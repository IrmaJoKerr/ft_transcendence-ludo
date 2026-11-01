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
  /** The corners a joiner may still claim, in canonical order (the join palette's list). */
  freeColors?: string[];
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

// The five viewer-relative states of one friendship row (socket D2): the same
// record drives the friends, requests and blocked lists, and `none` deletes the
// row from all three.
export type FriendshipViewState = 'accepted' | 'pending-in' | 'pending-out' | 'blocked' | 'none';

// One row of `friendship:changed`, already in the recipient's own terms:
// `friendsSince` is when the current state began (friends since / blocked since /
// requested at) and `requestId` is set while a request is pending, because that is
// the id accept/decline take.
export type FriendshipFriend = {
  id: string;
  username: string;
  displayName: string;
  avatarStyle: string;
  avatarV?: number;
  hasAvatarPhoto: boolean;
  rating: number;
  friendsSince: string | null;
  requestId?: string;
};

export type FriendshipRecord = {
  state: FriendshipViewState;
  friend: FriendshipFriend;
};

// One notification frame: the shape the socket carries and the bell stores. The
// unread snapshot is an array of these, newest first.
export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'friend_removed'
  | 'friend_declined'
  | 'game_invite'
  | 'achievement'
  | 'match_finished'
  | 'match_cancelled'
  | 'profile_updated'
  | 'display_name_changed'
  | 'friend_online'
  | 'friend_offline'
  | 'avatar_changed';

export type Notification = {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string;
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
  // One changed friendship row, viewer-relative. The socket joins its account's
  // `friends:of:` room at connect, so every tab receives it with no subscribe.
  'friendship:changed': (record: FriendshipRecord) => void;
  // One notification frame, on the account's `user:` room (or every socket for a
  // global broadcast). Replaces the SSE event of the same shape.
  'notification': (event: Notification) => void;
  // The connect snapshot: the account's unread list, re-sent on every (re)connect.
  // It is the bell's only read path.
  'notifications:unread': (list: Notification[]) => void;
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
