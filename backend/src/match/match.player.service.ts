import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../notification/notification.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { publishRoomsChanged } from '../common/channels';
import { pairKey } from '../friends/friendship-pair';
import { isEngineGameStarted, isSeatFinalized } from './seat-finalization';
import { findSeatedMatch, ENDED_MATCH_STATUSES } from './active-game';
import { ENGINE_WS_URL } from './match.creator.service';
import { readRoomRules } from './room-rules';
import { signEngineToken } from './engine-token.util';

const SLOT_COLORS = ['blue', 'red', 'green', 'yellow'];

@Injectable()
// Per-player match actions: joining, rejoining, inviting friends, ready
// checks, exiting, and marking matches started. Edits the match:* hashes
// in Redis. Used by MatchService.
export class MatchPlayerService {
  // Redis client for match:* game hashes and ready:<gameId> sets.
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notificationService: NotificationService,
  ) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  // Join an existing WAITING match at one corner. The joiner chooses it (`color`) and
  // the claim is final: no default, no swap afterwards.
  async joinMatch(gameId: string, userId: string, color: string) {
    const data = await this.redis.hgetall(`match:${gameId}`);
    if (!data.id)
      throw new NotFoundException({ code: 'MATCH_GAME_NOT_FOUND', message: 'Game not found' });

    // If player already in game, then hand back the same seat instead of allocating another
    const seatedSlot = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].indexOf(
      userId,
    );
    if (seatedSlot !== -1) return this.rejoin(gameId, userId);

    // One seat at a time: a waiting lobby locks like a live game, so joining
    // elsewhere means leaving the seat you hold first.
    if (await findSeatedMatch(this.redis, userId)) {
      throw new ForbiddenException({
        code: 'MATCH_ALREADY_SEATED',
        message:
          'You are already seated in a game. Return to it, or click Abort to leave it before creating or joining another.',
      });
    }

    if (data.status !== 'WAITING')
      throw new ForbiddenException({
        code: 'MATCH_ALREADY_STARTED',
        message: 'Game already started',
      });
    // The match hash can lag behind the engine, so the engine state decides as
    // well: a game that has already started accepts no new seats.
    if (await isEngineGameStarted(this.redis, gameId))
      throw new ForbiddenException({
        code: 'MATCH_ALREADY_STARTED',
        message: 'Game already started',
      });
    // Humans can only join human rooms : PvE/hotseat rooms are auto-started
    // and never accept a second human via this endpoint.
    if (data.gameType !== 'PVP')
      throw new ForbiddenException({
        code: 'MATCH_PVP_ONLY_JOIN',
        message: 'Only PvP rooms can be joined',
      });

    const maxSeats = parseInt(data.playerCount || '4', 10);
    const occupiedIds = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].filter(
      Boolean,
    );
    if (occupiedIds.length >= maxSeats)
      throw new ForbiddenException({ code: 'MATCH_ROOM_FULL', message: 'Room is full' });

    // A block refuses the next seating, both ways round (queue item 3's lobby
    // half). It is the same gate for `joinByInvite`, which routes through here.
    await this.assertNoBlockedSeat(occupiedIds, userId);

    // A claimed colour is a seat: it lands at that colour's own slot, and nothing
    // else may take it. There is no fallback slot.
    const colorSlot = new Map<string, number>(SLOT_COLORS.map((c, i) => [c, i + 1]));
    const slot = colorSlot.get(color);
    if (!slot || slot > maxSeats) {
      throw new BadRequestException({
        code: 'MATCH_INVALID_COLOR',
        message: `color is required and must be one of ${SLOT_COLORS.slice(0, maxSeats).join(', ')}`,
      });
    }
    const slotIndex = slot - 1;
    const assignedColor = color;
    const slotKey = `player${slotIndex + 1}`;

    // HSETNX is the whole claim protocol: two joiners racing for one colour produce
    // one seat and one MATCH_COLOR_TAKEN, never a silent overwrite. The colour field
    // is written after the id, so a failed claim leaves nothing behind; a missing
    // colour field reads back as that slot's own colour anyway.
    const claimed = await this.redis.hsetnx(`match:${gameId}`, `${slotKey}_id`, userId);
    if (!claimed) {
      throw new ConflictException({
        code: 'MATCH_COLOR_TAKEN',
        message: 'That color was just taken',
      });
    }
    await this.redis.hset(`match:${gameId}`, `${slotKey}_color`, assignedColor);
    // A seat taken is a lobby/mine change for everyone.
    await publishRoomsChanged(this.redis);

    const username = await this.resolveUsername(userId);
    const displayName = await this.resolveDisplayName(userId);
    const token = signEngineToken(this.jwt, {
      gameId,
      playerId: userId,
      username: username ?? undefined,
      displayName,
      role: 'player',
      color: assignedColor,
    });

    return {
      gameId,
      token,
      engineUrl: ENGINE_WS_URL,
      color: assignedColor,
      inviteCode: data.inviteCode || undefined,
      mode: (data as { gameType?: string }).gameType?.toLowerCase() ?? 'pvp',
      playerCount: parseInt(data.playerCount || '2', 10),
      // The joiner is handed the room's rules with the seat: the hash is the room's
      // advertised rules, and the engine's join freezes the same values into state.
      rules: readRoomRules(data),
    };
  }

  // A block refuses the next seating, both ways round: the blocker is told which of
  // their own blocks did it (`MATCH_SEAT_BLOCKED`, and it names nothing they do not
  // already know), the blocked party gets the list's neutral refusal, because a block is
  // never announced. Rejoin and my-rooms stay open: a seat already taken is a different
  // room than a seat being claimed, and a block placed inside a match never ejects
  // anybody (the waiting room included; the host's remedy is ABORT).
  private async assertNoBlockedSeat(slotIds: string[], userId: string): Promise<void> {
    if (slotIds.length === 0) return;
    const rows = await this.prisma.db.friendship.findMany({
      where: { pairKey: { in: slotIds.map((id) => pairKey(userId, id)) } },
      select: { user1Id: true, user1Status: true, user2Status: true },
    });
    for (const row of rows) {
      if (row.user1Status !== 'blocked' && row.user2Status !== 'blocked') continue;
      const callerIsUser1 = row.user1Id === userId;
      const callerBlocked = (callerIsUser1 ? row.user1Status : row.user2Status) === 'blocked';
      throw new ForbiddenException(
        callerBlocked
          ? { code: 'MATCH_SEAT_BLOCKED', message: 'You blocked a player in this room' }
          : { code: 'MATCH_ROOM_UNAVAILABLE', message: 'Room is not available' },
      );
    }
  }

  // Rejoin a match the user is already seated in (fresh token, no new slot).
  async rejoin(gameId: string, userId: string) {
    const data = await this.redis.hgetall(`match:${gameId}`);
    if (!data.id)
      throw new NotFoundException({ code: 'MATCH_GAME_NOT_FOUND', message: 'Game not found' });

    // A closed room is not a room. The hash outlives the game by its short TTL, but
    // the engine state behind it is gone (teardownRoom deletes it), so a token minted
    // here would point into nothing. A WAITING room never carries one of these
    // statuses, so the seat reclaim below is untouched.
    if (ENDED_MATCH_STATUSES.includes(data.status)) {
      throw new NotFoundException({ code: 'MATCH_GAME_NOT_FOUND', message: 'Game not found' });
    }

    // One seat at a time: a waiting lobby locks exactly like a live game, so
    // playing elsewhere means releasing this seat first (rejoining this room is not
    // a second seat, which is what exceptGameId says).
    if (await findSeatedMatch(this.redis, userId, gameId)) {
      throw new ForbiddenException({
        code: 'MATCH_ALREADY_SEATED',
        message:
          'You are already seated in a game. Return to it, or click Abort to leave it before creating or joining another.',
      });
    }

    const slotIndex = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].indexOf(
      userId,
    );
    if (slotIndex === -1)
      throw new ForbiddenException({
        code: 'MATCH_NOT_PLAYER',
        message: 'You are not a player in this game',
      });

    // A finalized seat is terminal: no fresh token is minted for it, whatever the
    // match hash says. Without this gate the /api/games/mine filter could be
    // bypassed with a cached tab or a crafted POST.
    const seatColor = data[`player${slotIndex + 1}_color`] || SLOT_COLORS[slotIndex];
    if (await isSeatFinalized(this.redis, gameId, seatColor)) {
      throw new ForbiddenException({
        code: 'MATCH_SEAT_EXPIRED',
        message: 'Your seat in this game is gone and cannot be reclaimed',
      });
    }

    const color = data[`player${slotIndex + 1}_color`] || SLOT_COLORS[slotIndex];
    const username = await this.resolveUsername(userId);
    const displayName = await this.resolveDisplayName(userId);
    const token = signEngineToken(this.jwt, {
      gameId,
      playerId: userId,
      username: username ?? undefined,
      displayName,
      role: slotIndex === 0 ? 'player1' : 'player',
      color,
    });

    return {
      gameId,
      token,
      engineUrl: ENGINE_WS_URL,
      color,
      inviteCode: data.inviteCode || undefined,
      mode: (data as { gameType?: string }).gameType?.toLowerCase() ?? 'pvp',
      playerCount: parseInt(data.playerCount || '2', 10),
      // Read back out of the hash, not re-derived: after a refresh this is how a
      // rejoining client learns which room it is re-entering (the engine state
      // carries the live flags too, but only once a socket has joined).
      rules: readRoomRules(data),
    };
  }

  // Can this room take a friend right now? The room's own preconditions and nothing
  // else: the friendship gate, the invite record and the notification all belong to
  // FriendsService.inviteToGame, which is this method's only caller — one gate for
  // every CHALLENGE button in the app instead of one per entry point.
  //
  // The seat is deliberately not created here: a seat owns a colour, so the friend
  // claims one from the palette when they accept (POST api/match/join/:code).
  async assertInvitableRoom(gameId: string, hostId: string) {
    const data = await this.redis.hgetall(`match:${gameId}`);
    if (!data.id)
      throw new NotFoundException({ code: 'MATCH_GAME_NOT_FOUND', message: 'Game not found' });
    if (data.gameType !== 'PVP')
      throw new ForbiddenException({
        code: 'MATCH_PVP_ONLY_INVITE',
        message: 'Only PvP rooms can be invited to',
      });
    if (data.status !== 'WAITING')
      throw new ForbiddenException({
        code: 'MATCH_ALREADY_STARTED',
        message: 'Game already started',
      });

    const isSeated =
      data.player1_id === hostId ||
      data.player2_id === hostId ||
      data.player3_id === hostId ||
      data.player4_id === hostId;
    if (!isSeated)
      throw new ForbiddenException({
        code: 'MATCH_NOT_PLAYER',
        message: 'You are not a player in this game',
      });

    return {
      gameId,
      inviteCode: data.inviteCode || undefined,
      playerCount: parseInt(data.playerCount || '4', 10),
    };
  }

  // Is this room still open to be joined? Read by the challenge record: a challenge
  // whose room has started (the friend joined, or the host began) or ended is spent,
  // so the sender may challenge that friend again.
  async isWaitingRoom(gameId: string): Promise<boolean> {
    return (await this.redis.hget(`match:${gameId}`, 'status')) === 'WAITING';
  }

  // Toggle the ready flag for a player in a WAITING match.
  async readyGame(gameId: string, userId: string) {
    const data = await this.redis.hgetall(`match:${gameId}`);
    if (!data.id)
      throw new NotFoundException({ code: 'MATCH_GAME_NOT_FOUND', message: 'Game not found' });

    const isPlayer =
      data.player1_id === userId ||
      data.player2_id === userId ||
      data.player3_id === userId ||
      data.player4_id === userId;
    if (!isPlayer)
      throw new ForbiddenException({
        code: 'MATCH_NOT_PLAYER',
        message: 'You are not a player in this game',
      });

    const readyKey = `ready:${gameId}`;
    const current = new Set<string>(JSON.parse((await this.redis.get(readyKey)) ?? '[]'));
    if (current.has(userId)) {
      current.delete(userId);
    } else {
      current.add(userId);
    }
    await this.redis.set(readyKey, JSON.stringify(Array.from(current)), 'EX', 86400);

    const readyCount = current.size;
    const totalPlayers = [
      data.player1_id,
      data.player2_id,
      data.player3_id,
      data.player4_id,
    ].filter(Boolean).length;

    return {
      gameId,
      readyCount,
      totalPlayers,
      allReady: readyCount === totalPlayers,
    };
  }

  // Remove a player from a match room and clear their ready state.
  async exitGame(gameId: string, userId: string) {
    const data = await this.redis.hgetall(`match:${gameId}`);
    if (!data.id)
      throw new NotFoundException({ code: 'MATCH_GAME_NOT_FOUND', message: 'Game not found' });

    const isPlayer =
      data.player1_id === userId ||
      data.player2_id === userId ||
      data.player3_id === userId ||
      data.player4_id === userId;
    if (!isPlayer)
      throw new ForbiddenException({
        code: 'MATCH_NOT_PLAYER',
        message: 'You are not a player in this game',
      });

    const slotMap: Record<string, string> = {
      [data.player1_id]: 'player1_id',
      [data.player2_id || '']: 'player2_id',
      [data.player3_id || '']: 'player3_id',
      [data.player4_id || '']: 'player4_id',
    };
    const slotKey = slotMap[userId];
    if (slotKey) {
      await this.redis.hdel(`match:${gameId}`, slotKey, slotKey.replace('_id', '_color'));
      await publishRoomsChanged(this.redis);
    }

    const readyKey = `ready:${gameId}`;
    const current = new Set<string>(JSON.parse((await this.redis.get(readyKey)) ?? '[]'));
    current.delete(userId);
    await this.redis.set(readyKey, JSON.stringify(Array.from(current)), 'EX', 86400);

    return { gameId };
  }

  // Cancel (abort) a match, setting its status to ABORTED. Host only, and only
  // while the room is still waiting: aborting a live game is a seat departure (the
  // board's `end_game`), never a room-wide status flip from an HTTP call. Quitting
  // stays unscored: End Game records no result.
  async cancelGame(gameId: string, userId: string) {
    const data = await this.redis.hgetall(`match:${gameId}`);
    if (!data.id)
      throw new NotFoundException({ code: 'MATCH_GAME_NOT_FOUND', message: 'Game not found' });

    const isPlayer =
      data.player1_id === userId ||
      data.player2_id === userId ||
      data.player3_id === userId ||
      data.player4_id === userId;
    if (!isPlayer)
      throw new ForbiddenException({
        code: 'MATCH_NOT_PLAYER',
        message: 'You are not a player in this game',
      });

    // The room's rules and its life belong to its host (row 2 of the leave/abort
    // matrix): a participant leaves by vacating their own seat.
    if (data.hostId !== userId)
      throw new ForbiddenException({
        code: 'MATCH_HOST_ONLY',
        message: 'Only the host can close the room',
      });

    // A started game is not a room to cancel: it is a game to leave, seat by seat.
    if (data.status !== 'WAITING')
      throw new ForbiddenException({
        code: 'MATCH_ALREADY_STARTED',
        message: 'Game already started',
      });

    await this.redis.hset(`match:${gameId}`, 'status', 'ABORTED');
    await this.redis.expire(`match:${gameId}`, 3600);
    await publishRoomsChanged(this.redis);

    // Notify the other human players that the match was aborted.
    await this.notifyMatchAbort(gameId, data, userId);

    return { gameId };
  }

  // Notify the other players when a match is aborted. The payload keeps the
  // `reason` field ('cancel') for wire stability with older clients.
  private async notifyMatchAbort(gameId: string, data: Record<string, string>, actorId: string) {
    const actor = await this.prisma.db.user.findUnique({
      where: { id: actorId },
      select: { username: true },
    });
    // A bot seat has nobody to tell. `player<N>_isBot` is what says so: the
    // creator writes it beside the seat, and the engine and the post-game report
    // read the same flag. So this is a test of the seat, not of the shape of its
    // id: a seat without the flag is an account (a human, or a guest mint).
    const botSeats = new Set(
      [1, 2, 3, 4]
        .filter((slot) => data[`player${slot}_isBot`] === 'true')
        .map((slot) => data[`player${slot}_id`])
        .filter((id): id is string => !!id),
    );
    const targets = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].filter(
      (id): id is string => !!id && id !== actorId && !botSeats.has(id),
    );

    for (const targetId of targets) {
      try {
        await this.notificationService.notify(targetId, 'match_cancelled', {
          gameId,
          reason: 'cancel',
          fromUserId: actorId,
          fromUsername: actor?.username ?? 'A player',
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
    await publishRoomsChanged(this.redis);
    return { message: 'Game marked active', gameId };
  }

  // The caller's account name for an engine token. A lookup, not a bot test: the
  // only ids that reach these two methods are accounts (the JWT's own `uid`, or a
  // friend's id from a `Friendship` row), so an unknown one just resolves to null.
  private async resolveUsername(userId: string): Promise<string | null> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return user?.username ?? null;
  }

  private async resolveDisplayName(userId: string): Promise<string | undefined> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return user?.displayName ?? undefined;
  }
}
