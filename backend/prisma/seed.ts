import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pairKey } from '../src/friends/friendship-pair';
import { ratingDeltaFor } from '../src/common/scoring';

loadEnv({ path: join(__dirname, '..', '..', '.env') });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const SEED_PLAYERS = [
  // MAMEE MONSTER (Top 3 Contenders)
  { username: 'Viper_X', rating: 1650, wins: 34, losses: 6, avatar: 'bottts' },

  // MILO DINOSAUR (Rating >= 1350)
  { username: 'NeonKnight', rating: 1540, wins: 28, losses: 9, avatar: 'avataaars' },
  { username: 'Alice', rating: 1480, wins: 25, losses: 10, avatar: 'identicon' },
  { username: 'ShadowFox', rating: 1440, wins: 22, losses: 11, avatar: 'bottts' },
  { username: 'CyberSamurai', rating: 1410, wins: 20, losses: 12, avatar: 'shapes' },
  { username: 'HyperNova', rating: 1390, wins: 19, losses: 11, avatar: 'bottts' },
  { username: 'GhostRunner', rating: 1370, wins: 18, losses: 13, avatar: 'avataaars' },
  { username: 'AeroBlade', rating: 1355, wins: 17, losses: 12, avatar: 'identicon' },

  // PADDLE POP (Rating 1200 - 1349)
  { username: 'StarLord', rating: 1340, wins: 16, losses: 14, avatar: 'bottts' },
  { username: 'PixelMage', rating: 1320, wins: 15, losses: 13, avatar: 'shapes' },
  { username: 'QuantumVolt', rating: 1290, wins: 14, losses: 12, avatar: 'avataaars' },
  { username: 'Bob', rating: 1270, wins: 13, losses: 13, avatar: 'bottts' },
  { username: 'CircuitBreaker', rating: 1250, wins: 12, losses: 14, avatar: 'identicon' },
  { username: 'SolarFlare', rating: 1220, wins: 11, losses: 15, avatar: 'shapes' },
  { username: 'LaserFang', rating: 1205, wins: 10, losses: 14, avatar: 'bottts' },

  // HONEY STARS (Rating 1000 - 1199)
  { username: 'CheeseRing', rating: 1180, wins: 10, losses: 16, avatar: 'avataaars' },
  { username: 'NightOwl', rating: 1150, wins: 9, losses: 16, avatar: 'identicon' },
  { username: 'Carol', rating: 1120, wins: 8, losses: 15, avatar: 'shapes' },
  { username: 'RetroRider', rating: 1090, wins: 7, losses: 16, avatar: 'bottts' },
  { username: 'TurboSnack', rating: 1060, wins: 6, losses: 15, avatar: 'avataaars' },
  { username: 'VortexRogue', rating: 1030, wins: 5, losses: 16, avatar: 'identicon' },
  { username: 'MechaPawn', rating: 1005, wins: 5, losses: 18, avatar: 'shapes' },

  // CHOKI CHOKI (Rating < 1000)
  { username: 'ChocoRookie', rating: 980, wins: 4, losses: 18, avatar: 'bottts' },
  { username: 'Dave', rating: 920, wins: 3, losses: 19, avatar: 'identicon' },
  { username: 'BitDrifter', rating: 860, wins: 2, losses: 20, avatar: 'shapes' },
  { username: 'Eve', rating: 780, wins: 1, losses: 22, avatar: 'avataaars' },
  { username: 'ZeroCool', rating: 720, wins: 1, losses: 25, avatar: 'bottts' },
  { username: 'NeonSprout', rating: 650, wins: 0, losses: 24, avatar: 'identicon' },
];

const SALT_ROUNDS = 10;
const SEED_PASSWORD = 'password';
const hashPassword = () => bcrypt.hash(SEED_PASSWORD, SALT_ROUNDS);

const HOUR = 3600_000;
const MINUTE = 60_000;
const now = Date.now();

