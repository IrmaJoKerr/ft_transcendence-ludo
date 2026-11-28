import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client';
import type { GameType, PlayerColor } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { pairKey } from '../src/friends/friendship-pair';
import { ratingDeltaFor } from '../src/common/scoring';

loadEnv({ path: join(__dirname, '..', '..', '.env') });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const HOUR = 3600_000;
const MINUTE = 60_000;
const now = Date.now();

// A demo match: one entry per seat, `uid` absent for a seat whose account is not in
// this database (a skipped seat, exactly as the old seed skipped it).
interface SeedMatch {
  ago: number;
  type: 'PVP' | 'PVE';
  parts: Array<{
    uid?: string;
    c: 'RED' | 'GREEN' | 'YELLOW' | 'BLUE';
    r: number;
    cap: number;
    goal: number;
  }>;
}

// A seat's printable identity, for the row's participant snapshot.
type SeatName = { username: string; displayName: string; avatarStyle: string };

// One MatchHistory row per seat, shaped like postgame: tallies, rating delta and a
// seat snapshot so the row needs no join. Derived game ids let a reseed replace its
// own window instead of duplicating it.
async function writeMatches(
  matches: SeedMatch[],
  durationMs: number,
  names: Map<string, SeatName>,
  gamePrefix: string,
): Promise<void> {
  const snapshotOf = (parts: SeedMatch['parts']) =>
    parts
      .filter((p) => p.uid)
      .map((p) => {
        const who = names.get(p.uid as string);
        return {
          username: who?.username ?? 'unknown',
          displayName: who?.displayName ?? 'Unknown',
          avatarStyle: who?.avatarStyle ?? null,
          hasAvatarPhoto: false,
          color: p.c,
          rank: p.r,
          isBot: false,
        };
      })
      .sort((a, b) => a.rank - b.rank);

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const seats = m.parts.filter((p) => p.uid);
    const gameId = `${gamePrefix}${i}`;
    const snapshot = snapshotOf(m.parts);
    const playedAt = new Date(now - m.ago);

    for (const p of seats) {
      // The row's turn count and the pieces it lost, derived from the seat's own figures so
      // the history card and the career totals below describe the same match: a seat takes
      // a handful of turns plus the ones its captures and goals cost it, brings home what
      // it brought home, and lost nothing if it won. The clash columns stay at their
      // defaults (0) because these demo rooms predate the mutator — `gameModes` says so.
      const totalTurns = 12 + 6 * p.cap + 4 * p.goal;
      const piecesLost = p.r === 1 ? 0 : Math.max(0, 4 - p.goal);
      await prisma.matchHistory.create({
        data: {
          user_id: p.uid as string,
          game_id: gameId,
          playedAt,
          durationMs,
          gameType: m.type as GameType,
          // A standard room: the demo matches predate every mutator.
          gameModes: {
            clashEnabled: false,
            noSafeZones: false,
            freeExit: false,
            clashKeyShift: 0,
            playerCount: seats.length,
          },
          color: p.c as PlayerColor,
          rank: p.r,
          ratingDelta: ratingDeltaFor({ piecesInGoal: p.goal, rank: p.r, gameType: m.type }),
          totalTurns,
          totalCaptures: p.cap,
          piecesInGoal: p.goal,
          piecesLost,
          participants: snapshot,
        },
      });
    }
  }
}

