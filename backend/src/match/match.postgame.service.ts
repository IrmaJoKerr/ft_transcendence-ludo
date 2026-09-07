import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationService } from '../notification/notification.service';
import { isBotUserId } from '../common/bot';
import { ratingDeltaFor } from '../common/scoring'

// POST-GAME POINTS (piece-based): each piece home = 2 pts (PvP) or 1 pt (PvE),
// winner gets +1 bonus piece. Losers still earn points; bots are skipped.

@Injectable()
// Post-game processing: persists finished games and participants to Postgres,
// awards piece-based rating, refreshes the Redis leaderboard, triggers
// achievement evaluation, and notifies players. Used by POST /api/game/end.
export class MatchPostgameService {
	// Redis client for reading match metadata and updating the leaderboard.
	private redis: Redis;

	constructor(
		private readonly prisma: PrismaService,
		private readonly achievements: AchievementsService,
		private readonly notifications: NotificationService,
	) {
		const host = process.env.REDIS_HOST || 'redis';
		const port = parseInt(process.env.REDIS_PORT || '6479', 10);
		const password = secret('REDIS_PASSWORD');
		this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
		this.redis.on('error', (error) => console.error('Redis error:', (error as Error).message));
	}

	// Write final results to Postgres (game + participant rows), award piece-
	// based rating, refresh the Redis leaderboard, and notify players. Called
	// by the engine when a match ends.
	async processGameEnd(data: { gameId: string; participants: Array<{ userId: string; color: string; rank: number; piecesCaptured?: number; piecesInGoal?: number; clashDefends?: number; clashAttacksWon?: number }> }) {
		const { gameId, participants } = data;
		if (!gameId) throw new BadRequestException('gameId is required');
		if (!participants || !Array.isArray(participants) || participants.length < 2) {
			throw new BadRequestException('participants array is required (min 2)');
		}

		// Idempotency guard: if this game was already processed, do nothing.
		// Example: the engine retries the callback after a network blip -> the
		// second call hits `existing` and returns early, so points are NOT
		// double-awarded to the players.
		const existing = await this.prisma.db.game.findUnique({ where: { id: gameId } });
		if (existing) return { message: 'Game already processed', gameId };

		const matchData = await this.redis.hgetall(`match:${gameId}`);
		const startedAt = matchData?.startedAt ? parseInt(matchData.startedAt) : null;
		const endedAt = Date.now();
		const gameType = (matchData?.gameType as any) || 'PVP';
		const inviteCode = matchData?.inviteCode || null;

		await this.prisma.db.$transaction(async (tx) => {
			const game = await tx.game.create({
				data: {
					id: gameId,
					startedAt: new Date(startedAt || endedAt),
					endedAt: new Date(endedAt),
					status: 'COMPLETED',
					gameType,
					inviteCode,
				},
			});

			for (const p of participants) {
				// Bots must exist as real User rows : GameParticipant.user_id has
				// an FK to User.id. Guarantee the row exists (id "bot-<color>")
				// so every PvE game-end transaction satisfies the constraint
				// regardless of seed state. Without this, the FK would roll back
				// the whole transaction and void the human's PvE results too.
				if (isBotUserId(p.userId)) {
					await tx.user.upsert({
						where: { id: p.userId },
						update: {},
						create: {
							id: p.userId,
							username: p.userId, // "bot-green" etc. : unique, clearly a bot
							// displayName is required + unique on User (feature-update-profile
							// branch); bot rows reuse the same id so it stays unique.
							displayName: p.userId,
							achievement: { create: { id: crypto.randomUUID() } },
						},
					});
				}

				await tx.gameParticipant.create({
					data: {
						id: crypto.randomUUID(),
						game_id: game.id,
						user_id: p.userId,
						color: p.color as any,
						rank: p.rank,
						piecesCaptured: p.piecesCaptured || 0,
						piecesInGoal: p.piecesInGoal || 0,
						clashDefends: p.clashDefends || 0,
						clashAttacksWon: p.clashAttacksWon || 0,
					},
				});

				// ------------------------------------------------------------------
				// POINTS CALCULATION (per participant, human players only)
				// ------------------------------------------------------------------
				// Bots never earn or lose points : a bot participant is still
				// recorded for history/FK purposes, but its rating is NOT touched.
				if (isBotUserId(p.userId)) continue;

				const isWinner = p.rank === 1;

				const ratingDelta = ratingDeltaFor({
					piecesInGoal: p.piecesInGoal ?? 0,
					rank: p.rank,
					gameType,
				});

				// Example: rating 100, winner, 4 pieces -> +10 => newRating 110,
				//          highestRating 110, wins++, winStreak 1.
				//          Rating is clamped at zero (never negative).
				const user = await tx.user.findUnique({ where: { id: p.userId } });
				if (user) {
					const newRating = Math.max(0, user.rating + ratingDelta);
					await tx.user.update({
						where: { id: p.userId },
						data: {
							rating: newRating,
							highestRating: Math.max(user.highestRating, newRating),
							wins: isWinner ? { increment: 1 } : undefined,
							losses: isWinner ? undefined : { increment: 1 },
							humanWins: isWinner ? { increment: 1 } : undefined,
							botWins: gameType === 'PVE' && isWinner ? { increment: 1 } : undefined,
							winStreak: isWinner ? { increment: 1 } : 0,
							bestWinStreak: isWinner ? Math.max(user.winStreak + 1, user.bestWinStreak) : undefined,
							// pveGameStreak: PVE increments (any rank), PVP resets to 0.
							// Hotseat never reaches the backend (demo-and-forget).
							pveGameStreak: gameType === 'PVE' ? { increment: 1 } : 0,
						},
					});
					// Push the player's fresh rating into the global Redis leaderboard.
					// Example: zadd('leaderboard:global', 110, 'alice-id')
					try {
						await this.redis.zadd('leaderboard:global', newRating, p.userId);
					} catch { /* ignore */ }
				}
			}
		});

		// Post-game achievements hook : MUST never fail the game-end request.
		// A failure only logs (see achievement-revamp.md Phase 3 failure contract).
		await this.achievements.evaluateAfterGame(gameId).catch((err) => {
			console.warn(`Achievements evaluation failed for game ${gameId}:`, err);
		});

		// Match-finished notifications : tell every human player the match
		// concluded and their personal rank. MUST never fail the game-end request.
		await this.notifyMatchFinished(gameId, gameType, participants).catch((err) => {
			console.warn(`Match-finished notifications failed for game ${gameId}:`, err);
		});

		await this.redis.del(`match:${gameId}`);
		return { message: 'Game processed', gameId };
	}

