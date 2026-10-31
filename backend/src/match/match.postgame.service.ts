import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationService } from '../notification/notification.service';
import { isBotUserId } from '../common/botname-enforce';
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
  // Barrier Buster: token-priced prison exits that won their clash chain.
  barrierBreaks?: number;
}
export interface GameEndPayload {
  gameId: string;
  participants: GameEndParticipant[];
}

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

    // The engine reports human finishers only. A PvE game has a single human
    // (its opponents are bots, which leave no rows), while a PvP room always
    // finishes with two or more, so fewer means a seat went missing.
    if (gameType === 'PVP' && participants.length < 2) {
      throw new BadRequestException({
        code: 'MATCH_END_PVP_MIN_PLAYERS',
        message: 'a PvP result needs at least 2 players',
      });
    }

    await this.prisma.db.$transaction(async (tx) => {
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

      for (const p of participants) {
        // Bots leave no rows: the engine already drops them, and this guard
        // keeps a stray bot id out of the insert below (user_id is a foreign
        // key, so an unknown id would roll the whole transaction back).
        if (isBotUserId(p.userId)) continue;

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

        // POINTS CALCULATION : every participant left here is a human.
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
              humanWins: gameType === 'PVP' && isWinner ? { increment: 1 } : undefined,
              botWins: gameType === 'PVE' && isWinner ? { increment: 1 } : undefined,
              winStreak: isWinner ? { increment: 1 } : 0,
              bestWinStreak: isWinner
                ? Math.max(user.winStreak + 1, user.bestWinStreak)
                : undefined,
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
        }
      }
    });

    // Post-game achievements hook : MUST never fail the game-end request.
    // A failure only logs.
    await this.achievements.evaluateAfterGame(gameId).catch((err) => {
      console.warn(`Achievements evaluation failed for game ${gameId}:`, err);
    });

    // Match-finished notifications : tell every human player the match
    // concluded and their personal rank. MUST never fail the game-end request.
    await this.notifyMatchFinished(gameId, gameType, participants).catch((err) => {
      console.warn(`Match-finished notifications failed for game ${gameId}:`, err);
    });

    // The content half of every accepted friend's row (D2): a postgame rating moved,
    // and the friends' lists carry it. After the transaction, one publish per human.
    for (const p of participants) {
      if (!isBotUserId(p.userId)) void this.friendshipEvents.publishSubject(p.userId);
    }

    await this.redis.del(`match:${gameId}`);
    // The room is gone from both lists.
    await publishRoomsChanged(this.redis);
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
      const wu = await this.prisma.db.user.findUnique({
        where: { id: winner.userId },
        select: { username: true },
      });
      winnerUsername = wu?.username ?? 'A rival';
    }

    for (const p of participants) {
      if (isBotUserId(p.userId)) continue;
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
