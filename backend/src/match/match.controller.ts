import {
  Controller,
  Post,
  UseGuards,
  Request,
  Body,
  Param,
  Get,
  Headers,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MATCH_THROTTLE } from '../common/throttles';
import { MatchService, type GameEndPayload } from './match.service';
import { InviteFriendDto } from './dto/invite-friend.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { verifySecret } from '../secrets';


@Controller()
// HTTP routes for the match lifecycle: creating/joining games (PvP, PvE,
// hotseat), ready/exit/abort actions, room browsing, and the engine
// callbacks (game end / game started). Delegates to MatchService.
export class MatchController {
  constructor(private readonly match: MatchService) {}

  // PvP: Create invite game (share code via chat)
  @UseGuards(JwtAuthGuard)
  @Throttle(MATCH_THROTTLE.pvpInvite)
  @Post('api/match/pvp/invite')
  pvpInvite(
    @Request() req: { user: { id: string } },
    // The room rules, read one body param at a time like every other field on
    // these create routes (no DTO, so no ValidationPipe: room-rules.ts normalizes
    // and defaults them). The room browser sends the standard rules and the host
    // flips them from the room's panel.
    @Body('clashEnabled') clashEnabled?: boolean,
    @Body('noSafeZones') noSafeZones?: boolean,
    @Body('freeExit') freeExit?: boolean,
  ) {
    return this.match.createInvite(req.user.id, { clashEnabled, noSafeZones, freeExit });
  }

  // PvP: Join by invite code
  @UseGuards(JwtAuthGuard)
  @Throttle(MATCH_THROTTLE.join)
  @Post('api/match/join/:code')
  joinInvite(@Request() req: { user: { id: string } }, @Param('code') code: string) {
    return this.match.joinByInvite(code, req.user.id);
  }

  // PvE: Human vs Bot (1 - 3 bots)
  @UseGuards(JwtAuthGuard)
  @Throttle(MATCH_THROTTLE.pve)
  @Post('api/match/pve')
  pve(@Request() req: { user: { id: string } }, @Body('playerCount') playerCount: number) {
    return this.match.playBot(req.user.id, playerCount || 2);
  }

  // Unified Match Creation
  @UseGuards(JwtAuthGuard)
  @Throttle(MATCH_THROTTLE.create)
  @Post('api/match/create')
  create(
    @Request() req: { user: { id: string } },
    @Body('mode') mode: string,
    @Body('playerCount') playerCount: number,
    @Body('botCount') botCount?: number,
    @Body('botColors') botColors?: string[],
    @Body('botNames') botNames?: string[],
    @Body('seatColors') seatColors?: string[],
    // The host's room rules ride the same body as the seats, so a room is created
    // with its rules in ONE call (no second transaction, no window where a room
    // exists without them). Read as separate params because this route has no DTO
    // class, so the global ValidationPipe never runs on it and nothing would strip
    // or transform a rules object: room-rules.ts coerces the raw values instead.
    @Body('clashEnabled') clashEnabled?: boolean,
    @Body('noSafeZones') noSafeZones?: boolean,
    @Body('freeExit') freeExit?: boolean,
  ) {
    if (mode !== 'pvp' && mode !== 'pve' && mode !== 'hotseat') {
      throw new BadRequestException({
        code: 'MATCH_MODE_REQUIRED',
        message: 'mode is required and must be pvp, pve, or hotseat',
      });
    }
    if (mode !== 'pve' && (botCount ?? 0) > 0) {
      throw new BadRequestException({
        code: 'MATCH_BOTS_PVE_ONLY',
        message: 'Bots are only allowed in PvE games',
      });
    }
    return this.match.createMatch(
      req.user.id,
      mode,
      playerCount || 2,
      botCount ?? 0,
      botColors,
      botNames,
      seatColors,
      { clashEnabled, noSafeZones, freeExit },
    );
  }

  // Game Actions
  @UseGuards(JwtAuthGuard)
  @Throttle(MATCH_THROTTLE.ready)
  @Post('api/game/:id/ready')
  ready(@Request() req: { user: { id: string } }, @Param('id') gameId: string) {
    return this.match.readyGame(gameId, req.user.id);
  }

  // Browse Open Rooms (WAITING PvP games : joinable, plus the caller's own
  // reclaimable seats in games that have already started)
  @UseGuards(JwtAuthGuard)
  @Get('api/games/rooms')
  listRooms(@Request() req: { user: { id: string } }) {
    return this.match.listOpenRooms(req.user.id);
  }

  // My Rooms (WAITING/ACTIVE games I'm seated in : rejoin after refresh)
  @UseGuards(JwtAuthGuard)
  @Get('api/games/mine')
  listMine(@Request() req: { user: { id: string } }) {
    return this.match.listMyRooms(req.user.id);
  }

  // Invite a friend into this WAITING PvP room
  @UseGuards(JwtAuthGuard)
  @Throttle(MATCH_THROTTLE.inviteFriend)
  @Post('api/game/:id/invite')
  inviteFriend(
    @Request() req: { user: { id: string } },
    @Param('id') gameId: string,
    @Body() dto: InviteFriendDto,
  ) {
    return this.match.inviteFriendToGame(gameId, req.user.id, dto.friendId);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(MATCH_THROTTLE.rejoin)
  @Post('api/game/:id/rejoin')
  rejoin(@Request() req: { user: { id: string } }, @Param('id') gameId: string) {
    return this.match.rejoin(gameId, req.user.id);
  }

  // Game End (called by ludo-engine)
  @Post('api/game/end')
  gameEnd(@Headers('x-engine-key') key: string, @Body() body: GameEndPayload) {
    if (!verifySecret('ENGINE_API_KEY', key)) {
      throw new UnauthorizedException('Invalid engine key');
    }
    return this.match.processGameEnd(body);
  }

  // Game Started (called by ludo-engine once the ready-check passes)
  @Post('api/game/:id/started')
  gameStarted(@Headers('x-engine-key') key: string, @Param('id') gameId: string) {
    if (!verifySecret('ENGINE_API_KEY', key)) {
      throw new UnauthorizedException('Invalid engine key');
    }
    return this.match.markStarted(gameId);
  }

  // Exit Game (player acknowledges leaving)
  @UseGuards(JwtAuthGuard)
  @Throttle(MATCH_THROTTLE.exit)
  @Post('api/game/:id/exit')
  exitGame(@Request() req: { user: { id: string } }, @Param('id') gameId: string) {
    return this.match.exitGame(gameId, req.user.id);
  }

  // Abort Game
  @UseGuards(JwtAuthGuard)
  @Throttle(MATCH_THROTTLE.abort)
  @Post('api/game/:id/abort')
  abort(@Request() req: { user: { id: string } }, @Param('id') gameId: string) {
    return this.match.cancelGame(gameId, req.user.id);
  }
}
