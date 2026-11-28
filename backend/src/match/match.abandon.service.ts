import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis-client';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { ENDED_MATCH_STATUSES } from './active-game';
import {
  HISTORY_TRIM,
  SLOT_COLORS,
  chatColumns,
  isUniqueViolation,
  readEngineState,
  seatColorsByUserId,
  seatSnapshot,
} from './postgame-snapshot';
import type { GameChatBlock, GameChatPayload } from './postgame-snapshot';
import { readRoomRules } from './room-rules';

// Payload for one seat that left before a win. Counters are the tallies at departure;
// `rank` is the room's player count, so an abandoned seat is last.
export interface SeatAbandonPayload {
  userId: string;
  color: string;
  rank: number;
  // Epoch ms of the departure: the row's "end" for `durationMs`. Absent means now.
  capturedAt?: number;
  totalTurns?: number;
  piecesCaptured?: number;
  piecesInGoal?: number;
  piecesLost?: number;
  threeSixes?: number;
  clashAttacksWon?: number;
  clashDefendsWon?: number;
  clashAttacksLost?: number;
  clashDefendsLost?: number;
  clashWallBattlesWon?: number;
  clashWallsAttacked?: number;
  clashWallsDefended?: number;
  // The room's channel, the same two fields `/end` carries: this seat's row keeps what
  // it was shown up to the moment it left.
  chat?: GameChatPayload;
  blocks?: GameChatBlock[];
}

