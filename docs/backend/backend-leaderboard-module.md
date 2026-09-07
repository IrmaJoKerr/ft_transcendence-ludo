# Leaderboard Module

## Table of Contents

- [Overview](#overview) — What the leaderboard does
- [Data Flow & Population](#data-flow--population) — How the leaderboard gets filled and read
- [Files](#files) — Every source file in the module and its role
- [Key Types / Interfaces](#key-types--interfaces) — Query options and response shapes
- [API Endpoints](#api-endpoints) — All routes with method, path, auth, and description
- [Core Logic / Flow](#core-logic--flow) — Mermaid diagrams for the leaderboard flow
- [Logic Paths Summary](#logic-paths-summary) — Step-by-step paths for each operation
- [Dependencies](#dependencies) — Other services this module relies on
- [Configuration / Environment](#configuration--environment) — Environment variables used

---

## Overview

The Leaderboard module shows a **ranked list of players**, sorted by rating
(their score). It supports:

1. **Leaderboard querying** — get the list, split into pages, for global, ranked, casual, or bot modes.
2. **Redis sorted sets** — the ranking is stored in Redis as a sorted set
   (`leaderboard:{mode}`), so it is always sorted by rating and fast to read.
3. **Your own rank** — the request can also return the logged-in user's position via `myRank`.

---

## Data Flow & Population

### Where the data lives

| Store | What it holds | Role |
|-------|---------------|------|
| **Redis sorted set** `leaderboard:{mode}` | each player = `userId`, each rating = `rating` | The only leaderboard store; always sorted by rating and fast to read |
| **PostgreSQL `User`** | the real ratings (`User.rating`) | Where the real ratings live — Redis is (re)built from this when empty |

### How Redis sorted sets rank players

Redis keeps one **sorted set** per mode.

**What a sorted set is (plain English):** a Redis *sorted set* is a collection
of unique members (here, `userId`s) where **each member carries a numeric
"score"** (here, the player's rating). Redis keeps the set **ordered by that
score automatically** — every insert immediately lands in the right position,
in `O(log n)` time. You never sort by hand: to read the leaderboard you just
ask Redis for a slice of the already-sorted set, and to move a player up or
down you just change their score (via `ZADD` with the new rating) and Redis
repositions them for free. It is the canonical Redis data structure for
leaderboards for exactly this reason.

| Redis command | What it does | Where it is used |
|---------------|--------------|------------------|
| `ZADD leaderboard:global <rating> <userId>` | Add a player, or **update** their score (inserts or repositions) | seed, game end, fill-on-demand |
| `ZREVRANGE key start stop WITHSCORES` | Read one page, **highest rating first** | `getLeaderboardFromRedis` |
| `ZREVRANK key userId` | A player's position (starts at 0, so add 1) | `getUserRank` (the `myRank` highlight) |
| `ZCARD key` | How many players are in the set | `getLeaderboardCount` |

A few concrete points about how the app uses them:

- **`ZADD` doubles as "insert" and "update".** If the `userId` is already in the
  set, `ZADD` just overwrites its score — you do not need a separate check or
  delete. That is why game-end scoring can blindly `ZADD` a player's new rating
  without knowing whether they were already ranked.
- **`ZREVRANGE ... WITHSCORES` returns a flat array** `[userId1, rating1, userId2,
  rating2, ...]`. The app steps through it two elements at a time to build the
  `{ userId, rating }` entries (see `getLeaderboardFromRedis`).
- **`ZREVRANK` is 0-based**, so the app adds 1 to turn it into a human "rank"
  (1st place = index 0 → rank 1).
- **Ascending vs descending:** `ZREVRANGE` reads *highest score first*
  (reverse order). Redis also has `ZRANGE` for ascending — this app always uses
  the reverse variant because a leaderboard ranks the top players first.
- **Ties:** when two players share a rating, Redis orders them by *member*
  (the `userId` string) as a tiebreaker. Two users with the same rating will
  still have a deterministic, stable order — no "equal rank" logic is needed
  downstream.

The set is always in rating order, so reading the top N players is just one
`ZREVRANGE` call — no sorting needed in the app.

#### The leaderboard writes (`ZADD`) and reads in one picture

```mermaid
sequenceDiagram
    participant Post as MatchPostgameService
    participant L as LeaderboardRedisService
    participant R as Redis sorted set (leaderboard:{mode})
    participant API as LeaderboardService

    Note over Post,R: On every game end
    Post->>Post: compute new rating for a human player
    Post->>L: updateLeaderboardEntry(userId, newRating, 'global')
    L->>R: ZADD leaderboard:global newRating userId
    Note over R: Redis re-sorts automatically

    Note over API,R: When a client asks
    API->>L: getLeaderboardFromRedis('global', page, limit)
    L->>R: ZREVRANGE leaderboard:global start end WITHSCORES
    R-->>L: [{userId, rating}] already highest-first
    L-->>API: entries (then enriched with usernames from Postgres)
```

### Scenario 1 — First startup with seeded data

Seeding is a **manual** step — `make all` only builds/starts the stack (see `backend-seeding-system.md`). Running `npm run db:seed` after the stack is up fills the Redis leaderboards at the same time as it fills the database:

```mermaid
sequenceDiagram
    participant Op as npm run db:seed (manual)
    participant Seed as seed.ts
    participant DB as PostgreSQL
    participant R as Redis

    Op->>Seed: prisma db seed -> seed.ts
    Seed->>DB: Create 28 roster users (+ blank bossku test account) with ratings
    Seed->>R: DEL leaderboard:global, leaderboard:ranked, leaderboard:casual
    loop For every user in the database
        Seed->>R: ZADD leaderboard:{mode} rating userId
    end
    Note over R: Redis is fully filled at seed time — nothing else needs to fetch it
```

> **Wait — isn't the seed only for the database?** The command is called `db:seed`
> (run as `npm run db:seed` → `prisma generate && prisma db seed`), and yes, its
> main job is filling PostgreSQL. But the seed script **also connects to Redis
> directly** and fills the leaderboard there. It does not rely on the backend
> API at all:
>
> 1. `seed.ts` connects straight to Redis with `ioredis`, using the same
>    `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` values the backend uses
>    (from the root `.env` — no secret files are used).
> 2. It clears the old sorted sets first: `DEL leaderboard:global`,
>    `leaderboard:ranked`, `leaderboard:casual`.
> 3. It reads every user + rating from PostgreSQL (`allPilots`, sorted by rating
>    descending) and writes each one into all three sets with
>    `ZADD leaderboard:{mode} <rating> <userId>`.
> 4. If Redis is unreachable at seed time, the script **does not fail** — it
>    logs a warning and skips the Redis part, so the PostgreSQL seed still
>    completes. The leaderboard then gets filled later by the fill-on-demand
>    path (Scenario 3b) or by game-end updates (Scenario 4).
>
> **How often does the leaderboard check the backend?** At seed time it is
> filled **once**, right away. After that there is **no polling, no cron, and no
> scheduled sync** — the ranking is updated a little at a time after every game
> (see Scenario 4) and fills itself back up on the first read if Redis is empty
> (see Scenario 3b).

### Scenario 2 — Nothing in the database

If PostgreSQL has **zero users** (fresh DB, no seed, no sign-ups yet):

```mermaid
sequenceDiagram
    participant Client
    participant API as GET /api/leaderboard
    participant R as Redis
    participant DB as PostgreSQL

    Client->>API: Request leaderboard
    API->>R: ZREVRANGE leaderboard:global
    R-->>API: (empty)
    API->>DB: Try to fill: read all users + ratings
    DB-->>API: (no users)
    API-->>Client: Empty leaderboard (source: redis)
    Note over API: The first finished game will ZADD the first entry
```

Result: an **empty leaderboard**. It stays empty until the first real game
finishes, because the only things that write to it are the seed script and
game-end scoring.

### Scenario 3 — Redis was shut down and brought back up

#### 3a. Redis still has its data (normal restart)

Redis keeps its data in the `redis_data` Docker volume, so a container restart
**keeps the sorted sets**. After a restart the leaderboard is served straight
from Redis — nothing needs to be filled again.

#### 3b. Redis is empty (volume wiped / flushed) but PostgreSQL has users

The first read **rebuilds Redis on demand** from PostgreSQL:

```mermaid
sequenceDiagram
    participant Client
    participant API as GET /api/leaderboard
    participant R as Redis
    participant DB as PostgreSQL

    Note over R,DB: Redis empty, PostgreSQL still has users + ratings
    Client->>API: Request leaderboard
    API->>R: ZREVRANGE leaderboard:global
    R-->>API: (empty)
    API->>DB: Read all users (id + User.rating)
    DB-->>API: user list
    loop For every user
        API->>R: ZADD leaderboard:global rating userId
    end
    API->>R: ZREVRANGE again (now filled)
    R-->>API: entries
    API-->>Client: Leaderboard (source: redis)
```

This is triggered by the check in `getLeaderboard`: if Redis returns **no
entries** or **fewer than 5 total**, the service reads every player's rating
from PostgreSQL and writes them into Redis before answering. This only happens
**when someone actually asks for the leaderboard** — nothing runs in the
background.

#### 3c. Redis is completely down

The Redis read is wrapped in `try/catch`. With no PostgreSQL snapshot to fall
back on, a Redis outage surfaces as an error instead of serving a stale board.
The board rebuilds itself automatically (fill-on-demand from `User.rating`)
once Redis is back up.

### Scenario 4 — Live updates after every game

The leaderboard does **not** go stale between seeds: every finished game
updates it.

```mermaid
sequenceDiagram
    participant Engine as ludo-engine
    participant PostGame as MatchPostgameService
    participant R as Redis
    participant DB as PostgreSQL

    Engine->>PostGame: POST /api/game/end (players + results)
    PostGame->>DB: Save Game + GameParticipant rows, update ratings
    loop For each human player who just played
        PostGame->>R: ZADD leaderboard:global <newRating> <userId>
    end
```

> Note: game-end scoring only writes the **`global`** mode. The `ranked` and
> `casual` sets are created by the seed and the fill-on-demand, but only
> `global` is updated after every game.

---

## Files

| File | Role |
|------|------|
| `leaderboard.controller.ts` | HTTP route: GET with mode, page, limit query params (needs login) |
| `leaderboard.service.ts` | Business logic: reads Redis, fills it from PostgreSQL (`User.rating`) when empty |
| `leaderboard-redis.service.ts` | Redis layer: ZADD / ZREVRANGE / ZREVRANK / ZCARD + full rebuild helper |
| `leaderboard.module.ts` | NestJS module — registers controller, services, and PrismaService |

---

## Key Types / Interfaces

### Query Options

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `'global' \| 'ranked' \| 'casual' \| 'bot'` | `'global'` | Which game mode to show |
| `page` | number (string) | `1` | Page number (starts at 1) |
| `limit` | number (string) | `20` | Players per page (max 100) |

### LeaderboardEntry Interface

```typescript
interface LeaderboardEntry {
  rank: number;  // Position in the ranking
  username: string;  // Player's username
  rating: number;  // Player's rating (score)
  gamesPlayed: number;  // Games played
  wins: number;  // Games won
  losses: number;  // Games lost
  draws: number;       // Always 0 (not tracked)
  winRate: number;     // Win percentage (0-100)
  avatarStyle: string | null;  // Avatar style name
}
```

### LeaderboardResponse Interface

```typescript
interface LeaderboardResponse {
  entries: LeaderboardEntry[];  // The leaderboard rows
  total: number;  // Total number of players
  page: number;  // Page number
  limit: number;  // Players per page
  myRank?: {           // Only included if a userId is given
    rank: number;  // Position in the ranking
    username: string;  // Player's username
    rating: number;  // Player's rating (score)
  } | null;
  source: 'redis';  // Redis is the leaderboard's only source now
}
```

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/leaderboard?mode=global&page=1&limit=20` | JWT (required) | Get the leaderboard; includes `myRank` for the logged-in user |

---

## Core Logic / Flow

### 1. Get Leaderboard

What happens when a client asks for the leaderboard.

```mermaid
sequenceDiagram
    participant User
    participant Site as Your App
    participant Server as Backend
    participant FastCache as Redis (leaderboard:{mode})
    participant DB as Database

    User->>Site: Open the leaderboard page
    Site->>Server: GET /api/leaderboard?mode=global&page=1&limit=20
    alt Redis has >= 5 entries (normal path)
        Server->>FastCache: ZREVRANGE page (highest rating first)
        Server->>DB: Fetch usernames, avatars, win/loss for those players
        Server->>Server: Build entries, work out winRate + ranks
        Server-->>Site: Sorted score list + page info (source: redis)
    else Redis empty or < 5 entries (fill-on-demand)
        Server->>DB: Read all users + ratings
        loop For every user
            Server->>FastCache: ZADD rating userId
        end
        Server->>FastCache: ZREVRANGE page (now filled)
        Server-->>Site: Sorted score list + page info (source: redis)
    else Redis down / throws
        Server-->>Site: Error — no snapshot fallback; board rebuilds when Redis returns
    end
    Site-->>User: Show the leaderboard table
```

---

## Logic Paths Summary

### Get Leaderboard Path

```
GET /api/leaderboard?mode=global&page=1&limit=20
  ├── Read the query options (mode, page, limit)
  ├── Try Redis:
  │   ├── ZREVRANGE leaderboard:{mode} page → entries
  │   ├── ZCARD leaderboard:{mode} → total
  │   ├── If entries empty OR total < 5:
  │   │   └── Fill on demand: read all users (id + User.rating) from PostgreSQL
  │   │       └── ZADD each into leaderboard:{mode}, then read again
  │   ├── If Redis still has no entries: return an empty board
  │   ├── Fetch user details from PostgreSQL, work out gamesPlayed/winRate/ranks
  │   ├── myRank = ZREVRANK(userId) + 1 (if userId given)
  │   └── Return { entries, source: 'redis', myRank? }
  └── If Redis fails (catch): rethrow — no snapshot fallback anymore
```

### Population Paths (summary)

```
SEED (manual: `npm run db:seed`)
  ├── Create seed users with ratings
  ├── DEL leaderboard:global / ranked / casual
  └── ZADD every user into each sorted set

GAME END (MatchPostgameService.processGameEnd)
  └── For each human player: ZADD leaderboard:global <newRating> <userId>

FILL ON DEMAND (first read after Redis is empty)
  ├── GET /api/leaderboard finds Redis empty or < 5 entries
  └── Reads all users from PostgreSQL and ZADDs them into leaderboard:{mode}
```

---

## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `PrismaService` | Database access (User model — ratings, profile info) |
| `LeaderboardRedisService` | Redis layer: sorted-set reads/writes + rebuild helper |
| `ioredis` | Redis client |

---

## Configuration / Environment

| Variable | Default | Used By |
|----------|---------|---------|
| `REDIS_HOST` | `redis` | LeaderboardRedisService Redis connection |
| `REDIS_PORT` | `6479` | LeaderboardRedisService Redis connection |
| `REDIS_PASSWORD` | (from secrets) | LeaderboardRedisService Redis authentication |
