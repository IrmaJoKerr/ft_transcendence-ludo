# Match Module

## Table of Contents

- [Overview](#overview) — Matchmaking and the game lifecycle
- [Files](#files) — Every source file in the module and its role
- [Key Types / Interfaces](#key-types--interfaces) — Match creation DTOs and response shapes
- [API Endpoints](#api-endpoints) — Matchmaking endpoints and in-game actions
- [Engine GameState Readers](#engine-gamestate-readers-seat-finalizationts) — Reads of the engine's own live state
- [The one-seat lock](#the-one-seat-lock-active-gamets) — One seat per player, waiting room included, enforced on every create/join path
- [Blocked pairs at the door](#blocked-pairs-at-the-door) — A room holding a blocked pair is not a row, and its seats cannot be claimed; a block placed inside a room never ejects anybody
- [Core Logic / Flow](#core-logic--flow) — Mermaid sequence diagrams for match flows
- [Logic Paths Summary](#logic-paths-summary) — Decision trees for each operation
- [Lobby invalidation](#lobby-invalidation-roomschanged--roomslist--roomsmine) — `rooms:changed`, the one snapshot and the per-viewer diff that replaced the polls
- [Which seats a result may write](#which-seats-a-result-may-write-post-apigameend) — the bot flag, the account check, and who earns a rating
- [Dependencies](#dependencies) — Internal services this module relies on
- [Configuration / Environment](#configuration--environment) — Redis and engine configuration


---
---


## Overview

The Match module is the bridge between the REST API and the real-time ludo-engine. It handles:

1. **Matchmaking** — creates or joins PvP, PvE, or invite games.
2. **Game lifecycle** — moves the engine's game state through `waiting` → `active` → `finished`, and the match record through `WAITING` → `ACTIVE` → `ABORTED`, or deletes the hash once the game-end callback has written the results.
3. **Room browsing** — `GET /api/games/rooms` lists the PvP rooms you may enter (open lobby rooms, plus your own still-reclaimable seats in games that have already started), and `GET /api/games/mine` lists the rooms you are seated in.

The module uses Redis for short-lived match data (queues, active games) and lets the ludo-engine own the actual game logic over Socket.IO.


---
---


## Files

| File | Role |
|------|------|
| `match.controller.ts` | HTTP routes: matchmaking, game actions, room browsing, engine callbacks |
| `match.service.ts` | Facade — composes the four split services (`MatchCreatorService`, `MatchPlayerService`, `MatchQueryService`, `MatchPostgameService`) and re-exports the `GameEndPayload` type from `match.postgame.service.ts` (`ENGINE_WS_URL` is defined/exported by `match.creator.service.ts`) |
| `match.creator.service.ts` | Match creation: PvP/PvE/hotseat, invite codes, room joining, bot seeding |
| `match.player.service.ts` | In-game actions: join, rejoin, invite friend, ready, exit, cancel |
| `match.query.service.ts` | Browse queries: open rooms, my rooms, and `seatResult()` (the caller's own row for a match they can no longer join) |
| `match.postgame.service.ts` | `POST /api/game/end` (the completion pass: scoring, ratings, the clash tallies, achievements) and `POST /api/game/:id/abandon` (one abandoned row, no scoring) |
| `seat-finalization.ts` | Engine GameState readers — `isSeatFinalized()` (can this seat still be rejoined?) and `isEngineGameStarted()` (has the ready-check already started the game?). Used by `GET /api/games/mine`, `GET /api/games/rooms`, `POST /api/game/:id/rejoin`, `POST /api/match/join/:code`, and the create reuse lookup |
| `active-game.ts` | The strict state lock — `findLiveMatch()`: the live game this player already holds a seat in (`{ gameId }`, or `null`). Composes the `match:*` hash status with `isEngineGameStarted()`; backs every create (all modes), `POST /api/match/join/:code`, rejoin refusal, and the sign-out that ends the room. `matchSeatIds()` lists a hash's four seat ids for the account-deletion sweep |
| `engine-token.util.ts` | `signEngineToken()` — signs the game-scoped Socket.IO tokens with `ENGINE_JWT_SECRET` and `aud: 'ludo-engine'` (the single place both mint sites below go through) |
| `match.module.ts` | NestJS module — registers all services, PrismaService |


---
---


## Key Types / Interfaces

### MatchMode

```typescript
type MatchMode = 'pvp' | 'pve' | 'hotseat'
```

### CreateMatchBody

```typescript
{
  mode: 'pvp' | 'pve' | 'hotseat';  // REQUIRED — no silent fallback
  playerCount?: number;      // 2-4 (2 or 4 for PvE)
  botCount?: number;         // 0 - (playerCount-1), PvE only
  botColors?: string[];      // Optional per-bot slot colors
  botNames?: string[];       // Optional per-bot assistant names, index-aligned with botColors
  seatColors?: string[];     // Optional seat list: one colour per seat, in seat order (identity, not the rotation)
  hostColor?: string;        // REQUIRED at runtime: the host's own corner (no fallback)
}
```

The host owns a corner before any other seat exists: `hostColor` is required in every mode and
`MATCH_INVALID_COLOR` answers its absence or a colour outside the room. The written `seatColors` starts
with the host's colour and continues in canonical order, cut to `playerCount`, and a PvE or hotseat
create refuses a list that does not hold the host's colour. That list is seat identity — which corners
exist, so a skipped one stays skipped — and not the rotation: turn order is colour order (blue → red →
green → yellow), applied by the engine at the start gate. A PvP joiner claims theirs in the join
request (`color`), and the claim is final: `joinMatch` resolves that colour's slot and writes it with
`HSETNX`, so one of two racing joiners gets the seat and the other gets `MATCH_COLOR_TAKEN`. There is no
default corner and no in-room swap.

`botNames` names the bot on each `botColors` slot. The backend stores each one as `player{n}_displayName = bot-<color> (<assistant>)`, which the engine copies to that seat's `displayName`; the seat keeps its `bot-<color>` identity, and the hash's `player{n}_isBot = 'true'` is what marks it as a bot. An empty or missing entry leaves the seat showing its plain id.

### MatchResponse

```typescript
{
  gameId: string;            // UUID of the match
  token: string;             // JWT for the Socket.IO handshake
  engineUrl: string;         // Socket.IO endpoint name. Derived from `FRONTEND_URL`
                             // (`ENGINE_WS_URL`, prefix `http` → `ws`). The SPA does not use it
                             // to connect — it connects to its own origin.
  color: string;             // Assigned seat color (server-chosen)
  mode: 'pvp' | 'pve' | 'hotseat';  // Game mode (persisted for refresh/rejoin)
  playerCount: number;       // How many players/seats
  inviteCode?: string;       // 6-char code (invite games only)
}
```


---
---


## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/match/pvp/invite` | JWT | Create invite-only PvP match |
| `POST` | `/api/match/join/:code` | JWT | Join PvP match by invite code |
| `POST` | `/api/match/pve` | JWT | Start PvE (vs bot) game |
| `POST` | `/api/match/create` | JWT | Unified match creation (mode required: pvp/pve/hotseat) |
| `POST` | `/api/match/guest` | public (CSRF + rate limited) | Anonymous, ephemeral PvE room behind a stripped setup screen; returns the same handoff with `isGuest: true` |
| `POST` | `/api/game/:id/ready` | JWT | Signal player is ready |
| `POST` | `/api/game/:id/exit` | JWT | Acknowledge leaving post-game |
| `POST` | `/api/game/:id/abort` | JWT | Cancel unstarted game (host only, `WAITING` only) |
| `POST` | `/api/game/:id/rejoin` | JWT | Rejoin a room after refresh |
| `GET` | `/api/games/rooms` | JWT | List the PvP rooms the caller may enter (open lobby rooms + their own reclaimable seats in started games) |
| `GET` | `/api/games/mine` | JWT | List rooms the user is seated in |
| `POST` | `/api/game/end` | engine key (`X-Engine-Key`) | Engine callback — the completion pass: rows for the seats that have none (scoring/achievements); persists `clashDefends` / `clashAttacksWon` per participant. Refuses a room that is still live (`MATCH_END_STILL_ACTIVE`) or never started (`MATCH_END_NEVER_STARTED`) |
| `POST` | `/api/game/:id/abandon` | engine key (`X-Engine-Key`) | Engine callback — one seat left a room before anybody won: one `ABANDONED` row for that seat, and nothing else (no rating, no stats, no hash deletion) |
| `POST` | `/api/game/:id/started` | engine key (`X-Engine-Key`) | Engine callback — mark game started |
| `GET` | `/api/game/:id/result` | JWT | The caller's own row for this match (`{ state, row }`): the read a client makes when it can no longer join |

> **There is no invite route in this module.** Inviting a friend into a room is
> `POST /api/friends/:friendId/invite` with `{ gameId }`, served by the friends module:
> this module owns the room, so it owns `assertInvitableRoom` (404 `MATCH_GAME_NOT_FOUND`,
> 403 `MATCH_PVP_ONLY_INVITE` / `MATCH_ALREADY_STARTED` / `MATCH_NOT_PLAYER`) and
> `isWaitingRoom`, which the friends module calls before it writes anything. One route
> means the friendship gate, the invite record and the notification exist once.

> **One seat at a time:** every create and every join path refuses a caller who
> already holds a seat in a waiting room or a live game with `403 MATCH_ALREADY_SEATED`;
> the only exception is reclaiming a seat in the room itself. See
> [the one-seat lock](#the-one-seat-lock-active-gamets).


---
---


## Engine GameState Readers (`seat-finalization.ts`)

**Source:** `backend/src/match/seat-finalization.ts`

Both helpers read the engine's own live state instead of trusting the `match:*` hash, because the hash can lag behind the engine (and, before the guards below existed, a duplicate create could rewrite a live `ACTIVE` room back to `WAITING`).

### `isSeatFinalized(redis, gameId, color)`

This helper answers one question: can this seat still be rejoined? It is used in three places — `GET /api/games/mine` (stop advertising a match to a departed player), `GET /api/games/rooms` (stop offering a rejoin row for a seat the engine is done with) and `POST /api/game/:id/rejoin` (refuse to mint a token for a seat that is gone). It is evaluated on the caller's seat regardless of the hash status, because a `WAITING` room has engine state too.

The engine owns the authoritative live game state (`game:{gameId}` hash, field `state`, one JSON blob). A seat whose `PlayerMeta.status` is `exited` (pruned on grace expiry, or removed by End Game) is terminal: the player can never resume that seat, so the backend must stop treating the match as rejoinable for them. `exited` is the only terminal status.

Deliberately **not** terminal:

| Status | Why it can still rejoin |
|--------|-------------------------|
| `disconnected` | The grace window (45 s) is running; the player can still come back |
| `inactive` | A waiting-room leave, or a seat that has not joined a live game yet |

The helper is fail-open: a missing key, unreadable value, or schema drift returns `false`, which keeps the match advertised rather than locking a legitimate player out.

A torn-down room has no engine state at all (teardown deletes `game:{gameId}`), so this helper cannot refuse a rejoin into it — that gate is the hash status, checked first in `MatchPlayerService.rejoin()`: a hash reading `ABORTED` (or legacy `ENDED`) answers `404 MATCH_GAME_NOT_FOUND`, the same statuses the strict lock below ignores. A `WAITING` room never carries one of them, so reclaiming a lobby seat is unaffected.

### `isEngineGameStarted(redis, gameId)`

Answers: has the engine's ready-check already started this game? A room is only a lobby until then, and a game that has started accepts no new seats.

- `GET /api/games/rooms` uses it to keep started rooms out of the joinable list for every viewer who does not hold a seat in them (the hash status alone is not enough: a room whose hash was rewritten back to `WAITING` is still a running game).
- `POST /api/match/join/:code` → `MatchPlayerService.joinMatch()` re-checks it, so a stale hash cannot be used to seat a new player into a running game.

It reports `true` for any engine status other than `waiting` and `false` when the engine has no state yet (a pure lobby room) — the same fail-open policy as `isSeatFinalized`.

> The holes these gates closed, and the socket rules that depend on them, are in [`../architecture.md`](../architecture.md) → Security & Threat Model.


---
---


## The one-seat lock (`active-game.ts`)

**Source:** `backend/src/match/active-game.ts`

One seat per player, waiting room included. `findSeatedMatch(redis, userId, exceptGameId?)` returns the room this player already holds a seat in — `{ gameId }`, or `null` — whatever its status, and it is the single implementation behind every "one seat at a time" refusal (a caller that only needs the boolean tests the result):

| Call site | Effect when a live game exists |
|-----------|--------------------------------|
| `MatchCreatorService.createMatchLocked()` — `POST /api/match/create`, `/api/match/pve`, `/api/match/pvp/invite` | `403 MATCH_ALREADY_SEATED`, checked after the idempotent PvP reuse lookup: re-opening your own lobby room hands that seat back, while a seat in any other room refuses the create |
| `MatchPlayerService.joinMatch()` — `POST /api/match/join/:code`, and the challenge's accept, which joins by code | `403 MATCH_ALREADY_SEATED`, unless the seat is in the room being joined (that path is a rejoin) |
| `MatchPlayerService.rejoin()` — `POST /api/game/:id/rejoin` | `403 MATCH_ALREADY_SEATED` for a **different** room; the room being rejoined never counts (`exceptGameId`), so reclaiming your own seat still works. Checked after the closed-room gate above (`404` for `ABORTED`/`ENDED`) |
| `AuthService.logout()` — `POST /api/auth/logout` | not a refusal: the revoked token already names the user, so the same answer decides which room to publish `match:abandon` for, and the engine ends that seat (see [Sign-out ends the match](#sign-out-ends-the-match)) |

A seat counts from the moment it is written into the hash, in either status, so the lock
is about the seat rather than the phase of the game: a waiting lobby you are keeping open
is still a seat, and playing elsewhere means releasing it (Abort) or losing it (a
participant's five-minute window). `createMatchLocked` checks the reuse lookup first, so
"re-loading my own lobby" hands the same seat back instead of refusing it.

Only rooms whose hash says `ABORTED` (an abort, or the engine's expiry teardown) are
finished and never lock their players out, even while the hash lingers for the rest of
its TTL; a room finished by its results has no hash at all (the game-end callback deletes
it), and a legacy `ENDED` value written by an older build is treated as finished too.

`findLiveMatch()` is the narrower read, used by sign-out: it returns only a room whose hash
is `ACTIVE` or whose engine state has started, because that is the room a sign-out has to
end through `match:abandon`.

The check is backend-authoritative because the backend owns the `match:*` state. The frontend mirrors it as a hint only: `LudoLobby` greys out host/join (with a tooltip) while `/api/games/mine` reports a room, and `Lobby`'s launch button does the same from a one-shot `/api/games/mine` read. A notification never clears the way: accepting an invite only carries the room code to the lobby, which refuses the claim while a seat is held, so the player releases their own seat with Abort instead of a bell deciding that a game is over. A refused create/join surfaces as the localized `errors.MATCH_ALREADY_SEATED` message wherever the request was made.

### Blocked pairs at the door

A block is about **seating**, never about the room a player already sits in. The two rules
that follow from that are implemented in `MatchQueryService.lobbyRoomsFor()` and
`MatchPlayerService.assertNoBlockedSeat()`:

| Stage | Rule |
|-------|------|
| The open list (`GET /api/games/rooms`) | A room is not a row for a viewer when **any** seat in it belongs to a blocked pair with that viewer, in either direction. The filter is server-side (`blockedByViewer()` folds every `blocked` row into one map per flush); the browser's row carries no seat ids, so it could not apply it. |
| Claiming a seat (`POST /api/match/join/:code` → `joinMatch`) | The seats already taken are tested against the caller with one `pairKey`-set read. The blocker gets `403 MATCH_SEAT_BLOCKED` ("You blocked a player in this room"), which names nothing they do not already know; the blocked party gets the neutral `403 MATCH_ROOM_UNAVAILABLE`, the same answer a room that filled up gives. |
| Everything that already holds a seat | Unaffected. `joinMatch` hands an existing seat back through `rejoin` before it looks at the room's occupants, and `POST /api/game/:id/rejoin` plus `GET /api/games/mine` never ask the block question at all. |

Two consequences are deliberate:

- **It is a door, not an eviction.** A block placed while both accounts sit in one room (waiting
  or playing) never removes anybody: the match plays out, with the room's chat cut both ways by the
  engine's `blockedPairs`. A host who does not want to play that match has `POST /api/game/:id/abort`
  (WAITING and host only), and the new room they create refuses the blocked player at the door, which
  is the whole remedy. Making BLOCK a kick would need a seat release, a colour reclaim and a "you
  were removed" surface, and it would turn a private decision into an announcement.
- **Seat-based, not host-based.** A third party's room can seat both sides, so the pair is tested
  against every occupied seat rather than against the host's account. The host case is just the one
  where it is most visible.

The chat-side half of the same decision lives in the friends module (`publishBlocksChanged` on block
and unblock); the invite side needs no gate: a blocked pair is not a friendship, so no friends row,
CHALLENGE button or INVITE COMMS column can even offer it, and `POST /api/friends/:friendId/invite`
refuses a blocked pair with `403 FRIEND_BLOCKED` before it touches a room.

### Sign-out ends the match

Signing out must not leave a live room behind a seat that can never come back (D7). `AuthService.logout` revokes the refresh token — `SessionService.revoke()` returns the `userId` it already read, so no second lookup — and then asks `findLiveMatch()` which room that account holds. When there is one, it publishes `match:abandon` with `{ gameId, userId }` through `publishMatchAbandon()` in `common/channels.ts`.

The backend stops there on purpose. The room state belongs to the ludo-engine, and the departure is not a hash write: `departSeat` parks the seat's pieces, advances the turn, publishes `player_exited` + `state_update`, and closes the room when fewer than two live humans remain (a 2-player room and any PvE room therefore end; a 3-4 player room plays on with the seat `exited`). The engine's `MatchAbandonSubscriber` owns that call and applies it under the game lock, exactly like a grace-window expiry. No `MatchModule` dependency is added to `AuthModule`: `active-game.ts` imports only `ioredis` and `seat-finalization.ts`, so `AuthService` calls it directly with the Redis client it already holds.

Both steps are best effort and independent. A Redis hiccup on the publish is logged, never surfaced: the sign-out itself already happened, and the seat still ends through its own reconnect window — `startReconnectGrace` opens one on the closing socket, and its expiry departs the same seat with `'timeout'` instead of `'leave'`.


---
---


## Core Logic / Flow

### 1. Create a PvP Match

```mermaid
sequenceDiagram
    participant User
    participant Site as Your App
    participant Server as Backend

    User->>Site: Configure PvP and press Start
    Site->>Server: POST /api/match/create { mode: "pvp" }
    Server->>Server: Reuse your own open lobby room if you have one (else create it)
    Server->>Server: Sign an engine JWT for your seat (24h expiry)
    Server-->>Site: { gameId, token, engineUrl }
    Site-->>User: Take you into the game room
    Note over Site,Server: Opponents join later via invite code (/pvp/invite) or an open room
```

### 2. Create Invite Match

```mermaid
sequenceDiagram
    participant User
    participant Site as Your App
    participant Server as Backend

    User->>Site: Click "Invite a friend"
    Site->>Server: POST /api/match/pvp/invite
    Server->>Server: Create a game + a 6-character invite code
    Server-->>Site: { gameId, inviteCode, token, engineUrl }
    Site-->>User: Show the code so you can share it
```

### 3. Join by Invite Code

```mermaid
sequenceDiagram
    participant User
    participant Site as Your App
    participant Server as Backend

    User->>Site: Enter the invite code a friend gave you
    Site->>Server: POST /api/match/join/{code}
    Server->>Server: Look up the game for that code
    alt Code not found or expired
        Server-->>Site: Error message
        Site-->>User: Show "code invalid"
    else Code valid
        Server->>Server: Add you to the game (only if its engine game is still waiting)
        Server-->>Site: { gameId, token, engineUrl }
        Site-->>User: Take you into the game room
    end
```

### 4. Start PvE Game

```mermaid
sequenceDiagram
    participant User
    participant Site as Your App
    participant Server as Backend

    User->>Site: Set up a game against bots and press Start
    Site->>Server: POST /api/match/pve
    Server->>Server: Create a game with you + the chosen bots
    Server-->>Site: { gameId, token, engineUrl }
    Site-->>User: Take you into the game
```


---
### 5. Guest PvE Game (public door)

```mermaid
sequenceDiagram
    participant Guest
    participant Site as SPA
    participant Server as Backend
    participant Engine

    Guest->>Site: "Play as guest" on the login screen
    Site-->>Guest: Stripped PvE setup (bots and room rules only)
    Guest->>Site: Add bots, set rules, Launch
    Site->>Server: POST /api/match/guest { botCount, botColors?, botNames?, rules }
    Server->>Server: GuestLimitService gate + reserve (per address and global)
    Server->>Server: createMatchLocked(guest-<hash>, pve, blue, [blue, ...botColors])
    Server-->>Site: { gameId, token: g_…, color, mode, playerCount, rules, isGuest: true }
    Site->>Engine: Socket.IO handshake with the opaque token
    Engine->>Engine: guesttok:<sha256(token)> -> { gameId, color, mode, ip }
    Engine-->>Site: game_joined for the token's room and seat
```

The full design, including the budgets, the registry keys and the settlement paths, is in
[`../guest-mode.md`](../guest-mode.md).

- **No account, no session.** The route has no `JwtAuthGuard`; CSRF and the
  global throttler still apply, and nginx gives the exact location its own
  `guest` zone (10 r/m, burst 5) instead of the generic `/api/` budget.
- **The payload cannot widen the room.** `CreateGuestMatchDto` takes
  `botCount` (1-3), optional `botColors`/`botNames` and the three rules; `mode`,
  `playerCount`, `seatColors` and `gameId` are not accepted. The mode is forced
  to `pve`, the human seat is blue, and the seat order is derived as
  `['blue', ...botColors]` so sparse bot layouts are dealt as shown.
- **The seat id is per mint:** `guest-<sha256(token)>`, never a per-IP id (a
  shared NAT id would hand the second student a `MATCH_ALREADY_SEATED` refusal).
  The create lock and the live-match scan are skipped: the id is unique, so
  both are no-ops, and a full hash scan per anonymous mint is pure cost.
- **Budgets** live in `GuestLimitService`'s single `GUEST_LIMITS` block:
  per-address mints (soft 10 -> delay ladder, hard 40 / 6 h), aborts priced
  double at the next mint, 3 live rooms per address and a global live-room
  ceiling. The engine writes the abort/live counters from its own socket path;
  the backend decides every limit.
- **The engine trusts a registry, not a signature.** `guesttok:<sha256(token)>`
  is written at mint with a 1 h TTL; the handshake branches on the `g_` prefix,
  resolves the record and marks the socket `isGuest`. Guests may drive the
  game events and `end_game`/`leave_game`, and are refused `player_ready` and
  `update_modifiers` silently (an allow-list, so future
  events are closed by default).
- **Nothing is written at the end.** The match hash carries `isGuest=true`, so
  the engine never calls `/api/game/end` or `/api/game/:id/started` for it: no
  `MatchHistory` rows, no `PlayerStats` counters and no leaderboard, exactly like
  hotseat. An abort
  instead prices the counter, frees the live-room slots and revokes the token;
  a normal finish frees the slots without pricing an abort.


---

## Logic Paths Summary

### Create PvP Path
```
POST /api/match/create   (mode: "pvp")
  ├── The caller already sits in a live game → 403 MATCH_ALREADY_SEATED
  │   (strict state lock, all modes, checked before any reuse)
  ├── Validate the mode and the seat counts
  ├── Reuse lookup: does the caller already sit in one of their own PvP rooms?
  │   ├── hash WAITING + engine game not started + their seat not finalized
  │   │   → hand back that room and their EXISTING seat (colour, role,
  │   │     inviteCode, playerCount) and write nothing to the hash
  │   └── otherwise → create a fresh room below. A started game is never
  │       reused: the player keeps ghosting in it (or keeps its 45 s
  │       reclaimable seat) and may start or join something else meanwhile
  ├── Write the match hash (status WAITING) with a 24h TTL
  ├── Sign the engine JWT for the host seat (`jwt.sign`, 24h expiry)
  └── Return { gameId, token, engineUrl }
```

### Invite Path
```
POST /api/match/pvp/invite
  ├── Same create-or-reuse path as above (host seat, inviteCode on create),
  │   including the strict state lock
  └── Return { gameId, inviteCode, token, engineUrl }

POST /api/match/join/:code
  ├── SCAN match:* for a room whose inviteCode matches and whose status is WAITING
  │   ├── no match → 404 MATCH_INVITE_INVALID
  │   ├── the caller is the host → 400 MATCH_OWN_INVITE
  │   └── found → joinMatch (see In-Game Actions Path)
```

### PvE Path
```
POST /api/match/pve
  ├── The caller already sits in a live game → 403 MATCH_ALREADY_SEATED
  ├── Create the match with the host and the chosen bots
  ├── Write the match hash with status ACTIVE
  ├── Sign the engine JWT for the host seat
  └── Return { gameId, token, engineUrl }
```

### In-Game Actions Path
```
POST /api/game/:id/ready
  └── Mark player ready → return { message, gameId }

POST /api/game/:id/exit
  └── Acknowledge post-game exit → return { message, gameId }

POST /api/game/:id/abort
  ├── Verify the caller holds a seat → else 403 MATCH_NOT_PLAYER
  ├── Verify the caller is the host → else 403 MATCH_HOST_ONLY
  ├── Verify the room is still WAITING → else 403 MATCH_ALREADY_STARTED
  ├── Mark the room ABORTED, then publish the room change
  └── `match_cancelled` to every other seat the hash does *not* flag
      `player<N>_isBot` (a bot seat has no bell to ring) → return { gameId }

POST /api/game/:id/rejoin
  ├── A live game in ANOTHER room → 403 MATCH_ALREADY_SEATED (this room excluded)
  ├── Verify the caller holds a seat → else 403 MATCH_NOT_PLAYER
  ├── Their seat is finalized (isSeatFinalized, any hash status) → 403 MATCH_SEAT_EXPIRED
  └── Mint a fresh engine JWT for the seat

POST /api/match/join/:code → joinMatch
  ├── The caller already holds a seat → hand back that seat (rejoin rules above)
  ├── A live game in another room → 403 MATCH_ALREADY_SEATED
  ├── hash status is not WAITING → 403 MATCH_ALREADY_STARTED
  ├── the engine has already started the game → 403 MATCH_ALREADY_STARTED
  ├── not a PvP room → 403 MATCH_PVP_ONLY_JOIN
  ├── room full → 403 MATCH_ROOM_FULL
  └── Seat the caller in the next free slot → return { gameId, token, engineUrl }

GET /api/games/mine
  ├── Scan match:* hashes where the caller is seated
  ├── Skip rooms that are not WAITING or ACTIVE
  └── Their seat is finalized (isSeatFinalized, any status) → skip, so no
      REJOIN MATCH button is offered for a seat that is gone

GET /api/games/rooms
  ├── Scan match:* hashes (WAITING or ACTIVE, PvP)
  ├── The caller holds a seat in the room → REJOIN row
  │   ├── their seat is finalized → skip (nothing left to rejoin)
  │   └── otherwise list it even when the game is live or the room is full
  ├── The caller holds no seat → JOIN row
  │   ├── hash status ACTIVE, or the engine has started the game → skip
  │   │   (a started room is visible only to its own reclaimable seats)
  │   └── room full → skip
  └── Every row carries mySeat, so the lobby knows to rejoin instead of join,
      plus readRoomRules(hash): clashEnabled, noSafeZones, freeExit and
      clashKeyShift, which the browser shows as the MODES cell (absent fields read
      as the standard room; the switch count is 0 unless clash mode is on)
```


---
---


## Lobby invalidation (`rooms:changed` → `rooms:list` / `rooms:mine`)

The lobby and the rejoin banner are pushed, not polled (socket consolidation, Phase 2).

**Publishers.** Every write that can change either list publishes `rooms:changed` with no payload:

| Side | Where |
|------|-------|
| Backend | `MatchCreatorService` (`createMatch` write, `handoffExistingRoom` seat reclaim), `MatchPlayerService` (`joinMatch` seat, `rejoin` reclaim, `exitGame` free seat, `cancelGame` abort, `markStarted`), `MatchPostgameService` (`processGameEnd` deletes the hash) — all through `publishRoomsChanged(this.redis)` from `backend/src/common/channels.ts` |
| Engine | `RedisGameStore`'s match-key methods: `updateMatchData`, `setIdleSince`, `clearIdleSince`, `setSeatUser`, `clearSeatUser`, `clearMatchSeat`, `abortMatch` — each calls its own `notifyRoomsChanged()`, because the engine is a separate build with no import path into the backend |

Both sides are best-effort: a failed publish is logged and repaired by the tick below, never raised to
the caller that caused the write.

**The diff.** `RealtimeBroadcaster` subscribes to the channel, debounces **500 ms** (a burst is one
snapshot read), calls `MatchQueryService.snapshot()` once, and derives each connected viewer's payload
from it:

- `snapshot()` reads every `match:*` hash in one scan, **one engine-state read per room** (which seats
  the engine finalized, and whether it started), and one Postgres query for the hosts. Everything
  viewer-independent is resolved once.
- `lobbyRoomsFor(snapshot, viewerId)` and `myRoomsFor(snapshot, userId)` are the pure filters that
  build the two payloads. They are the *same functions* the REST routes use, so the push and
  `GET /api/games/rooms` / `/api/games/mine` cannot drift.
- A payload is emitted only when its JSON changed for that viewer, so a room that changed for
  somebody else never repaints this viewer's screen.
- The cache is pruned to the accounts that still have a socket, so a reconnect always receives the
  current state instead of diffing against stale bytes.

**The repair tick.** Every 30 s the broadcaster recomputes and emits on change, and logs
`[rooms] repair tick emitted N diff(s)` when it had to. It is both insurance (a crash between write
and publish, a reconnecting subscriber) and the counter that makes a missed publish visible: a steady
non-zero count is a coverage hole in the publisher list above.

**The client.** `LudoLobby` and `RetroNavbar` subscribe to the events and keep one REST read for first
paint (plus one per reconnect, since the push carries only a diff). Neither screen polls any more.


---
---


## Which seats a result may write (`POST /api/game/end`)

A finished game becomes rows, ratings and a leaderboard entry in one transaction, and only
human seats are allowed in. The engine already reports human seats only
(`result-submitter.ts` drops a seat whose state says `isBot`), but the backend answers that
question itself instead of trusting the payload:

- **The room hash's flag is the answer.** `botSeatColors(matchData)` reads
  `match:<gameId>`'s `player<N>_isBot = 'true'`, taking each slot's colour from
  `player<N>_color` (a hotseat room may skip a colour). Every reported participant whose colour
  is in that set is dropped before anything is written; nothing looks at the shape of an id.
- **The flag-filtered list is the one everything downstream uses.** It is what the PvP minimum
  counts (`MATCH_END_PVP_MIN_PLAYERS`), what the transaction inserts and rates, what goes into
  `leaderboard:global`, and what receives the `match_finished` bell entry and the friends'
  `publishSubject` refresh.
- **A seat with no `User` row writes nothing.** The row and the rating are written only after
  `tx.user.findUnique()` returns a user: `game_participant.user_id` is a foreign key, so an
  unknown id would roll back the whole transaction (every other participant's rating included).
  This is also what keeps a `bot-<color>` id out of the record when the room hash is gone (a
  Redis restart mid-game leaves nothing flagged) — the account check, not an id prefix.
- **The winner's colour still comes from the report.** A bot may win a PvE game; the client
  should render "red won" with a placeholder name. `notifyMatchFinished` therefore takes both
  lists: `participants` for the rank-1 colour, and the scored list for the username lookup and
  for who gets a bell.

`Test-harnesses/bot-seats/postgame-seat-probe.ts` is the live proof: six rooms POSTed to this
route with the engine key, including a PvP room whose only second seat is a bot (refused) and a
seat flagged `isBot` that carries a real account's id (that account stays untouched).


---

## The abandoned row (`POST /api/game/:id/abandon`)

A seat that leaves a room before anybody wins keeps a row. The engine calls this route from its
one departure funnel: at the departure itself when the room stays above quorum, and once per
human seat when a room is torn down below quorum (`closeRoom` in `player-handler.ts`).

- **The guard reads the engine's own state.** The seat must be `exited` or `inactive` in
  `game:<id>`'s `state`, or the room's hash must be `ABORTED`/`ENDED`. A seat that is still
  playing is refused (`409 MATCH_ABANDON_SEAT_ACTIVE`) on purpose: a 3-of-4 abort must not write
  a row for the players still on the board, whose rows arrive with the report that ends the room.
  A room with no `startedAt` is refused too (`MATCH_ABANDON_NEVER_STARTED`): a waiting room is a
  room, not a match, so a participant's Abort there frees a corner and leaves no record.
- **What it writes is one row and nothing else.** `status: ABANDONED`, `rank` = the room's player
  count (last, never a podium), `ratingDelta: 0`, the tallies the seat had at the departure (the
  engine captures them before its pieces are parked, so `piecesInGoal` is true rather than 0), the
  room's seat snapshot with the leaving seat flagged `abandoned`, and the usual 50-row trim in the
  same transaction. It never touches `PlayerStats`, the rating, `leaderboard:global`, an
  achievement, or `rooms:changed`, and it never deletes `match:${id}`: the room may be live for the
  others.
- **The bell says `match_abandoned`.** Not `match_finished`: being told you finished a match you
  did not finish is worse than hearing nothing.
- **A redelivery is free.** The early read answers with the row it already wrote, and
  `@@unique([user_id, game_id])` settles the delivery that races it.

The engine side is what makes this safe: the record is captured before the parking, kept on the
seat (`exitRecord`), and its `submitted` flag is only set after a 2xx. A delivery that fails is
retried by the wake pass and by the room's next reconnect, so a backend hiccup cannot lose a row.

---

## `/end` is a completion pass (R21)

`POST /api/game/end` no longer means "here is the final result". It means "this room is over, fill
in the seats that have no row".

- **Two markers say the room is over.** The engine's own `game:<id>` state at `status: 'finished'`
  (a winner was declared), or the `match:<id>` hash in `ENDED_MATCH_STATUSES` (the engine closed
  the room itself). Neither means `409 MATCH_END_STILL_ACTIVE`, so a premature POST can no longer
  delete the hash out from under a game that is still being played, or award a rating for a board
  that is still moving.
- **A missing state falls through.** A Redis restart mid-game is exactly the case whose result
  must still land, so an unreadable `game:` key drops to the start stamp instead of refusing;
  `MATCH_END_NEVER_STARTED` then covers the reaped waiting room.
- **The idempotency guard is a *completed* row.** Any row would have answered "already processed"
  for a game that only has an abandoned seat's row, and thrown away the real result for the seats
  that stayed.
- **Existing rows are read, not rewritten.** The seats that already hold a row are skipped, their
  recorded ranks and statuses join the snapshot, and the PvP minimum counts rows plus reports. The
  career row (`playerStats`, rating, leaderboard, streak) is gated on `status === 'completed'`, so
  the no-stats rule is one condition in one place.

## The room's transcript on a row (`chat`, M3)

Both result writers store the room's channel on the row they write, and neither re-mints a line: the
engine sent them as it stored them.

| piece | where |
| --- | --- |
| the payload | `GameEndPayload.chat` / `.blocks` and `SeatAbandonPayload.chat` / `.blocks`: `chat: { truncated?: boolean, lines: ChatLine[] }` and `blocks: { a, b, atSeq }[]` |
| the projection | `chatForSeat(chat, blocks, seatUserId)` (exported from `match.postgame.service.ts`): the room's lines in order, cut at the ledger — a line is hidden when a block between that seat and its sender was applied at or before the line's own sequence, in either direction. A seat's own lines and every system line always survive |
| the columns | `chatColumns(...)` is spread into `matchHistory.create` by both `processGameEnd` and `recordAbandonedSeat`: `chat` stays absent when the room had no channel or never spoke, and `chatTruncated` is only ever true when the engine's 413 fallback cut the payload |
| the body cap | `main.ts` mounts a 2 MB json parser for `POST /api/game/end` and `POST /api/game/:id/abandon` and the 100 kB default for everything else. A 413 is the one refusal the engine answers rather than retries: it re-posts the newest 400 lines with `truncated: true` |

The transcript is written once, at the end of the room, and it is **never** read back by
`GET /api/game/:id/result`: a card needs the outcome, not the conversation. The one reader is
`getUserGames`, which ships `chat` and `chatTruncated` to the row's own account and omits both for
a friend, so the profile's expander is owner-only by construction rather than by a UI condition.

## The result read (`GET /api/game/:id/result`)

A dropped client cannot be handed a card: the frame that ends a match is addressed to the sockets
still inside the room. So the database answers instead, for the caller's own seat:

| `state` | Meaning | What the client does |
| --- | --- | --- |
| `finished` | The row is there (`{ state, row }`) | Renders the card from the row and never re-emits `join_game` |
| `pending` | No row, but `match:${id}` is still live | Leaves the socket alone |
| `unknown` | No row and no room | Keeps the card it already has |

The client asks on three signals: a `/game` mount whose match is already terminal, a refused
`join_game` (`MATCH_GAME_NOT_FOUND`), and `reconnect_failed` after the socket's 16 attempts. The
row it gets back is the seat's own, with its counters and the room's seat snapshot; the transcript
(`chat`) is never carried by this route.




`processGameEnd` moves every human participant's rating inside one transaction. A friend's list shows
that rating, and before Phase 3 the 12 s / 15 s pollers were what kept it honest. Now, after the
transaction commits and the postgame notifications are sent, the service calls
`FriendshipEventsService.publishSubject(userId)` once per participant that got a row — the seats the
room flags as bots were dropped before the transaction, and a seat with no `User` row got no row to
publish: the publisher reads the subject's fresh row and pushes an `accepted` record with the new
`rating` to every accepted friend who has a socket open.

Two properties are deliberate:

- **After the commit, fire-and-forget.** A live-update failure is logged, never raised into
  `POST /api/game/end`, and nothing is published for a rating that could still roll back.
- **One publish per participant, no coalescing.** The four participants of a 4-player game are four
  different subjects with four different audiences, so a per-`(recipient, subject)` coalescer would
  merge nothing; a single game-end request publishes at most one record per (friend, participant)
  pair.

See [backend-friends-module.md](backend-friends-module.md) → *Live records on the session socket* for
the record's shape and the watcher short-circuit.


---


## Implementation Notes

- **Room rules are normalized once, at the service boundary** (`match.creator.service.ts`). `normalizeRoomRules` applies the defaults and the coercion for every caller, and `roomRuleHashFields` writes the result in the same `HSET` as the seats, so a room never exists without its rules. Keys and defaults live in `room-rules.ts`; the engine freezes them at join, and the lobby may change them only while the room is WAITING.

- **The key-shift count is clamped in two places, on purpose.** `clashKeyShift` is the one rule that is a number (0, 1 or 2 switches per clash) rather than a boolean, so it carries its own clamp: `clampClashKeyShift` in `backend/src/match/room-rules.ts` on this side of the wire, and the same body in `backend/app/ludo-engine/src/engine.ts` on the engine side, which the join also reads through when it builds a game from the match hash. The two are separate packages with no shared import path, so `room-rules-harness.ts` compares the two function bodies instead of trusting a comment: same text, same behaviour. Both force 0 whenever `clashEnabled` is false, so "the mutator is on but clash is off" cannot be stored or read, and a junk value (a string, a float, a boolean, an array) clamps to a legal count rather than reaching the state.


---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `Redis` (ioredis) | Match state, invite codes; match.postgame posts finished-game ratings into `leaderboard:global` (zadd) |
| `PrismaService` | Game history, rating updates, achievement evaluation |
| `NotificationService` | `game_invite` / `match_cancelled` / `match_finished` pushes to the seated players |
| `AchievementsService` | Achievement evaluation after a game ends (`match.postgame`) |
| `JwtService` | Host for the engine-token signer (`engine-token.util.ts` overrides the secret per call, so the module's own `JWT_SECRET` is not what signs match tokens) |
| `secrets.ts` | `ENGINE_API_KEY` (validating engine callbacks, compared in constant time by `verifySecret`) and `ENGINE_JWT_SECRET` (signing engine tokens) |

> Presence is **not** a match dependency: no `match.*` service imports `PresenceService`.
> Presence is read off the session socket now (see `backend-presence-module.md`): the connection is the
> liveness signal, and the match page only sends `presence:playing` on enter/leave.


---
---


## Configuration / Environment

| Variable | Default | Used By |
|----------|---------|---------|
| `REDIS_HOST` | `redis` | Redis connection for match state |
| `REDIS_PORT` | `6479` | Redis port |
| `REDIS_PASSWORD` | (from secrets) | Redis authentication |
| `ENGINE_API_KEY` | (from secrets) | Validates `POST /api/game/end` and `/api/game/:id/started` from engine. Compared with `verifySecret()` (both sides SHA-256-hashed, then `timingSafeEqual`, so a wrong-length key cannot throw or leak its length) and the entrypoint preflight rejects a build where it is empty |
| `ENGINE_JWT_SECRET` | (from secrets) | Signs the Socket.IO engine tokens handed to clients (`signEngineToken`, `engine-token.util.ts`) — separate from the session `JWT_SECRET` so one leaked key cannot forge the other token family. Required: the preflight rejects a build without it |
| `FRONTEND_URL` | `https://localhost:8443` (from `.env`) | Derives `ENGINE_WS_URL` by replacing `http` with `ws`; required, so the app throws at startup if it is unset |

### Tunable constants

| Constant | File | Default | What it controls |
|----------|------|---------|------------------|
| `SLOT_COLORS` | `match.creator.service.ts`, `match.player.service.ts` | blue, red, green, yellow | Seat order used when creating/joining rooms |
| `ENGINE_WS_URL` | `match.creator.service.ts` | derived from `FRONTEND_URL` | WebSocket URL handed to clients for the ludo-engine |
| `POINTS_PER_PIECE` | `common/scoring.ts` | 2 | Rating points per piece brought home (halved for PvE) |
| `WIN_BONUS_PIECE` | `common/scoring.ts` | 1 | Extra "piece" counted for the winner when scoring |