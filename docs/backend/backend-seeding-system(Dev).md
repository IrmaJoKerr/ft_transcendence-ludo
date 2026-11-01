# Seeding (Dev)

## Table of Contents

- [Overview](#overview) — Test data generation for development
- [Files](#files) — Every source file and its role
- [Seed Data](#seed-data) — Users, games, and friendships created
- [Core Logic / Flow](#core-logic--flow) — Mermaid sequence diagram of seed execution
- [Idempotency](#idempotency) — How the seed scripts handle re-runs
- [Usage](#usage) — Commands


---
---


## Overview

The seed pipeline populates the database with a full test roster for development. It creates:

1. **28 seed players** (a "Cyber Roster") — themed usernames spanning the rating ladder (Viper_X 1650 down to NeonSprout 650), each with rating/win/loss counters on `User`, an `avatarStyle`, and achievement flags on the nested `Achievement` row consistent with the current thresholds.
2. **1 blank test account** — `bossku` / `password`, deliberately empty (no flags, no history) for testing brand-new accounts.
3. **Redis leaderboards** — the whole roster synced into Redis sorted sets (`leaderboard:global|ranked|casual`).
4. **Friendships and friend requests** — `seed.ts` itself builds a social graph (pending requests, accepted friends and one blocked pair); `seed_friends.ts` can add a denser accepted-friendship graph on top.
5. **Demo account profiles** — stats, achievements, match history and friendships for the two demo accounts (`harleyhxng` / `harleynghxedu`) from `seed_user_profile.ts`.

Seeding is a **manual** step — run `npm run db:seed` (or `npm run db:reset` for a clean reseed) after the stack is up. `make all` only builds and starts the containers: the backend container's entrypoint runs `prisma db push` to sync the schema automatically, but nothing seeds the database by itself.


---
---


## Files

| File | Role |
|------|------|
| `prisma/seed.ts` | Main seed — 28-player roster, blank `bossku` account, Redis leaderboard sync, game history, base friendship graph |
| `prisma/seed_friends.ts` | Dense accepted-friendship graph (up to 8 links per user; 10+ for the two target accounts) |
| `prisma/seed_user_profile.ts` | Stats, achievements, match history and friendships for the two demo accounts (`harleyhxng` / `harleynghxedu`) |
| `prisma/sync_leaderboard.ts` | Standalone Redis leaderboard sync script |
| `prisma/drop-all.sql` | SQL script to drop all tables (clean reset) |
| `prisma/truncate-all.sql` | SQL script to truncate all tables (clean reseed) |
| `prisma.config.ts` | Prisma 7 config — declares the seed command (`ts-node ... prisma/seed.ts`) |


---
---


## Seed Data

### Users

The main roster (`SEED_PLAYERS`) has 28 players with themed names, each given:

- `username`, `displayName`, email `{username}@transcendence.cyber`
- `password_hash` (all share `password`, bcrypt'd)
- `emailVerified` (staggered dates), `twoFactorEnabled: false`
- Direct `User` stats: `rating`, `highestRating`, `wins`, `losses`, `botWins`, `humanWins`, `winStreak`, `bestWinStreak`, `pveGameStreak`, `avatarStyle`
- A nested `Achievement` row holding only the lifetime achievement flags matching the roster's win counts

| Username | Rating | Wins | Losses | Notes |
|----------|-------|------|--------|-------|
| Viper_X | 1650 | 34 | 6 | Top of the ladder |
| NeonKnight | 1540 | 28 | 9 | |
| Alice | 1480 | 25 | 10 | |
| ShadowFox | 1440 | 22 | 11 | |
| CyberSamurai | 1410 | 20 | 12 | |
| HyperNova | 1390 | 19 | 11 | |
| GhostRunner | 1370 | 18 | 13 | |
| AeroBlade | 1355 | 17 | 12 | |
| StarLord | 1340 | 16 | 14 | |
| PixelMage | 1320 | 15 | 13 | |
| QuantumVolt | 1290 | 14 | 12 | |
| Bob | 1270 | 13 | 13 | |
| CircuitBreaker | 1250 | 12 | 14 | |
| SolarFlare | 1220 | 11 | 15 | |
| LaserFang | 1205 | 10 | 14 | |
| CheeseRing | 1180 | 10 | 16 | |
| NightOwl | 1150 | 9 | 16 | |
| Carol | 1120 | 8 | 15 | |
| RetroRider | 1090 | 7 | 16 | |
| TurboSnack | 1060 | 6 | 15 | |
| VortexRogue | 1030 | 5 | 16 | |
| MechaPawn | 1005 | 5 | 18 | |
| ChocoRookie | 980 | 4 | 18 | |
| Dave | 920 | 3 | 19 | |
| BitDrifter | 860 | 2 | 20 | |
| Eve | 780 | 1 | 22 | |
| ZeroCool | 720 | 1 | 25 | |
| NeonSprout | 650 | 0 | 24 | Bottom of the ladder |
| bossku | 0 | 0 | 0 | **Blank test account** (password) — no flags/history |

### Games

Sample game history is created for a subset of the roster so profile history pages and stats have data.

### Friendships

`seed.ts` builds the base social graph — pending incoming requests, accepted friendships and one blocked pair — so the Friends pages and notification flows have realistic data. `seed_friends.ts` can then add a denser, all-accepted friendship graph on top.


---
---


## Core Logic / Flow

### Seed Execution Flow

Sequence of steps when the main seed runs.
```mermaid
sequenceDiagram
    participant Command as seed command
    participant DB as Database
    participant Redis as Redis

    Command->>DB: Connect
    Command->>DB: Remove old test users (so rerunning is safe)
    Command->>DB: Create 28 roster players + their stats rows
    Command->>DB: Create a blank test account
    Command->>DB: Read every pilot's rating (id + rating)
    Command->>Redis: DEL + ZADD leaderboard:{mode} for all pilots
    Command->>DB: Add a little fake match history
    Command-->>Console: "Seed complete"
```

### Secondary Seed Scripts

- `seed_friends.ts` — deletes all friendships, then creates accepted friendships (up to 8 per user; 10+ each for the two target accounts). It does not create pending requests.
- `seed_user_profile.ts` — applies stats / achievements / match history / friendships for the two demo accounts (`harleyhxng`, `harleynghxedu`); it does not touch avatars.
- `sync_leaderboard.ts` — standalone re-sync of the Redis leaderboards (idempotent).


---
---


## Idempotency

The seed scripts are safe to re-run. The main script:

```
user.deleteMany({ where: { username: { in: SEED_PLAYERS.map(p => p.username) } } })
game.deleteMany({ where: { participants: { none: {} } } })
friendship.deleteMany({})
```

Cascading deletes (User → Account / PlayerStats / MatchHistory / Achievement / Friendship) keep re-runs clean, so `npx prisma db seed` multiple times produces the same state without duplicate-key errors. Redis sorted sets are reset (`DEL leaderboard:global|ranked|casual`) before re-adding.


---
---


## Usage

```bash
# Run main seed (prisma generate first)
npm run db:seed            # = prisma generate && prisma db seed

# Full reset (truncate all tables, then seed)
npm run db:reset           # = npm run db:truncate && npm run db:seed

# Truncate all tables without migrating
npm run db:fresh           # prisma db execute --file ./prisma/drop-all.sql

# Friends + profile extras
npx ts-node --transpile-only prisma/seed_friends.ts
npx ts-node --transpile-only prisma/seed_user_profile.ts
```
