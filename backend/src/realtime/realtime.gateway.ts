import { UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { ACCESS_COOKIE } from '../auth/auth.constants';
import { originAllowed, publishedOrigins } from '../common/origin';
import { PresenceService } from '../presence/presence.service';
import {
  EVENT_COUNTS_ONLINE,
  EVENT_PRESENCE_HELLO,
  EVENT_PRESENCE_PLAYING,
  WS_MAX_EVENT_BYTES,
  WS_NAMESPACE,
  WS_PATH,
  WS_PING_INTERVAL_MS,
  WS_PING_TIMEOUT_MS,
  userRoom,
} from './realtime.constants';
import { PresencePlayingDto } from './dto/presence-playing.dto';
import { SessionAuthService, readCookie } from './session-auth';
import { SilentEventRejectionFilter } from './silent-event-rejection.filter';


// What the handshake middleware puts on a socket before it connects. A socket
// that fails the gate never reaches `handleConnection`, so both fields are set
// on every socket this class sees.
type SessionData = { userId?: string; username?: string };

// The session socket: one connection per tab, authenticated by the same httpOnly
// `token` cookie the API uses. Presence rides on it (Phase 1): the connection is
// the liveness signal, `presence:playing` is the only thing the client sends, and
// the account's online count reaches every socket as `counts:online`. Rooms,
// friendships and notifications join it in later phases.
//
// Throttling is off by decision: every event this socket carries is
// edge-triggered and idempotent, and the global HTTP guard cannot count a
// websocket anyway.
@SkipThrottle()
@WebSocketGateway({
  namespace: WS_NAMESPACE,
  path: WS_PATH,
  pingInterval: WS_PING_INTERVAL_MS,
  pingTimeout: WS_PING_TIMEOUT_MS,
  maxHttpBufferSize: WS_MAX_EVENT_BYTES,
  // The Origin gate, at the engine level so it also refuses a raw WebSocket
  // upgrade (a browser never applies CORS to `new WebSocket`). `originAllowed`
  // is the same rule the CSRF middleware uses, over the same allow-list.
  allowRequest: (req, callback) => {
    callback(null, originAllowed(req.headers.origin, publishedOrigins()));
  },
  cors: {
    origin: (origin, callback) => {
      callback(null, originAllowed(origin, publishedOrigins()));
    },
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Namespace;

  // userId -> that account's live socket ids, for the broadcaster's rooms diff.
  // Presence knows the same thing in Redis, but this is read on every flush and
  // must not cost a round trip per event.
  private connected = new Map<string, Set<string>>();

  constructor(
    private readonly auth: SessionAuthService,
    private readonly presence: PresenceService,
  ) {}


  // The handshake gate. Refusing here reaches the client as `connect_error`,
  // which a socket disconnected after `connection` cannot produce.
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      void this.authenticate(socket, next);
    });
  }

  // A registered socket joins its account's room, is counted as a presence
  // connection, and only then is told it is ready. The order matters: `hello` is
  // the ack a probe reads as "counted", not "opened".
  async handleConnection(socket: Socket): Promise<void> {
    const data = socket.data as SessionData;
    if (!data.userId) {
      // Unreachable: the handshake gate refuses a socket without a user. Kept so
      // the room join below can never run with `user:undefined`.
      socket.disconnect(true);
      return;
    }
    socket.join(userRoom(data.userId));
    const sockets = this.connected.get(data.userId) ?? new Set<string>();
    sockets.add(socket.id);
    this.connected.set(data.userId, sockets);
    await this.presence.openConnection(data.userId, socket.id);
    socket.emit(EVENT_PRESENCE_HELLO);

    // The badge's first paint (D11). The live number is a namespace emit from the
    // broadcaster, but `presence:count` is coalesced to one push per 5 s, so a
    // socket connecting between two edges would sit without a number. This hands
    // it the cached one; a cold cache is not a hole, because the connection above
    // started a push of its own.
    const count = this.presence.currentCount();
    if (count !== null) socket.emit(EVENT_COUNTS_ONLINE, { count });
  }

  // Only this socket's member leaves the account's connection set. The presence
  // row lapses on its own TTL, and the service publishes the offline edge when it
  // does (D3: never `clear()` on disconnect).
  async handleDisconnect(socket: Socket): Promise<void> {
    const data = socket.data as SessionData;
    if (!data.userId) return;
    const sockets = this.connected.get(data.userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) this.connected.delete(data.userId);
    }
    await this.presence.closeConnection(data.userId, socket.id);
  }

  // The accounts the rooms diff has to consider. A tab that closed is gone from
  // the map at once, so a stale viewer never keeps a cached payload alive.
  connectedUserIds(): string[] {
    return [...this.connected.keys()];
  }

  // One account's sockets, by its room: the revocation push already relies on the
  // same room, so a per-user event needs no extra bookkeeping.
  emitToUser(userId: string, event: string, payload: unknown): void {
    if (!this.server) return;
    this.server.in(userRoom(userId)).emit(event, payload);
  }

  // The only client -> server event (D3). The pipe is explicit because a gateway
  // handler is not a controller: an unknown field is stripped, a non-boolean is
  // refused, and the service ignores an event that races the socket's close. A
  // refused payload is dropped silently (no ack is expected, and logging it would
  // be one ERROR per packet on an unthrottled socket).
  @UseFilters(SilentEventRejectionFilter)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @SubscribeMessage(EVENT_PRESENCE_PLAYING)
  async onPresencePlaying(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: PresencePlayingDto,
  ): Promise<void> {
    const data = socket.data as SessionData;
    if (!data.userId) return;
    await this.presence.setPlaying(data.userId, socket.id, dto.playing);
  }

  // The badge push. One number for every socket: it is site-wide by definition,
  // and filtering it per viewer would be a second source of truth.
  emitCountsOnline(count: number): void {
    if (!this.server) return;
    this.server.emit(EVENT_COUNTS_ONLINE, { count });
  }

  // A revoked session closes its sockets by push (D4), on that account's room
  // only: `disconnectSockets()` with no room would cut every connected client.
  disconnectUser(userId: string): void {
    if (!this.server) return; // a revocation before the socket server is attached
    this.server.in(userRoom(userId)).disconnectSockets(true);
  }

  private async authenticate(socket: Socket, next: (err?: Error) => void): Promise<void> {
    const token = readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }
    const user = await this.auth.verify(token);
    if (!user) {
      next(new Error('Invalid token'));
      return;
    }
    const data = socket.data as SessionData;
    data.userId = user.id;
    data.username = user.username;
    next();
  }
}
