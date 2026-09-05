import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createRedis } from '../redis';
import { secret } from '../secrets';
import { PrismaService } from '../prisma.service';

@Injectable()
export class LeaderboardRedisService implements OnModuleDestroy {
  private redis: Redis;

  constructor() {
    // Host/port stay plain env — they're topology, not secrets.
    this.redis = createRedis();
    this.redis.on('error', (error) => console.error('Redis error:', (error as Error).message));
  }

  onModuleDestroy() {
    this.redis.quit();
  }

  /**
   * Update leaderboard entry for a user
   * @param userId - User ID
   * @param rating - User's current rating
   * @param mode - Game mode (global, ranked, casual, bot)
   */
  async updateLeaderboardEntry(userId: string, rating: number, mode: 'global' | 'ranked' | 'casual' | 'bot'): Promise<void> {
    const key = `leaderboard:${mode}`;
    await this.redis.zadd(key, rating, userId);
  }

  /**
   * Get leaderboard from Redis with pagination
   * @param mode - Game mode
   * @param page - Page number (1-based)
   * @param limit - Results per page
   * @returns Array of {userId, rating} sorted by rating descending
   */
  async getLeaderboardFromRedis(
    mode: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ userId: string; rating: number }[]> {
    const start = (page - 1) * limit;
    const end = start + limit - 1;
    const key = `leaderboard:${mode}`;

    // ZREVRANGE with scores (highest rating first)
    const results = await this.redis.zrevrange(key, start, end, 'WITHSCORES');

    // Parse results: [userId1, rating1, userId2, rating2, ...]
    const entries: { userId: string; rating: number }[] = [];
    for (let i = 0; i < results.length; i += 2) {
      entries.push({
        userId: results[i],
        rating: parseInt(results[i + 1], 10),
      });
    }

    return entries;
  }

  /**
   * Get total count of entries in leaderboard
   */
  async getLeaderboardCount(mode: string): Promise<number> {
    const key = `leaderboard:${mode}`;
    return await this.redis.zcard(key);
  }

  /**
   * Get user's rank in leaderboard
   * @returns 1-based rank, or null if not found
   */
  async getUserRank(userId: string, mode: string): Promise<number | null> {
    const key = `leaderboard:${mode}`;
    // ZREVRANK returns 0-based index, add 1 for 1-based rank
    const rank = await this.redis.zrevrank(key, userId);
    return rank !== null ? rank + 1 : null;
  }

  /**
   * Push a full snapshot of the Redis leaderboard to PostgreSQL.
   * Called after every game end to keep PG mirror in sync.
   * This snapshot serves as a fast fallback when Redis is unavailable.
   */
  async pushSnapshotToPostgres(prisma: PrismaService, mode: string): Promise<void> {
    // 1. Get full sorted set from Redis
    const results = await this.redis.zrevrange(`leaderboard:${mode}`, 0, -1, 'WITHSCORES');

    // 2. Parse into entries
    const entries: { userId: string; rating: number }[] = [];
    for (let i = 0; i < results.length; i += 2) {
      entries.push({ userId: results[i], rating: parseInt(results[i + 1], 10) });
    }

    if (entries.length === 0) return;

    // 3. Enrich with usernames
    const userIds = entries.map(e => e.userId);
    const users = await prisma.db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true },
    });
    const userMap = new Map(users.map(u => [u.id, u.username]));

    // 4. Delete old snapshot for this mode, insert new one in a transaction
    const now = new Date();
    const snapshotData = entries.map((e, i) => ({
      id: crypto.randomUUID(),
      mode,
      userId: e.userId,
      username: userMap.get(e.userId) || 'unknown',
      rating: e.rating,
      rank: i + 1,
      updatedAt: now,
    }));

    await prisma.db.$transaction([
      prisma.db.leaderboardSnapshot.deleteMany({ where: { mode } }),
      prisma.db.leaderboardSnapshot.createMany({ data: snapshotData }),
    ]);
  }

  /**
   * Rebuild leaderboard from PostgreSQL data.
   * Use for fresh deployments or catastrophic recovery when both Redis
   * and the PG snapshot are lost.
   */
  async rebuildLeaderboard(
    users: { userId: string; rating: number }[],
    mode: string,
    timestamp: string,
    gameCount: string,
  ): Promise<void> {
    const pipeline = this.redis.pipeline();

    // Clear existing sorted set
    pipeline.del(`leaderboard:${mode}`);

    // Add all users
    users.forEach((user) => {
      pipeline.zadd(`leaderboard:${mode}`, user.rating, user.userId);
    });

    await pipeline.exec();
    console.log(`[Redis] Rebuilt leaderboard:${mode} with ${users.length} users`);
  }
}