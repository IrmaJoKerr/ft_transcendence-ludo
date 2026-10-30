import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PRESENCE_THROTTLE } from '../common/throttles';
import { Request } from 'express';
import { PresenceService } from './presence.service';
import { HeartbeatDto } from './dto/heartbeat.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('api/presence')
// HTTP routes for the presence system. All JWT-protected; delegates to
// PresenceService.
//
// Presence itself is read off the session socket now (RealtimeGateway): the
// connection keeps the row refreshed and its close lets the TTL lapse, so the
// shipped client calls nothing here. What remains is the REST fallback (a browser
// whose socket cannot be established) and the badge's first-paint read.
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  // Fallback heartbeat for a client without a session socket. `playing` flips the
  // status to "playing" instead of plain "online" while inside a match. There is
  // deliberately no DELETE: a logout disconnects the socket, and clearing the row
  // on demand would contradict the connection-as-liveness rule (D3).
  @Throttle(PRESENCE_THROTTLE.heartbeat)
  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(@Req() req: Request, @Body() dto: HeartbeatDto) {
    await this.presence.heartbeat((req.user as { id: string }).id, !!dto.playing);
    return { ok: true };
  }

  // Site-wide online count for the homepage badge bar. Kept for first paint: the
  // live number arrives as the `counts:online` socket event.
  @Get('online-count')
  async onlineCount() {
    return { count: await this.presence.getOnlineCount() };
  }
}
