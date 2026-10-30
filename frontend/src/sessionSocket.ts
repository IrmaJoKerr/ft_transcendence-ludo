import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

// The session socket (socket consolidation): one connection per signed-in tab on
// the backend's `/ws` namespace, on its own path so it cannot collide with the
// engine's game socket at `/socket.io/`. Presence rides on it today; the room,
// friendship and notification pushes join it in later phases.
// One row of the lobby, as `rooms:list` carries it. `mySeat` is viewer-relative:
// the broadcaster derives the list per account (D1).
export type LobbyRoom = {
  id: string;
  roomCode: string;
  host: string;
  hostUsername?: string;
  hostId?: string;
  hasAvatarPhoto?: boolean;
  seats: number;
  maxSeats: number;
  mode: 'classic' | 'duel';
  mySeat?: boolean;
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
  clashKeyShift?: 0 | 1 | 2;
};

// One row of `rooms:mine`: the account's own seats (rejoin banner, "has a game").
export type MyRoom = {
  id: string;
  roomCode: string | null;
  status: string;
  gameType: string;
  seats: number;
  maxSeats: number;
};

export type SessionServerEvents = {
  // Emitted once a socket is registered, which is when it counts as online.
  'presence:hello': () => void;
  // The site-wide badge: one number for every socket.
  'counts:online': (event: { count: number }) => void;
  // The open lobby, filtered for this viewer (a row carries `mySeat`).
  'rooms:list': (rooms: LobbyRoom[]) => void;
  // This account's own seats.
  'rooms:mine': (rooms: MyRoom[]) => void;
};

export type SessionClientEvents = {
  // The only client -> server event (D3): a per-connection "in a match" bit.
  'presence:playing': (event: { playing: boolean }) => void;
};

export type SessionSocket = Socket<SessionServerEvents, SessionClientEvents>;

// Same origin as the page: nginx (or, in dev, the Vite proxy) forwards
// /ws-socket.io/ to the backend, so the browser never needs its real host/port.
// `withCredentials` is what sends the httpOnly `token` cookie the handshake
// authenticates on; the token is never exposed to JS.
export function connectSessionSocket(): SessionSocket {
  return io(`${window.location.origin}/ws`, {
    path: '/ws-socket.io',
    withCredentials: true,
    transports: ['websocket'],
    // A signed-in tab should outlive a tunnel blip. The auth-failure path in the
    // store is what bounds a genuinely dead session, not this count.
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 5000,
  });
}