	// Notify each human participant that the match concluded, with their own rank.
	private async notifyMatchFinished(
		gameId: string,
		gameType: string,
		participants: Array<{ userId: string; color: string; rank: number }>,
	) {
		const winner = participants.find((p) => p.rank === 1);
		let winnerUsername = 'A rival';
		if (winner && !isBotUserId(winner.userId)) {
			const wu = await this.prisma.db.user.findUnique({ where: { id: winner.userId }, select: { username: true } });
			winnerUsername = wu?.username || 'A rival';
		}

		for (const p of participants) {
			if (isBotUserId(p.userId)) continue;
			await this.notifications.notify(p.userId, 'match_finished', {
				gameId,
				mode: (gameType || 'PVP').toLowerCase(),
				rank: p.rank,
				winnerColor: winner?.color?.toLowerCase(),
				winnerUsername,
			});
		}
	}

	// Remove stale match keys older than 24h from Redis.
	async cleanupStaleGames() {
		const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
		let cleaned = 0;

		let cursor = '0';
		do {
			const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
			cursor = nextCursor;
			for (const key of keys) {
				const data = await this.redis.hgetall(key);
				const createdAt = parseInt(data.createdAt || '0');
				if (createdAt > 0 && createdAt < oneDayAgo) {
					await this.redis.del(key);
					cleaned++;
				}
			}
		} while (cursor !== '0');

		return { matchesCleaned: cleaned };
	}
}
