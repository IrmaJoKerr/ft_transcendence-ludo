// Read-only match queries: active games, open rooms, and my-rooms.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { createRedis } from '../redis';

@Injectable()
export class MatchQueryService {
	private redis: Redis;

	constructor(private readonly prisma: PrismaService) {
		this.redis = createRedis();
		this.redis.on('error', (error) => console.error('Redis error:', (error as Error).message));
	}

	// List all currently ACTIVE matches.
	async listActiveGames() {
		let cursor = '0';
		const games: any[] = [];
		do {
			const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
			cursor = nextCursor;
			for (const key of keys) {
				const data = await this.redis.hgetall(key);
				if (data.status === 'ACTIVE') {
					games.push({
						id: data.id,
						gameType: data.gameType,
						player1: data.player1_id,
						player2: data.player2_id,
					});
				}
			}
		} while (cursor !== '0');
		return games;
	}

	// List all WAITING PvP rooms that are open for joining.
	async listOpenRooms() {
		let cursor = '0';
		const rooms: Array<{ id: string; roomCode: string; hostId: string; seats: number; maxSeats: number }> = [];
		do {
			const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
			cursor = nextCursor;
			for (const key of keys) {
				const data = await this.redis.hgetall(key);
				if (data.status === 'WAITING' && data.gameType === 'PVP' && data.player1_id) {
					const seats = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].filter(Boolean).length;
					const maxSeats = parseInt(data.playerCount || '4', 10);
					// Full rooms aren't "open" — hide them instead of listing an
					// unjoinable row (join would just 403 with "Room is full").
					if (seats >= maxSeats) continue;
					rooms.push({
						id: data.id,
						roomCode: data.inviteCode,
						hostId: data.player1_id,
						seats,
						maxSeats,
					});
				}
			}
		} while (cursor !== '0');

		const hostIds = [...new Set(rooms.map((r) => r.hostId))];
		const hosts = await this.prisma.db.user.findMany({
			where: { id: { in: hostIds } },
			select: { id: true, username: true, displayName: true },
		});
		const hostMap = new Map(hosts.map((u) => [u.id, u]));

		return rooms.map((r) => {
			const h = hostMap.get(r.hostId);
			return {
				id: r.id,
				roomCode: r.roomCode,
				// Display name shown in the room listing; the immutable username is
				// also returned separately so the frontend can keep using it for
				// avatar URLs and ownership checks.
				host: h?.displayName ?? h?.username ?? 'Unknown',
				hostUsername: h?.username ?? r.hostId,
				seats: r.seats,
				maxSeats: r.maxSeats,
				mode: r.maxSeats === 2 ? 'duel' : 'classic',
			};
		});
	}

	// List WAITING or ACTIVE matches that the given user is seated in.
	async listMyRooms(userId: string) {
		let cursor = '0';
		const rooms: Array<{ id: string; roomCode: string | null; status: string; gameType: string; seats: number; maxSeats: number }> = [];
		do {
			const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
			cursor = nextCursor;
			for (const key of keys) {
				const data = await this.redis.hgetall(key);
				const seatIds = [data.player1_id, data.player2_id, data.player3_id, data.player4_id];
				if (!seatIds.includes(userId)) continue;
				if (data.status !== 'WAITING' && data.status !== 'ACTIVE') continue;
				rooms.push({
					id: data.id,
					roomCode: data.inviteCode || null,
					status: data.status,
					gameType: data.gameType,
					seats: seatIds.filter(Boolean).length,
					maxSeats: parseInt(data.playerCount || '4', 10),
				});
			}
		} while (cursor !== '0');
		return rooms;
	}
}