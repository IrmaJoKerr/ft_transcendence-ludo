import type { RedisGameStore } from '../redis';
import type { ConnectionCounter } from './connection-counter';
import type { GameSocket } from './auth';
import { GUEST_TOKEN_PREFIX, verifyToken } from './auth';

// One account may hold a handful of sockets: one active per device, one stale while a
// refresh reconnects, one for a clash pipe if that ever ships, and one slack. Four
// covers a reconnect and stays tight; three would break the day a pipe is added.
export const MAX_SOCKETS_PER_USER = 4;

interface HandshakeDeps {
  store: RedisGameStore;
  connections: ConnectionCounter;
}

// The handshake middleware: resolve the token once, stamp the socket, and take the
// account's slot. Kept out of the composition root so the rule can be read on its
// own; the caller still owns the io server and the connection counter.
export function createHandshakeAuth({ store, connections }: HandshakeDeps) {
  return async (socket: GameSocket, next: (err?: Error) => void): Promise<void> => {
    try {
      const token = socket.handshake.auth?.token;
      // A token is mandatory: bots are driven server-side and the SPA always
      // supplies one.
      if (!token || typeof token !== 'string') {
        next(new Error('Authentication required'));
        return;
      }

      // Guest branch: an opaque `g_` token resolved from the backend's registry.
      // That record is the authority for the room, seat and mode; none of it comes
      // from the client. A forged token is "not found", not a refused signature.
      if (token.startsWith(GUEST_TOKEN_PREFIX)) {
        const guest = await store.getGuestSession(token);
        if (!guest) {
          next(new Error('Invalid token'));
          return;
        }
        socket.data.userId = guest.userId;
        // Display fallback only: the client may send its own localized name
        // in join_game, which the join path prefers.
        socket.data.username = 'Guest';
        socket.data.displayName = 'Guest';
        socket.data.gameId = guest.gameId;
        socket.data.tokenGameId = guest.gameId;
        socket.data.role = 'player';
        socket.data.tokenColor = guest.color;
        socket.data.mode = 'pve';
        socket.data.isGuest = true;
        socket.data.guestIpHash = guest.ipHash;
        socket.data.guestTokenHash = guest.tokenHash;
        // Same per-account cap as a player: a guest id is unique per mint, so
        // this bounds one room's sockets, not the whole guest population.
        if (!connections.acquire(guest.userId, MAX_SOCKETS_PER_USER)) {
          next(new Error('Too many connections'));
          return;
        }
        next();
        return;
      }

      const payload = verifyToken(token);
      if (!payload) {
        next(new Error('Invalid token'));
        return;
      }

      socket.data.userId = payload.userId;
      socket.data.username = payload.username;
      socket.data.displayName = payload.displayName;
      socket.data.gameId = payload.gameId;
      // Token-pinned match id: unlike gameId this survives detachSocket(), so a
      // refused socket can never re-join a different game.
      socket.data.tokenGameId = payload.gameId;
      socket.data.role = payload.role as 'player';
      socket.data.tokenColor = payload.color;
      socket.data.mode = payload.mode as 'pvp' | 'pve' | 'hotseat' | undefined;
      // Per-user socket cap. Refusing here reaches the client as `connect_error`, so a
      // flood from one account never becomes dozens of live sockets.
      if (!connections.acquire(payload.userId, MAX_SOCKETS_PER_USER)) {
        next(new Error('Too many connections'));
        return;
      }
      next();
    } catch (error) {
      console.error('Socket handshake failed:', error instanceof Error ? error.message : error);
      next(new Error('Authentication failed'));
    }
  };
}
