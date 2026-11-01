import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { LeaderboardRedisService } from './leaderboard-redis.service';

export interface LeaderboardEntry {
  rank: number; // 1-based position on this page
  username: string; // immutable account name
  id: string; // immutable user id : the key every avatar is looked up by
  displayName: string; // shown name
  rating: number; // current Elo-style score
  gamesPlayed: number; // wins + losses
  wins: number;
  losses: number;
  draws: number;
  winRate: number; // wins / gamesPlayed, as a whole-number percent
  avatarStyle: string | null; // dicebear fallback style
  hasAvatarPhoto: boolean; // true when a photo avatar was uploaded
}

// Envelope the frontend receives from GET /api/leaderboard.
export interface LeaderboardResponse {
  entries: LeaderboardEntry[]; // one page of ranked players
  total: number; // total entries on the board
  page: number; // current page (1-based)
  limit: number; // page size
  myRank?: { rank: number; username: string; displayName: string; rating: number } | null; // caller's own position, when logged in
  source: 'redis'; // where the data was read from
}

// The boards that exist. A bot is a seat, not an account, so there is no bot
// board: every rating here belongs to a PlayerStats row, and the `match:*` hash is
// where a bot lives. `global` is what the client asks for today; `ranked`/`casual`
// are the same board until per-mode ratings exist.
export type LeaderboardMode = 'global' | 'ranked' | 'casual';

@Injectable()
// Leaderboard reads: merges Redis-ranked user ids with Postgres account details,
// rebuilding the Redis board from PlayerStats.rating when empty.
// Used by leaderboard.controller.ts (GET /api/leaderboard).
export class LeaderboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: LeaderboardRedisService,
  ) {}

  // One page of the board for a mode (global/ranked/casual), plus the caller's own
  // rank when userId is given. Used by GET /api/leaderboard.
  async getLeaderboard(options: {
    mode?: LeaderboardMode;
    page: number;
    limit: number;
    userId?: string;
  }): Promise<LeaderboardResponse> {
    // Default to a mode so passing `mode` to Redis methods (which require a
    // string) never sends undefined. The public API treats 'global' as default.
    const { mode = 'global', page, limit, userId } = options;

    // Try Redis first (fast path)
    try {
      let redisEntries = await this.redisService.getLeaderboardFromRedis(mode, page, limit);
      let total = await this.redisService.getLeaderboardCount(mode);

      // If Redis has no entries or is missing users, auto-populate from PostgreSQL.
      // Reading `PlayerStats` is itself the bot filter: a bot is a seat, not an
      // account, so it owns no row that could be rebuilt into the board.
      if (redisEntries.length === 0 || total < 5) {
        const allDbUsers = await this.prisma.db.playerStats.findMany({
          select: { user_id: true, rating: true },
        });
        if (allDbUsers.length > 0) {
          for (const u of allDbUsers) {
            await this.redisService.updateLeaderboardEntry(u.user_id, u.rating, mode);
          }
          redisEntries = await this.redisService.getLeaderboardFromRedis(mode, page, limit);
          total = await this.redisService.getLeaderboardCount(mode);
        }
      }

      if (redisEntries.length > 0) {
        const userIds = redisEntries.map((e) => e.userId);
        const users = await this.prisma.db.user.findMany({
          where: { id: { in: userIds } },
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarStyle: true,
            avatarPhotoContentType: true,
            // The board prints a career, so the card reads the one row that holds it.
            stats: { select: { rating: true, gamesPlayed: true, wins: true, losses: true } },
          },
        });

        const userMap = new Map(users.map((u) => [u.id, u]));
        const entries: LeaderboardEntry[] = [];
        for (const entry of redisEntries) {
          const user = userMap.get(entry.userId);
          // No account, no row: a member left behind by a deleted account (or by
          // a hand-written `bot-` id) stops here.
          if (!user) continue;

          const wins = user.stats?.wins ?? 0;
          const losses = user.stats?.losses ?? 0;
          // `gamesPlayed` is the career counter; the sum is the fallback for a row
          // written before the counter existed, so the card can never read 0 games
          // for a player who has wins.
          const gamesPlayed = user.stats?.gamesPlayed ?? wins + losses;
          const winRate = gamesPlayed > 0 ? Math.round((wins / gamesPlayed) * 100) : 0;

          entries.push({
            rank: (page - 1) * limit + entries.length + 1,
            // The immutable id : the client keys avatars on it, so a renamed
            // display name can never break an avatar URL.
            id: user.id,
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
          });
        }

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
              select: {
                username: true,
                displayName: true,
                stats: { select: { rating: true } },
              },
            });
            if (user) {
              response.myRank = {
                rank: myRank,
                username: user.username,
                displayName: user.displayName,
                // The board's own score, which is what `rank` was computed on: the
                // row is the fallback for a caller Redis has not scored yet.
                rating: user.stats?.rating ?? 0,
              };
            }
          }
        }

        return response;
      }
    } catch (err) {
      // Redis is the leaderboard's only store, rebuilt from PlayerStats.rating
      // whenever it comes up empty. Surfaces the failure instead of hiding it.
      console.warn('Redis leaderboard read failed:', err);
      throw err;
    }

    // Nothing to serve from Redis (fresh database with no users yet) : return an empty board
    return {
      entries: [],
      total: 0,
      page,
      limit,
      source: 'redis',
    };
  }
}
