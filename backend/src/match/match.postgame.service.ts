import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationService } from '../notification/notification.service';
import { publishRoomsChanged } from '../common/channels';
import { ratingDeltaFor } from '../common/scoring';
import { readRoomRules } from './room-rules';
import { FriendshipEventsService } from '../friends/friendship-events.service';

// Engine → backend payload for POST /api/game/end. Colors arrive uppercase
// (matching the PlayerColor enum, e.g. 'RED'). Every counter is optional: a room
// that outlived a redeploy reports the tallies it has, and an absent one is 0.
export interface GameEndParticipant {
  userId: string;
  color: string;
  rank: number;
  totalTurns?: number;
  piecesCaptured?: number;
  piecesInGoal?: number;
  piecesLost?: number;
  diceRolls?: number;
  sixes?: number;
  clashDefends?: number;
  clashAttacksWon?: number;
  // Wall Breaker: clash chains won on a landing that stood a barrier.
  clashWallBattlesWon?: number;
  clashWallsAttacked?: number;
  clashWallsDefended?: number;
}
export interface GameEndPayload {
  gameId: string;
  participants: GameEndParticipant[];
}

// One seat of the finished room, as a match row keeps it. A type alias, not an
// interface, so it is assignable to Prisma's `Json` input without a cast.
export type MatchParticipantSnapshot = {
  username: string;
  displayName: string;
  avatarStyle: string | null;
  hasAvatarPhoto: boolean;
  color: string; // uppercase, matching PlayerColor
  rank: number | null; // null for a seat the engine never ranked (a bot)
  isBot: boolean;
};

// Rows kept per user. The history is a scrollable window, not an archive: past
// the newest 50 nothing reads it, and lifetime numbers live in PlayerStats, so the
// trim can never lose a total.
const HISTORY_TRIM = 50;


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

// Prisma raises P2002 for a unique index. Checked structurally so this file needs
// no import of the generated runtime just to name one error.
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