// One seat's departure is a write of its own: it has no winner to rank and no
// careers to score, so it lives apart from the completed-match transaction.
@Injectable()
export class MatchAbandonService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Write one departed seat's row and nothing else. A still-playing seat and an
  // unstarted room are refused. The route never deletes `match:${id}`, because the room
  // may still be live for the others.
  async recordAbandonedSeat(gameId: string, seat: SeatAbandonPayload) {
    if (!gameId) {
      throw new BadRequestException({
        code: 'MATCH_ABANDON_GAME_ID_REQUIRED',
        message: 'gameId is required',
      });
    }
    const userId = typeof seat?.userId === 'string' ? seat.userId : '';
    const color = typeof seat?.color === 'string' ? seat.color.toUpperCase() : '';
    if (!userId || !color) {
      throw new BadRequestException({
        code: 'MATCH_ABANDON_SEAT_REQUIRED',
        message: 'a seat needs a user and a colour',
      });
    }

    // The hash is the room: it carries the start stamp, the rules and the seats, so a
    // hash that is gone leaves nothing to describe. A departure only reaches the
    // backend while its room still has one (a teardown marks the hash before it posts).
    const matchData = await this.redis.hgetall(`match:${gameId}`);
    // The departing seat's transcript gets the same semantic name colours as a finished
    // room's, read from the hash that still holds every seat.
    const seatColors = seatColorsByUserId(matchData);
    if (!matchData.id) {
      throw new NotFoundException({
        code: 'MATCH_GAME_NOT_FOUND',
        message: 'Game not found',
      });
    }

    // The guard, in one read of the engine's own state: the seat must be terminal
    // (`exited`/`inactive`), or the engine must have closed the room. A seat that is
    // still playing is refused on purpose: a 3-of-4 abort must not write a row for the
    // players still on the board, whose rows arrive with the report that ends the room.
    const engineState = await readEngineState(this.redis, gameId);
    const seatStatus = engineState?.players?.find(
      (p) => (p.color ?? '').toUpperCase() === color,
    )?.status;
    const roomOver = ENDED_MATCH_STATUSES.includes(matchData.status ?? '');
    if (seatStatus !== 'exited' && seatStatus !== 'inactive' && !roomOver) {
      throw new ConflictException({
        code: 'MATCH_ABANDON_SEAT_ACTIVE',
        message: 'that seat is still playing',
      });
    }
    // A waiting room is a room, not a match: a participant who aborts one frees a
    // corner and leaves no record behind. The start stamp is what says so.
    if (!matchData.startedAt) {
      throw new BadRequestException({
        code: 'MATCH_ABANDON_NEVER_STARTED',
        message: 'the game never started',
      });
    }

    // Idempotency: a seat holds at most one row per game (`@@unique([user_id, game_id])`),
    // so a redelivered departure answers with the row it already wrote.
    const existing = await this.prisma.db.matchHistory.findFirst({
      where: { user_id: userId, game_id: gameId },
      select: { status: true },
    });
    if (existing) return { message: 'Seat already recorded', gameId };

    const startMs = parseInt(matchData.startedAt, 10);
    const playedAt = new Date(Number.isFinite(startMs) ? startMs : Date.now());
    // The row ends where the seat did: the engine stamps the departure, so a row
    // written at minute five says five minutes rather than the length of the game.
    const capturedMs =
      typeof seat.capturedAt === 'number' && Number.isFinite(seat.capturedAt)
        ? seat.capturedAt
        : Date.now();
    const durationMs = Math.max(0, capturedMs - playedAt.getTime());
    const gameType = (matchData.gameType || 'PVP') as 'PVP' | 'PVE';
    const playerCount =
      SLOT_COLORS.filter((_, index) => Boolean(matchData[`player${index + 1}_color`])).length || 1;
    const gameModes = { ...readRoomRules(matchData), playerCount };

    // The row's company line, built from the hash: every seat of the room, with the
    // abandoning seat placed last (its `rank` is the player count, never a podium) and
    // flagged abandoned. The others are unranked here, because they have not placed.
    const seatUserIds = SLOT_COLORS.map(
      (_, index) => matchData[`player${index + 1}_id`] ?? '',
    ).filter((id) => id !== '');
    const accounts = await this.prisma.db.user.findMany({
      where: { id: { in: seatUserIds } },
      select: {
        id: true,
        username: true,
        displayName: true,
        avatarStyle: true,
        avatarPhotoContentType: true,
      },
    });
    const accountById = new Map(
      accounts.map((user) => [
        user.id,
        {
          username: user.username,
          displayName: user.displayName,
          avatarStyle: user.avatarStyle,
          hasAvatarPhoto: user.avatarPhotoContentType !== null,
        },
      ]),
    );
    if (!accountById.has(userId)) {
      throw new BadRequestException({
        code: 'MATCH_ABANDON_NO_ACCOUNT',
        message: 'no account holds that seat',
      });
    }
    const rank = Number.isFinite(seat.rank) && seat.rank > 0 ? seat.rank : playerCount;
    const snapshot = seatSnapshot(
      matchData,
      new Map([[color, rank]]),
      accountById,
      new Set([color]),
    );

    try {
      await this.prisma.db.$transaction(async (tx) => {
        await tx.matchHistory.create({
          data: {
            user_id: userId,
            game_id: gameId,
            playedAt,
            durationMs,
            gameType,
            gameModes,
            color: color as 'RED' | 'GREEN' | 'YELLOW' | 'BLUE',
            rank,
            status: 'ABANDONED',
            // No rating, no counter, no leaderboard: the row is the record, and the
            // career row is a completed match's alone.
            ratingDelta: 0,
            totalTurns: seat.totalTurns ?? 0,
            totalCaptures: seat.piecesCaptured ?? 0,
            piecesInGoal: seat.piecesInGoal ?? 0,
            piecesLost: seat.piecesLost ?? 0,
            threeSixes: seat.threeSixes ?? 0,
            clashAttacksWon: seat.clashAttacksWon ?? 0,
            clashDefendsWon: seat.clashDefendsWon ?? 0,
            clashAttacksLost: seat.clashAttacksLost ?? 0,
            clashDefendsLost: seat.clashDefendsLost ?? 0,
            clashWallBattlesWon: seat.clashWallBattlesWon ?? 0,
            clashWallsAttacked: seat.clashWallsAttacked ?? 0,
            clashWallsDefended: seat.clashWallsDefended ?? 0,
            participants: snapshot,
            // What this seat was shown of the room, up to the moment it left (M3).
            ...chatColumns(seat.chat, seat.blocks, userId, seatColors),
          },
        });

        // The same 50-row window as a completed match, in the same transaction: the
        // trim cannot tell the two apart, and it must not.
        const cutoff = await tx.matchHistory.findMany({
          where: { user_id: userId },
          orderBy: { playedAt: 'desc' },
          skip: HISTORY_TRIM - 1,
          take: 1,
          select: { playedAt: true },
        });
        if (cutoff.length > 0) {
          await tx.matchHistory.deleteMany({
            where: { user_id: userId, playedAt: { lt: cutoff[0].playedAt } },
          });
        }
      });
    } catch (err) {
      // A concurrent delivery of the same departure: the unique index is the guard,
      // and the loser answers like it always did.
      if (isUniqueViolation(err)) return { message: 'Seat already recorded', gameId };
      throw err;
    }

    // The bell for the seat that left says it left, never that it finished what it
    // did not. Best effort: a bell must not fail a row that is already written.
    await this.notifications
      .notify(userId, 'match_abandoned', {
        gameId,
        mode: gameType.toLowerCase(),
        playerCount,
        color,
      })
      .catch((err) => {
        console.warn(`Abandoned-match notification failed for ${userId} in ${gameId}:`, err);
      });

    return { message: 'Seat recorded', gameId };
  }
}
