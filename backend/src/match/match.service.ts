import { Injectable } from '@nestjs/common';

import { MatchCreatorService } from './match.creator.service';
import { MatchPlayerService } from './match.player.service';
import { MatchPostgameService } from './match.postgame.service';
import { MatchQueryService } from './match.query.service';

// Re-export so callers can reach the engine WebSocket URL without depending
// on the creator service directly.
export { ENGINE_WS_URL } from './match.creator.service';

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
		clashEnabled: boolean = true,
		safeZones: boolean = true,
		botColors?: string[],
		seatColors?: string[],
	) {
		return this.creator.createMatch(userId, mode, playerCount, botCount, clashEnabled, safeZones, botColors, seatColors);
	}
	async findRandomMatch(userId: string, clashEnabled: boolean = true, safeZones: boolean = true) {
		return this.creator.findRandomMatch(userId, clashEnabled, safeZones, (gameId: string, uid: string) => this.player.joinMatch(gameId, uid), (uid: string) => this.query.listMyRooms(uid));
	}
	async createInvite(userId: string, clashEnabled: boolean = true, safeZones: boolean = true) {
		return this.creator.createInvite(userId, clashEnabled, safeZones);
	}
	async playBot(userId: string, playerCount: number = 2, clashEnabled: boolean = true, safeZones: boolean = true) {
		return this.creator.playBot(userId, playerCount, clashEnabled, safeZones);
	}
	async joinByInvite(inviteCode: string, userId: string) {
		return this.creator.joinByInvite(inviteCode, userId, (gameId: string, uid: string) => this.player.joinMatch(gameId, uid));
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
	async listActiveGames() {
		return this.query.listActiveGames();
	}
	async listOpenRooms() {
		return this.query.listOpenRooms();
	}
	async listMyRooms(userId: string) {
		return this.query.listMyRooms(userId);
	}

	// Post-game
	async processGameEnd(data: any) {
		return this.postgame.processGameEnd(data);
	}
	async cleanupStaleGames() {
		return this.postgame.cleanupStaleGames();
	}
}
