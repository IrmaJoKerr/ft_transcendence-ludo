import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../notification/notification.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { isBotUserId } from '../common/bot';

const SLOT_COLORS = ['blue', 'red', 'green', 'yellow'];

@Injectable()
// Per-player match actions: joining, rejoining, inviting friends, ready
// checks, exiting, resigning, and marking matches started/ended. Edits the
// match:* hashes in Redis. Used by MatchService.
export class MatchPlayerService {
	// Redis client for match:* game hashes and ready:<gameId> sets.
	private redis: Redis;

	constructor(
		private readonly prisma: PrismaService,
		private readonly jwt: JwtService,
		private readonly notificationService: NotificationService,
	) {
		const host = process.env.REDIS_HOST || 'redis';
		const port = parseInt(process.env.REDIS_PORT || '6479', 10);
		const password = secret('REDIS_PASSWORD');
		this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
		this.redis.on('error', (error) => console.error('Redis error:', (error as Error).message));
	}

	// Join an existing WAITING match by filling the next empty slot.
	async joinMatch(gameId: string, userId: string) {
		const data = await this.redis.hgetall(`match:${gameId}`);
		if (!data || !data.id) throw new NotFoundException('Game not found');

		// If player already in game, then hand back the same seat instead of allocating another
		const seatedSlot = [data.player1_id, data.player2_id, data.player3_id, data.player4_id]
			.indexOf(userId);
		if (seatedSlot !== -1) return this.rejoin(gameId, userId);

		if (data.status !== 'WAITING') throw new ForbiddenException('Game already started');
		// Humans can only join human rooms : PvE/hotseat rooms are auto-started
		// and never accept a second human via this endpoint.
		if (data.gameType !== 'PVP') throw new ForbiddenException('Only PvP rooms can be joined');

		const maxSeats = parseInt(data.playerCount || '4', 10);
		const occupiedIds = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].filter(Boolean);
		if (occupiedIds.length >= maxSeats) throw new ForbiddenException('Room is full');

		const clashEnabled = data.clashEnabled === 'true';
		const slotIndex = !data.player2_id ? 1 : !data.player3_id ? 2 : 3;
		const slotKey = `player${slotIndex + 1}`;
		const assignedColor = SLOT_COLORS[slotIndex];

		await this.redis.hset(`match:${gameId}`, `${slotKey}_id`, userId, `${slotKey}_color`, assignedColor);

		const username = await this.resolveUsername(userId);
		const displayName = await this.resolveDisplayName(userId);
		const token = this.jwt.sign(
			{ gameId, playerId: userId, username: username || undefined, displayName, role: 'player', clashEnabled, color: assignedColor, mode: (data.gameType || 'PVP').toLowerCase() },
			{ expiresIn: '24h' },
		);

