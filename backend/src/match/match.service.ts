import { Injectable } from '@nestjs/common';
import { MatchCreatorService } from './match.creator.service';
export { ENGINE_WS_URL } from './match.creator.service';
import { MatchPlayerService } from './match.player.service';
import { MatchQueryService } from './match.query.service';
import { MatchPostgameService, type GameEndPayload } from './match.postgame.service';
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
    seatColors?: string[],
    clashEnabled: boolean = false,
    safeZones: boolean = true,
  ) {
    return this.creator.createMatch(
      userId,
      mode,
      playerCount,
      botCount,
      botColors,
      seatColors,
      clashEnabled,
      safeZones,
    );
  }
  async createInvite(userId: string, clashEnabled: boolean = false, safeZones: boolean = true) {
    return this.creator.createInvite(userId, clashEnabled, safeZones);
  }
  async playBot(
    userId: string,
    playerCount: number = 2,
    clashEnabled: boolean = false,
    safeZones: boolean = true,
  ) {
    return this.creator.playBot(userId, playerCount, clashEnabled, safeZones);
  }
  async joinByInvite(inviteCode: string, userId: string) {
    return this.creator.joinByInvite(inviteCode, userId, (gameId: string, uid: string) =>
      this.player.joinMatch(gameId, uid),
    );
  }

  // Joining
  async joinMatch(gameId: string, userId: string) {
    return this.player.joinMatch(gameId, userId);
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
  async gameEnd(gameId: string, userId: string) {
    return this.player.gameEnd(gameId, userId);
  }
  async cancelGame(gameId: string, userId: string) {
    return this.player.cancelGame(gameId, userId);
  }
  async resign(gameId: string, userId: string) {
    return this.player.resign(gameId, userId);
  }

  // Queries
  async listOpenRooms() {
    return this.query.listOpenRooms();
  }
  async listMyRooms(userId: string) {
    return this.query.listMyRooms(userId);
  }

  // Post-game
  async processGameEnd(data: GameEndPayload) {
    return this.postgame.processGameEnd(data);
  }
}
