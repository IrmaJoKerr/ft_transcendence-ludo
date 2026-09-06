# Ludo Engine — Socket.IO Events

## Table of Contents

- [Overview](#overview) — Socket.IO server, connection, and event protocol
- [Files](#files) — Source file inventory
- [Connection](#connection) — Handshake auth and JWT
- [Client → Server Events](#client--server-events) — Events emitted by the client
- [Server → Client Events](#server--client-events) — Events broadcast by the server
- [Event Reference](#event-reference) — Complete event payload reference
- [Configuration](#configuration) — Socket.IO server settings

---

## Overview

The ludo-engine exposes a Socket.IO server on port 3001. All game communication happens through events. The engine requires JWT authentication in the handshake `auth` object.

The server is started by `index.ts` which calls `SocketServer.start(3001)`. The `SocketServer` class in `socket/server.ts` is the orchestration root / composition root: it constructs and wires **all** of the engine's split services — `RedisGameStore` (persistence), `EventPublisher` (Redis pub/sub), `RedisBroadcaster` (room state broadcasts), `ClashManager` (clash QTE), `LudoEngine` (game state machine), `LobbyManager` (colors + ready check), `ResultSubmitter` (POST /api/game/end callback), `SocketHandlers` (which delegates `join_game` to `JoinManager`), `BotTurnScheduler` (bot turn timers), and `PostGameManager` (post-game timeout, `end_game`) — then routes engine events and socket events to those modules.

---

## Files

| File | Role |
|------|------|
| `index.ts` | Entry point — `SocketServer.start(3001)` |
| `socket/server.ts` | `SocketServer` — composition root: constructs/wires `RedisGameStore`, `EventPublisher`, `RedisBroadcaster`, `ClashManager`, `LudoEngine`, `LobbyManager`, `ResultSubmitter`, `SocketHandlers` (+ `JoinManager`), `BotTurnScheduler`, `PostGameManager`; also JWT middleware, engine-event routing, and socket wiring |
| `socket/auth.ts` | `GameSocket` type, JWT extraction middleware |
| `socket/socket-handlers.ts` | `SocketHandlers` — client→server gameplay/lobby/lifecycle handlers; delegates `join_game` to `JoinManager` |
| `socket/join-manager.ts` | `JoinManager` — the `join_game` flow (seat resolution, game creation, reconnects, auto-start, resume) |
| `socket/bot-scheduler.ts` | `BotTurnScheduler` — bot turn timers + clash-freeze gating |
| `socket/post-game.ts` | `PostGameManager` — post-game timeout, `end_game` |
| `socket/event-publisher.ts` | Redis pub/sub → Socket.IO bridge for multi-instance scaling |
| `socket/redis-broadcaster.ts` | Room-based state broadcasts via Redis |
| `socket/result-submitter.ts` | POST /api/game/end callback to backend |

---

## Connection

### Handshake

Connect to the engine with a JWT token in the `auth` object. The browser connects to its **own origin** (`/socket.io/`), which nginx (or the Vite proxy) forwards to the engine:

```js
const io = require('socket.io-client');
const socket = io(window.location.origin, {   // same-origin → nginx → ludo-engine
  auth: { token: '<jwt-from-match-endpoint>' },
  transports: ['websocket'],
});
```

The JWT payload (issued by `MatchService`) contains:

```json
{
  "gameId": "uuid",
  "playerId": "user-id",
  "username": "username",
  "displayName": "Display Name",
  "role": "player1" | "player",
  "mode": "pvp" | "pve" | "hotseat"
}
```

### JWT Validation

The `socket/auth.ts` middleware reads the token from `socket.handshake.auth.token` and verifies it with a minimal HMAC-SHA256 check (no external JWT library). It maps `playerId`/`sub`/`userId` to `socket.data.userId`, and attaches `role`, `gameId`, `username`, and `displayName` to `socket.data`. Invalid or missing tokens are rejected with an `error` event.

### Connection flow

```mermaid
sequenceDiagram
    participant Player
    participant Engine as LudoEngine (socket server)

    Player->>Engine: Connect with the game token
    Engine->>Engine: Check the token is valid
    Player->>Engine: join_game (gameId, color)
    Engine-->>Player: game_joined (the board state)
    Player->>Engine: roll_dice
    Engine-->>Player: dice_rolled (value + movable pieces)
    Player->>Engine: move_piece (pieceId)
    Engine-->>Player: piece_moved
    Engine-->>Player: game_ended (if someone won)
```

### Rooms

- Each game has a room named `game:{gameId}`.
- Players join the room via `join_game`.
- Server broadcasts to a room using `io.to(room).emit(...)`.

---

## Client → Server Events

### `join_game`

Join or create a game room.

```js
socket.emit('join_game', gameId, playerColor, userId?, displayName?);
```

| Param | Type | Notes |
|---|---|---|
| `gameId` | string | Match UUID |
| `playerColor` | `'red'` \| `'green'` \| `'yellow'` \| `'blue'` | Your chosen color |
| `userId` | string | (optional) Override for bots |
| `displayName` | string | (optional) Display name for the seat |

**Response:** `game_joined` event with full `GameState`

**Errors:** `error` event with message.

---

### `end_game`

End the game prematurely (host/admin action).

```js
socket.emit('end_game');
```

**Response:** `game_ended` / `player_aborted` broadcast.

---

### `roll_dice`

Roll the dice for the current turn.

```js
socket.emit('roll_dice');
```

**Response:** `dice_rolled` event (broadcast to all in room)

**Errors:** `error` if not your turn, wrong phase, or player exited.

---

### `move_piece`

Move a piece using a legal pieceId.

```js
socket.emit('move_piece', pieceId);
```

| Param | Type | Notes |
|---|---|---|
| `pieceId` | string | e.g. `"red-0"` |

**Response:** `piece_moved` event (broadcast to all in room)

**Errors:** `error` if piece not in current legal moves.

---

### `player_ready`

Signal that the current player is ready to start the game.

```js
socket.emit('player_ready');
```

**Response:** None

---

### `select_color`

Select a color for the player (used during lobby/color selection phase).

```js
socket.emit('select_color', color);
```

| Param | Type | Notes |
|---|---|---|
| `color` | string | e.g. `"red"` |

**Response:** None

---

### `leave_game`

Leave the current game (acknowledges leaving after game has ended).

```js
socket.emit('leave_game');
```

**Response:** None

---

### `resign`

Forfeit the game voluntarily.

```js
socket.emit('resign');
```

**Response:** `player_exited` event (broadcast to all)

---

### `disconnect`

Automatically handled by Socket.IO on connection drop.

```js
// No manual emit needed — Socket.IO handles this
```

**Response:** `player_exited` event (broadcast)

---

## Server → Client Events

| Event | Payload | When |
|---|---|---|
| `game_joined` | `GameState` (full state) | After `join_game` |
| `dice_rolled` | `{ value, legalMoves, bonusRoll, currentTurn, forfeited? }` | After dice rolled |
| `piece_moved` | `MoveResult` | After piece moved |
| `game_started` | `{ gameId }` | Game transitions from waiting → active |
| `game_ended` | `{ winner, resultDetail }` | Game finished |
| `game_timeout` | none | Post-game lobby expired (60s) — finished room torn down |
| `game_expired` | none | Idle lobby expired (5 min, < 2 seated) |
| `player_exited` | `{ color }` | Player disconnected/resigned |
| `player_aborted` | `{ color, username }` | A player aborted the game |
| `player_disconnected` | `{ color }` | A player's connection dropped |
| `player_reconnected` | `{ color }` | A player reconnected |
| `lobby_update` | `{ players: [{ userId, username, avatarStyle, color, ready }] }` | Lobby seats changed |
| `color_selected` | `{ gameId, userId, color }` | A player picked a color |
| `state_update` | `any` (parsed JSON) | Generic catch-all for any Redis pub/sub message |
| `error` | `string` | On invalid action |

---

## Event Reference

### GameState

```typescript
{
  id: string;                          // Unique game id (same as the match gameId)
  pieces: Piece[];                     // 16 pieces: 4 per player × 4 players
  players: PlayerMeta[];               // Per-seat player info (status, name, stats)
  currentTurn: PlayerColor;            // Whose turn it is
  consecutiveSixes: number;            // Current 6-streak (a third 6 forfeits the turn)
  moveCounter: number;                 // Total moves made in the game
  turnPhase: 'WAITING_FOR_ROLL' | 'WAITING_FOR_MOVE';  // Must the player roll, or move?
  firstRollOfTurn: boolean;            // True until the six-bonus has been used once during the current player's turn-holding streak
  pendingLegalMoves: LegalMove[];      // Server-authoritative legal moves after a roll
  pendingDiceValue?: number;           // Dice value from the most recent roll (server-authoritative)
  pendingIsFirstRoll?: boolean;        // Whether pendingDiceValue came from the first roll of the turn
  disconnectedPlayers: DisconnectState[];  // Players temporarily disconnected (grace period)
  status: 'waiting' | 'active' | 'finished';  // Game lifecycle state
  winner?: PlayerColor;                // Winner color once the game is finished
  resultDetail?: string;               // Human-readable finish reason (all pieces home / forfeit)
  resultSubmitted?: boolean;           // Prevents duplicate backend submissions
  botBusy?: boolean;                   // Prevents overlapping bot turns
  clash?: ClashState;                  // Active clash QTE, if any
  clashMode: boolean;                  // Clash minigame on vs standard capture
  safeZones: boolean;                  // Safe/star squares capture-immune
  readyPlayers: PlayerColor[];         // Players who have clicked "ready"
  pendingCapture?: PendingCapture;     // Capture deferred until the clash resolves
  resultCardUntil?: number;            // Input freeze while the clash result card shows
  paused?: boolean;                    // Whether the game is currently paused
  pauseTurnOwner?: PlayerColor;        // Whose turn it was when the game paused
}
```

### PlayerMeta

```typescript
{
  color: PlayerColor;                  // Seat color
  status: 'active' | 'exited' | 'inactive' | 'disconnected';  // Player lifecycle state
  username: string;                    // Seat/display name
  displayName?: string;                // Optional display name
  isBot: boolean;                      // Whether this seat is a bot
  isConnected: boolean;                // Whether the player's socket is currently connected
  piecesInGoal: number;                // Pieces finished (0-4)
  hasRolled: boolean;                  // Whether the player has rolled this turn
  consecutiveSixes: number;            // Per-player 6-streak (resets on turn advance)
  bonusRoll: boolean;                  // Rolled a 6 → rolls again
  isFinished: boolean;                 // All 4 pieces in goal
  finishedAt?: string;                 // ISO timestamp when the player finished
  stats: {  // Per-game counters
    turns: number;                     // Turns taken in this game
    captures: number;                  // Pieces captured in this game
    piecesInGoal: number;              // Pieces that reached goal in this game
    clashDefends: number;              // Clashes defended (won as defender)
    clashAttacksWon: number;           // Clashes won as attacker
  };
}
```

### Piece

```typescript
{
  id: PieceId;          // e.g. "red-0"
  color: PlayerColor;   // Piece owner
  step: number;         // -1=exited, 0=prison, 1-51=track, 52-56=home lane, 57=goal
  isInGoal?: boolean;   // true when step === 57
  isInBase?: boolean;   // true when step <= 0
}
```

### MoveResult

```typescript
{
  ply: number;                 // Move number (increments each move in the game)
  color: PlayerColor;          // Player who moved
  diceValue: number;           // The roll that produced the move
  pieceId: PieceId;            // Which piece moved
  from: number;                // Starting step
  path: number[];              // Every intermediate step from `from`+1 through `to`, for step-by-step animation
  to: number;                  // Landing step
  captured: boolean;           // Whether this move captured an opponent piece
  capturedPieceIds?: PieceId[];  // Opponent pieces sent home from the landing square (a stacked block sends all of them back)
  enteredHome: boolean;        // Whether the piece entered the home lane
  bonusRoll: boolean;          // Player rolled a 6 → rolls again
  clashOutcome?: 'attacker_won' | 'defender_won';  // Set when this move ended a clash
}
```

---

## Configuration

| Variable | Default | Used By |
|----------|---------|---------|
| `PORT` | 3001 | Socket.IO server listen port |
| `REDIS_HOST` | `redis` | Redis pub/sub and game store |
| `REDIS_PORT` | `6479` | Redis port |
| `REDIS_PASSWORD` | (from secrets) | Redis authentication |
| `BACKEND_URL` | `http://localhost:3000` | Engine callback URL |
| `ENGINE_API_KEY` | (from secrets) | Validates engine→backend callbacks |

### Tunable constants

Module-level constants in the socket layer — edit the value at the top of the file to tweak behaviour:

| Constant | File | Default | What it controls |
|----------|------|---------|------------------|
| `IDLE_LOBBY_TIMEOUT_MS` | `socket/server.ts` | 5 min | A WAITING room (< 2 seated) is aborted after this long idle |
| `POST_GAME_TIMEOUT_MS` | `socket/server.ts` | 60 s | Post-game room auto-times-out after a game ends |
| `BOT_STEP_ANIM_MS` | `socket/server.ts` | 220 ms | Per-step piece-move animation pacing used to time bot turns |
| `BOT_THINK_MS` | `socket/server.ts` | 500 ms | Flat "thinking" pause before a bot rolls |
| `DICE_ANIM_MS` | `socket/server.ts` | 750 ms | Frontend dice-roll animation wait before a bot acts |
| `LOBBY_SWEEP_INTERVAL_MS` | `socket/server.ts` | 60 s | How often the lobby-expiry sweep runs |
| `SLOT_COLORS` | `socket/socket-handlers.ts` | blue, red, green, yellow | Seat order used when creating games / auto-filling bot seats |
| `BOT_PREFIX` | `socket/auth.ts` | `bot-` | Prefix that marks a user id as a bot |
| `BACKEND_URL` | `socket/auth.ts` | `http://backend:3000` | Base URL the engine POSTs results to (env `BACKEND_URL`) |