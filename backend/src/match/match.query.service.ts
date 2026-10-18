// Read-only match queries: open rooms and my-rooms.
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { isEngineGameStarted, isSeatFinalized } from './seat-finalization';
import { readRoomRules } from './room-rules';

const SLOT_COLORS = ['blue', 'red', 'green', 'yellow'];

@Injectable()
// Read-only match queries over Redis match:* hashes, enriched with host
// details from Postgres. Used by match.controller.ts via MatchService.
export class MatchQueryService {
  // Redis client for scanning match:* game hashes.
  private redis: Redis;

  constructor(private readonly prisma: PrismaService) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  // Lists the PvP rooms the viewer may enter: public lobby rooms, plus the
  // viewer's own seat in a room whose game has already started, as long as that
  // seat can still be reclaimed.
  async listOpenRooms(viewerId?: string) {
    let cursor = '0';
    const rooms: Array<{
      id: string;
      roomCode: string;
      hostId: string;
      seats: number;
      maxSeats: number;
      mySeat: boolean;
      clashEnabled: boolean;
      noSafeZones: boolean;
      freeExit: boolean;
    }> = [];
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        const data = await this.redis.hgetall(key);
        if (data.status !== 'WAITING' && data.status !== 'ACTIVE') continue;
        if (data.gameType !== 'PVP' || !data.player1_id) continue;

        const seatIds = [data.player1_id, data.player2_id, data.player3_id, data.player4_id];
        const seats = seatIds.filter(Boolean).length;
        const maxSeats = parseInt(data.playerCount || '4', 10);
        const slotIndex = viewerId ? seatIds.indexOf(viewerId) : -1;

        if (slotIndex !== -1) {
          // The viewer holds a seat here, so the full-room rule does not apply.
          const color = data[`player${slotIndex + 1}_color`] || SLOT_COLORS[slotIndex];
          if (await isSeatFinalized(this.redis, data.id, color)) continue;
        } else {
          // A game that has already started takes no new players. The match hash
          // can still say WAITING, so the engine state is checked as well (see
          // isEngineGameStarted).
          if (data.status === 'ACTIVE') continue;
          if (await isEngineGameStarted(this.redis, data.id)) continue;
          if (seats >= maxSeats) continue;
        }

        rooms.push({
          id: data.id,
          roomCode: data.inviteCode,
          hostId: data.player1_id,
          seats,
          maxSeats,
          mySeat: slotIndex !== -1,
          // The rules the hash was created with; readRoomRules defaults an old hash
          // to clash off, free exit off, safe zones on. The lobby renders them in the
          // MODES cell before a player takes a seat.
          ...readRoomRules(data),
        });
      }
    } while (cursor !== '0');

    const hostIds = [...new Set(rooms.map((r) => r.hostId))];
    const hosts = await this.prisma.db.user.findMany({
      where: { id: { in: hostIds } },
      select: { id: true, username: true, displayName: true, avatarPhotoContentType: true },
    });
    const hostMap = new Map(hosts.map((u) => [u.id, u]));

    return rooms.map((r) => {
      const h = hostMap.get(r.hostId);
      return {
        id: r.id,
        roomCode: r.roomCode,
        // Host identity: the id keys the avatar, the display name is shown, and
        // the immutable username is returned separately for ownership checks.
        hostId: r.hostId,
        host: h?.displayName ?? h?.username ?? 'Unknown',
        hostUsername: h?.username ?? r.hostId,
        hasAvatarPhoto: h?.avatarPhotoContentType != null,
        seats: r.seats,
        maxSeats: r.maxSeats,
        mode: r.maxSeats === 2 ? 'duel' : 'classic',
        // True when the viewer holds a seat in this room: the UI turns the row
        // into a REJOIN row instead of a join row.
        mySeat: r.mySeat,
        clashEnabled: r.clashEnabled,
        noSafeZones: r.noSafeZones,
        freeExit: r.freeExit,
      };
    });
  }

  // List WAITING or ACTIVE matches that the given user is seated in.
  async listMyRooms(userId: string) {
    let cursor = '0';
    const rooms: Array<{
      id: string;
      roomCode: string | null;
      status: string;
      gameType: string;
      seats: number;
      maxSeats: number;
    }> = [];
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        const data = await this.redis.hgetall(key);
        const seatIds = [data.player1_id, data.player2_id, data.player3_id, data.player4_id];
        if (!seatIds.includes(userId)) continue;
        if (data.status !== 'WAITING' && data.status !== 'ACTIVE') continue;

        // A finalized seat can never be rejoined, so this match is not advertised
        // at all. Checked on every hash status, because the engine keeps its state
        // for waiting rooms too.
        const color = data[`player${seatIds.indexOf(userId) + 1}_color`];
        if (color && (await isSeatFinalized(this.redis, data.id, color))) continue;
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
