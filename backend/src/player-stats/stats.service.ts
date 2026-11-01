import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
// Aggregate player stats for the stats card. Used by
// stats.controller.ts (GET /api/stats).
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  // Lifetime totals for the logged-in user: rating, games, wins/losses and the
  // counter sums. One row read: the career lives in PlayerStats, so nothing here
  // aggregates over history (which is a trimmed window, not the record).
  async getStats(userId: string) {
    const stats = await this.prisma.db.playerStats.findUnique({ where: { user_id: userId } });
    if (!stats) {
      return { error: 'User not found' };
    }

    const totalGames = stats.gamesPlayed;

    return {
      rating: stats.rating,
      highestRating: stats.highestRating,
      lastRatingDelta: stats.lastRatingDelta,
      totalGames,
      wins: stats.wins,
      losses: stats.losses,
      totalTurns: stats.totalTurns,
      totalCaptures: stats.totalCaptures,
      totalPiecesInGoal: stats.totalPiecesInGoal,
      totalPiecesLost: stats.totalPiecesLost,
      totalDiceRolls: stats.totalDiceRolls,
      totalSixes: stats.totalSixes,
      avgCapturesPerGame:
        totalGames > 0 ? Math.round((stats.totalCaptures / totalGames) * 10) / 10 : 0,
    };
  }
}
