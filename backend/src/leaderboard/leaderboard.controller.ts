import { Controller, Get, UseGuards, Request, Query } from '@nestjs/common';
import { LeaderboardService, LeaderboardMode } from './leaderboard.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

function positiveIntOr(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

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
    @Query('mode') mode?: LeaderboardMode,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    // JwtStrategy.validate returns { id, username }, so the user id lives on
    // req.user.id (not req.user.sub) : this is also what makes `myRank` work.
    const userId = req.user.id;
    return this.leaderboard.getLeaderboard({
      mode: mode ?? 'global',
      page: positiveIntOr(page, 1),
      limit: Math.min(positiveIntOr(limit, 20), 100),
      userId,
    });
  }
}
