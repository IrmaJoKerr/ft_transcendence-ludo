import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
import Redis from 'ioredis';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

loadEnv({ path: join(__dirname, '..', '..', '.env') });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
const prisma = new PrismaClient({ adapter });

// One-off maintenance script: rebuilds the Redis leaderboard sorted sets
// (global/ranked/casual) from the career ratings in PlayerStats.
// Run manually with ts-node after a Redis wipe or fresh deploy.
async function main() {
  console.log('🔄 Synchronizing database users to Redis leaderboards...');

  // The rating lives on the career row, so the board is rebuilt from PlayerStats
  // joined to the account it belongs to. A bot has no row, which is the filter.
  const pilots = await prisma.playerStats.findMany({
    select: { user_id: true, rating: true },
    orderBy: { rating: 'desc' },
  });

  console.log(`Found ${pilots.length} total rated players in PostgreSQL database.`);

  // Connect to Redis
  const redisHost = process.env.REDIS_HOST || 'localhost';
  const redisPort = parseInt(process.env.REDIS_PORT || '6479', 10);
  const redisPassword = process.env.REDIS_PASSWORD || 'password123';

  const redis = new Redis({
    host: redisHost,
    port: redisPort,
    password: redisPassword,
  });

  // Clear Redis leaderboards
  await redis.del('leaderboard:global', 'leaderboard:ranked', 'leaderboard:casual');

  // Populate Redis sorted sets
  for (const p of pilots) {
    await redis.zadd('leaderboard:global', p.rating, p.user_id);
    await redis.zadd('leaderboard:ranked', p.rating, p.user_id);
    await redis.zadd('leaderboard:casual', p.rating, p.user_id);
  }

  const count = await redis.zcard('leaderboard:global');
  console.log(`✅ Successfully added ${count} users to Redis leaderboard:global!`);

  await redis.quit();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('❌ Leaderboard sync failed:', err);
  process.exit(1);
});
