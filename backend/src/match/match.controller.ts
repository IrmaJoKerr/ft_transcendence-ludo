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
import { MatchService, type GameEndPayload } from './match.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { requireSecret } from '../secrets';

@Controller()
// HTTP routes for the match lifecycle: creating/joining games (PvP, PvE,
// hotseat), ready/resign/exit/abort actions, room browsing, and the engine
// callbacks (game end / game started). Delegates to MatchService.
export class MatchController {
  constructor(private readonly match: MatchService) {}

  // PvP: Create invite game (share code via chat)
  @UseGuards(JwtAuthGuard)
  @Post('api/match/pvp/invite')
  pvpInvite(
    @Request() req: { user: { id: string } },
    @Body('clashEnabled') clashEnabled?: boolean,
    @Body('safeZones') safeZones?: boolean,
  ) {
    return this.match.createInvite(req.user.id, clashEnabled ?? false, safeZones ?? true);
  }

  // PvP: Join by invite code
  @UseGuards(JwtAuthGuard)
  @Post('api/match/join/:code')
  joinInvite(@Request() req: { user: { id: string } }, @Param('code') code: string) {
    return this.match.joinByInvite(code, req.user.id);
  }

  // PvE: Human vs Bot (1 - 3 bots)
  @UseGuards(JwtAuthGuard)
  @Post('api/match/pve')
  pve(
    @Request() req: { user: { id: string } },
    @Body('playerCount') playerCount: number,
    @Body('clashEnabled') clashEnabled?: boolean,
    @Body('safeZones') safeZones?: boolean,
  ) {
    return this.match.playBot(req.user.id, playerCount || 2, clashEnabled ?? false, safeZones ?? true);
  }

  // Unified Match Creation
  @UseGuards(JwtAuthGuard)
  @Post('api/match/create')
  create(
    @Request() req: { user: { id: string } },
    @Body('mode') mode: string,
    @Body('playerCount') playerCount: number,
    @Body('botCount') botCount?: number,
    @Body('botColors') botColors?: string[],
    @Body('seatColors') seatColors?: string[],
    @Body('clashEnabled') clashEnabled?: boolean,
    @Body('safeZones') safeZones?: boolean,
  ) {
    if (mode !== 'pvp' && mode !== 'pve' && mode !== 'hotseat') {
      throw new BadRequestException('mode is required and must be pvp, pve, or hotseat');
    }
    if (mode !== 'pve' && (botCount ?? 0) > 0) {
      throw new BadRequestException('Bots are only allowed in PvE games');
    }
    return this.match.createMatch(
      req.user.id,
      mode,
      playerCount || 2,
      botCount ?? 0,
      botColors,
      seatColors,
      clashEnabled ?? false,
      safeZones ?? true,
    );
  }

  // Game Actions
  @UseGuards(JwtAuthGuard)
  @Post('api/game/:id/ready')
  ready(@Request() req: { user: { id: string } }, @Param('id') gameId: string) {
    return this.match.readyGame(gameId, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/game/:id/resign')
  resign(@Request() req: { user: { id: string } }, @Param('id') gameId: string) {
    return this.match.resign(gameId, req.user.id);
  }

  // Browse Open Rooms (WAITING PvP games : joinable)
  @UseGuards(JwtAuthGuard)
  @Get('api/games/rooms')
  listRooms() {
    return this.match.listOpenRooms();
  }

  // My Rooms (WAITING/ACTIVE games I'm seated in : rejoin after refresh)
  @UseGuards(JwtAuthGuard)
  @Get('api/games/mine')
  listMine(@Request() req: { user: { id: string } }) {
    return this.match.listMyRooms(req.user.id);
  }

  // Invite a friend into this WAITING PvP room
  @UseGuards(JwtAuthGuard)
  @Post('api/game/:id/invite')
  inviteFriend(
    @Request() req: { user: { id: string } },
    @Param('id') gameId: string,
    @Body('friendId') friendId: string,
  ) {
    return this.match.inviteFriendToGame(gameId, req.user.id, friendId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('api/game/:id/rejoin')
  rejoin(@Request() req: { user: { id: string } }, @Param('id') gameId: string) {
    return this.match.rejoin(gameId, req.user.id);
  }

  // Game End (called by ludo-engine)
  @Post('api/game/end')
  gameEnd(@Headers('x-engine-key') key: string, @Body() body: GameEndPayload) {
    if (key !== requireSecret('ENGINE_API_KEY')) {
      throw new UnauthorizedException('Invalid engine key');
    }
    return this.match.processGameEnd(body);
  }

  // Game Started (called by ludo-engine once the ready-check passes)
  @Post('api/game/:id/started')
  gameStarted(@Headers('x-engine-key') key: string, @Param('id') gameId: string) {
    if (key !== requireSecret('ENGINE_API_KEY')) {
      throw new UnauthorizedException('Invalid engine key');
    }
    return this.match.markStarted(gameId);
  }

  // Exit Game (player acknowledges leaving)
  @UseGuards(JwtAuthGuard)
  @Post('api/game/:id/exit')
  exitGame(@Request() req: { user: { id: string } }, @Param('id') gameId: string) {
    return this.match.exitGame(gameId, req.user.id);
  }

  // Abort Game
  @UseGuards(JwtAuthGuard)
  @Post('api/game/:id/abort')
  abort(@Request() req: { user: { id: string } }, @Param('id') gameId: string) {
    return this.match.cancelGame(gameId, req.user.id);
  }
}
