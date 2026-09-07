import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
// Aggregate player stats for the stats card. Used by
// stats.controller.ts (GET /api/stats).
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  // Lifetime totals for the logged-in user: rating, games, wins/losses,
  // captures and goals. Used by GET /api/stats.
  async getStats(userId: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return { error: 'User not found' };
    }

    const participations = await this.prisma.db.gameParticipant.findMany({
      where: { user_id: userId },
    });

    const totalGames = participations.length;
    const wins = participations.filter((p) => p.rank === 1).length;
    const totalCaptures = participations.reduce((s, p) => s + p.piecesCaptured, 0);
    const totalPiecesInGoal = participations.reduce((s, p) => s + p.piecesInGoal, 0);

    return {
      rating: user.rating,
      highestRating: user.highestRating,
      totalGames,
      wins,
      losses: totalGames - wins,
      totalCaptures,
      totalPiecesInGoal,
      avgCapturesPerGame: totalGames > 0 ? Math.round(totalCaptures / totalGames * 10) / 10 : 0,
    };
  }
}