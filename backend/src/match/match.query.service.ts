// Read-only match queries: open rooms, my-rooms, and the one snapshot the
// realtime broadcaster diffs (socket consolidation, Phase 2).
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { readRoomRules } from './room-rules';

const SLOT_COLORS = ['blue', 'red', 'green', 'yellow'];
// Seat statuses the engine treats as terminal: the player can never rejoin (the
// same rule as seat-finalization.ts, applied to the one state read per room).
const TERMINAL_SEAT_STATUSES = ['exited'];

// What one room looks like with everything viewer-independent already resolved.
// `rooms:list` is viewer-relative only through `mySeat` (D1), so the snapshot
// stores the seats once and each viewer's payload is a filter over it.
export type RoomSnapshotRow = {
  id: string;
  roomCode: string;
  status: string;
  gameType: string;
  hostId: string;
  host: string;
  hostUsername: string;
  hasAvatarPhoto: boolean;
  seats: number;
  maxSeats: number;
  mode: 'classic' | 'duel';
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
  clashKeyShift: 0 | 1 | 2;
  /** Seat slots in order; empty strings for free slots. */
  seatIds: string[];
  /** Users whose seat the engine finalized: never rejoined, never listed. */
  finalizedIds: string[];
  /** The engine has already started this room's game. */
  started: boolean;
};

/** One row of `rooms:list` — the payload the lobby renders. */
export type LobbyRoom = {
  id: string;
  roomCode: string;
  hostId: string;
  host: string;
  hostUsername: string;
  hasAvatarPhoto: boolean;
  seats: number;
  maxSeats: number;
  mode: 'classic' | 'duel';
  mySeat: boolean;
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
  clashKeyShift: 0 | 1 | 2;
};

/** One row of `rooms:mine` — the rejoin banner and "has an active game". */
export type MyRoom = {
  id: string;
  roomCode: string | null;
  status: string;
  gameType: string;
  seats: number;
  maxSeats: number;
};

// The viewer's lobby list. A seated viewer sees the room even when it is full or
// already started (it is their REJOIN row) unless the engine finalized the seat;
// everybody else only sees rooms that can still take them.
export function lobbyRoomsFor(snapshot: RoomSnapshotRow[], viewerId?: string): LobbyRoom[] {
  const rooms: LobbyRoom[] = [];
  for (const room of snapshot) {
    // The lobby is joinable PvP rooms only; `rooms:mine` covers everything.
    if (room.gameType !== 'PVP' || !room.hostId) continue;
    const slotIndex = viewerId ? room.seatIds.indexOf(viewerId) : -1;
    if (slotIndex !== -1) {
      if (viewerId && room.finalizedIds.includes(viewerId)) continue;
    } else {
      // A started or full room takes no new players. The engine state decides
      // "started", because the match hash can lag behind it.
      if (room.status === 'ACTIVE') continue;
      if (room.started) continue;
      if (room.seats >= room.maxSeats) continue;
    }
    rooms.push({
      id: room.id,
      roomCode: room.roomCode,
      hostId: room.hostId,
      host: room.host,
      hostUsername: room.hostUsername,
      hasAvatarPhoto: room.hasAvatarPhoto,
      seats: room.seats,
      maxSeats: room.maxSeats,
      mode: room.mode,
      mySeat: slotIndex !== -1,
      clashEnabled: room.clashEnabled,
      noSafeZones: room.noSafeZones,
      freeExit: room.freeExit,
      clashKeyShift: room.clashKeyShift,
    });
  }
  return rooms;
}

// The viewer's own seats, in every game type. A finalized seat is not advertised
// at all: it can never be rejoined.
export function myRoomsFor(snapshot: RoomSnapshotRow[], userId: string): MyRoom[] {
  return snapshot
    .filter((room) => room.seatIds.includes(userId) && !room.finalizedIds.includes(userId))
    .map((room) => ({
      id: room.id,
      roomCode: room.roomCode || null,
      status: room.status,
      gameType: room.gameType,
      seats: room.seats,
      maxSeats: room.maxSeats,
    }));
}

