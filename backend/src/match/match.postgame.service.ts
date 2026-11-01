import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationService } from '../notification/notification.service';
import { publishRoomsChanged } from '../common/channels';
import { ratingDeltaFor } from '../common/scoring';
import { FriendshipEventsService } from '../friends/friendship-events.service';

// Engine → backend payload for POST /api/game/end. Colors arrive uppercase
// (matching the PlayerColor enum, e.g. 'RED').
export interface GameEndParticipant {
  userId: string;
  color: string;
  rank: number;
  piecesCaptured?: number;
  piecesInGoal?: number;
  clashDefends?: number;
  clashAttacksWon?: number;
  // Wall Breaker: token-priced prison exits that won their clash chain.
  barrierBreaks?: number;
}
export interface GameEndPayload {
  gameId: string;
  participants: GameEndParticipant[];
}

// Seat order the room hash is written in: slot N is `player<N>_*`, and its
// colour is `player<N>_color` (a hotseat room may skip a colour, so the default
// is only a fallback).
const SLOT_COLORS = ['blue', 'red', 'green', 'yellow'];

// The colours whose seat the room hash flags as a bot. `player<N>_isBot` is the
// only answer this service accepts: it is written by MatchCreatorService beside
// the seat, the engine reads the same field, and nothing here looks at the shape
// of an id, so a seat without the flag counts as a human seat whatever its id
// reads like. A room whose hash is gone (a Redis restart mid-game) flags nobody:
// the engine reports human seats only, and the account check in processGameEnd
// still keeps a seat with no User row out of the transaction.
// See docs/ludo-engine/ludo-engine-bot-module.md and backend-match-module.md.
function botSeatColors(matchData: Record<string, string>): Set<string> {
  const bots = new Set<string>();
  SLOT_COLORS.forEach((fallback, index) => {
    const slot = index + 1;
    if (matchData[`player${slot}_isBot`] !== 'true') return;
    bots.add((matchData[`player${slot}_color`] || fallback).toLowerCase());
  });
  return bots;
}

