import { SkipThrottle } from '@nestjs/throttler';
import {
  OnGatewayConnection,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { ACCESS_COOKIE } from '../auth/auth.constants';
import { originAllowed, publishedOrigins } from '../common/origin';
import {
  EVENT_PRESENCE_HELLO,
  WS_MAX_EVENT_BYTES,
  WS_NAMESPACE,
  WS_PATH,
  WS_PING_INTERVAL_MS,
  WS_PING_TIMEOUT_MS,
  userRoom,
} from './realtime.constants';
import { SessionAuthService, readCookie } from './session-auth';

// What the handshake middleware puts on a socket before it connects. A socket
// that fails the gate never reaches `handleConnection`, so both fields are set
// on every socket this class sees.
type SessionData = { userId?: string; username?: string };

// The session socket: one connection per tab, authenticated by the same httpOnly
// `token` cookie the API uses. No business event is handled yet (presence starts
// in Phase 1); what exists is the transport, the gate and the readiness ack.
//
// Throttling is off by decision: every event this socket will carry is
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
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private server!: Namespace;

  constructor(private readonly auth: SessionAuthService) {}

  // The handshake gate. Refusing here reaches the client as `connect_error`,
  // which a socket disconnected after `connection` cannot produce.
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      void this.authenticate(socket, next);
    });
  }

  // A registered socket joins its account's room and is told it is ready.
  handleConnection(socket: Socket): void {
    const data = socket.data as SessionData;
    if (!data.userId) {
      // Unreachable: the handshake gate refuses a socket without a user. Kept so
      // the room join below can never run with `user:undefined`.
      socket.disconnect(true);
      return;
    }
    socket.join(userRoom(data.userId));
    socket.emit(EVENT_PRESENCE_HELLO);
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
