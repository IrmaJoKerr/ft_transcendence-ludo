import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

loadEnv({ path: join(__dirname, '..', '..', '.env') });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

// Friendship seed script: clears all friendships, then links every user to
// up to 8 others (accepted) and guarantees the two target accounts 10+
// friends. Run manually with ts-node.
async function main() {
  console.log('♟ Seeding rich allied friendships roster...');

  const allUsers = await prisma.user.findMany();
  console.log(`Found ${allUsers.length} total users in DB.`);

  const targetUsernames = ['harleyhxng', 'harleynghxedu'];
  const targets = allUsers.filter((u) => targetUsernames.includes(u.username));

  // If targets not found by exact username, take the first 2 users
  const mainUsers = targets.length > 0 ? targets : allUsers.slice(0, 2);

  // Clear existing friendships for all users to ensure fresh bidirectional links
  await prisma.friendship.deleteMany({});

  const createdFriendships: any[] = [];
  const addedPairs = new Set<string>();

  for (const mainUser of allUsers) {
    // Select 6-10 other users as friends
    const otherUsers = allUsers.filter((u) => u.id !== mainUser.id);
    const selectedFriends = otherUsers.slice(0, 8);

    for (const friend of selectedFriends) {
      const pairKey1 = `${mainUser.id}_${friend.id}`;
      const pairKey2 = `${friend.id}_${mainUser.id}`;

      if (!addedPairs.has(pairKey1) && !addedPairs.has(pairKey2)) {
        createdFriendships.push({
          id: randomUUID(),
          userId: mainUser.id,
          friendId: friend.id,
          status: 'accepted' as const,
        });
        addedPairs.add(pairKey1);
      }
    }
  }

  // Ensure harleyhxng and harleynghxedu have at least 10 active friends
  for (const target of mainUsers) {
    const others = allUsers.filter((u) => u.id !== target.id);
    for (const other of others.slice(0, 12)) {
      const pairKey1 = `${target.id}_${other.id}`;
      const pairKey2 = `${other.id}_${target.id}`;
      if (!addedPairs.has(pairKey1) && !addedPairs.has(pairKey2)) {
        createdFriendships.push({
          id: randomUUID(),
          userId: target.id,
          friendId: other.id,
          status: 'accepted' as const,
        });
        addedPairs.add(pairKey1);
      }
    }
  }

  await prisma.friendship.createMany({
    data: createdFriendships,
  });

  console.log(`✅ Successfully established ${createdFriendships.length} accepted allied friendships!`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Friend seeding failed:', err);
  process.exit(1);
});
