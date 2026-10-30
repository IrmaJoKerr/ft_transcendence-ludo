// The session socket: one namespace on the backend, on its own path so it cannot
// collide with the engine's default /socket.io/ (the SPA holds both sockets).
export const WS_NAMESPACE = '/ws';
export const WS_PATH = '/ws-socket.io';

// Detection at ~40 s, deliberately below the 45 s presence TTL
// (PRESENCE_TTL_S in presence.service.ts): a dead peer's socket closes before its
// presence key lapses, so every transition comes from a disconnect, never a race
// between the two timers.
export const WS_PING_INTERVAL_MS = 20_000;
export const WS_PING_TIMEOUT_MS = 20_000;

// Same 64 KB cap as the engine's sockets (MAX_EVENT_BYTES there). The largest
// inbound event here is one boolean, so anything bigger is a bug or a flood.
export const WS_MAX_EVENT_BYTES = 64 * 1024;

// The room every socket of one account joins at connect. The revocation push
// addresses it: `disconnectSockets()` with no room would cut every client.
export const userRoom = (userId: string): string => `user:${userId}`;

// The readiness ack: emitted once a socket is registered (authenticated, in its
// room). It is what tells a probe the connection counts, not merely opened.
export const EVENT_PRESENCE_HELLO = 'presence:hello';
