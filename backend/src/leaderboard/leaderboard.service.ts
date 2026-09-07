import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LeaderboardRedisService } from './leaderboard-redis.service';
import { BOT_PREFIX, isBotUserId } from '../common/bot';

// One row on the leaderboard, fully denormalized for display.
export interface LeaderboardEntry {
  rank: number;          // 1-based position on this page
  username: string;      // immutable account name
  displayName: string;   // shown name
  rating: number;        // current Elo-style score
  gamesPlayed: number;   // wins + losses
  wins: number;
  losses: number;
  draws: number;
  winRate: number;       // wins / gamesPlayed, as a whole-number percent
  avatarStyle: string | null;   // dicebear fallback style
  hasAvatarPhoto: boolean;      // true when a photo avatar was uploaded
}

// Envelope the frontend receives from GET /api/leaderboard.
export interface LeaderboardResponse {
  entries: LeaderboardEntry[]; // one page of ranked players
  total: number;               // total entries on the board
  page: number;                // current page (1-based)
  limit: number;               // page size
  myRank?: { rank: number; username: string; displayName: string; rating: number } | null; // caller's own position, when logged in
  source: 'redis';             // where the data was read from
}

@Injectable()
// Leaderboard reads: merges Redis-ranked user ids with Postgres user
// details, rebuilding the Redis board from User.rating when empty.
// Used by leaderboard.controller.ts (GET /api/leaderboard).
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: LeaderboardRedisService,
  ) {}

  // One page of the board for a mode (global/ranked/casual/bot), plus the
  // caller's own rank when userId is given. Used by GET /api/leaderboard.
  async getLeaderboard(options: {
    mode?: 'global' | 'ranked' | 'casual' | 'bot';
    page: number;
    limit: number;
    userId?: string;
  }): Promise<LeaderboardResponse> {
    const { mode, page, limit, userId } = options;

    // Try Redis first (fast path)
    try {
      let redisEntries = await this.redisService.getLeaderboardFromRedis(mode, page, limit);
      let total = await this.redisService.getLeaderboardCount(mode);

      // If Redis has no entries or is missing users, auto-populate from PostgreSQL
      if (redisEntries.length === 0 || total < 5) {
        // Bots are persisted as real User rows (GameParticipant.user_id has an
        // FK to User.id), so an unfiltered scan sweeps "bot-red" & co. straight
        // onto the board. match.postgame.service.ts already skips bots when it
        // zadds a rating; this fallback has to be just as careful.
        const allDbUsers = await this.prisma.db.user.findMany({
          where: { NOT: { id: { startsWith: BOT_PREFIX } } },
          select: { id: true, rating: true },
        });
        if (allDbUsers.length > 0) {
          for (const u of allDbUsers) {
            await this.redisService.updateLeaderboardEntry(u.id, u.rating, (mode as any) || 'global');
          }
          redisEntries = await this.redisService.getLeaderboardFromRedis(mode, page, limit);
          total = await this.redisService.getLeaderboardCount(mode);
        }
      }

      if (redisEntries.length > 0) {
        const userIds = redisEntries.map(e => e.userId);
        const users = await this.prisma.db.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            username: true,
            displayName: true,
            rating: true,
            wins: true,
            losses: true,
            avatarStyle: true,
            avatarPhotoContentType: true,
          },
        });

        const userMap = new Map(users.map(u => [u.id, u]));
        const entries: LeaderboardEntry[] = redisEntries
          // Belt and braces: the query above keeps bots out of the sorted set
          // from here on, but entries written before this fix (or by any future
          // path) are already in Redis. Never render one regardless of how it got in.
          .filter(e => userMap.has(e.userId) && !isBotUserId(e.userId))
          .map((entry, i) => {
            const user = userMap.get(entry.userId)!;
            const gamesPlayed = user.wins + user.losses;
            const wins = user.wins;
            const losses = user.losses;
            const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;

            return {
              rank: (page - 1) * limit + i + 1,
              username: user.username,
              displayName: user.displayName,
              rating: entry.rating,
              gamesPlayed,
              wins,
              losses,
              draws: 0,
              winRate,
              avatarStyle: user.avatarStyle,
              hasAvatarPhoto: user.avatarPhotoContentType !== null,
            };
          });

        const response: LeaderboardResponse = {
          entries,
          total,
          page,
          limit,
          source: 'redis',
        };

        if (userId) {
          const myRank = await this.redisService.getUserRank(userId, mode);
          if (myRank) {
            const user = await this.prisma.db.user.findUnique({
              where: { id: userId },
              select: { username: true, displayName: true, rating: true },
            });
            if (user) {
              response.myRank = {
                rank: myRank,
                username: user.username,
                displayName: user.displayName,
                rating: user.rating,
              };
            }
          }
        }

        return response;
      }
    } catch (err) {
      // Redis is the leaderboard's only store now (it is rebuilt from
      // User.rating whenever it comes up empty), so there is no PostgreSQL
      // snapshot to fall back on : surface the failure instead of hiding it.
      console.warn('Redis leaderboard read failed:', err);
      throw err;
    }

    // Nothing to serve from Redis (fresh database with no users yet) : return
    // an empty board rather than the removed LeaderboardSnapshot fallback.
    return {
      entries: [],
      total: 0,
      page,
      limit,
      source: 'redis',
    };
  }
}