// The room's seats as the match row keeps them. The `match:*` hash is the only
// place a bot seat still exists by the time a match ends (the engine reports human
// seats only), so the snapshot is built from the hash and the reported ranks. A
// seat whose account cannot be loaded writes no row, so it is not in the snapshot
// either; an empty slot is skipped.
function seatSnapshot(
  matchData: Record<string, string>,
  ranksByColor: Map<string, number>,
  accounts: Map<
    string,
    { username: string; displayName: string; avatarStyle: string; hasAvatarPhoto: boolean }
  >,
): MatchParticipantSnapshot[] {
  const seats: MatchParticipantSnapshot[] = [];
  SLOT_COLORS.forEach((fallback, index) => {
    const slot = index + 1;
    const color = (matchData[`player${slot}_color`] || fallback).toUpperCase();
    if (matchData[`player${slot}_isBot`] === 'true') {
      // A bot's identity is its id: `bot-<color>`, and the lobby's label beside it.
      const botId = `bot-${color.toLowerCase()}`;
      seats.push({
        username: botId,
        displayName: matchData[`player${slot}_displayName`] || botId,
        avatarStyle: null,
        hasAvatarPhoto: false,
        color,
        rank: ranksByColor.get(color) ?? null,
        isBot: true,
      });
      return;
    }
    const account = accounts.get(matchData[`player${slot}_id`] ?? '');
    if (!account) return;
    seats.push({
      username: account.username,
      displayName: account.displayName,
      avatarStyle: account.avatarStyle,
      hasAvatarPhoto: account.hasAvatarPhoto,
      color,
      rank: ranksByColor.get(color) ?? null,
      isBot: false,
    });
  });
  // Winners first, then the unranked (a bot the engine never ranked) in seat order.
  return seats.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

// POST-GAME POINTS (piece-based): each piece home = 2 pts (PvP) or 1 pt (PvE),
// winner gets +1 bonus piece. Losers still earn points; bot seats are dropped
// before any row is written, so they earn nothing.

@Injectable()
// Post-game processing: writes one MatchHistory row per seat and updates the
// PlayerStats row each one holds, awards piece-based rating, refreshes the Redis
// leaderboard, triggers achievement evaluation, and notifies players. Used by
// POST /api/game/end.
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

  // Write one match row per seat, update the career row each one holds, award the
  // piece-based rating, refresh the Redis leaderboard, and notify players. Called
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

    // Idempotency guard: an engine retry after a network blip hits this read and
    // returns early : points are never double-awarded. The match rows are the guard
    // now (`game_id` is indexed), and `@@unique([user_id, game_id])` is the half that
    // cannot race : see the P2002 catch around the transaction below.
    const existing = await this.prisma.db.matchHistory.findFirst({
      where: { game_id: gameId },
      select: { id: true },
    });
    if (existing) return { message: 'Game already processed', gameId };

    const matchData = await this.redis.hgetall(`match:${gameId}`);
    const startMs = matchData.startedAt ? parseInt(matchData.startedAt) : null;
    const endMs = Date.now();
    // `playedAt` is the start, and the start is what a row prints: the room hash
    // carries it, and a hash that lost it (a Redis restart mid-game) falls back to
    // now so the row still sorts sanely.
    const playedAt = new Date(startMs ?? endMs);
    const durationMs = Math.max(0, endMs - playedAt.getTime());
    const gameType = (matchData.gameType || 'PVP') as 'PVP' | 'PVE';

    // The room as it was played, captured here because the hash is deleted at the
    // end of this method: a finished game's room rules survive nowhere else.
    const gameModes = {
      ...readRoomRules(matchData),
      playerCount:
        SLOT_COLORS.filter((_, index) => Boolean(matchData[`player${index + 1}_color`])).length ||
        participants.length,
    };

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

    // The accounts behind the reported seats, fetched once: `user_id` is a foreign
    // key, so a seat without a row can own neither a result nor a rating, and the
    // transaction below must not try. This is the second half of the bot rule too: a
    // bot has no User row, so even a bot id that survived a lost room hash (nothing
    // flagged, so the filter above let it through) writes nothing. The names come
    // along for the row's participant snapshot, so no reader has to join again.
    const accounts = await this.prisma.db.user.findMany({
      where: { id: { in: humans.map((p) => p.userId) } },
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
    // A seat is scored only as a pair with the account that will hold the result,
    // so the transaction has no "no account" branch to forget.
    const scored = humans.flatMap((seat) => {
      const user = accountById.get(seat.userId);
      return user ? [{ seat, user }] : [];
    });
    if (scored.length === 0) {
      // Nothing to record: refusing here leaves no row behind, where an empty
      // insert would have committed a set of rows with no seat.
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

    // The row's company line: every seat of the room, bots included, in rank order.
    const snapshot = seatSnapshot(
      matchData,
      new Map(humans.map((p) => [p.color.toUpperCase(), p.rank])),
      accountById,
    );

    // The participants that actually got a row and a rating, returned by the
    // transaction: the notification and the friends' refresh below read this list
    // rather than the reported one. A duplicate delivery that slipped past the read
    // above is refused here by `@@unique([user_id, game_id])` (P2002), which is the
    // answer the old `Game.findUnique` guard gave.
    let processed: GameEndParticipant[];
    try {
      processed = await this.prisma.db.$transaction(async (tx) => {
        const done: GameEndParticipant[] = [];

        for (const { seat: p } of scored) {
          // POINTS CALCULATION : every participant left here has a seat the room did
          // not flag as a bot, and an account to hold the result.
          const isWinner = p.rank === 1;

          const scoredDelta = ratingDeltaFor({
            piecesInGoal: p.piecesInGoal ?? 0,
            rank: p.rank,
            gameType,
          });

          // The career row, upserted rather than updated: every account is created
          // with one (auth, then the seeds), so this create only fires after a manual
          // DELETE, where it heals instead of throwing inside the transaction and
          // bricking match-end.
          const before = await tx.playerStats.upsert({
            where: { user_id: p.userId },
            create: { user_id: p.userId },
            update: {},
            select: { rating: true, highestRating: true, winStreak: true, bestWinStreak: true },
          });

          // Rating is clamped at zero, and the delta stored is the one that actually
          // landed: a +10 that pays only +4 on a rating of 4 is recorded as 4, so a row
          // and `rating` can never drift apart.
          const ratingDelta = Math.max(-before.rating, scoredDelta);
          // Example: rating 100, winner, 4 pieces -> +10 => newRating 110,
          //          highestRating 110, wins++, winStreak 1.
          const newRating = before.rating + ratingDelta;
          const winStreak = isWinner ? before.winStreak + 1 : 0;
          await tx.playerStats.update({
            where: { user_id: p.userId },
            data: {
              rating: newRating,
              highestRating: Math.max(before.highestRating, newRating),
              winStreak,
              bestWinStreak: Math.max(before.bestWinStreak, winStreak),
              lastRatingDelta: ratingDelta,
              gamesPlayed: { increment: 1 },
              wins: isWinner ? { increment: 1 } : undefined,
              losses: isWinner ? undefined : { increment: 1 },
              humanWins: gameType === 'PVP' && isWinner ? { increment: 1 } : undefined,
              botWins: gameType === 'PVE' && isWinner ? { increment: 1 } : undefined,
              // pveGameStreak: PVE increments (any rank), PVP resets to 0.
              // Hotseat never reaches the backend (demo-and-forget).
              pveGameStreak: gameType === 'PVE' ? { increment: 1 } : 0,
              // Lifetime counters, written even when the room had clash off (where they
              // all read 0): they are the only place the lifetime rules can read.
              totalTurns: { increment: p.totalTurns ?? 0 },
              totalCaptures: { increment: p.piecesCaptured ?? 0 },
              totalPiecesInGoal: { increment: p.piecesInGoal ?? 0 },
              totalPiecesLost: { increment: p.piecesLost ?? 0 },
              totalDiceRolls: { increment: p.diceRolls ?? 0 },
              totalSixes: { increment: p.sixes ?? 0 },
              clashDefends: { increment: p.clashDefends ?? 0 },
              clashAttacksWon: { increment: p.clashAttacksWon ?? 0 },
              clashWallBattlesWon: { increment: p.clashWallBattlesWon ?? 0 },
              clashWallsAttacked: { increment: p.clashWallsAttacked ?? 0 },
              clashWallsDefended: { increment: p.clashWallsDefended ?? 0 },
            },
          });
          // What happened, written once: the counters are the engine's tallies and the
          // delta is the one applied above, so a reload tomorrow renders the same row.
          await tx.matchHistory.create({
            data: {
              user_id: p.userId,
              game_id: gameId,
              playedAt,
              durationMs,
              gameType,
              gameModes,
              color: p.color as 'RED' | 'GREEN' | 'YELLOW' | 'BLUE',
              rank: p.rank,
              ratingDelta,
              totalTurns: p.totalTurns ?? 0,
              totalCaptures: p.piecesCaptured ?? 0,
              piecesInGoal: p.piecesInGoal ?? 0,
              piecesLost: p.piecesLost ?? 0,
              diceRolls: p.diceRolls ?? 0,
              sixes: p.sixes ?? 0,
              clashDefends: p.clashDefends ?? 0,
              clashAttacksWon: p.clashAttacksWon ?? 0,
              clashWallBattlesWon: p.clashWallBattlesWon ?? 0,
              clashWallsAttacked: p.clashWallsAttacked ?? 0,
              clashWallsDefended: p.clashWallsDefended ?? 0,
              participants: snapshot,
            },
          });

          // Retention: keep the newest 50 rows for this seat, in the same transaction as
          // the insert. Lifetime numbers live in PlayerStats, so the trim cannot take a
          // total with it : the row is a window, not the record.
          const cutoff = await tx.matchHistory.findMany({
            where: { user_id: p.userId },
            orderBy: { playedAt: 'desc' },
            skip: HISTORY_TRIM - 1,
            take: 1,
            select: { playedAt: true },
          });
          if (cutoff.length > 0) {
            await tx.matchHistory.deleteMany({
              where: { user_id: p.userId, playedAt: { lt: cutoff[0].playedAt } },
            });
          }

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
    } catch (err) {
      // Two deliveries of the same result can both pass the read above, and the unique
      // index settles which one lands: the loser answers like it always did.
      if (isUniqueViolation(err)) return { message: 'Game already processed', gameId };
      throw err;
    }

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