// POST-GAME POINTS (piece-based): each piece home = 2 pts (PvP) or 1 pt (PvE),
// winner gets +1 bonus piece. Losers still earn points; bot seats are dropped
// before any row is written, so they earn nothing.

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
    private readonly friendshipEvents: FriendshipEventsService,
  ) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  // Write final results to Postgres (game + participant rows), award piece-
  // based rating, refresh the Redis leaderboard, and notify players. Called
  // by the engine when a match ends.
  async processGameEnd(data: GameEndPayload) {
    const { gameId, participants } = data;
    if (!gameId) {
      throw new BadRequestException({
        code: 'MATCH_END_GAME_ID_REQUIRED',
        message: 'gameId is required',
      });
    }
    if (!Array.isArray(participants) || participants.length === 0) {
      throw new BadRequestException({
        code: 'MATCH_END_PLAYERS_REQUIRED',
        message: 'at least one player is required',
      });
    }

    // Idempotency guard: an engine retry after a network blip hits `existing`
    // and returns early : points are never double-awarded.
    const existing = await this.prisma.db.game.findUnique({ where: { id: gameId } });
    if (existing) return { message: 'Game already processed', gameId };

    const matchData = await this.redis.hgetall(`match:${gameId}`);
    const startedAt = matchData.startedAt ? parseInt(matchData.startedAt) : null;
    const endedAt = Date.now();
    const gameType = (matchData.gameType || 'PVP') as 'PVP' | 'PVE';
    const inviteCode = matchData.inviteCode || null;

    // The seats the room says are bots never reach a row, a rating or the
    // leaderboard. The engine already reports human seats only
    // (result-submitter.ts drops a seat whose state flag says bot); this is the
    // backend's own answer to the same question, from the same flag, so a payload
    // that carries a bot seat is filtered here instead of trusted.
    const botColors = botSeatColors(matchData);
    const humans = participants.filter((p) => !botColors.has(p.color.toLowerCase()));
    if (humans.length !== participants.length) {
      console.warn(
        `Game ${gameId}: dropped ${participants.length - humans.length} bot seat(s) from the report`,
      );
    }

    // A PvE game has a single human (its opponents are bots, which leave no
    // rows), while a PvP room always finishes with two or more, so fewer human
    // finishers means a seat went missing.
    if (gameType === 'PVP' && humans.length < 2) {
      throw new BadRequestException({
        code: 'MATCH_END_PVP_MIN_PLAYERS',
        message: 'a PvP result needs at least 2 players',
      });
    }

    // The accounts behind the reported seats, fetched once: `user_id` is a
    // foreign key, so a seat without a row can own neither a result nor a rating,
    // and the transaction below must not try. This is the second half of the bot
    // rule too: a bot has no User row, so even a bot id that survived a lost room
    // hash (nothing flagged, so the filter above let it through) writes nothing.
    const accounts = await this.prisma.db.user.findMany({
      where: { id: { in: humans.map((p) => p.userId) } },
      select: { id: true, rating: true, highestRating: true, winStreak: true, bestWinStreak: true },
    });
    const accountById = new Map(accounts.map((user) => [user.id, user]));
    // A seat is scored only as a pair with the account that will hold the result,
    // so the transaction has no "no account" branch to forget.
    const scored = humans.flatMap((seat) => {
      const user = accountById.get(seat.userId);
      return user ? [{ seat, user }] : [];
    });
    if (scored.length === 0) {
      // Nothing to record: refusing here leaves no `Game` row behind, where an
      // empty insert would have committed one with no participants.
      throw new BadRequestException({
        code: 'MATCH_END_PLAYERS_REQUIRED',
        message: 'no participant in this report holds an account',
      });
    }
    for (const p of humans) {
      if (!accountById.has(p.userId)) {
        console.warn(`Game ${gameId}: no account for participant ${p.userId}; skipping`);
      }
    }

    // The participants that actually got a row and a rating, returned by the
    // transaction: the notification and the friends' refresh below read this list
    // rather than the reported one.
    const processed = await this.prisma.db.$transaction(async (tx) => {
      const done: GameEndParticipant[] = [];
      const game = await tx.game.create({
        data: {
          id: gameId,
          startedAt: new Date(startedAt ?? endedAt),
          endedAt: new Date(endedAt),
          status: 'COMPLETED',
          gameType,
          inviteCode,
        },
      });

      for (const { seat: p, user } of scored) {
        await tx.gameParticipant.create({
          data: {
            id: crypto.randomUUID(),
            game_id: game.id,
            user_id: p.userId,
            color: p.color as 'RED' | 'GREEN' | 'YELLOW' | 'BLUE',
            rank: p.rank,
            piecesCaptured: p.piecesCaptured ?? 0,
            piecesInGoal: p.piecesInGoal ?? 0,
            // Written even when the room had clash off: all three read 0 there, and
            // the columns are the only place the clash achievements can read.
            clashDefends: p.clashDefends ?? 0,
            clashAttacksWon: p.clashAttacksWon ?? 0,
            barrierBreaks: p.barrierBreaks ?? 0,
          },
        });

        // POINTS CALCULATION : every participant left here has a seat the room did
        // not flag as a bot, and a User row to hold the result.
        const isWinner = p.rank === 1;

        const ratingDelta = ratingDeltaFor({
          piecesInGoal: p.piecesInGoal ?? 0,
          rank: p.rank,
          gameType,
        });

        // Example: rating 100, winner, 4 pieces -> +10 => newRating 110,
        //          highestRating 110, wins++, winStreak 1.
        //          Rating is clamped at zero (never negative).
        const newRating = Math.max(0, user.rating + ratingDelta);
        await tx.user.update({
          where: { id: p.userId },
          data: {
            rating: newRating,
            highestRating: Math.max(user.highestRating, newRating),
            wins: isWinner ? { increment: 1 } : undefined,
            losses: isWinner ? undefined : { increment: 1 },
            humanWins: gameType === 'PVP' && isWinner ? { increment: 1 } : undefined,
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
        } catch {
          // ignore
        }
        done.push(p);
      }
      return done;
    });

    // Post-game achievements hook : MUST never fail the game-end request.
    // A failure only logs.
    await this.achievements.evaluateAfterGame(gameId).catch((err) => {
      console.warn(`Achievements evaluation failed for game ${gameId}:`, err);
    });

    // Match-finished notifications : tell every human player the match
    // concluded and their personal rank. MUST never fail the game-end request.
    await this.notifyMatchFinished(gameId, gameType, participants, processed).catch((err) => {
      console.warn(`Match-finished notifications failed for game ${gameId}:`, err);
    });

    // The content half of every accepted friend's row (D2): a postgame rating moved,
    // and the friends' lists carry it. After the transaction, one publish per human
    // participant — the ones that actually hold a rating.
    for (const p of processed) {
      void this.friendshipEvents.publishSubject(p.userId);
    }

    await this.redis.del(`match:${gameId}`);
    // The room is gone from both lists.
    await publishRoomsChanged(this.redis);
    return { message: 'Game processed', gameId };
  }

  // Notify each human participant that the match concluded, with their own rank.
  // `participants` is the reported result (its rank 1 names the winning colour,
  // bot or not) and `scored` are the participants that hold a row and a rating, so
  // only those get a bell entry and only a scored winner's name is looked up.
  private async notifyMatchFinished(
    gameId: string,
    gameType: string,
    participants: Array<{ userId: string; color: string; rank: number }>,
    scored: Array<{ userId: string; color: string; rank: number }>,
  ) {
    const winner = participants.find((p) => p.rank === 1);
    const winnerIsHuman = winner !== undefined && scored.some((h) => h.userId === winner.userId);
    let winnerUsername = 'A rival';
    if (winner && winnerIsHuman) {
      const wu = await this.prisma.db.user.findUnique({
        where: { id: winner.userId },
        select: { username: true },
      });
      winnerUsername = wu?.username ?? 'A rival';
    }

    for (const p of scored) {
      await this.notifications.notify(p.userId, 'match_finished', {
        gameId,
        mode: (gameType || 'PVP').toLowerCase(),
        rank: p.rank,
        winnerColor: winner?.color.toLowerCase(),
        winnerUsername,
      });
    }
  }
}
