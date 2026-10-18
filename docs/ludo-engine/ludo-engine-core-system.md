# Ludo Engine — Core Engine

## Table of Contents

- [Overview](#overview) — Game state machine, turn logic, and win conditions
- [Files](#files) — Source file inventory
- [Key Types / Interfaces](#key-types--interfaces) — GameState, PlayerColor, Piece, events
- [Core Logic / Flow](#core-logic--flow) — Mermaid sequence diagrams for game flow
- [Logic Paths Summary](#logic-paths-summary) — Decision trees for game operations
- [Dependencies](#dependencies) — Internal services this module relies on
- [Configuration](#configuration) — Environment variables


---
---


## Overview

The engine core enforces the game rules. It runs inside the `ludo-engine` service and is the single source of truth for all game state. The engine:

1. **Manages game state** — moves games through `waiting` → `active` → `finished`.
2. **Validates moves** — uses `MoveValidator` to work out which moves are legal.
3. **Handles dice rolls** — enforces turn order, gives a bonus roll on 6, and forfeits the turn on the third consecutive 6.
4. **Tracks pieces** — each piece has a `step` value (-1=exited, 0=prison, 1-51=track, 52-56=home lane, 57=goal).
5. **Detects wins** — the first player to get all 4 pieces home wins.
6. **Saves state** — writes to Redis via `RedisGameStore` so a restart doesn't lose the game.
7. **Serializes operations** — a per-game lock ensures roll/move never run on top of each other.


---
---


## Files

| File | Role |
|------|------|
| `engine.ts` | `LudoEngine` class — state machine, turn logic, dice rolling, piece movement, per-game locks |
| `types.ts` | Type definitions: `GameState`, `PlayerMeta`, `Piece`, `LegalMove`, `MoveResult`, `GameEvent` |
| `move-validator.ts` | Legal move computation based on board geometry |
| `turn.ts` | `applyMoveOutcome` — mirrors the move into stats, keeps each seat's `piecesInGoal` count in step with the board, checks the win condition, and advances the turn |
| `board-mapper.ts` | Board geometry — safe zones, track positions, goal entries |
| `redis.ts` | `RedisGameStore` — Redis persistence layer |
| `bot.ts` | Heuristic bot AI |
| `player-handler.ts` | Disconnect/reconnect/exit/ready management and turn advance |
| `lobby.ts` | Lobby management — color selection with seat swap (ready gate is in player-handler.ts) |
| `index.ts` | Entry point — starts Socket.IO server on port 3001 |


---
---


## Key Types / Interfaces

### PlayerColor

```typescript
export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';
```

### Piece

```typescript
export interface Piece {
  id: PieceId;           // e.g. "red-0"
  color: PlayerColor;    // Owner color
  step: number;          // -1=exited, 0=prison, 1-51=track, 52-56=home lane, 57=goal
  isInGoal?: boolean;    // true when step === 57
  isInBase?: boolean;    // true when step <= 0
}
```

### PlayerMeta

```typescript
export interface PlayerMeta {
  color: PlayerColor;    // Seat color
  status: 'active' | 'exited' | 'inactive' | 'disconnected';  // Player lifecycle state
  username: string;      // Immutable account name (bots: `bot-<color>`)
  displayName?: string;  // Shown name (bot seats: `bot-<color> (<assistant>)`)
  userId?: string;       // Immutable account id (avatar key); absent for bots/hotseat seats
  hasAvatarPhoto: boolean;  // Whether the account has an uploaded photo (from the backend's Redis cache)
  avatarStyle?: string;  // DiceBear style used when there is no photo
  isBot: boolean;        // Whether this seat is a bot
  isConnected: boolean;  // Whether the player's socket is connected
  piecesInGoal: number;  // Pieces finished (0-4)
  hasRolled: boolean;    // Whether the player rolled this turn
  consecutiveSixes: number;  // Per-player six streak, resets on turn advance
  bonusRoll: boolean;    // Rolled a 6 → rolls again
  isFinished: boolean;   // true when all 4 pieces in goal
  finishedAt?: string;   // ISO timestamp
  stats: {
    turns: number;             // Turns taken by the seat this game
    captures: number;          // Enemy pieces sent home
    piecesInGoal: number;      // Mirrors the seat's pieces at step 57
    clashDefends: number;      // Clash rounds fought as defender (achSteadyDefender)
    clashAttacksWon: number;   // Clash rounds won as attacker (achMercilessAttacker)
    barrierBreaks: number;     // Barriers torn down: token-priced exits that won their chain (achTearDownThisWall)
  };
  barrierTokens?: number;      // Barrier Buster tokens in hand (absent on a state written before the token = 0)
  barrierArmed?: boolean;      // Barrier Buster arm switch for THIS turn (absent = disarmed, which is the safe default)
}
```

The Barrier Buster fields are safe-by-default on purpose. A live room survives a redeploy
in Redis, so a `GameState` written before the token existed can still be loaded mid-game; the two
NUMERIC fields feed arithmetic (`barrierTokens -= 1`, `barrierBreaks += n`) where `undefined - 1` is
`NaN`, and a `NaN` seat would stay broken for the rest of the match (the boolean `barrierArmed` has
no arithmetic and is read as `=== true`, so absent is simply off). `RedisGameStore` normalizes
them once at the only door the state comes back through (`withBarrierDefaults`, in
[`redis.ts`](./ludo-engine-redis-system.md)), and every per-site read keeps a `?? 0` as belt and
braces. `0` is also the honest reading: a state without the fields deals no token and has broken no
wall.

`userId` / `hasAvatarPhoto` / `avatarStyle` are filled in at join time from the backend's Redis
`avatar:<userId>` record (the engine has no database access), and `emitLobbyUpdate` passes them to the
client with the roster. The full pipeline is in [`avatar-system.md`](../avatar-system.md).

**Seat statuses.** `active` = playing; `disconnected` = in the reconnect grace window;
`inactive` = left a waiting room; `exited` = left a live game.

**Turn order is derived from `state.players[]` (players-as-truth).** `advanceTurnInState` scans the
array forward from `currentTurn` and picks the next seat that can play: `active` seats take the
turn, `exited`/`inactive` seats are skipped, and a `disconnected` seat whose grace window is still
open **holds the turn** — `currentTurn` parks on it and nobody else can act (turn ownership gates
roll/move/bot actions) until that seat reconnects or is pruned. Disconnecting during another
player's turn does not freeze anything — play continues, and the wait only lands when the turn
reaches the departed seat.

**The explicit pause flag is PvP-only.** When a PvP player drops during their *own* turn
(`handlePlayerDisconnect`), the game also sets `state.paused` / `state.pauseTurnOwner` so clients can
render a "waiting to reconnect" banner immediately. PvE and hotseat never pause: they are
single-instance games with one human and no remote opponent, so the only two states are *running*
and *aborted* — their disconnect still arms the long (1h) single-instance window, and expiry tears
the room down. The pause is cleared in three places: `handlePlayerReconnect` (seat restored, same turn
resumes with its pending dice/moves), `finalizeDeparture` (seat pruned, turn advances to the next
playable seat), and the re-arm check in `join-manager` (defensive, owner-only). While paused,
`rollDice`, `movePiece`, and bot turns are all rejected, so nobody can act on a frozen board.

A player who leaves a **waiting room** keeps their seat. It is parked as `inactive`, which the lobby
roster (`emitLobbyUpdate`) and the client's pilot list both filter out, and its Redis seat row is
flagged as reserved rather than deleted, so `joinMatch` sends the player back to the same colour.
Aborting frees the seat outright instead. Either way the room's idle-abort timer is restarted, and
the host's seat is never touched. Because the seat is restored to `active` on rejoin, `isFinished`
is deliberately left untouched on this path: a stale "finished" flag would make the player look
already done at game start.

A player who leaves a **live game** is parked as `exited` with `isFinished` set, because the
post-game result logic prunes on that status.

A grace window is only opened for a seat that can actually come back. A seat cannot be resumed
once it is `exited` or the match is finished, because every one of its pieces is parked at
`step = -1`. Parking such a seat in `disconnectedPlayers` would let a later `join_game` take the
reconnect branch and flip it back to `active` with all four pieces still at `-1`; `MoveValidator`
skips `step < 0`, so that seat could never produce a legal move and its turn would auto-pass forever.

The reset on turn advance is deliberate. The turn-scoped snapshot (`turnPhase`, `pendingLegalMoves`,
`pendingDiceValue`, `pendingIsFirstRoll`) belongs to the player who just finished. A stale snapshot would
freeze the next player after a seat is pruned mid-`WAITING_FOR_MOVE`: it could neither roll (`Invalid turn
phase`) nor move a piece. `rollDice` also resets these
on its own paths, but doing it in `advanceTurnInState` makes the invariant hold for every caller.

**Quorum.** `hasQuorum(state)` is the single predicate that decides whether a room can continue: it
requires at least two seats that are both `active` and not bots. Bots never count, so a PvE room is
not kept alive by its bot seats. When a departure drops the room below that count, `teardownRoom`
runs: it emits `game_expired`, marks the match `ABORTED`, deletes the engine game state, and calls
the in-memory cleanup callback (which drops the room's `RoomContext` from the `RoomRegistry`, and its
pending bot turn, in one disposal path).

**Source files.** `firstActiveColor`, `advanceTurnInState`, `handlePlayerDisconnect`,
`handlePlayerReconnect`, `expireDisconnectedPlayer`, `finalizeDeparture`, `teardownRoom`, and
`hasQuorum` all live in `backend/app/ludo-engine/src/player-handler.ts`.

### GameState

```typescript
export interface GameState {
  id: string;                      // Unique game id
  pieces: Piece[];                 // 16 pieces: 4 per player × 4 players
  players: PlayerMeta[];           // Per-seat player info
  currentTurn: PlayerColor;        // Whose turn it is
  consecutiveSixes: number;        // Current 6-streak (third 6 forfeits the turn)
  moveCounter: number;             // Total moves made in the game
  turnPhase: 'WAITING_FOR_ROLL' | 'WAITING_FOR_MOVE';  // Roll phase or move phase
  firstRollOfTurn: boolean;        // True until the six-bonus has been used once during the current turn-holding streak
  pendingLegalMoves: LegalMove[];  // authoritative legal moves after a roll
  pendingDiceValue?: number;       // Dice value from the most recent roll
  pendingIsFirstRoll?: boolean;    // Whether the pending roll was the first of the turn
  disconnectedPlayers: DisconnectState[];  // Players in their disconnect grace period
  status: 'waiting' | 'active' | 'finished';  // Game lifecycle state
  winner?: PlayerColor;            // Winner color when finished
  resultDetail?: string;           // Human-readable finish reason
  resultSubmitted?: boolean;       // prevents duplicate backend submissions
  botBusy?: boolean;               // prevents overlapping bot turns
  readyPlayers: PlayerColor[];     // Colors whose seat is ready (cleared when seats swap)
  paused?: boolean;                // True while frozen on a disconnected seat's turn
  pauseTurnOwner?: PlayerColor;    // The seat the paused turn is waiting on
  pausedReason?: string;           // e.g. 'disconnect_grace'
}
```

### LegalMove & MoveResult

```typescript
export interface LegalMove {
  pieceId: PieceId;    // Which piece can move
  from: number;        // Starting step
  to: number;          // Landing step
  isCapture: boolean;  // Whether this move captures an opponent piece
  isHomeEntry: boolean; // Whether this move enters the home lane
}

export interface MoveResult {
  ply: number;                 // Move number (increments each move)
  color: PlayerColor;          // Player who moved
  diceValue: number;           // The roll that produced the move
  pieceId: PieceId;            // Which piece moved
  from: number;                // Starting step
  path: number[];              // every intermediate step, for step-by-step animation
  to: number;                  // Landing step
  captured: boolean;           // Whether this move captured a piece
  capturedPieceIds?: PieceId[];  // all opponent pieces sent home from the landing square
  enteredHome: boolean;        // Whether the piece entered the home lane
  bonusRoll: boolean;          // Rolled a 6 → rolls again
}
```

### GameEvent

One source of truth for game lifecycle — the engine emits these, and the socket layer relays them:

```typescript
export type GameEvent =
  | { type: 'dice_rolled'; gameId; value; legalMoves; bonusRoll; currentTurn; forfeited? }      // A roll happened; includes the value + legal moves (+ forfeited on third 6)
  | { type: 'piece_moved'; gameId; result: MoveResult }                                         // A piece moved; full MoveResult payload
  | { type: 'game_ended'; gameId; winner; resultDetail }                                        // Game finished; winner + reason
  | { type: 'game_started'; gameId }                                                            // Game transitioned from waiting → active
  | { type: 'game_expired'; gameId }                                                            // Room torn down (quorum lost, single-instance expiry, idle lobby)
  | { type: 'player_exited'; gameId; color }                                                    // A player left the game, or the server pruned the seat
  | { type: 'player_aborted'; gameId; color; username }                                         // A player aborted the game
  | { type: 'player_disconnected'; gameId; color }                                              // A player's connection dropped
  | { type: 'player_reconnected'; gameId; color; displayName? }                                 // A player reconnected (displayName carries a rename)
  | { type: 'state_update'; gameId; state: GameState }                                          // Full state frame after a prune or a pause change
  | { type: 'color_selected'; gameId; userId; color }                                           // A player picked a color in the lobby
  | { type: 'lobby_update'; gameId; players };                                                  // Lobby seats changed
```


---
---


## Core Logic / Flow

### The landing rule

**A move fights ONLY the square it lands on.** That is the whole capture rule, and it holds for both
shapes: a single defender on the landing square is the ordinary capture, and a wall there (2+ of one
opponent colour) is the clash chain, one round per defender. Nothing is ever attacked on a square a
piece passes over, on any route: a wall anywhere before the landing square blocks the move, whether the
piece is leaving prison or already on the board, and whether free exit is on or off. The roll therefore
has to reach the target's square exactly.

There is no fighting along the path, no battle list on a `LegalMove`, and no attack that resolves on a
square the piece did not land on. `LegalMove` carries one landing (`to`,
`captureCount`), and the chain reads the landing square's stack.

### 1. Dice Roll

```mermaid
sequenceDiagram
    participant Player
    participant Engine as LudoEngine

    Player->>Engine: Click the die
    Engine->>Engine: Check it is your turn
    Engine->>Engine: Roll a 1-6 and keep count of 6s in a row
    alt Third 6 in a row
        Engine->>Engine: Lose your turn (rule: three 6s = pass)
        Engine-->>Player: dice_rolled (forfeited)
    else Normal roll
        Engine->>Engine: Work out which pieces can move
        Engine-->>Player: dice_rolled (value + movable pieces)
    end
```

### 2. Move Piece

```mermaid
sequenceDiagram
    participant Player
    participant Engine as LudoEngine

    Player->>Engine: Click a piece to move it
    Engine->>Engine: Check the move is legal
    Engine->>Engine: Clash mode and the move captures: defer to the QTE, applied once the chain ends
    Engine->>Engine: Otherwise move the piece now. Any opponent piece on the landing square goes to base
    Engine->>Engine: Did all 4 pieces reach home?
    alt Yes — player wins
        Engine-->>Player: game_ended (winner)
    else No — still playing
        alt Roll was 6 or a capture
            Engine->>Engine: Same player rolls again
        else Normal roll
            Engine->>Engine: Pass the turn to the next player
        end
        Engine-->>Player: piece_moved
    end
```


---
---


## Logic Paths Summary

### Dice Roll Path
```
roll_dice()
  ├── Reject if the game is paused (a disconnect grace window is open)
  ├── Reject if the clash result card is still up (state.resultCardUntil in the future)
  ├── Validate game active, turnPhase WAITING_FOR_ROLL, caller is current player
  ├── Roll 1-6
  ├── 6 → consecutiveSixes++ ; otherwise reset to 0
  ├── Third consecutive 6 → forfeit turn (forfeited: true), advance, return
  ├── 6 → bonusRoll = true
  ├── pendingLegalMoves = MoveValidator.getLegalMoves(...)
  ├── No legal moves → clear pending moves; a first-roll 6 keeps the turn, otherwise advance
  ├── turnPhase = WAITING_FOR_MOVE
  └── Emit dice_rolled { value, legalMoves, bonusRoll }
```

#### The dice math (mulberry32)

`rollDice` doesn't use `Math.random()` directly — it seeds `mulberry32`, a small
32-bit PRNG (`seededRand` in `engine.ts`), and draws once per roll:

```ts
s = (s + 0x6d2b79f5) | 0;                     // 1. advance a 32-bit counter
let t = Math.imul(s ^ (s >>> 15), 1 | s);     // 2. scramble the bits
t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // 3. uniform float in [0, 1)
```

- **Advance** — `s` is a 32-bit counter; adding a fixed odd constant
  (0x6d2b79f5) steps it through all 2^32 states before repeating. `| 0`
  keeps the arithmetic in 32-bit range — JS numbers are float64 and lose
  integer precision past 2^53.
- **Scramble** — the counter alone follows a simple pattern, so XOR-shifts
  move bits to new positions and `Math.imul` (32-bit multiply) combines them:
  a small change in the seed produces a completely different output.
- **Normalize** — `>>> 0` makes the result unsigned; dividing by 2^32 gives
  an even spread over [0, 1). `Math.floor(rand() * 6) + 1` turns that into
  a die value: each face 1–6 has the same chance.

Why a fresh seed per roll: `Math.random()` cannot be seeded and shares one
process-wide stream. Seeding mulberry32 with a new `Math.random()` value for
each roll gives that roll its own separate stream, so other code using
`Math.random()` cannot affect the die result.

### Move Piece Path
```
move_piece(pieceId)
  ├── Reject if the game is paused (a disconnect grace window is open)
  ├── Reject if the clash result card is still up (state.resultCardUntil in the future)
  ├── Validate game active and turnPhase = WAITING_FOR_MOVE
  ├── Verify pieceId is in pendingLegalMoves (server snapshot from the roll)
  ├── Priced Barrier Buster move →
  │   ├── Require the seat to be ARMED (arm_barrier) and to hold a token, else refuse
  │   └── Spend the token here, on the ATTEMPT, inside the game lock and against the freshly
  │       loaded state: a replayed emit finds the move gone and spends nothing, a repulsed
  │       chain keeps the token spent, and an empty hand clears the arm switch
  ├── Clash mode AND the move is a capture →
  │   ├── Stage pendingCapture for the landing square (the whole stack, in piece-id order)
  │   │   with barrierBattles stamped (1 when that square stood 2+ of one colour)
  │   ├── Clear pendingLegalMoves + pendingDiceValue, then start the QTE
  │   └── Return result.captured = true with NO piece_moved: the chain applies the move once,
  │       on its last round (clash-engine doc)
  └── Otherwise (no clash, or a move that captures nothing) →
      ├── executeMove → move the piece; any opponent piece on the landing square goes to base
      ├── recordMove (history) + moveCounter++
      ├── Check the win condition (all 4 pieces at step 57)
      │   ├── Win → sync the winner's piecesInGoal, status = 'finished', emit game_ended
      │   └── No win → sync the mover's piecesInGoal
      │       ├── Roll was 6 OR the move captured → the same player rolls again (bonus roll)
      │       └── Roll 1 to 5 with no capture → advance the turn to the next seat
      ├── Clear pendingLegalMoves + pendingDiceValue
      └── saveGameState; emit piece_moved (+ game_ended if finished)
```

### Barrier Buster Path

The Barrier Buster is the token-priced LANDING: one token per seat, dealt by `createGame`, that pays
for a fight on a wall the roll reaches exactly. It never crosses a barrier and never waives the
exit-roll gate: the roll still has to reach the wall's square exactly. The route does not matter (an
armed prison exit, an on-board landing and a free-exit landing all pay the same one token), so with
the free exit on the plain exit REACHES the wall but still does not pay for it: the token is what
turns the landing into a fight in every clash-mode room.

```
armed_exit(pieceId)                                 // MoveValidator.armedExit
  ├── Require clash mode ON and the seat's token count > 0
  ├── Require `to` = the roll, on the main track (1..51)
  ├── Offered only when the plain exit is NOT legal for this roll (see getLegalMoves),
  │   so a piece never carries two exits to the same square
  ├── Require the landing square itself to be a BARRIER (2+ of ONE opponent colour)
  │   └── A lone defender, or a pair of different colours, is no barrier: the ordinary
  │       exit rules above cover those squares
  ├── Require the landing to be attackable (`wallIsAttackable`), read here because a protected
  │   star never blocks either, so `blockadeBlocksPath` alone would let the bust land on a
  │   wall it cannot fight
  ├── Require a clear path behind the landing (`blockadeBlocksPath` from step 1): a second
  │   barrier on the way blocks the bust exactly as it blocks any other move
  └── LegalMove { from: 0, to: the roll, isCapture: true, captureCount: the barrier's depth,
      spendsBarrierToken: true } — no battle list: the one square is the whole fight
```

**Arming and Skip.** The arm switch is engine-owned: `arm_barrier` calls `setBarrierArmed`, which
stores `PlayerMeta.barrierArmed` for the current turn. Clash mode is the OPPORTUNITY to break a wall;
the flag is the DECISION. The move LIST does not depend on it (option C): a wall landing is listed and
priced whether or not the seat is armed, so a toggle costs one `state_update` and no recompute, and
`movePiece` is what refuses a priced move when the seat is unarmed or holds no token. Arming an empty
hand is refused, the flag is deleted from EVERY seat when the turn advances, and a spend that empties
the hand clears it too (a capture re-rolls, so an ARMED badge over zero tokens must be impossible).
The engine HOLDS the turn while a bust is on the table (a bust is a legal move, so `rollDice`'s
no-move pass never fires for it), and `skipArmedBust` (`skip_bust` on the wire) is the other way out:
a PASS that spends the dice, advances the turn and leaves the token in hand. Skip is single-purpose:
it is refused unless EVERY pending move is priced (an ordinary move on the table means the roll is
played, not skipped), there is no 6 carve-out (a 6 offers no priced move, so the gate already covers
it), and the socket layer drops a refusal silently.

**The economy.** Seed 1, cap `BUST_CAP` (3). The debit is the ATTEMPT: `movePiece` spends the token
inside the game lock and against the state it has just re-read, before the clash gate, so a replayed
emit finds the move snapshot cleared and cannot spend a second, while a chain that repulses the
attacker keeps the token spent. The income comes from the same clash branch that credits
`barrierBreaks`: a chain won against EXACTLY ONE defender pays one token back, clamped to the cap. A
won barrier pays nothing, so a wall never feeds the thing that breaks walls.

**Crediting `barrierBreaks`.** Each move is stamped with `pendingMove.barrierBattles` = 1 when its
landing square stood 2 or more defenders, else 0, and the clash engine adds that to the attacker's
`stats.barrierBreaks` only when the whole chain is won. So the tally counts BARRIERS, not rounds: a
landing on a 2-stack is 1, an armed bust on a wall (whatever its size) is 1, a lone defender is 0,
and a lost chain credits nothing. That count is what `achTearDownThisWall` sums per game; `?? 0`
keeps a state written before the field existed reading as 0.


---
---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `MoveValidator` | Legal move computation |
| `BoardMapper` | Board geometry, safe zones, track positions |
| `RedisGameStore` | Redis persistence for game state |
| `player-handler` | Disconnect/reconnect/exit/ready + `advanceTurnInState`; ready/start gate |
| `LobbyManager` | Color selection with seat swap (readiness cleared on swap) |

### Tunable constants

Module-level constants in the engine's support files — edit at the top of each file to tweak:

| Constant | File | Default | What it controls |
|----------|------|---------|------------------|
| `DISCONNECT_GRACE_MS` | `player-handler.ts` | 45 s | PvP reconnect window before a disconnected player is pruned |
| `SINGLE_SOCKET_DISCONNECT_GRACE_MS` | `player-handler.ts` | 1 h | Single-instance (PvE/hotseat) reconnect window before the game auto-aborts |

> `player-handler.ts` adds a hardcoded `+1000` ms buffer to the PvP grace
> period so the prune timer fires just after the reconnect deadline.


---
---


## Configuration

| Variable | Default | Used By |
|----------|---------|---------|
| `REDIS_HOST` | `redis` | RedisGameStore |
| `REDIS_PORT` | `6479` | RedisGameStore |
| `REDIS_PASSWORD` | (from secrets) | RedisGameStore |
| `BACKEND_URL` | `http://backend:3000` | ResultSubmitter |
| `ENGINE_API_KEY` | (from secrets) | ResultSubmitter |
| `ENGINE_JWT_SECRET` | (from secrets) | `socket/auth.ts` — verifies the handshake match tokens |
