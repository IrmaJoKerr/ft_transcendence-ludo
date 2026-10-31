// The session socket: one namespace on the backend, on its own path so it cannot
// collide with the engine's default /socket.io/ (the SPA holds both sockets).
export const WS_NAMESPACE = '/ws';
export const WS_PATH = '/ws-socket.io';

// Detection at ~40 s, deliberately below the 45 s presence TTL
// (PRESENCE_TTL_S in presence/presence.constants.ts): a dead peer's socket closes
// before its presence key lapses, so every transition comes from a disconnect,
// never a race between the two timers.
export const WS_PING_INTERVAL_MS = 20_000;
export const WS_PING_TIMEOUT_MS = 20_000;

// Same 64 KB cap as the engine's sockets (MAX_EVENT_BYTES there). The largest
// inbound event here is one boolean, so anything bigger is a bug or a flood.
export const WS_MAX_EVENT_BYTES = 64 * 1024;

// The room every socket of one account joins at connect. The revocation push
// addresses it: `disconnectSockets()` with no room would cut every client.
export const userRoom = (userId: string): string => `user:${userId}`;

// The readiness ack: emitted once a socket is registered (authenticated, in its
// room, presence connection counted). It is what tells a probe the connection
// counts, not merely opened.
export const EVENT_PRESENCE_HELLO = 'presence:hello';

// The one client -> server event (D3): a per-connection "in a match" bit, sent on
// game enter/leave and re-asserted on every connect.
export const EVENT_PRESENCE_PLAYING = 'presence:playing';

// The site-wide badge, pushed from the broadcaster's `presence:count` channel.
export const EVENT_COUNTS_ONLINE = 'counts:online';

// The lobby and the rejoin banner, from the broadcaster's `rooms:changed`
// handling. `rooms:list` is per viewer because a row carries `mySeat` (D1);
// `rooms:mine` is the account's own seats.
export const EVENT_ROOMS_LIST = 'rooms:list';
export const EVENT_ROOMS_MINE = 'rooms:mine';

// One row of the friendship graph, already viewer-relative (D2): `{ state, friend }`
// with `state` relative to the recipient. It arrives on the broadcaster's
// `friendship:<recipientId>` channel.
export const EVENT_FRIENDSHIP_CHANGED = 'friendship:changed';

// The friendship audience is a room, not a graph fan-out: every socket joins its
// *own* account's room in `handleConnection`, so the id comes from the handshake
// and a crafted join cannot read another user's rows. Joining at connect (rather
// than on a client event) also removes the subscribe-before-first-paint race: the
// listener exists for the whole life of the connection.
export const friendsRoom = (userId: string): string => `friends:of:${userId}`;
