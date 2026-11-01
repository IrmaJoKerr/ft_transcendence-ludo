import { Injectable } from '@nestjs/common';
import { MatchCreatorService } from './match.creator.service';
import { MatchPlayerService } from './match.player.service';
import { MatchQueryService } from './match.query.service';
import { MatchPostgameService, type GameEndPayload } from './match.postgame.service';
import type { RoomRules } from './room-rules';
import type { CreateGuestMatchDto } from './dto/create-guest-match.dto';
export type { GameEndPayload } from './match.postgame.service';

@Injectable()
// Facade over the four match sub-services (creator, player, query,
// postgame). Every match route in match.controller.ts goes through here.
export class MatchService {
  constructor(
    private readonly creator: MatchCreatorService,
    private readonly player: MatchPlayerService,
    private readonly query: MatchQueryService,
    private readonly postgame: MatchPostgameService,
  ) {}

  // Creation
  async createMatch(
    userId: string,
    mode: 'pvp' | 'pve' | 'hotseat',
    playerCount: number,
    botCount: number,
    botColors?: string[],
    botNames?: string[],
    seatColors?: string[],
    // The host's own corner. Required at runtime in every mode (a seat owns a colour
    // and there is no fallback); optional here only because it follows optional
    // seat params, so `createMatchLocked` is the one that refuses its absence.
    hostColor?: string,
    // The room rules from the create body, already one object: the controller
    // shapes the wire params, the creator service normalizes and defaults them.
    rules: Partial<RoomRules> = {},
  ) {
    return this.creator.createMatch(
      userId,
      mode,
      playerCount,
      botCount,
      botColors,
      botNames,
      seatColors,
      hostColor,
      rules,
    );
  }
  async createInvite(userId: string, rules: Partial<RoomRules> | undefined, hostColor?: string) {
    return this.creator.createInvite(userId, rules, hostColor);
  }
  async playBot(userId: string, playerCount: number, hostColor?: string) {
    return this.creator.playBot(userId, playerCount, hostColor);
  }
  // Guest creation: anonymous and ephemeral, so there is no userId. The IP is
  // the only budget key an account-less caller has.
  async createGuestMatch(ip: string, dto: CreateGuestMatchDto) {
    return this.creator.createGuestMatch(ip, dto);
  }
  async joinByInvite(inviteCode: string, userId: string, color: string) {
    return this.creator.joinByInvite(inviteCode, userId, (gameId: string, uid: string) =>
      this.player.joinMatch(gameId, uid, color),
    );
  }

  // Joining
  async joinMatch(gameId: string, userId: string, color: string) {
    return this.player.joinMatch(gameId, userId, color);
  }
  async rejoin(gameId: string, userId: string) {
    return this.player.rejoin(gameId, userId);
  }
  async inviteFriendToGame(gameId: string, userId: string, friendId: string) {
    return this.player.inviteFriendToGame(gameId, userId, friendId);
  }

  // Mark Started (called by ludo-engine once a PvP game actually starts)
  async markStarted(gameId: string) {
    return this.player.markStarted(gameId);
  }

  // State transitions
  async readyGame(gameId: string, userId: string) {
    return this.player.readyGame(gameId, userId);
  }
  async exitGame(gameId: string, userId: string) {
    return this.player.exitGame(gameId, userId);
  }
  async cancelGame(gameId: string, userId: string) {
    return this.player.cancelGame(gameId, userId);
  }

  // Queries
  async listOpenRooms(viewerId?: string) {
    return this.query.listOpenRooms(viewerId);
  }
  async listMyRooms(userId: string) {
    return this.query.listMyRooms(userId);
  }

  // Post-game
  async processGameEnd(data: GameEndPayload) {
    return this.postgame.processGameEnd(data);
  }
}
