import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { secret } from '../secrets';

@Injectable()
// Redis sorted-set storage for leaderboards (one set per mode). Used by
// leaderboard.service.ts and match.postgame.service.ts (rating updates).
export class LeaderboardRedisService implements OnModuleDestroy {
  // Redis client; keys are leaderboard:<mode> sorted sets (member = userId,
  // score = rating).
  private redis: Redis;

  constructor() {
    // Host/port stay plain env : they're topology, not secrets.
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');

    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  // Set a user's rating in a mode's sorted set (key leaderboard:<mode>).
  async updateLeaderboardEntry(
    userId: string,
    rating: number,
    mode: 'global' | 'ranked' | 'casual',
  ): Promise<void> {
    const key = `leaderboard:${mode}`;
    await this.redis.zadd(key, rating, userId);
  }

  // One page of {userId, rating} entries, highest rating first.
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

  // Get total count of entries in leaderboard
  async getLeaderboardCount(mode: string): Promise<number> {
    const key = `leaderboard:${mode}`;
    return await this.redis.zcard(key);
  }

  // 1-based rank in the board, or null if not ranked.
  async getUserRank(userId: string, mode: string): Promise<number | null> {
    const key = `leaderboard:${mode}`;
    // ZREVRANK returns 0-based index, add 1 for 1-based rank
    const rank = await this.redis.zrevrank(key, userId);
    return rank !== null ? rank + 1 : null;
  }
}
