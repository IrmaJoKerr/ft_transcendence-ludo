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
import { CHAT_COOLDOWN_MS, CHAT_MAX_CHARS } from '../chat/chat.constants';
import { ChatService, type ChatAck, type ChatMessage } from '../chat/chat.service';
import { ChatSendDto } from '../chat/dto/chat-send.dto';
import { originAllowed, publishedOrigins } from '../common/origin';
import type { FriendshipViewState } from '../friends/friendship-record';
import { BlockStateService } from '../friends/block-state.service';
import { PresenceService } from '../presence/presence.service';
import { NotificationService } from '../notification/notification.service';
import type { NotificationPayload } from '../notification/notification.service';
import {
  EVENT_CHAT_HISTORY,
  EVENT_CHAT_MESSAGE,
  EVENT_CHAT_SEND,
  EVENT_COUNTS_ONLINE,
  EVENT_FRIENDSHIP_CHANGED,
  EVENT_NOTIFICATIONS_UNREAD,
  EVENT_NOTIFICATION,
  EVENT_PRESENCE_HELLO,
  EVENT_PRESENCE_PLAYING,
  WS_MAX_EVENT_BYTES,
  WS_NAMESPACE,
  WS_PATH,
  WS_PING_INTERVAL_MS,
  WS_PING_TIMEOUT_MS,
  friendsRoom,
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
// the liveness signal and `presence:playing` is one of the two things the client
// sends, the other being a chat line. The account's online count reaches every
// socket as `counts:online`. Rooms, friendships, notifications and the public
// chat channel join it in the later phases.
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

  // userId -> the ids that account has blocked. The chat filter's per-recipient
  // half (queue item 3): seeded at connect from one Prisma read and kept current
  // from `friendship:changed`, so filtering a frame costs no query. The other half
  // travels with the frame, because a block is never announced to the side it
  // hides from.
  private blocked = new Map<string, Set<string>>();

  // socket.id -> when it last sent a chat line, the channel's only throttle. A
  // disconnect drops the row; nothing else grows.
  private lastChatAt = new Map<string, number>();

  constructor(
    private readonly auth: SessionAuthService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationService,
    private readonly chat: ChatService,
    private readonly blocks: BlockStateService,
  ) {}


  // The handshake gate. Refusing here reaches the client as `connect_error`,
  // which a socket disconnected after `connection` cannot produce.
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      void this.authenticate(socket, next);
    });
    // The notification sink (Phase 4): the hub owns storage and the Redis
    // pub/sub, this gateway owns delivery. `all` is the one global channel; a
    // user id is a room, so every tab of that account receives the frame.
    this.notifications.setDeliverer((target, event) => {
      this.emitNotification(server, target, event);
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
    void socket.join(userRoom(data.userId));
    // The friendship audience (D2): the same connection, a second room. Every tab
    // of this account receives every record published to it; a socket that never
    // opens a friends screen simply drops the frames.
    void socket.join(friendsRoom(data.userId));
    const sockets = this.connected.get(data.userId) ?? new Set<string>();
    sockets.add(socket.id);
    this.connected.set(data.userId, sockets);
    // The chat filter's seed: one read, awaited so a line sent straight after the
    // handshake cannot slip past it. A failed read leaves an empty set; the live
    // `friendship:changed` record repairs it on the next block.
    try {
      this.blocked.set(data.userId, new Set(await this.blocks.blockedIds(data.userId)));
    } catch (error) {
      this.blocked.set(data.userId, new Set());
      console.error('[realtime] blocked seed failed:', error);
    }
    await this.presence.openConnection(data.userId, socket.id);
    socket.emit(EVENT_PRESENCE_HELLO);

    // The badge's first paint (D11). The live number is a namespace emit from the
    // broadcaster, but `presence:count` is coalesced to one push per 5 s, so a
    // socket connecting between two edges would sit without a number. This hands
    // it the cached one; a cold cache is not a hole, because the connection above
    // started a push of its own.
    const count = this.presence.currentCount();
    if (count !== null) socket.emit(EVENT_COUNTS_ONLINE, { count });

    // The bell's first paint and its repair after a reconnect (Phase 4). It is
    // the only read path; the client merges it by id, so a frame that arrives
    // while this read is in flight is not lost and not duplicated.
    try {
      socket.emit(EVENT_NOTIFICATIONS_UNREAD, await this.notifications.getUnread(data.userId));
    } catch (error) {
      // A Redis hiccup must not refuse the socket: the next connect retries.
      console.error('[realtime] unread snapshot failed:', error);
    }

    // The transcript, oldest first, re-sent on every (re)connect like the bell's
    // unread list, so a frame missed while the socket was down is repaired. The
    // panel merges by id: this list's tail and the last live frame may overlap.
    try {
      socket.emit(EVENT_CHAT_HISTORY, await this.chat.history());
    } catch (error) {
      console.error('[realtime] chat history failed:', error);
    }
  }

  // One notification frame, to one account's room or to every socket. The
  // deliverer hands it here, so the routing rule lives with the rooms.
  private emitNotification(
    server: Namespace,
    target: string | 'all',
    event: NotificationPayload,
  ): void {
    if (target === 'all') {
      server.emit(EVENT_NOTIFICATION, event);
      return;
    }
    server.in(userRoom(target)).emit(EVENT_NOTIFICATION, event);
  }

  // One viewer-relative record, to every tab that account has open (D2). The
  // payload was built by the publisher, so this is a route, not a query.
  emitToFriends(userId: string, record: unknown): void {
    if (!this.server) return;
    this.server.in(friendsRoom(userId)).emit(EVENT_FRIENDSHIP_CHANGED, record);
  }

  // One chat frame to every socket, minus the pairs a block hides: the recipient's
  // own list and the sender's, because either direction is enough. The sender's
  // list travelled with the frame, so no per-recipient query runs and an instance
  // with none of the sender's sockets can still filter correctly.
  emitChat(message: ChatMessage, senderBlocked: readonly string[]): void {
    if (!this.server) return;
    const senderBlocks = new Set(senderBlocked);
    for (const socket of this.server.sockets.values()) {
      const viewer = (socket.data as SessionData).userId;
      if (!viewer) continue;
      if (viewer !== message.senderId) {
        if (senderBlocks.has(viewer)) continue;
        if (this.blocked.get(viewer)?.has(message.senderId)) continue;
      }
      socket.emit(EVENT_CHAT_MESSAGE, message);
    }
  }

  // A friendship record is also the chat filter's update path (queue item 3). Only
  // the recipient's own block is in it, which is why the sender's list rides each
  // frame: the side a block hides from is told `none`, never `blocked`.
  noteBlockState(userId: string, state: FriendshipViewState, friendId: string): void {
    const set = this.blocked.get(userId);
    if (!set) return;
    if (state === 'blocked') set.add(friendId);
    else if (state === 'none') set.delete(friendId);
  }

  // Only this socket's member leaves the account's connection set. The presence
  // row lapses on its own TTL, and the service publishes the offline edge when it
  // does (D3: never `clear()` on disconnect).
  async handleDisconnect(socket: Socket): Promise<void> {
    const data = socket.data as SessionData;
    this.lastChatAt.delete(socket.id);
    if (!data.userId) return;
    const sockets = this.connected.get(data.userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        this.connected.delete(data.userId);
        // The filter is per account, so the last tab's close is when it is dropped.
        this.blocked.delete(data.userId);
      }
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

  // The public channel's one write (queue item 3). Every refusal is an ack code
  // rather than silence, because the panel keeps the text and shows the reason in
  // its one status line: too long, too soon, nothing to send, or storage down.
  @UseFilters(SilentEventRejectionFilter)
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @SubscribeMessage(EVENT_CHAT_SEND)
  async onChatSend(
    @ConnectedSocket() socket: Socket,
    @MessageBody() dto: ChatSendDto,
  ): Promise<ChatAck> {
    const data = socket.data as SessionData;
    if (!data.userId) return { ok: false, error: 'CHAT_UNAVAILABLE' };

    const text = dto.text.trim();
    if (!text) return { ok: false, error: 'CHAT_EMPTY' };
    if (text.length > CHAT_MAX_CHARS) return { ok: false, error: 'CHAT_TOO_LONG' };

    const now = Date.now();
    if (now - (this.lastChatAt.get(socket.id) ?? 0) < CHAT_COOLDOWN_MS) {
      return { ok: false, error: 'CHAT_COOLDOWN' };
    }
    this.lastChatAt.set(socket.id, now);

    try {
      const message = await this.chat.append(
        { id: data.userId, username: data.username ?? '' },
        text,
      );
      // The sender's own block list rides the frame: it is how another instance
      // answers the reverse direction without a per-recipient query.
      await this.chat.publish({
        message,
        senderBlocked: [...(this.blocked.get(data.userId) ?? [])],
      });
      return { ok: true };
    } catch (error) {
      console.error('[realtime] chat send failed:', error);
      // The cooldown was spent on a line that never landed, so release it: a
      // storage failure must not also cost the sender two seconds.
      this.lastChatAt.delete(socket.id);
      return { ok: false, error: 'CHAT_UNAVAILABLE' };
    }
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
