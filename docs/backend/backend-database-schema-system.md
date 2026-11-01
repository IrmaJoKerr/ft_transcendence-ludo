# Database Schema

## Table of Contents

- [Overview](#overview) — Prisma ORM schema for PostgreSQL
- [Enums](#enums) — All enum types used in the database
- [Models](#models) — All 7 models with fields, types, and relations
- [Entity Relationships](#entity-relationships) — ER diagram showing model relations
- [Indexes](#indexes) — Database indexes for query performance


---
---


## Overview

The database uses PostgreSQL 16 with Prisma ORM (Prisma 7, `@prisma/adapter-pg`). The schema defines **6 models** and **4 enums** covering users, achievements, OAuth accounts, games and friendships. Notifications are not a table: the bell lives in Redis (see [backend-notification-module.md](./backend-notification-module.md) and D12 in `todo.md`). The Prisma client is generated into `backend/generated` (gitignored).

> **Notable shift:** The `Achievement` model now holds **only the achievement
> flags**. All per-user stats (rating, wins, streaks), avatar data, and
> disconnect/reconnect counters live directly on **`User`**.


---
---


## Enums


---
---


### FriendshipStatus

A directional friendship state. Each `Friendship` row stores two of these — one per
side of the pair (`user1Status` / `user2Status`) — so a block on one side can never
be silently rewritten from the other.

```prisma
enum FriendshipStatus {
  none
  pending
  accepted
  declined
  blocked
}
```


---
---


### PlayerColor

```prisma
enum PlayerColor {
  RED
  GREEN
  YELLOW
  BLUE
}
```


---
---


### GameStatus

```prisma
enum GameStatus {
  COMPLETED
  ABANDONED
}
```


---
---


### GameType

```prisma
enum GameType {
  PVP
  PVE
}
```

> There is no `UserStatus` enum — presence is a runtime Redis concern (see `backend-presence-module.md`), with `'online' | 'playing' | 'offline'` derived from the presence key TTL.


---
---


## Models


---
---


### User

The main account record. Holds login info plus all per-user stats, avatar
data, and disconnect/reconnect counters.

| Field | Type | Attributes | Description |
|-------|------|------------|-------------|
| `id` | String | UUID, PK | Unique user identifier |
| `username` | String | Unique | Login name (3-20 chars, alphanumeric + underscore) |
| `displayName` | String | Unique | Display name shown in-game |
| `email` | String? | Unique | Email address (nullable for OAuth-only edge cases) |
| `password_hash` | String? | | bcrypt hash (null for OAuth-only users) |
| `emailVerified` | DateTime? | | When email was verified |
| `twoFactorEnabled` | Boolean | Default: false | Whether email-code 2FA is required at login |
| `language` | String | Default: `"en"` | UI/transactional-email language (`en` \| `fr` \| `ms`) |
| `rating` | Int | Default: 0 | Elo-like rating |
| `highestRating` | Int | Default: 0 | Peak rating achieved |
| `wins` | Int | Default: 0 | Total games won |
| `losses` | Int | Default: 0 | Total games lost |
| `winStreak` | Int | Default: 0 | Current consecutive wins |
| `bestWinStreak` | Int | Default: 0 | Best consecutive wins |
| `botWins` | Int | Default: 0 | Games won against bots |
| `humanWins` | Int | Default: 0 | Games won against humans |
| `avatarStyle` | String | Default: `"bottts"` | DiceBear avatar style identifier |
| `avatarPhoto` | Bytes? | | Binary custom avatar image data |
| `avatarPhotoContentType` | String? | | MIME type of custom avatar |
| `disconnectCount` | Int | Default: 0 | Number of disconnects |
| `reconnectCount` | Int | Default: 0 | Number of reconnects |
| `pveGameStreak` | Int | Default: 0 | Consecutive PvE games (any outcome) |
| `createdAt` | DateTime | Auto | Account creation timestamp |
| `updatedAt` | DateTime | Auto | Last update timestamp |

**Relations:** `accounts`, `achievement` (1:1), `gameParticipants`, `friendshipsAsUser1`, `friendshipsAsUser2`


---
---


### Achievement

1:1 with `User`. Holds **only the achievement flags** — no stats, rating, or
avatar data (those live on `User`).

| Field | Type | Attributes | Description |
|-------|------|------------|-------------|
| `id` | String | UUID, PK | Unique identifier |
| `userId` | String | Unique, FK | Owning user |
| `achFirstBlood` … `achMercilessAttacker` | Boolean | Default: false | 16 achievement flags (see `backend-achievements-module.md`) |

**Relations:** `user` (1:1, back-reference)


---
---


### Account

OAuth provider links, one row per provider per user.

| Field | Type | Attributes | Description |
|-------|------|------------|-------------|
| `id` | String | UUID, PK | Unique identifier |
| `userId` | String | FK | Owning user |
| `provider` | String | | Provider name (`google`, `github`, `42`) |
| `providerAccountId` | String | | Provider-side account id |

**Relations:** `user` (back-reference)


---
---


### Game

Historical results only — live matchmaking state is stored in Redis, not here.

| Field | Type | Attributes | Description |
|-------|------|------------|-------------|
| `id` | String | UUID, PK | Unique game identifier |
| `startedAt` | DateTime | | When the game started |
| `endedAt` | DateTime | | When the game ended |
| `status` | GameStatus | Default: COMPLETED | Completion state |
| `gameType` | GameType | Default: PVP | PvP or PvE |
| `inviteCode` | String? | Unique | Join code for invite games |

**Relations:** `participants` (GameParticipant[])


---
---


### GameParticipant

One row per player per game.

| Field | Type | Attributes | Description |
|-------|------|------------|-------------|
| `id` | String | UUID, PK | Unique identifier |
| `game_id` | String | FK | Owning game |
| `user_id` | String | FK | Player (human accounts only; bots are never written) |
| `color` | PlayerColor | | Seat color |
| `rank` | Int | | Final placement (1st-4th) |
| `piecesCaptured` | Int | Default: 0 | Pieces knocked off |
| `piecesInGoal` | Int | Default: 0 | Pieces finished (0-4) |
| `clashDefends` | Int | Default: 0 | Clash (QTE) rounds won as defender |
| `clashAttacksWon` | Int | Default: 0 | Clash (QTE) rounds won as attacker |

**Relations:** `game`, `user`


---
---


### Bots

Bots are not stored: a bot's id is the literal string `bot-<color>`
(`bot-red`, `bot-green`, `bot-yellow`, `bot-blue`), built per seat from
`BOT_PREFIX + color`. That id lives in the `match:*` hashes and in the engine's
game state, and it never reaches Postgres. The seat's kind is its own field: the
backend writes `player<N>_isBot = 'true'` beside `player<N>_id`, and that flag is
the only answer — the engine never tests the id's shape, so a room without the
flag seats no bot. A bot seat gets no token of its own:
the backend writes its slot into the match hash and the engine auto-fills it. The
engine reports only the human seats that finished, and `match.postgame` decides
the same question for itself: it drops every reported seat whose colour the hash
flags as a bot, and it writes a row and a rating only after the seat's `User` row
is found (so an unknown id can never reach the foreign key, with or without a
`bot-` prefix).

`backend/src/common/botname-enforce.ts` defines `BOT_PREFIX` and
`isReservedBotName()`. `BOT_PREFIX` names the id a bot seat is minted with;
`isReservedBotName()` keeps a human **username**, **display name** or OAuth seed
out of that namespace (`AUTH_USERNAME_RESERVED`, `AUTH_DISPLAY_NAME_RESERVED`).
No backend reader classifies an id by its shape: what a seat *is* comes from the
hash's `player<N>_isBot` (the abort fan-out and `match.postgame` both read it),
and which account holds a result comes from the `User` row itself. The engine
keeps its own copy of `BOT_PREFIX` in
`backend/app/ludo-engine/src/socket/auth.ts`, used only to mint a bot seat's id,
so bot identity must be changed in both places at once.

The name a bot seat shows is not its id. The creator sends the lobby's own names
as `botNames`, index-aligned with `botColors`, and writes each one to
`player{n}_displayName` as `bot-<color> (<assistant>)`. The engine copies it into
the seat's `displayName`, so the label travels with the match and each client
translates only the colour word.

Modules that must tell humans from bots:

| Module | What it does with bots |
|--------|------------------------|
| Match (`match.creator`, `match.player`, `match.postgame`) | Builds a bot seat as `BOT_PREFIX + color` and writes `player{n}_isBot = 'true'` beside it, so the room hash says what the seat is; stores the lobby's `botNames` label as `player{n}_displayName`; excludes bots from seat and invite lists and from the abort fan-out (which reads the same flag); `match.postgame` drops every seat the hash flags before the transaction, and writes a row and a rating only for a seat whose `User` row exists, so a bot never gets an Elo change, a win/loss tally, a game row, a bell entry or a leaderboard entry |


---
---


### Friendship

One row per **unordered user pair** (a "superset" row), so a pair has a single
record whatever direction a request was made from. Each direction carries its own
status (`user1Status` = user1's action toward user2), so a block on one side can
never be silently rewritten from the other.

| Field | Type | Attributes | Description |
|-------|------|------------|-------------|
| `id` | String | PK | Unique identifier |
| `pairKey` | String | Unique | Sorted `"min:max"` id pair — enforces one row per pair |
| `user1Id` | String | FK | First user of the sorted pair |
| `user2Id` | String | FK | Second user of the sorted pair |
| `user1Status` | FriendshipStatus | Default: none | User1's action toward user2 |
| `user2Status` | FriendshipStatus | Default: none | User2's action toward user1 |
| `user1StatusAt` | DateTime? | | When user1's status changed (TTL / cooldown base) |
| `user2StatusAt` | DateTime? | | When user2's status changed (TTL / cooldown base) |
| `requestCount` | Int | Default: 0 | Re-request bookkeeping |
| `lastRequestAt` | DateTime? | | When the last request was sent (24 h pending TTL) |
| `createdAt` | DateTime | Auto | When the pair row was created |
| `updatedAt` | DateTime | Auto | Last change |

**Relations:** `user1` (FriendshipUser1), `user2` (FriendshipUser2)

> A live `pending` expires after 24 h and a `declined` direction stops blocking
> re-requests after a 1 h cooldown; both are applied lazily on read by the pure
> helpers in `backend/src/friends/friendship-pair.ts` (see
> [backend-friends-module.md](./backend-friends-module.md)).


---
---


## Entity Relationships

```mermaid
erDiagram
    User ||--|| Achievement : "1:1 (achievement flags)"
    User ||--o{ Account : "OAuth links"
    User ||--o{ GameParticipant : "plays"
    User ||--o{ Friendship : "user1 (user1Id)"
    User ||--o{ Friendship : "user2 (user2Id)"
    Game ||--o{ GameParticipant : "includes"

    User {
        string id PK "Unique ID"
        string username UK "Login name"
        string displayName UK "Name shown in game"
        string email UK "Email address"
        string password_hash "Scrambled password"
        datetime emailVerified "When email was verified"
        boolean twoFactorEnabled "Is 2FA on?"
        string language "Email/UI language"
        int rating "Skill score"
        int highestRating "Best rating ever"
        int wins "Games won"
        int losses "Games lost"
        int winStreak "Wins in a row now"
        int bestWinStreak "Longest streak ever"
        int botWins "Wins vs bots"
        int humanWins "Wins vs humans"
        string avatarStyle "Avatar style name"
        bytes avatarPhoto "Uploaded avatar image"
        string avatarPhotoContentType "Avatar image type"
        int disconnectCount "Times disconnected"
        int reconnectCount "Times reconnected"
        int pveGameStreak "PvE games in a row"
        datetime createdAt "When the account was made"
        datetime updatedAt "Last change"
    }
    Achievement {
        string id PK "Unique ID"
        string userId UK "Which user this belongs to"
        boolean achFirstBlood "Achievement: first win"
        boolean achOnFire "Achievement: 2 wins in a row"
        boolean achDiceMaster "Achievement: 3 wins"
        boolean achBabySteps "Achievement: 1 bot win"
        boolean achTheDiceLoveMe "Achievement: 3 bot wins"
        boolean achTactician "Achievement: 5 wins"
        boolean achMaster "Achievement: 8 wins"
        boolean achGrandBotMaster "Achievement: 12 wins"
        boolean achWorldChampion "Achievement: 15 wins"
        boolean achft_Transcendence "Achievement: 10 human wins"
        boolean achLoveTheMachine "Achievement: 3 PvE streak"
        boolean achSpeedDemon "Achievement: fast win"
        boolean achUnstoppable "Achievement: 3 captures"
        boolean achSteadyDefender "Achievement: 2 clash rounds defended"
        boolean achMercilessAttacker "Achievement: 2 clash rounds won attacking"
    }
    Account {
        string id PK "Unique ID"
        string userId FK "Which user"
        string provider "Which OAuth (Google...)"
        string providerAccountId "ID from that provider"
    }
    Game {
        string id PK "Unique ID"
        datetime startedAt "When the game started"
        datetime endedAt "When the game ended"
        GameStatus status "State of the game"
        GameType gameType "PvP / PvE"
        string inviteCode UK "Code to join"
    }
    GameParticipant {
        string id PK "Unique ID"
        string game_id FK "Which game"
        string user_id FK "Which player"
        PlayerColor color "Seat color"
        int rank "1st, 2nd, ..."
        int piecesCaptured "Pieces knocked off"
        int piecesInGoal "Pieces finished"
        int clashDefends "Clash rounds won defending"
        int clashAttacksWon "Clash rounds won attacking"
    }
    Friendship {
        string id PK "Unique ID"
        string pairKey UK "Sorted min:max id pair"
        string user1Id FK "First user of the pair"
        string user2Id FK "Second user of the pair"
        FriendshipStatus user1Status "User1's action toward user2"
        FriendshipStatus user2Status "User2's action toward user1"
        datetime user1StatusAt "When user1's status changed"
        datetime user2StatusAt "When user2's status changed"
        int requestCount "Re-request counter"
        datetime lastRequestAt "When last request was sent"
        datetime createdAt "When the pair row was made"
        datetime updatedAt "Last change"
    }
```


---
---


## Indexes

| Model | Field(s) | Type | Purpose |
|-------|----------|------|---------|
| User | `username` | Unique | Fast lookup by username |
| User | `displayName` | Unique | Fast lookup by display name |
| User | `email` | Unique | Fast lookup by email |
| Achievement | `userId` | Unique | 1:1 lookup by user |
| Account | `(provider, providerAccountId)` | Unique | Fast OAuth lookup |
| Account | `userId` | Index | Fast user account lookup |
| Game | `inviteCode` | Unique | Fast invite code lookup |
| GameParticipant | `(game_id, user_id)` | Unique | Prevent duplicate entries |
| GameParticipant | `(game_id, color)` | Unique | Prevent duplicate colors |
| Friendship | `pairKey` | Unique | One row per unordered user pair |
| Friendship | `(user1Id, user1Status)` | Index | Fast lookup of a user's user1-direction rows |
| Friendship | `(user2Id, user2Status)` | Index | Fast lookup of a user's user2-direction rows |