// Demo data for two accounts (harleyhxng, harleynghxedu): their stats,
// achievements, match history, and friendships. Run manually with ts-node;
// accounts that do not exist are skipped.
async function main() {
  console.log('🚀 Injecting distinct pilot profiles for harleyhxng & harleynghxedu...');

  const harleyhxng = await prisma.user.findUnique({ where: { username: 'harleyhxng' } });
  const harleynghxedu = await prisma.user.findUnique({ where: { username: 'harleynghxedu' } });

  const alice = await prisma.user.findUnique({ where: { username: 'Alice' } });
  const bob = await prisma.user.findUnique({ where: { username: 'Bob' } });
  const carol = await prisma.user.findUnique({ where: { username: 'Carol' } });
  const dave = await prisma.user.findUnique({ where: { username: 'Dave' } });
  const eve = await prisma.user.findUnique({ where: { username: 'Eve' } });

  // Every seat a demo match can name, resolved once: a row's participant snapshot is
  // then a map lookup instead of a query per seat.
  const seatNames = new Map<string, SeatName>();
  for (const u of [harleyhxng, harleynghxedu, alice, bob, carol, dave, eve]) {
    if (u) {
      seatNames.set(u.id, {
        username: u.username,
        displayName: u.displayName,
        avatarStyle: u.avatarStyle,
      });
    }
  }

  // ACCOUNT 1: harleyhxng (CYBER GRAND MASTER : #1 Top Apex Predator)

  if (harleyhxng) {
    console.log(`\n👑 Seeding Account 1: harleyhxng (Top Apex Rank 1450 ELO)`);

    const harleyhxngStats = {
      rating: 1450,
      highestRating: 1480,
      gamesPlayed: 15,
      wins: 12,
      losses: 3,
      humanWins: 9,
      botWins: 3,
      winStreak: 5,
      bestWinStreak: 7,
      // Lifetime counter sums, matching the 15 demo matches below (62 captures, 51
      // pieces in goal): the card and the history then agree. The turns and the pieces
      // lost are the same rows added up (784 / 5), and the streak is the whole window:
      // fifteen PvP games in a row, which is what that counter counts.
      totalCaptures: 62,
      totalPiecesInGoal: 51,
      totalTurns: 784,
      totalPiecesLost: 5,
      pvpGameStreak: 15,
    };
    const harleyhxngAchievement = {
      achFirstBlood: true,
      achOnFire: true,
      achDiceMaster: true,
      achTactician: true,
      achMaster: true,
      achGrandBotMaster: true,
      achWorldChampion: true,
      achLoveTheMachine: true,
      achUnstoppable: true,
      achSpeedDemon: true,
    };
    await prisma.user.update({
      where: { id: harleyhxng.id },
      data: {
        displayName: 'Harley HX',
        // The career is its own row, upserted so an account created before this seed
        // ran still gets one.
        stats: { upsert: { create: harleyhxngStats, update: harleyhxngStats } },
        achievement: {
          upsert: {
            create: { id: randomUUID(), ...harleyhxngAchievement },
            update: harleyhxngAchievement,
          },
        },
      },
    });

    // Replace this account's demo window. The match ids are derived from the account,
    // so this delete takes every seat's row from the previous run with it.
    const gamePrefix1 = `seed-${harleyhxng.id}-`;
    await prisma.matchHistory.deleteMany({ where: { game_id: { startsWith: gamePrefix1 } } });

    // 15 matches (12 wins, 3 losses, 62 captures, 51 pieces in goal)
    const matches1: SeedMatch[] = [
      {
        ago: 1 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'RED', r: 1, cap: 6, goal: 4 },
          { uid: alice?.id, c: 'GREEN', r: 2, cap: 2, goal: 2 },
          { uid: bob?.id, c: 'YELLOW', r: 3, cap: 1, goal: 1 },
          { uid: eve?.id, c: 'BLUE', r: 4, cap: 0, goal: 0 },
        ],
      },
      {
        ago: 2 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'RED', r: 1, cap: 5, goal: 4 },
          { uid: alice?.id, c: 'GREEN', r: 2, cap: 1, goal: 2 },
        ],
      },
      {
        ago: 4 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'RED', r: 1, cap: 4, goal: 4 },
          { uid: bob?.id, c: 'YELLOW', r: 2, cap: 2, goal: 1 },
        ],
      },
      {
        ago: 7 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'RED', r: 1, cap: 6, goal: 4 },
          { uid: carol?.id, c: 'YELLOW', r: 2, cap: 1, goal: 2 },
          { uid: dave?.id, c: 'BLUE', r: 3, cap: 0, goal: 0 },
        ],
      },
      {
        ago: 10 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'GREEN', r: 1, cap: 4, goal: 4 },
          { uid: eve?.id, c: 'RED', r: 2, cap: 1, goal: 2 },
        ],
      },
      {
        ago: 14 * HOUR,
        type: 'PVP',
        parts: [
          { uid: alice?.id, c: 'RED', r: 1, cap: 4, goal: 4 },
          { uid: harleyhxng.id, c: 'GREEN', r: 2, cap: 2, goal: 3 },
        ],
      },
      {
        ago: 18 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'YELLOW', r: 1, cap: 5, goal: 4 },
          { uid: dave?.id, c: 'RED', r: 2, cap: 0, goal: 1 },
        ],
      },
      {
        ago: 24 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'BLUE', r: 1, cap: 4, goal: 4 },
          { uid: carol?.id, c: 'GREEN', r: 2, cap: 1, goal: 2 },
        ],
      },
      {
        ago: 30 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'RED', r: 1, cap: 5, goal: 4 },
          { uid: bob?.id, c: 'GREEN', r: 2, cap: 2, goal: 2 },
          { uid: dave?.id, c: 'YELLOW', r: 3, cap: 0, goal: 1 },
          { uid: carol?.id, c: 'BLUE', r: 4, cap: 0, goal: 0 },
        ],
      },
      {
        ago: 36 * HOUR,
        type: 'PVP',
        parts: [
          { uid: bob?.id, c: 'RED', r: 1, cap: 3, goal: 4 },
          { uid: harleyhxng.id, c: 'GREEN', r: 2, cap: 2, goal: 2 },
        ],
      },
      {
        ago: 42 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'RED', r: 1, cap: 5, goal: 4 },
          { uid: alice?.id, c: 'GREEN', r: 2, cap: 2, goal: 3 },
        ],
      },
      {
        ago: 48 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'GREEN', r: 1, cap: 4, goal: 4 },
          { uid: eve?.id, c: 'YELLOW', r: 2, cap: 1, goal: 2 },
        ],
      },
      {
        ago: 54 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'RED', r: 1, cap: 6, goal: 4 },
          { uid: dave?.id, c: 'BLUE', r: 2, cap: 0, goal: 0 },
        ],
      },
      {
        ago: 60 * HOUR,
        type: 'PVP',
        parts: [
          { uid: eve?.id, c: 'GREEN', r: 1, cap: 4, goal: 4 },
          { uid: harleyhxng.id, c: 'RED', r: 2, cap: 1, goal: 2 },
        ],
      },
      {
        ago: 72 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleyhxng.id, c: 'RED', r: 1, cap: 5, goal: 4 },
          { uid: carol?.id, c: 'GREEN', r: 2, cap: 1, goal: 1 },
          { uid: alice?.id, c: 'YELLOW', r: 3, cap: 2, goal: 2 },
          { uid: bob?.id, c: 'BLUE', r: 4, cap: 0, goal: 0 },
        ],
      },
    ];

    await writeMatches(matches1, 18 * MINUTE, seatNames, gamePrefix1);

    // Friendships for harleyhxng
    await prisma.friendship.deleteMany({
      where: { OR: [{ user1Id: harleyhxng.id }, { user2Id: harleyhxng.id }] },
    });
    const f1: Array<{
      id: string;
      pairKey: string;
      user1Id: string;
      user2Id: string;
      user1Status: 'accepted' | 'pending';
      user2Status: 'none' | 'accepted';
      user1StatusAt: Date;
      user2StatusAt: Date | null;
      requestCount: number;
      lastRequestAt: Date | null;
      createdAt: Date;
    }> = [];
    const accepted1 = (a: string, b: string) => {
      const at = new Date();
      f1.push({
        id: randomUUID(),
        pairKey: pairKey(a, b),
        user1Id: a,
        user2Id: b,
        user1Status: 'accepted',
        user2Status: 'accepted',
        user1StatusAt: at,
        user2StatusAt: at,
        requestCount: 0,
        lastRequestAt: null,
        createdAt: at,
      });
    };
    const pending1 = (from: string, to: string) => {
      const at = new Date();
      f1.push({
        id: randomUUID(),
        pairKey: pairKey(from, to),
        user1Id: from,
        user2Id: to,
        user1Status: 'pending',
        user2Status: 'none',
        user1StatusAt: at,
        user2StatusAt: null,
        requestCount: 1,
        lastRequestAt: at,
        createdAt: at,
      });
    };
    if (alice) accepted1(harleyhxng.id, alice.id);
    if (bob) accepted1(harleyhxng.id, bob.id);
    if (eve) accepted1(harleyhxng.id, eve.id);
    if (harleynghxedu) accepted1(harleyhxng.id, harleynghxedu.id);
    if (carol) pending1(carol.id, harleyhxng.id);
    await prisma.friendship.createMany({ data: f1 });
  }

  // ACCOUNT 2: harleynghxedu (CYBER VETERAN : #3 Tactical Operative)

  if (harleynghxedu) {
    console.log(`\n🛡️ Seeding Account 2: harleynghxedu (Tactical Ace 1190 ELO)`);

    const harleynghxeduStats = {
      rating: 1190,
      highestRating: 1240,
      gamesPlayed: 7,
      wins: 4,
      losses: 3,
      humanWins: 3,
      botWins: 1,
      winStreak: 1,
      bestWinStreak: 3,
      // Lifetime counter sums, matching the 7 demo matches below (23 captures, 20
      // pieces in goal), plus the same two additions: the rows' turns and losses (306 /
      // 7) and the seven-PvP-game streak the window is.
      totalCaptures: 23,
      totalPiecesInGoal: 20,
      totalTurns: 306,
      totalPiecesLost: 7,
      pvpGameStreak: 7,
    };
    const harleynghxeduAchievement = {
      achFirstBlood: true,
      achTactician: true,
      achSpeedDemon: true,
      achUnstoppable: false,
      achMaster: false,
    };
    await prisma.user.update({
      where: { id: harleynghxedu.id },
      data: {
        displayName: 'Harley NGHX',
        stats: { upsert: { create: harleynghxeduStats, update: harleynghxeduStats } },
        achievement: {
          upsert: {
            create: { id: randomUUID(), ...harleynghxeduAchievement },
            update: harleynghxeduAchievement,
          },
        },
      },
    });

    // Replace this account's demo window, exactly as account 1 does.
    const gamePrefix2 = `seed-${harleynghxedu.id}-`;
    await prisma.matchHistory.deleteMany({ where: { game_id: { startsWith: gamePrefix2 } } });

    // 7 matches (4 wins, 3 losses, 23 captures, 20 pieces in goal)
    const matches2: SeedMatch[] = [
      {
        ago: 2 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleynghxedu.id, c: 'RED', r: 1, cap: 5, goal: 4 },
          { uid: dave?.id, c: 'YELLOW', r: 2, cap: 0, goal: 1 },
        ],
      },
      {
        ago: 5 * HOUR,
        type: 'PVP',
        parts: [
          { uid: alice?.id, c: 'RED', r: 1, cap: 4, goal: 4 },
          { uid: harleynghxedu.id, c: 'GREEN', r: 2, cap: 2, goal: 2 },
        ],
      },
      {
        ago: 11 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleynghxedu.id, c: 'GREEN', r: 1, cap: 4, goal: 4 },
          { uid: carol?.id, c: 'YELLOW', r: 2, cap: 1, goal: 2 },
          { uid: dave?.id, c: 'BLUE', r: 3, cap: 0, goal: 0 },
        ],
      },
      {
        ago: 19 * HOUR,
        type: 'PVP',
        parts: [
          { uid: bob?.id, c: 'RED', r: 1, cap: 3, goal: 4 },
          { uid: harleynghxedu.id, c: 'GREEN', r: 2, cap: 2, goal: 2 },
        ],
      },
      {
        ago: 27 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleynghxedu.id, c: 'YELLOW', r: 1, cap: 4, goal: 4 },
          { uid: eve?.id, c: 'RED', r: 2, cap: 1, goal: 2 },
        ],
      },
      {
        ago: 38 * HOUR,
        type: 'PVP',
        parts: [
          { uid: eve?.id, c: 'GREEN', r: 1, cap: 3, goal: 4 },
          { uid: harleynghxedu.id, c: 'RED', r: 2, cap: 1, goal: 1 },
        ],
      },
      {
        ago: 49 * HOUR,
        type: 'PVP',
        parts: [
          { uid: harleynghxedu.id, c: 'RED', r: 1, cap: 5, goal: 4 },
          { uid: bob?.id, c: 'GREEN', r: 2, cap: 1, goal: 3 },
          { uid: carol?.id, c: 'BLUE', r: 3, cap: 0, goal: 0 },
        ],
      },
    ];

    await writeMatches(matches2, 16 * MINUTE, seatNames, gamePrefix2);

    // Friendships for harleynghxedu
    await prisma.friendship.deleteMany({
      where: { OR: [{ user1Id: harleynghxedu.id }, { user2Id: harleynghxedu.id }] },
    });
    const f2: Array<{
      id: string;
      pairKey: string;
      user1Id: string;
      user2Id: string;
      user1Status: 'accepted' | 'pending';
      user2Status: 'none' | 'accepted';
      user1StatusAt: Date;
      user2StatusAt: Date | null;
      requestCount: number;
      lastRequestAt: Date | null;
      createdAt: Date;
    }> = [];
    const accepted2 = (a: string, b: string) => {
      const at = new Date();
      f2.push({
        id: randomUUID(),
        pairKey: pairKey(a, b),
        user1Id: a,
        user2Id: b,
        user1Status: 'accepted',
        user2Status: 'accepted',
        user1StatusAt: at,
        user2StatusAt: at,
        requestCount: 0,
        lastRequestAt: null,
        createdAt: at,
      });
    };
    const pending2 = (from: string, to: string) => {
      const at = new Date();
      f2.push({
        id: randomUUID(),
        pairKey: pairKey(from, to),
        user1Id: from,
        user2Id: to,
        user1Status: 'pending',
        user2Status: 'none',
        user1StatusAt: at,
        user2StatusAt: null,
        requestCount: 1,
        lastRequestAt: at,
        createdAt: at,
      });
    };
    if (alice) accepted2(harleynghxedu.id, alice.id);
    if (dave) accepted2(harleynghxedu.id, dave.id);
    if (harleyhxng) accepted2(harleynghxedu.id, harleyhxng.id);
    if (bob) pending2(bob.id, harleynghxedu.id);
    await prisma.friendship.createMany({ data: f2 });
  }

  console.log('\n✅ Successfully injected unique differentiated seed data for both accounts!');
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