// The engine's game state, read once per room: which of this room's seats it
// finalized, and whether it has started. Both fail open, so an unreadable state
// never hides a seat or a room.
function readEngineState(
  raw: string | null,
  seatColors: string[],
): { finalizedColors: Set<string>; started: boolean } {
  const result = { finalizedColors: new Set<string>(), started: false };
  if (!raw) return result;
  try {
    const state = JSON.parse(raw) as {
      status?: string;
      players?: Array<{ color?: string; status?: string }>;
    };
    result.started = state.status !== undefined && state.status !== 'waiting';
    for (const color of seatColors) {
      const seat = state.players?.find((p) => p.color === color);
      if (seat?.status && TERMINAL_SEAT_STATUSES.includes(seat.status)) {
        result.finalizedColors.add(color);
      }
    }
  } catch {
    // unreadable state: fail open
  }
  return result;
}

@Injectable()
// Read-only match queries over Redis match:* hashes, enriched with host details
// from Postgres. Used by match.controller.ts via MatchService, and by the
// realtime broadcaster, which diffs one snapshot per rooms-change event.
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

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  // Every room the lobby or a rejoin banner could show anybody, read once: the
  // hash scan, one engine-state read per room, and one Postgres query for the
  // hosts. Each viewer's payload is then a filter (lobbyRoomsFor / myRoomsFor),
  // which is what keeps one change from costing one scan per connected user.
  async snapshot(): Promise<RoomSnapshotRow[]> {
    const rows: RoomSnapshotRow[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        const data = await this.redis.hgetall(key);
        // ABORTED/ENDED rooms are in neither list.
        if (data.status !== 'WAITING' && data.status !== 'ACTIVE') continue;
        if (!data.id) continue;

        const seatIds = [data.player1_id, data.player2_id, data.player3_id, data.player4_id];
        const seatColors = SLOT_COLORS.map((fallback, i) => data[`player${i + 1}_color`] || fallback);
        const engine = readEngineState(await this.redis.hget(`game:${data.id}`, 'state'), seatColors);
        const maxSeats = parseInt(data.playerCount || '4', 10);

        rows.push({
          id: data.id,
          roomCode: data.inviteCode,
          status: data.status,
          gameType: data.gameType,
          hostId: data.player1_id ?? '',
          host: '',
          hostUsername: '',
          hasAvatarPhoto: false,
          seats: seatIds.filter(Boolean).length,
          maxSeats,
          mode: maxSeats === 2 ? 'duel' : 'classic',
          ...readRoomRules(data),
          seatIds,
          finalizedIds: seatIds.filter((id, i) => !!id && engine.finalizedColors.has(seatColors[i])),
          started: engine.started,
        });
      }
    } while (cursor !== '0');

    const hostIds = [...new Set(rows.map((r) => r.hostId).filter(Boolean))];
    if (hostIds.length > 0) {
      const hosts = await this.prisma.db.user.findMany({
        where: { id: { in: hostIds } },
        select: { id: true, username: true, displayName: true, avatarPhotoContentType: true },
      });
      const hostMap = new Map(hosts.map((u) => [u.id, u]));
      for (const row of rows) {
        const h = hostMap.get(row.hostId);
        // Host identity: the id keys the avatar, the display name is shown, and
        // the immutable username is returned separately for ownership checks.
        row.host = h?.displayName ?? h?.username ?? 'Unknown';
        row.hostUsername = h?.username ?? row.hostId;
        row.hasAvatarPhoto = h?.avatarPhotoContentType != null;
      }
    }
    return rows;
  }

  // Lists the PvP rooms the viewer may enter: public lobby rooms, plus the
  // viewer's own seat in a room whose game has already started, as long as that
  // seat can still be reclaimed.
  async listOpenRooms(viewerId?: string): Promise<LobbyRoom[]> {
    return lobbyRoomsFor(await this.snapshot(), viewerId);
  }

  // List WAITING or ACTIVE matches that the given user is seated in.
  async listMyRooms(userId: string): Promise<MyRoom[]> {
    return myRoomsFor(await this.snapshot(), userId);
  }
}
