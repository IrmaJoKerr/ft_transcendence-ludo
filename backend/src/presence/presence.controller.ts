import { Body, Controller, Delete, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PresenceService } from './presence.service';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/presence')
// HTTP routes for the presence system (heartbeat, online count, logout
// clear). All JWT-protected; delegates to PresenceService.
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  // Called every ~20s while the app is open; `playing` flips the status to
  // "playing" instead of plain "online" while inside a match.
  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(@Req() req: Request, @Body() dto: HeartbeatDto) {
    await this.presence.heartbeat((req.user as { id: string }).id, !!dto.playing);
    return { ok: true };
  }

  // Site-wide online count for the homepage badge bar.
  @Get('online-count')
  async onlineCount() {
    return { count: await this.presence.getOnlineCount() };
  }

  // Called on logout (before the auth cookie is cleared) so a signed-out user
  // reads as offline immediately instead of waiting out the heartbeat TTL.
  @Delete('heartbeat')
  @HttpCode(200)
  async clear(@Req() req: Request) {
    await this.presence.clear((req.user as { id: string }).id);
    return { ok: true };
  }
}