		return { gameId, token, engineUrl: 'ws://localhost:3001', color: assignedColor, inviteCode: data.inviteCode || undefined, mode: data.gameType ? data.gameType.toLowerCase() : 'pvp', playerCount: parseInt(data.playerCount || '2', 10) };
	}

	// Rejoin a match the user is already seated in (fresh token, no new slot).
	async rejoin(gameId: string, userId: string) {
		const data = await this.redis.hgetall(`match:${gameId}`);
		if (!data || !data.id) throw new NotFoundException('Game not found');

		const slotIndex = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].indexOf(userId);
		if (slotIndex === -1) throw new ForbiddenException('You are not a player in this game');

		const color = (data[`player${slotIndex + 1}_color`] as string) || SLOT_COLORS[slotIndex];
		const clashEnabled = data.clashEnabled === 'true';
		const username = await this.resolveUsername(userId);
		const displayName = await this.resolveDisplayName(userId);
		const token = this.jwt.sign(
			{
				gameId,
				playerId: userId,
				username: username || undefined,
				displayName,
				role: slotIndex === 0 ? 'player1' : 'player',
				clashEnabled,
				color,
				mode: (data.gameType || 'PVP').toLowerCase(),
			},
			{ expiresIn: '24h' },
		);

		return { gameId, token, engineUrl: 'ws://localhost:3001', color, inviteCode: data.inviteCode || undefined, mode: data.gameType ? data.gameType.toLowerCase() : 'pvp', playerCount: parseInt(data.playerCount || '2', 10) };
	}

	/**
	 * Seat a friend into an existing WAITING PvP room and stage an invite record
	 * (`invite:{friendId}`) so their client's poll (Shell /api/friends/invites/
	 * pending) picks it up. Same transport as FriendsService.inviteToGame, but
	 * works on a room that already exists instead of creating a fresh one.
	 */
	async inviteFriendToGame(gameId: string, hostId: string, friendId: string) {
		const data = await this.redis.hgetall(`match:${gameId}`);
		if (!data || !data.id) throw new NotFoundException('Game not found');
		if (data.gameType !== 'PVP') throw new ForbiddenException('Only PvP rooms can be invited to');
		if (data.status !== 'WAITING') throw new ForbiddenException('Game already started');

		const isHost = data.player1_id === hostId || data.player2_id === hostId ||
			data.player3_id === hostId || data.player4_id === hostId;
		if (!isHost) throw new ForbiddenException('You are not a player in this game');

		const friendship = await this.prisma.db.friendship.findFirst({
			where: {
				OR: [
					{ userId: hostId, friendId, status: 'accepted' },
					{ userId: friendId, friendId: hostId, status: 'accepted' },
				],
			},
		});
		if (!friendship) throw new ForbiddenException('You are not friends with this user');

		const friendSeat = await this.joinMatch(gameId, friendId);
		const fromUsername = (await this.resolveUsername(hostId)) || 'A friend';

		await this.redis.set(
			`invite:${friendId}`,
			JSON.stringify({
				gameId: friendSeat.gameId,
				token: friendSeat.token,
				engineUrl: friendSeat.engineUrl,
				color: friendSeat.color,
				inviteCode: data.inviteCode || undefined,
				fromUsername,
				createdAt: Date.now(),
			}),
			'EX', 300,
		);

		// Push real-time notification to the friend via SSE / Redis pub/sub
		await this.notificationService.notify(friendId, 'game_invite', {
			gameId: friendSeat.gameId,
			token: friendSeat.token,
			engineUrl: friendSeat.engineUrl,
			color: friendSeat.color,
			inviteCode: data.inviteCode || undefined,
			fromUsername,
			playerCount: parseInt(data.playerCount || '4', 10),
		});

		return { message: 'Invite sent', gameId: friendSeat.gameId };
	}

	// Toggle the ready flag for a player in a WAITING match.
	async readyGame(gameId: string, userId: string) {
		const data = await this.redis.hgetall(`match:${gameId}`);
		if (!data || !data.id) throw new NotFoundException('Game not found');

		const isPlayer = data.player1_id === userId || data.player2_id === userId ||
			data.player3_id === userId || data.player4_id === userId;
		if (!isPlayer) throw new ForbiddenException('You are not a player in this game');

		const readyKey = `ready:${gameId}`;
		const current = new Set<string>(JSON.parse(await this.redis.get(readyKey) || '[]'));
		if (current.has(userId)) {
			current.delete(userId);
		} else {
			current.add(userId);
		}
		await this.redis.set(readyKey, JSON.stringify(Array.from(current)), 'EX', 86400);

		const readyCount = current.size;
		const totalPlayers = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].filter(Boolean).length;

		return {
			message: 'Player ready',
			gameId,
			readyCount,
			totalPlayers,
			allReady: readyCount === totalPlayers,
		};
	}

	// Remove a player from a match room and clear their ready state.
	async exitGame(gameId: string, userId: string) {
		const data = await this.redis.hgetall(`match:${gameId}`);
		if (!data || !data.id) throw new NotFoundException('Game not found');

		const isPlayer = data.player1_id === userId || data.player2_id === userId ||
			data.player3_id === userId || data.player4_id === userId;
		if (!isPlayer) throw new ForbiddenException('You are not a player in this game');

		const slotMap: Record<string, string> = {
			[data.player1_id]: 'player1_id',
			[data.player2_id || '']: 'player2_id',
			[data.player3_id || '']: 'player3_id',
			[data.player4_id || '']: 'player4_id',
		};
		const slotKey = slotMap[userId];
		if (slotKey) {
			await this.redis.hdel(`match:${gameId}`, slotKey, `${slotKey.replace('_id', '_color')}`);
		}

		const readyKey = `ready:${gameId}`;
		const current = new Set<string>(JSON.parse(await this.redis.get(readyKey) || '[]'));
		current.delete(userId);
		await this.redis.set(readyKey, JSON.stringify(Array.from(current)), 'EX', 86400);

		return { message: 'Exited game', gameId };
	}

	// Cancel (abort) a match, setting its status to ABORTED.
	async cancelGame(gameId: string, userId: string, reason: 'cancel' | 'resign' = 'cancel') {
		const data = await this.redis.hgetall(`match:${gameId}`);
		if (!data || !data.id) throw new NotFoundException('Game not found');

		const isPlayer = data.player1_id === userId || data.player2_id === userId ||
			data.player3_id === userId || data.player4_id === userId;
		if (!isPlayer) throw new ForbiddenException('You are not a player in this game');

		await this.redis.hset(`match:${gameId}`, 'status', 'ABORTED');
		await this.redis.expire(`match:${gameId}`, 3600);

		// Notify the other human players that the match was aborted/resigned.
		await this.notifyMatchAbort(gameId, data, userId, reason);

		return { message: 'Game cancelled', gameId };
	}

	// Alias for cancelGame : player resigns from the match.
	async resign(gameId: string, userId: string) {
		return this.cancelGame(gameId, userId, 'resign');
	}

	/** Notify the other human players when a match is aborted or a player resigns. */
	private async notifyMatchAbort(
		gameId: string,
		data: Record<string, string>,
		actorId: string,
		reason: 'cancel' | 'resign',
	) {
		const actor = await this.prisma.db.user.findUnique({ where: { id: actorId }, select: { username: true } });
		const targets = [data.player1_id, data.player2_id, data.player3_id, data.player4_id]
			.filter((id): id is string => !!id && id !== actorId && !isBotUserId(id));

		for (const targetId of targets) {
			try {
				await this.notificationService.notify(targetId, 'match_cancelled', {
					gameId,
					reason,
					fromUserId: actorId,
					fromUsername: actor?.username || 'A player',
				});
			} catch (err) {
				console.warn(`Failed to notify ${targetId} about match ${gameId} cancellation:`, err);
			}
		}
	}

	// listOpenRooms only ever shows WAITING rooms : without this, a match stays
	// WAITING in Redis forever after the ready-check flips it active in the
	// engine, so it keeps showing up as "open" even mid-game.
	async markStarted(gameId: string) {
		const exists = await this.redis.exists(`match:${gameId}`);
		if (!exists) return { message: 'Game not found', gameId };

		await this.redis.hset(`match:${gameId}`, 'status', 'ACTIVE');
		await this.redis.hsetnx(`match:${gameId}`, 'startedAt', Date.now().toString());
		return { message: 'Game marked active', gameId };
	}

	// Mark a match as ENDED (called when the game is finished).
	async gameEnd(gameId: string, userId: string) {
		const data = await this.redis.hgetall(`match:${gameId}`);
		if (!data || !data.id) throw new NotFoundException('Game not found');

		const isPlayer = data.player1_id === userId || data.player2_id === userId ||
			data.player3_id === userId || data.player4_id === userId;
		if (!isPlayer) throw new ForbiddenException('You are not a player in this game');

		await this.redis.hset(`match:${gameId}`, 'status', 'ENDED');
		await this.redis.expire(`match:${gameId}`, 3600);

		return { message: 'Game ended', gameId };
	}

	private async resolveUsername(userId: string): Promise<string | null> {
		if (isBotUserId(userId)) return null;
		const user = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { username: true } });
		return user?.username ?? null;
	}

	private async resolveDisplayName(userId: string): Promise<string | undefined> {
		if (isBotUserId(userId)) return undefined;
		const user = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { displayName: true } });
		return user?.displayName ?? undefined;
	}
}