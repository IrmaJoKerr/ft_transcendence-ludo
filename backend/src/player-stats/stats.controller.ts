import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/stats')
// HTTP route for the logged-in user's aggregate stats. Delegates to
// StatsService.
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async getStats(@Request() req: { user: { id: string } }) {
    return this.stats.getStats(req.user.id);
  }
}