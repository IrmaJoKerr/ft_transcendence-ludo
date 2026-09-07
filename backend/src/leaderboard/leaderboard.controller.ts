import { Controller, Get, UseGuards, Request, Query } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

// Require a logged-in session (JWT cookie) for every leaderboard request :
// the same guard /api/stats and /api/achievements use. The leaderboard
// returns account-scoped ratings/profiles, so it must not be world-readable.
@Controller('api/leaderboard')
@UseGuards(JwtAuthGuard)
export class LeaderboardController {
  constructor(private readonly leaderboard: LeaderboardService) {}

  @Get()
  async getLeaderboard(
    @Request() req: { user: { id: string } },
    @Query('mode') mode?: 'global' | 'ranked' | 'casual' | 'bot',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // JwtStrategy.validate returns { id, username }, so the user id lives on
    // req.user.id (not req.user.sub) : this is also what makes `myRank` work.
    const userId = req.user?.id || null;
    return this.leaderboard.getLeaderboard({
      mode: mode || 'global',
      page: parseInt(page || '1', 10),
      limit: Math.min(parseInt(limit || '20', 10), 100),
      userId: userId || undefined,
    });
  }
}
