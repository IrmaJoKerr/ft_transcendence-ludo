import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

loadEnv({ path: join(__dirname, '..', '..', '.env') });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

const HOUR = 3600_000;
const MINUTE = 60_000;
const now = Date.now();

async function main() {
  console.log('🚀 Injecting distinct pilot profiles for harleyhxng & harleynghxedu...');

  const harleyhxng = await prisma.user.findUnique({ where: { username: 'harleyhxng' } });
  const harleynghxedu = await prisma.user.findUnique({ where: { username: 'harleynghxedu' } });

  const alice = await prisma.user.findUnique({ where: { username: 'Alice' } });
  const bob = await prisma.user.findUnique({ where: { username: 'Bob' } });
  const carol = await prisma.user.findUnique({ where: { username: 'Carol' } });
  const dave = await prisma.user.findUnique({ where: { username: 'Dave' } });
  const eve = await prisma.user.findUnique({ where: { username: 'Eve' } });

  // ───────────────────────────────────────────────────────────────────────────
  // ACCOUNT 1: harleyhxng (CYBER GRAND MASTER — #1 Top Apex Predator)
  // ───────────────────────────────────────────────────────────────────────────
  if (harleyhxng) {
    console.log(`\n👑 Seeding Account 1: harleyhxng (Top Apex Rank 1450 ELO)`);

    const harleyhxngStats = {
      rating: 1450,
      highestRating: 1480,
      wins: 12,
      losses: 3,
      humanWins: 9,
      botWins: 3,
      winStreak: 5,
      bestWinStreak: 7,
      disconnectCount: 0,
      reconnectCount: 0,
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
        ...harleyhxngStats,
        achievement: {
          upsert: {
            create: { id: randomUUID(), ...harleyhxngAchievement },
            update: harleyhxngAchievement,
          },
        },
      },
    });

    // Remove old participations
    const oldParts = await prisma.gameParticipant.findMany({
      where: { user_id: harleyhxng.id },
      select: { game_id: true },
    });
    if (oldParts.length > 0) {
      await prisma.game.deleteMany({ where: { id: { in: oldParts.map((p) => p.game_id) } } });
    }

    // 15 matches (12 wins, 3 losses, 62 captures, 51 pieces in goal)
    const matches1 = [
      { ago: 1 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'RED', r: 1, cap: 6, goal: 4 }, { uid: alice?.id, c: 'GREEN', r: 2, cap: 2, goal: 2 }, { uid: bob?.id, c: 'YELLOW', r: 3, cap: 1, goal: 1 }, { uid: eve?.id, c: 'BLUE', r: 4, cap: 0, goal: 0 }] },
      { ago: 2 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'RED', r: 1, cap: 5, goal: 4 }, { uid: alice?.id, c: 'GREEN', r: 2, cap: 1, goal: 2 }] },
      { ago: 4 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'RED', r: 1, cap: 4, goal: 4 }, { uid: bob?.id, c: 'YELLOW', r: 2, cap: 2, goal: 1 }] },
      { ago: 7 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'RED', r: 1, cap: 6, goal: 4 }, { uid: carol?.id, c: 'YELLOW', r: 2, cap: 1, goal: 2 }, { uid: dave?.id, c: 'BLUE', r: 3, cap: 0, goal: 0 }] },
      { ago: 10 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'GREEN', r: 1, cap: 4, goal: 4 }, { uid: eve?.id, c: 'RED', r: 2, cap: 1, goal: 2 }] },
      { ago: 14 * HOUR, type: 'PVP', parts: [{ uid: alice?.id, c: 'RED', r: 1, cap: 4, goal: 4 }, { uid: harleyhxng.id, c: 'GREEN', r: 2, cap: 2, goal: 3 }] },
      { ago: 18 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'YELLOW', r: 1, cap: 5, goal: 4 }, { uid: dave?.id, c: 'RED', r: 2, cap: 0, goal: 1 }] },
      { ago: 24 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'BLUE', r: 1, cap: 4, goal: 4 }, { uid: carol?.id, c: 'GREEN', r: 2, cap: 1, goal: 2 }] },
      { ago: 30 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'RED', r: 1, cap: 5, goal: 4 }, { uid: bob?.id, c: 'GREEN', r: 2, cap: 2, goal: 2 }, { uid: dave?.id, c: 'YELLOW', r: 3, cap: 0, goal: 1 }, { uid: carol?.id, c: 'BLUE', r: 4, cap: 0, goal: 0 }] },
      { ago: 36 * HOUR, type: 'PVP', parts: [{ uid: bob?.id, c: 'RED', r: 1, cap: 3, goal: 4 }, { uid: harleyhxng.id, c: 'GREEN', r: 2, cap: 2, goal: 2 }] },
      { ago: 42 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'RED', r: 1, cap: 5, goal: 4 }, { uid: alice?.id, c: 'GREEN', r: 2, cap: 2, goal: 3 }] },
      { ago: 48 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'GREEN', r: 1, cap: 4, goal: 4 }, { uid: eve?.id, c: 'YELLOW', r: 2, cap: 1, goal: 2 }] },
      { ago: 54 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'RED', r: 1, cap: 6, goal: 4 }, { uid: dave?.id, c: 'BLUE', r: 2, cap: 0, goal: 0 }] },
      { ago: 60 * HOUR, type: 'PVP', parts: [{ uid: eve?.id, c: 'GREEN', r: 1, cap: 4, goal: 4 }, { uid: harleyhxng.id, c: 'RED', r: 2, cap: 1, goal: 2 }] },
      { ago: 72 * HOUR, type: 'PVP', parts: [{ uid: harleyhxng.id, c: 'RED', r: 1, cap: 5, goal: 4 }, { uid: carol?.id, c: 'GREEN', r: 2, cap: 1, goal: 1 }, { uid: alice?.id, c: 'YELLOW', r: 3, cap: 2, goal: 2 }, { uid: bob?.id, c: 'BLUE', r: 4, cap: 0, goal: 0 }] },
    ];

    for (const m of matches1) {
      await prisma.game.create({
        data: {
          id: randomUUID(),
          startedAt: new Date(now - m.ago),
          endedAt: new Date(now - m.ago + 18 * MINUTE),
          status: 'COMPLETED',
          gameType: m.type as any,
          participants: {
            create: m.parts.filter((p) => p.uid).map((p) => ({
              id: randomUUID(),
              user_id: p.uid!,
              color: p.c as any,
              rank: p.r,
              piecesCaptured: p.cap,
              piecesInGoal: p.goal,
            })),
          },
        },
      });
    }

    // Friendships for harleyhxng
    await prisma.friendship.deleteMany({
      where: { OR: [{ userId: harleyhxng.id }, { friendId: harleyhxng.id }] },
    });
    const f1 = [];
    if (alice) f1.push({ id: randomUUID(), userId: harleyhxng.id, friendId: alice.id, status: 'accepted' as const });
    if (bob) f1.push({ id: randomUUID(), userId: harleyhxng.id, friendId: bob.id, status: 'accepted' as const });
    if (eve) f1.push({ id: randomUUID(), userId: harleyhxng.id, friendId: eve.id, status: 'accepted' as const });
    if (harleynghxedu) f1.push({ id: randomUUID(), userId: harleyhxng.id, friendId: harleynghxedu.id, status: 'accepted' as const });
    if (carol) f1.push({ id: randomUUID(), userId: carol.id, friendId: harleyhxng.id, status: 'pending' as const });
    await prisma.friendship.createMany({ data: f1 });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // ACCOUNT 2: harleynghxedu (CYBER VETERAN — #3 Tactical Operative)
  // ───────────────────────────────────────────────────────────────────────────
  if (harleynghxedu) {
    console.log(`\n🛡️ Seeding Account 2: harleynghxedu (Tactical Ace 1190 ELO)`);

    const harleynghxeduStats = {
      rating: 1190,
      highestRating: 1240,
      wins: 4,
      losses: 3,
      humanWins: 3,
      botWins: 1,
      winStreak: 1,
      bestWinStreak: 3,
      disconnectCount: 1,
      reconnectCount: 1,
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
        ...harleynghxeduStats,
        achievement: {
          upsert: {
            create: { id: randomUUID(), ...harleynghxeduAchievement },
            update: harleynghxeduAchievement,
          },
        },
      },
    });

    // Remove old participations
    const oldParts2 = await prisma.gameParticipant.findMany({
      where: { user_id: harleynghxedu.id },
      select: { game_id: true },
    });
    if (oldParts2.length > 0) {
      await prisma.game.deleteMany({ where: { id: { in: oldParts2.map((p) => p.game_id) } } });
    }

    // 7 matches (4 wins, 3 losses, 23 captures, 20 pieces in goal)
    const matches2 = [
      { ago: 2 * HOUR, type: 'PVP', parts: [{ uid: harleynghxedu.id, c: 'RED', r: 1, cap: 5, goal: 4 }, { uid: dave?.id, c: 'YELLOW', r: 2, cap: 0, goal: 1 }] },
      { ago: 5 * HOUR, type: 'PVP', parts: [{ uid: alice?.id, c: 'RED', r: 1, cap: 4, goal: 4 }, { uid: harleynghxedu.id, c: 'GREEN', r: 2, cap: 2, goal: 2 }] },
      { ago: 11 * HOUR, type: 'PVP', parts: [{ uid: harleynghxedu.id, c: 'GREEN', r: 1, cap: 4, goal: 4 }, { uid: carol?.id, c: 'YELLOW', r: 2, cap: 1, goal: 2 }, { uid: dave?.id, c: 'BLUE', r: 3, cap: 0, goal: 0 }] },
      { ago: 19 * HOUR, type: 'PVP', parts: [{ uid: bob?.id, c: 'RED', r: 1, cap: 3, goal: 4 }, { uid: harleynghxedu.id, c: 'GREEN', r: 2, cap: 2, goal: 2 }] },
      { ago: 27 * HOUR, type: 'PVP', parts: [{ uid: harleynghxedu.id, c: 'YELLOW', r: 1, cap: 4, goal: 4 }, { uid: eve?.id, c: 'RED', r: 2, cap: 1, goal: 2 }] },
      { ago: 38 * HOUR, type: 'PVP', parts: [{ uid: eve?.id, c: 'GREEN', r: 1, cap: 3, goal: 4 }, { uid: harleynghxedu.id, c: 'RED', r: 2, cap: 1, goal: 1 }] },
      { ago: 49 * HOUR, type: 'PVP', parts: [{ uid: harleynghxedu.id, c: 'RED', r: 1, cap: 5, goal: 4 }, { uid: bob?.id, c: 'GREEN', r: 2, cap: 1, goal: 3 }, { uid: carol?.id, c: 'BLUE', r: 3, cap: 0, goal: 0 }] },
    ];

    for (const m of matches2) {
      await prisma.game.create({
        data: {
          id: randomUUID(),
          startedAt: new Date(now - m.ago),
          endedAt: new Date(now - m.ago + 16 * MINUTE),
          status: 'COMPLETED',
          gameType: m.type as any,
          participants: {
            create: m.parts.filter((p) => p.uid).map((p) => ({
              id: randomUUID(),
              user_id: p.uid!,
              color: p.c as any,
              rank: p.r,
              piecesCaptured: p.cap,
              piecesInGoal: p.goal,
            })),
          },
        },
      });
    }

    // Friendships for harleynghxedu
    await prisma.friendship.deleteMany({
      where: { OR: [{ userId: harleynghxedu.id }, { friendId: harleynghxedu.id }] },
    });
    const f2 = [];
    if (alice) f2.push({ id: randomUUID(), userId: harleynghxedu.id, friendId: alice.id, status: 'accepted' as const });
    if (dave) f2.push({ id: randomUUID(), userId: harleynghxedu.id, friendId: dave.id, status: 'accepted' as const });
    if (harleyhxng) f2.push({ id: randomUUID(), userId: harleynghxedu.id, friendId: harleyhxng.id, status: 'accepted' as const });
    if (bob) f2.push({ id: randomUUID(), userId: bob.id, friendId: harleynghxedu.id, status: 'pending' as const });
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