// Database seed script: wipes and repopulates Users (each with its PlayerStats
// and Achievement row), Friendships and Redis leaderboard entries with 28 demo
// players across rating tiers. Run via `prisma db seed`.
async function main() {
  console.log('🌱 Seeding Ludo database with expanded 28-player Cyber Roster...');

  const seedUsernames = SEED_PLAYERS.map((p) => p.username);

  // Reset previous seed data
  // One delete: PlayerStats, MatchHistory and Achievement rows cascade with their
  // account, so a reseeded player starts with a blank career and no history.
  await prisma.user.deleteMany({ where: { username: { in: seedUsernames } } });

  const pwd = await hashPassword();

  // Create All Seed Players
  type SeedUser = { id: string; username: string; displayName: string; avatarStyle: string };
  const createdUsers: SeedUser[] = [];
  const requireUser = (username: string): SeedUser => {
    const found = createdUsers.find((u) => u.username === username);
    if (!found) throw new Error(`Seed user not found: ${username}`);
    return found;
  };
  for (let i = 0; i < SEED_PLAYERS.length; i++) {
    const p = SEED_PLAYERS[i];
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        username: p.username,
        displayName: p.username,
        email: `${p.username.toLowerCase()}@transcendence.cyber`,
        emailVerified: new Date(now - (50 - i) * 24 * HOUR),
        password_hash: pwd,
        twoFactorEnabled: false,
        avatarStyle: p.avatar,
        // The career is its own row: the rating, the win/loss record and the streaks
        // are seeded there, and the account keeps only the identity.
        stats: {
          create: {
            rating: p.rating,
            highestRating: p.rating + Math.floor(Math.random() * 40),
            gamesPlayed: p.wins + p.losses,
            wins: p.wins,
            losses: p.losses,
            humanWins: Math.max(0, p.wins - 2),
            botWins: Math.min(2, p.wins),
            winStreak: Math.max(0, Math.floor(p.wins / 4)),
            bestWinStreak: Math.max(1, Math.floor(p.wins / 2)),
            // pveGameStreak: top players have the 3-PvE-streak
            pveGameStreak: Math.min(3, Math.max(0, Math.floor(p.wins / 5))),
          },
        },
        achievement: {
          create: {
            id: randomUUID(),
            // Achievement flags use the revamp thresholds (achievement-revamp.md v3):
            // lower gate values match the win counts in the seed roster.
            achFirstBlood: p.wins >= 1,
            achOnFire: Math.floor(p.wins / 4) >= 2, // seeded winStreak = floor(wins/4) >= 2 → wins >= 8
            achDiceMaster: p.wins >= 3,
            achBabySteps: Math.min(2, p.wins) >= 1, // botWins >= 1
            // achTheDiceLoveMe needs botWins >= 3 : seed botWins caps at 2, so no
            // seed player legitimately holds it; real PvE play + POST /check backfill unlock it.
            achTactician: p.wins >= 5,
            achMaster: p.wins >= 8,
            achGrandBotMaster: p.wins >= 12,
            achWorldChampion: p.wins >= 15,
            achft_Transcendence: Math.max(0, p.wins - 2) >= 10, // humanWins >= 10
            // achLoveTheMachine needs pveGameStreak (not reliably derivable from
            // lifetime counters) : leave to real gameplay + POST /check backfill.
          },
        },
      },
    });
    createdUsers.push(user);
  }

  console.log(`  ✅ Created ${createdUsers.length} seed operatives!`);

  // Viper_X: give the top player every achievement, including the ones
  // the wins-based formulas above can't reach (achTheDiceLoveMe needs
  // botWins >= 3, achLoveTheMachine needs pveGameStreak, etc.)
  await prisma.achievement.update({
    where: { userId: requireUser('Viper_X').id },
    data: {
      achFirstBlood: true,
      achOnFire: true,
      achDiceMaster: true,
      achBabySteps: true,
      achTheDiceLoveMe: true,
      achTactician: true,
      achMaster: true,
      achGrandBotMaster: true,
      achWorldChampion: true,
      achLoveTheMachine: true,
      achft_Transcendence: true,
      achSpeedDemon: true,
      achUnstoppable: true,
    },
  });
  console.log('  ✅ Viper_X now has every achievement unlocked!');

  // Brand-new empty test account (bossku / password)
  // No achievements, no stats, no games, no friends : schema defaults only,
  // and excluded from the seed-player-specific loops below.
  await prisma.user.deleteMany({ where: { username: 'bossku' } });
  await prisma.user.create({
    data: {
      id: randomUUID(),
      username: 'bossku',
      displayName: 'bossku',
      email: 'bossku@transcendence.cyber',
      emailVerified: new Date(),
      password_hash: pwd,
      twoFactorEnabled: false,
      achievement: { create: { id: randomUUID() } },
      // A blank account still owns a career row, so its first match has somewhere to land.
      stats: { create: {} },
    },
  });
  console.log('  ✅ Created blank test account: bossku (password: password)');

  // Sync All Pilots directly to Redis Leaderboard
  // The rating lives on the career row, so the board is rebuilt from PlayerStats
  // (a bot has no row, which is the whole filter).
  const allPilots = await prisma.playerStats.findMany({
    select: { user_id: true, rating: true },
    orderBy: { rating: 'desc' },
  });

  try {
    const redisHost = process.env.REDIS_HOST || 'localhost';
    const redisPort = parseInt(process.env.REDIS_PORT || '6479', 10);
    const redisPassword = process.env.REDIS_PASSWORD || 'password123';
    const redis = new Redis({ host: redisHost, port: redisPort, password: redisPassword });

    // Clear old Redis leaderboards
    await redis.del('leaderboard:global', 'leaderboard:ranked', 'leaderboard:casual');

    for (const u of allPilots) {
      await redis.zadd('leaderboard:global', u.rating, u.user_id);
      await redis.zadd('leaderboard:ranked', u.rating, u.user_id);
      await redis.zadd('leaderboard:casual', u.rating, u.user_id);
    }
    await redis.quit();
    console.log(`  ✅ Successfully synchronized ${allPilots.length} pilots to Redis sorted sets!`);
  } catch (redisErr) {
    console.warn('  ⚠️ Redis sync during seed skipped/failed:', redisErr);
  }

  // Seed Friendships & Incoming Friend Requests
  await prisma.friendship.deleteMany({});

  // Find all non-seed users (e.g. harleyng, admin, or any registered user).
  // 'bossku' is excluded too : it's meant to stay a friendless blank account.
  const nonSeedUsers = await prisma.user.findMany({
    where: {
      username: { notIn: [...SEED_PLAYERS.map((p) => p.username), 'bossku'] },
    },
  });

  // Target non-seed user(s) + the first 2 seed players
  const targetsForRequests =
    nonSeedUsers.length > 0 ? nonSeedUsers : [createdUsers[0], createdUsers[1]];

  // One row per unordered pair (schema enforces pairKey uniqueness), so guard
  // against inserting the same pair twice across the blocks below.
  const seenPairs = new Set<string>();
  const addPair = async (
    a: string,
    b: string,
    status: {
      user1Status: 'pending' | 'accepted' | 'blocked';
      user2Status: 'none' | 'accepted';
      createdAt: Date;
    },
  ) => {
    const key = pairKey(a, b);
    if (seenPairs.has(key)) return;
    seenPairs.add(key);
    await prisma.friendship.create({
      data: {
        id: randomUUID(),
        pairKey: key,
        user1Id: a,
        user2Id: b,
        user1Status: status.user1Status,
        user2Status: status.user2Status,
        user1StatusAt: status.createdAt,
        user2StatusAt: status.user2Status === 'none' ? null : status.createdAt,
        requestCount: status.user1Status === 'pending' ? 1 : 0,
        lastRequestAt: status.user1Status === 'pending' ? status.createdAt : null,
        createdAt: status.createdAt,
      },
    });
  };

  for (const target of targetsForRequests) {
    // 1. Incoming Pending Friend Requests sent TO target
    const requestSenders = [
      requireUser('RetroRider'),
      requireUser('TurboSnack'),
      requireUser('CyberSamurai'),
    ].filter(Boolean);

    for (const sender of requestSenders) {
      if (sender && sender.id !== target.id) {
        await addPair(sender.id, target.id, {
          user1Status: 'pending',
          user2Status: 'none',
          createdAt: new Date(now - Math.floor(Math.random() * 48) * HOUR),
        });
      }
    }

    // 2. Active Accepted Comrades for target
    const friendList = [
      requireUser('Viper_X'),
      requireUser('NeonKnight'),
      requireUser('Alice'),
      requireUser('StarLord'),
      requireUser('PixelMage'),
      requireUser('CircuitBreaker'),
    ].filter(Boolean);

    for (const f of friendList) {
      if (f && f.id !== target.id) {
        await addPair(f.id, target.id, {
          user1Status: 'accepted',
          user2Status: 'accepted',
          createdAt: new Date(now - (10 + Math.floor(Math.random() * 30)) * 24 * HOUR),
        });
      }
    }

    // 3. Sample Blocked Pilot
    const blockedPilot = createdUsers.find((u) => u.username === 'NeonSprout');
    if (blockedPilot && blockedPilot.id !== target.id) {
      await addPair(target.id, blockedPilot.id, {
        user1Status: 'blocked',
        user2Status: 'none',
        createdAt: new Date(now - 5 * 24 * HOUR),
      });
    }
  }

  console.log(`  ✅ Seeded incoming friend requests, active friendships, and restricted lists!`);

  // One sample match, written the way postgame writes it: a MatchHistory row per
  // seat, with the delta the formula applies and the room's company line. The id is
  // fixed because the roster above is deleted (and its rows cascade) on every reseed.
  if (createdUsers.length >= 4) {
    const seats = [
      { seat: createdUsers[0], color: 'RED' as const, rank: 1, captures: 6, goal: 4 },
      { seat: createdUsers[1], color: 'GREEN' as const, rank: 2, captures: 3, goal: 3 },
      { seat: createdUsers[2], color: 'YELLOW' as const, rank: 3, captures: 2, goal: 2 },
      { seat: createdUsers[3], color: 'BLUE' as const, rank: 4, captures: 1, goal: 1 },
    ];
    const gameId = 'seed-sample-1';
    const playedAt = new Date(now - 2 * HOUR);
    const participants = seats.map((s2) => ({
      username: s2.seat.username,
      displayName: s2.seat.displayName,
      avatarStyle: s2.seat.avatarStyle,
      hasAvatarPhoto: false,
      color: s2.color,
      rank: s2.rank,
      isBot: false,
    }));

    for (const s2 of seats) {
      await prisma.matchHistory.create({
        data: {
          user_id: s2.seat.id,
          game_id: gameId,
          playedAt,
          durationMs: 30 * MINUTE,
          gameType: 'PVP',
          gameModes: {
            clashEnabled: false,
            noSafeZones: false,
            freeExit: false,
            clashKeyShift: 0,
            playerCount: seats.length,
          },
          color: s2.color,
          rank: s2.rank,
          ratingDelta: ratingDeltaFor({
            piecesInGoal: s2.goal,
            rank: s2.rank,
            gameType: 'PVP',
          }),
          totalCaptures: s2.captures,
          piecesInGoal: s2.goal,
          participants,
        },
      });
    }
  }

  console.log('✅ Seeding complete with full active roster across all Snack Rank Tiers!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
