# Ludo Engine — Redis Infrastructure

## Table of Contents

- [Overview](#overview) — Redis client setup and game state persistence
- [Files](#files) — Every source file and its role
- [Key Types / Interfaces](#key-types--interfaces) — Redis key patterns and data structures
- [Core Logic / Flow](#core-logic--flow) — Mermaid sequence diagrams for state persistence and pub/sub
- [What Redis Spawns Per Game Session](#what-redis-spawns-per-game-session) — The 3 keys created per game
- [How the Engine Handles Multiple Bots](#how-the-engine-handles-multiple-bots) — Cached per-color bot instances + server-driven turns
- [Piece-Level State](#piece-level-state-why-no-board-is-ever-built) — Why no board is ever built (incl. memory footprint + grid comparison)
- [Data Structures](#data-structures) — Redis key patterns and value formats
- [Dependencies](#dependencies) — External dependencies


---
---


## Overview

The Redis Infrastructure module provides the persistence and messaging layer for the Ludo Engine. It uses Redis for:

1. **Game state persistence** — stores active game state in Redis so games survive engine restarts and players can reconnect.
2. **Move history** — keeps the last 200 moves per game in a list.
3. **Match metadata** — a hash per match holding the seats, colors, and status (the lobby source of truth; readiness lives in the game state blob).
4. **Pub/sub messaging** — publishes game events to Redis channels for cross-instance broadcasting.


---
---


## Files

| File | Role |
|------|------|
| `redis.ts` | `RedisGameStore` class — persistence layer using ioredis for game state, moves, and match metadata; also `publish()` (PUBLISH to `game:{gameId}`) and the `subscriber` connection |
| `socket/event-publisher.ts` | `EventPublisher` — serialises each `GameEvent` into a pub/sub payload and calls `store.publish()` |
| `socket/redis-broadcaster.ts` | `RedisBroadcaster` — `PSUBSCRIBE game:*`, then forwards each message to the matching Socket.IO room |


---
---


## Key Types / Interfaces

### RedisGameStore (actual methods)

```typescript
class RedisGameStore {
  // Connections
  async connect(): Promise<void>                                          // Open the command and subscriber connections
  async disconnect(): Promise<void>                                       // Close both connections
  onReady(handler: () => void): void                                      // Run on every Redis `ready`, including the first connect (the wake trigger)
  async getAvatarMeta(userId: string): Promise<{ has: boolean; style?: string } | null>  // Read the cached avatar facts

  // Main state (hash field "state")
  async createGame(gameId: string, activeColors?: PlayerColor[]): Promise<void>   // Create a fresh game with all 16 pieces in prison
  async loadGameState(gameId: string): Promise<GameState | null>                                       // Load the full GameState (single HGET)
  async saveGameState(gameId: string, state: GameState): Promise<void>                                 // Save the full GameState (+ 24h expire)

  // Move history
  async recordMove(gameId: string, move: Move): Promise<void>                                          // Append a move (LPUSH + trim to 200)

  // Match metadata (lobby / color selection)
  async getMatchData(gameId: string): Promise<Record<string, string> | null>                           // Read the match hash (seats, colors, status)
  async updateMatchData(gameId: string, fields: Record<string, string>): Promise<void>                 // Update specific match-hash fields
  async scanMatchKeys(): Promise<string[]>                                                             // SCAN all match:* hashes
  async scanGameKeys(): Promise<string[]>                                                              // SCAN all game:* hashes (skips the :moves lists)
  async setIdleSince(gameId: string, now: number): Promise<number>                                     // Stamp idle time (room < 2 seated) with HSETNX, so an existing window is never restarted; returns the effective stamp the caller arms its timer from
  async clearIdleSince(gameId: string): Promise<void>                                                  // Clear the idle stamp (room ≥ 2 seated)
  async clearMatchSeat(gameId: string, color: PlayerColor): Promise<void>                              // Free a non-host seat (delete its row and account record)
  async reserveMatchSeat(gameId: string, color: PlayerColor): Promise<void>                            // Reserve a non-host seat (set player{N}_left)
  async setSeatUser(gameId: string, color: PlayerColor, userId: string): Promise<void>                 // Record which account took a seat
  async clearSeatUser(gameId: string, color: PlayerColor): Promise<void>                               // Drop a seat account record
  seatUserFrom(matchData: Record<string, string> | null, color: PlayerColor): string | undefined       // Read a seat account from a match hash
  async abortMatch(gameId: string): Promise<void>                                                      // Mark a match ABORTED with a short TTL

  // Teardown / publish
  async deleteGame(gameId: string): Promise<void>                                                      // Delete game state + move history for a match
  async publish(gameId: string, message: string): Promise<void>                                        // Publish a message on game:{gameId} (pub/sub)
}
```


---
---


## Core Logic / Flow

### 1. Game State Persistence

```mermaid
sequenceDiagram
    participant Engine as LudoEngine
    participant Store as RedisGameStore

    Note over Engine,Store: Saving
    Engine->>Store: saveGameState(gameId, state)
    Store->>Store: Write the whole game state
    Store-->>Engine: done

    Note over Engine,Store: Loading
    Engine->>Store: loadGameState(gameId)
    Store->>Store: Read the game state
    Store-->>Engine: the game state
```

### 2. Pub/Sub Messaging

```mermaid
sequenceDiagram
    participant Engine as LudoEngine
    participant Pub as EventPublisher
    participant Redis as Redis channel game:{gameId}
    participant Cast as RedisBroadcaster
    participant Room as Socket.IO room {gameId}

    Engine->>Pub: emit a GameEvent (roll, move, exit, …)
    Pub->>Redis: PUBLISH game:{gameId} (JSON payload)
    Redis-->>Cast: message on the game:* pattern
    Cast->>Room: io.to(gameId).emit(event.type, payload)
```


---
---


## What Redis Spawns Per Game Session

Every live game creates a small set of Redis keys. There is **no per-cell or
per-board structure** — the board is never built or stored as a grid. Each game
session creates exactly three keys:

| Key | Type | What it holds |
|-----|------|---------------|
| `game:{gameId}` | Hash | **One** field `state` = the whole game state as one JSON blob (the one true copy) |
| `game:{gameId}:moves` | List | Last 200 moves (LPUSH + LTRIM), for replay/turn-log |
| `match:{gameId}` | Hash | Lobby directory: `id`, `status`, `gameType`, `playerCount`, `seatColors`, `inviteCode` (PvP only), `createdAt`, `startedAt`, `idleSince`, one seat row per slot (`player{1-4}_id`, `player{1-4}_color`, `player{1-4}_left`), and one `seatUser_<color>` field per seat holding the account that took it (keyed by colour, not by slot) |

Readiness is stored inside the game `state` blob (`state.readyPlayers`), not in the match hash.

That's the whole picture: **3 keys per game** — no matter how many pieces are
moving, how many bots are seated, or how many cells the board has. When the
game ends (or the room is aborted/expired), `deleteGame` / `abortMatch` removes
them or gives them a short expiry.

```mermaid
flowchart LR
    G["Game session<br/>gameId"] --> K1[("game:{gameId}<br/>Hash — field 'state'<br/>= GameState JSON")]
    G --> K2[("game:{gameId}:moves<br/>List — last 200 moves")]
    G --> K3[("match:{gameId}<br/>Hash — seats, status")]
    G --> C["game:{gameId}<br/>pub/sub channel"]
```

### The pub/sub channel

On top of the three keys, each game also has a Redis pub/sub channel
`game:{gameId}`. The engine sends every event (roll, move, capture, game end)
to it; `RedisBroadcaster` picks it up and passes it to the Socket.IO room, so
all clients stay in sync even across several engine instances.


---
---


## How the Engine Handles Multiple Bots

### One bot per game + color (cached, not re-created)

The engine does **not** make a fresh bot object for every turn. Bots are
**created once per (game, color) pair and kept in a map**:

```typescript
// bot.ts — one map shared by the whole engine
const botMap = new Map<string, Map<PlayerColor, LudoBot>>();

export function getOrCreateBot(gameId, color, engine, store): LudoBot {
  if (!botMap.has(gameId)) botMap.set(gameId, new Map());
  const gameBots = botMap.get(gameId);
  if (!gameBots.has(color)) {
    gameBots.set(color, new LudoBot(gameId, color, engine, store));
  }
  return gameBots.get(color);
}
```

So a 4-player PvE game with 3 bots keeps **one `LudoBot` per bot color** (3
objects) for the whole match — reused every turn. A bot's only changing state
is its `gameId` + `color`; everything it needs to choose a move is **read again
from Redis each turn** via `loadGameState`. That keeps bots stateless and cheap.

### How turns are scheduled (one timer, run by the server)

Bots never act on their own. The `SocketServer` tells them when to play:

```text
game_started  → botScheduler.schedule(gameId, BOT_THINK_MS)          // 500 ms thinking pause
piece_moved   → botScheduler.schedule(gameId, path.length * 220 + 500) // wait for the move animation
dice_rolled   → if no legal moves → botScheduler.schedule(gameId, 750 + 500)
```

`BotTurnScheduler.schedule` keeps **one timer per game** (`botTurnTimers`): it cancels the
old timer before starting a new one, so bot turns never overlap. When the timer
fires, it checks the current turn is a bot (`isBotSeat`, read from the persisted
state), gets the bot from `getOrCreateBot`, and calls `bot.takeTurn()`.

`takeTurn()` checks things first:
1. Reads state from Redis; stops if the game is not active / it's not this
   bot's turn / it's the wrong phase.
2. Calls `engine.rollDice(...)` — the same path humans use.
3. Reads state again; if the turn changed (someone disconnected), it stops.
4. Picks the best move (`selectBestMove`) with a ~1.2s delay so the dice
   animation finishes.
5. Calls `engine.movePiece(...)`; bonus rolls / captures start the bot's next
   turn through the event loop.

```mermaid
sequenceDiagram
    participant Server as SocketServer
    participant Cache as botMap (per game+color)
    participant Bot as LudoBot
    participant R as Redis

    Note over Server,Cache: Turn moves to a bot
    Server->>Cache: getOrCreateBot(gameId, color)
    Cache-->>Server: cached LudoBot (created once per game+color)
    Server->>Bot: takeTurn()
    Bot->>R: loadGameState(gameId)
    R-->>Bot: state (authoritative)
    Bot->>R: rollDice → movePiece (same engine path as humans)
    R-->>Bot: result
    Note over Server,Bot: bonus/capture → engine event → triggerBotTurn again
```

### How bots are identified

A bot is not an account: its user id is the literal string `bot-<color>`
(`bot-green`), and it leaves no `User` row. That id lives in the `match:{gameId}`
hash and in the engine's game state. A bot seat gets no token of its own: the
engine auto-fills it from the hash when a human joins, so `bot-<color>` is never
a credential.
The same hash also carries the shown name, `player{n}_displayName`: for a bot seat
the backend writes `bot-<color> (<assistant>)` from the lobby's `botNames`, so the
label travels with the match and each client translates only the colour word.
Each process has one helper that answers "is this a bot?" by checking the `bot-`
prefix: `isBotUserId()` in `socket/auth.ts` inside the engine, and
`isBotUserId()` in `common/botname-enforce.ts` inside the backend. The backend's
copy is used by the match postgame scorer and the achievements service, so those
two always agree; the engine's copy keeps the engine free of backend imports.

A **seat** is a different question from a user id, and the engine answers it from
the persisted state: `isBotSeat(state, color)` (`bot.ts`) reads the seat's
`isBot` flag, falling back to a `bot-` username for states written before the
flag existed. This is the helper the bot scheduler, the rejoin path and the
startup wake pass use, because the in-memory seat map is empty after a restart
and answering the question from it is what froze bot games.


---
---


## Piece-Level State: Why No Board Is Ever Built

The engine has **no board object, no 2D grid, no cell map** on purpose. The
board is an *ephemeral interface*: it is never actually created or saved — it
exists only in the code. Everything is tracked at the **piece level** — each
piece is a **node** that just knows its spot on a 0–57 step line:

```typescript
export interface Piece {
  id: PieceId;     // e.g. "red-0" — the node's identity
  color: PlayerColor;
  step: number;    // -1=exited, 0=prison, 1-51=track, 52-56=home lane, 57=goal
  isInGoal?: boolean;  // true when step === 57 (frontend-compatible)
  isInBase?: boolean;  // true when step <= 0  (frontend-compatible)
}
```

The full "board" is just **16 pieces** (4 per color × 4 colors) held in one
array inside `GameState`. The board position is worked out **only when needed**
— `BoardMapper` turns a piece's `step` into a shared track spot only when a
rule asks for it (legal-move check, capture check, safe-zone check). The
engine never stores a 15×15 grid or a cell→piece map.

### Why this matters

1. **Nothing to create or keep in order.** There is no board structure in
   Redis to build, update, or tear down — only the one `GameState` JSON blob
   (3 keys per game total).
2. **A move just changes a piece's step.** A move is `piece.step = to`, plus a
   capture (opponent pieces' `step = 0`). Two pieces on the same spot are found
   by asking "which other piece has the same track position as this node?" —
   `findPiecesAtPosition` — no grid to look up.
3. **Move snapshots.** Because every rule reads the piece array from the
   latest `GameState`, a roll's legal-move snapshot is just that array filtered
   at roll time. The server checks `move_piece` against that snapshot, so the
   piece-node model is also how the server stops cheats.
4. **Saving is easy.** The whole game — 16 piece-nodes, players, turn, pending
   moves — fits in one JSON blob, so `saveGameState` is one `HSET` and
   `loadGameState` one `HGET`.

### Estimated memory footprint

Because the board is just 16 piece-nodes in one JSON blob, a whole game is
**tiny in memory**. The numbers below are rough estimates of the `GameState`
JSON per game:

| What | Size (approx.) |
|------|----------------|
| Each piece-node (`{ id, color, step, isInGoal, isInBase }`) | ~80–100 bytes |
| **16 pieces** (always created, even in a 2-player game) | **~1.5 KB** |
| Each player entry (`PlayerMeta` with stats) | ~150–200 bytes |
| Turn / phase / pending-moves / misc fields | ~200–300 bytes |

That gives a typical `GameState` of about **2 KB** — regardless of mode. The
player count only changes the `players` array, not the piece array.

#### PvP (e.g. 2 humans)

| Key | Approx. size |
|-----|--------------|
| `game:{gameId}` (state) | ~2 KB (16 pieces + 2 players) |
| `game:{gameId}:moves` | 0 → ~30 KB (last 200 moves) |
| `match:{gameId}` (lobby hash) | ~0.5 KB |
| **Total per PvP game** | **~2.5 KB**, up to ~32 KB in a long game |

#### PvE (e.g. 1 human + 3 bots)

Bots make the game slightly heavier because **all 4 seats are filled**, so the
`players` array has 4 entries instead of 2:

| Key | Approx. size |
|-----|--------------|
| `game:{gameId}` (state) | ~2.3 KB (16 pieces + 4 players) |
| `game:{gameId}:moves` | 0 → ~30 KB |
| `match:{gameId}` (lobby hash) | ~0.5 KB |
| **Total per PvE game** | **~2.8 KB**, up to ~33 KB in a long game |

So a PvE game costs only a few hundred extra bytes over PvP in Redis — the
bots do **not** multiply the state. The extra footprint from bots shows up
outside Redis:

- **PostgreSQL:** nothing. A bot is not an account, so a finished game writes no
  rows for it.
- **Engine memory:** one cached `LudoBot` object per bot color (a few hundred
  bytes each), kept for the whole match in `botMap`.
- **Timers:** one `setTimeout` per game for bot turns — never one per bot, so
  bot count does not add timers.

The short version: **bots add a tiny fixed cost (a few hundred bytes of Redis
and one small cached object each) — they do not scale the state.** Even
with 3 bots the whole game is still a ~2–3 KB JSON document.

### What if the board also had to be built?

The frontend board is a **15×15 grid (225 cells)**. If the engine had to build
and track that grid too — one state object per cell — the cost jumps a lot:

| What | Size (approx.) |
|------|----------------|
| Each cell entry (`{ type, owner, safe, pieces[] }`) | ~100–150 bytes |
| **225 cells (15×15)** | **~22–34 KB** |
| The 16 piece-nodes (still needed — pieces keep their own position) | ~1.5 KB |
| Per-cell occupancy lists (which piece sits on each cell) | ~0.5–1 KB |
| **Grid-based `GameState` total** | **~24–36 KB** |

Compare that with the piece-node model's **~2–2.3 KB** — the grid approach is
**roughly 10–15× bigger** before a single move is made.

The extra cost isn't just size — it's *work*:

1. **Two places to keep in sync.** Pieces would have a `step`, and the grid
   would also record where each piece sits. Every move must update both — twice
   the places for a bug.
2. **Every move touches two cells.** A piece leaving cell A and landing on cell
   B means two cell updates (clear A, fill B), instead of the piece-node's one
   `piece.step = to`.
3. **Blockades and captures get harder.** A blockade is "2+ pieces on one
   cell". With a grid you still have to scan cells or build a reverse lookup —
   the piece-node model answers the same question with one
   `findPiecesAtPosition` query.
4. **Bigger saves.** The same `HSET game:{gameId} state <JSON>` now writes a
   24–36 KB blob on every roll/move instead of a ~2 KB one — about 10× more
   network and Redis write cost per action.

Even a "lean" grid (a flat cell-type array + a separate occupancy map) only
saves part of that and still duplicates the piece positions. The piece-node
model already *is* the occupancy map: **16 nodes with a `step` field answer
"where is everything?" without ever building a board.**


---
---


## Data Structures

### Key Patterns

| Pattern | Type | TTL | Description |
|---------|------|-----|-------------|
| `game:{gameId}` | Hash | 86400s (24h) | One field `state` = serialized GameState JSON |
| `game:{gameId}:moves` | List | — | Move history, trimmed to 200 entries |
| `match:{gameId}` | Hash | 3600s (aborted) | Lobby directory: `id`, `status`, `gameType`, `playerCount`, `seatColors`, `inviteCode` (PvP only), `createdAt`, `startedAt`, `idleSince`, one seat row per slot (`player{1-4}_id`, `player{1-4}_color`, `player{1-4}_left`), and one `seatUser_<color>` field per seat holding the account that took it (keyed by colour, not by slot). **Co-owned** — mutated by both the engine (via `RedisGameStore` helpers) and Nest (via `match/*.service.ts`). The backend reads `game:{gameId}` state through `isSeatFinalized()` only to check seat liveness; it never writes to `game:*`. |

### Value Format

Game state is stored as JSON under the `state` field of the game hash:

```json
// game:{gameId} → field "state"
{
  "id": "uuid",
  "pieces": [{ "id": "red-0", "color": "red", "step": 0 }],
  "players": [{ "color": "red", "status": "active", "isBot": false }],
  "currentTurn": "red",
  "turnPhase": "WAITING_FOR_ROLL",
  "pendingLegalMoves": [],
  "status": "waiting",
  "readyPlayers": []
}
```


---
---


## Logic Paths Summary

### Save Game State Path
```
saveGameState(gameId, state)
  ├── HSET game:{gameId} state <JSON>
  ├── EXPIRE game:{gameId} 86400
  └── Done
```

### Load Game State Path
```
loadGameState(gameId)
  ├── HGET game:{gameId} state
  │   ├── Found → deserialize JSON to GameState
  │   │   └── withBarrierDefaults(state)
  │   │       ├── player.barrierTokens === undefined → 0
  │   │       └── player.stats.barrierBreaks === undefined → 0
  │   └── Not found → return null
  └── Done
```

`withBarrierDefaults` is the ONE door the state comes back through, and it exists because the
Barrier Buster fields arrived after the first rooms were written: a live room survives a redeploy
in Redis, so a `GameState` from before the token existed can be loaded mid-game. Both fields feed
arithmetic (`barrierTokens -= 1` when an armed exit is paid for, `stats.barrierBreaks += n` when a
chain is won), and `undefined - 1` is `NaN` — one NaN seat would stay broken for the rest of the
match, because every later turn reads the poisoned counter back out of Redis. Normalizing at the
load site (rather than at each read) keeps the fix in one place; the per-site `?? 0` reads stay as
belt and braces for a state that is handed around in memory. `0` is also the honest reading: that
room was created before `createGame` dealt a token, and its players have not broken a wall.

### Record Move Path
```
recordMove(gameId, move)
  ├── LPUSH game:{gameId}:moves <JSON>
  └── LTRIM game:{gameId}:moves 0 199
```

### Publish Event Path
```
publish(gameId, message)
  └── PUBLISH game:{gameId} <message>
```


---
---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `ioredis` | Redis client for Node.js — supports pub/sub, pipelining, hashes, and lists |


---
---


## What Pub/Sub Is (plain English)

Redis **pub/sub** is a fire-and-forget message bus. One Redis client *publishes*
a message to a **channel** (a named topic, like `game:abc123`); any number of
other clients that are *subscribed* to that channel receive a copy of the
message. It is a broadcast — there is **no storage, no acknowledgement, no
queue**. If a subscriber is not connected (or not subscribed yet) when a
message is published, it never sees it. That is exactly why the engine keeps
the durable `GameState` in Redis *and* uses pub/sub purely as a live signal to
connected clients.

This project uses **two independent pub/sub domains** — one in the ludo-engine
(driving game broadcasts) and one in the backend (driving notifications). Each
does the same *publish → subscribe → forward* dance, but on different channels
for different audiences:

| Domain | Publishing side | Subscribing side | Channel shape | What it forwards to |
|---|---|---|---|---|
| **Game events** | `EventPublisher` → `RedisGameStore.publish()` | `RedisBroadcaster` (pattern `game:*`) | `game:{gameId}` | Socket.IO room `{gameId}` |
| **Notifications** | `NotificationService.notify()/broadcast()` (backend) | `NotificationService` subscriber | `notify:{userId}` and `notify:all` | Per-user SSE stream(s) |

### The game-event pub/sub flow

The engine keeps **two Redis connections** per store: one `client` for
reads/writes and one `subscriber` (a `duplicate()`) purely for listening. When
a turn changes the game, `LudoEngine` fires a `GameEvent`; `EventPublisher`
serialises it and `RedisGameStore.publish()` calls
`PUBLISH game:{gameId} <json>`.

On the listening side, `RedisBroadcaster` opens a **pattern subscription**
(`PSUBSCRIBE game:*`) so it catches every game's channel without knowing the
ids ahead of time. Every published message arrives on the `pmessage` handler,
which:

1. checks the pattern is `game:*`,
2. strips the `game:` prefix to recover the `gameId`,
3. parses the JSON payload, and
4. `io.to(gameId).emit(data.type, data)` — i.e. it re-emits the payload onto
   the **Socket.IO room for that game**, which is what actually reaches the
   browsers.

```mermaid
sequenceDiagram
    participant Engine as LudoEngine (make a move)
    participant EP as EventPublisher
    participant Pub as Redis client (publish)
    participant Sub as Redis subscriber (PSUBSCRIBE game:*)
    participant Broad as RedisBroadcaster
    participant IO as Socket.IO room {gameId}
    participant Browser

    Engine->>EP: emit GameEvent (e.g. dice_rolled)
    EP->>Pub: PUBLISH game:{gameId} <json payload>
    Pub-->>Sub: message on game:{gameId}
    Sub->>Broad: pmessage(game:{gameId}, payload)
    Broad->>IO: io.to(gameId).emit(type, payload)
    IO-->>Browser: client receives dice_rolled
```

**Why Redis for this?** The pub/sub hop decouples "what happened" from "who
should hear it". The engine just publishes an event; it does not know or care
how many tabs/instances are connected. Because this stack currently runs a
**single engine instance**, the same effect could be reached by emitting
straight to Socket.IO — but routing through Redis means the design is ready for
multiple engine instances/processes (each one subscribes to `game:*` and they
all stay in sync), with no change to the publishing logic.

> **Not to be confused with the durable store:** pub/sub channels
> (`game:{gameId}`, `notify:*`) are *transient* — they carry live messages only.
> The persistent keys live in the **Data Structures** table above. A game's
> state survives a restart because it is saved with `HSET`; a pub/sub message,
> like a toast or a live board update, is gone the moment it stops being
> connected.

### The notification pub/sub flow (backend, for context)

The `NotificationService` mirrors the same pattern. `notify()` publishes to
`notify:{userId}` (per-recipient) and `broadcast()` to `notify:all` (global).
A single subscriber handler receives the message and pushes it into every open
SSE `Subject` for that user (or, for `notify:all`, every broadcast subject),
which NestJS flushes to the browser as an SSE `data:` frame. Nothing is
persisted on the pub/sub path by itself — the `notify()` variant also writes a
Postgres `Notification` row first so the message shows up in the bell on the
next page load even if the SSE stream was closed.

For full detail see `backend-notification-module.md`.
