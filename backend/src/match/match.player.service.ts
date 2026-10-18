import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../notification/notification.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { isBotUserId } from '../common/botname-enforce';
import { pairKey, isFriendPair, isBlockedPair } from '../friends/friendship-pair';
import { isEngineGameStarted, isSeatFinalized } from './seat-finalization';
import { hasLiveMatch } from './active-game';
import { ENGINE_WS_URL } from './match.creator.service';
import { readRoomRules } from './room-rules';
import { signEngineToken } from './engine-token.util';

const SLOT_COLORS = ['blue', 'red', 'green', 'yellow'];

@Injectable()
// Per-player match actions: joining, rejoining, inviting friends, ready
// checks, exiting, and marking matches started/ended. Edits the match:* hashes
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

  // Join an existing WAITING match by filling the next empty slot.
  async joinMatch(gameId: string, userId: string) {
    const data = await this.redis.hgetall(`match:${gameId}`);
    if (!data.id)
      throw new NotFoundException({ code: 'MATCH_GAME_NOT_FOUND', message: 'Game not found' });

    // If player already in game, then hand back the same seat instead of allocating another
    const seatedSlot = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].indexOf(
      userId,
    );
    if (seatedSlot !== -1) return this.rejoin(gameId, userId);

    // Strict lock: a caller with a live match must not open a second room, even
    // one they used to play in.
    if (await this.hasActiveMatch(userId)) {
      throw new ForbiddenException({
        code: 'MATCH_ACTIVE_GAME',
        message: 'You already have an active game. Leave it before creating or joining a new match.',
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

    const slotIndex = !data.player2_id ? 1 : !data.player3_id ? 2 : 3;
    const slotKey = `player${slotIndex + 1}`;
    const assignedColor = SLOT_COLORS[slotIndex];

    await this.redis.hset(
      `match:${gameId}`,
      `${slotKey}_id`,
      userId,
      `${slotKey}_color`,
      assignedColor,
    );

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

  // Rejoin a match the user is already seated in (fresh token, no new slot).
  async rejoin(gameId: string, userId: string) {
    const data = await this.redis.hgetall(`match:${gameId}`);
    if (!data.id)
      throw new NotFoundException({ code: 'MATCH_GAME_NOT_FOUND', message: 'Game not found' });

    // Strict lock: you may not join a second room while your current match is
    // still live (rejoining your own live room is fine).
    if (await this.hasActiveMatchExcept(userId, gameId)) {
      throw new ForbiddenException({
        code: 'MATCH_ACTIVE_GAME',
        message: 'You already have an active game. Leave it before creating or joining a new match.',
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

    // Reclaiming the seat clears the reservation flag a "returned to lobby" leave
    // set, so the room counts this player again and the idle-abort stops applying.
    await this.redis.hdel(`match:${gameId}`, `player${slotIndex + 1}_left`);

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

  // Seat a friend into an existing WAITING PvP room and stage an
  // `invite:{friendId}` record for their client's next poll.
  async inviteFriendToGame(gameId: string, hostId: string, friendId: string) {
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

    const pair = await this.prisma.db.friendship.findUnique({
      where: { pairKey: pairKey(hostId, friendId) },
    });
    if (pair && isBlockedPair(pair))
      throw new ForbiddenException({
        code: 'FRIEND_BLOCKED',
        message: 'Cannot invite - user is blocked',
      });
    if (!pair || !isFriendPair(pair))
      throw new ForbiddenException({
        code: 'NOT_FRIENDS_WITH_USER',
        message: 'You are not friends with this user',
      });

    const friendSeat = await this.joinMatch(gameId, friendId);
    const fromUsername = (await this.resolveUsername(hostId)) ?? 'A friend';

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
      'EX',
      300,
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

    return { gameId: friendSeat.gameId };
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
    }

    const readyKey = `ready:${gameId}`;
    const current = new Set<string>(JSON.parse((await this.redis.get(readyKey)) ?? '[]'));
    current.delete(userId);
    await this.redis.set(readyKey, JSON.stringify(Array.from(current)), 'EX', 86400);

    return { gameId };
  }

  // Cancel (abort) a match, setting its status to ABORTED. Quitting stays
  // unscored: End Game records no result.
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

    await this.redis.hset(`match:${gameId}`, 'status', 'ABORTED');
    await this.redis.expire(`match:${gameId}`, 3600);

    // Notify the other human players that the match was aborted.
    await this.notifyMatchAbort(gameId, data, userId);

    return { gameId };
  }

  // Notify the other human players when a match is aborted. The payload keeps
  // the `reason` field ('cancel') for wire stability with older clients.
  private async notifyMatchAbort(gameId: string, data: Record<string, string>, actorId: string) {
    const actor = await this.prisma.db.user.findUnique({
      where: { id: actorId },
      select: { username: true },
    });
    const targets = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].filter(
      (id): id is string => !!id && id !== actorId && !isBotUserId(id),
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
    return { message: 'Game marked active', gameId };
  }

  // Mark a match as ENDED (called when the game is finished).
  async gameEnd(gameId: string, userId: string) {
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

    await this.redis.hset(`match:${gameId}`, 'status', 'ENDED');
    await this.redis.expire(`match:${gameId}`, 3600);

    return { gameId };
  }

  private async resolveUsername(userId: string): Promise<string | null> {
    if (isBotUserId(userId)) return null;
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return user?.username ?? null;
  }

  private async resolveDisplayName(userId: string): Promise<string | undefined> {
    if (isBotUserId(userId)) return undefined;
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return user?.displayName ?? undefined;
  }

  // Whether the caller holds a seat in a live game right now: the strict state
  // lock. While one is live the caller must not open or enter a second room.
  private async hasActiveMatch(userId: string): Promise<boolean> {
    return hasLiveMatch(this.redis, userId);
  }

  // Like hasActiveMatch, but the room the caller is trying to rejoin does not
  // count: rejoining your own live room must still work.
  private async hasActiveMatchExcept(userId: string, exceptGameId: string): Promise<boolean> {
    return hasLiveMatch(this.redis, userId, exceptGameId);
  }
}
