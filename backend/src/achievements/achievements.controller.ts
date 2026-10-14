import { Controller, Get, Post, UseGuards, Request, Query } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/achievements')
// HTTP routes for achievements: the progress report for the dashboard and a
// silent re-check endpoint. Delegates to AchievementsService.
export class AchievementsController {
  constructor(private readonly achievements: AchievementsService) {}

  // GET /api/achievements : progress report for all 15 achievements.
  // Optional ?username=... targets another user.
  @UseGuards(JwtAuthGuard)
  @Get()
  async getAchievements(
    @Request() req: { user: { id: string } },
    @Query('username') targetUsername?: string,
  ) {
    const achievements = await this.achievements.getUserAchievements(req.user.id, targetUsername);
    return achievements;
  }

  // POST /api/achievements/check : silent re-evaluation for the current
  // user. Returns { unlocked: string[] }.
  @UseGuards(JwtAuthGuard)
  @Post('check')
  async checkAchievements(@Request() req: { user: { id: string } }) {
    return this.achievements.evaluateForUser(req.user.id, undefined, false);
  }
}
