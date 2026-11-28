import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { AchievementsService } from '../achievements/achievements.service';
import { publishRoomsChanged } from '../common/channels';
import { REDIS_CLIENT } from '../common/redis-client';
import { ratingDeltaFor } from '../common/scoring';
import { FriendshipEventsService } from '../friends/friendship-events.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { ENDED_MATCH_STATUSES } from './active-game';
import {
  HISTORY_TRIM,
  SLOT_COLORS,
  botSeatColors,
  chatColumns,
  isUniqueViolation,
  readEngineState,
  seatColorsByUserId,
  seatSnapshot,
} from './postgame-snapshot';
import type { GameChatBlock, GameChatPayload } from './postgame-snapshot';
import { readRoomRules } from './room-rules';

// Engine → backend payload for POST /api/game/end. Colors arrive uppercase
// (matching the PlayerColor enum, e.g. 'RED'). Every counter is optional: a room
// that outlived a redeploy reports the tallies it has, and an absent one is 0.
export interface GameEndParticipant {
  userId: string;
  color: string;
  // Rank 1 for the seat with four pieces home, 2 for every other seat. The engine gives
  // no finer order; `rank === 1` is the whole win test.
  rank: number;
  totalTurns?: number;
  piecesCaptured?: number;
  piecesInGoal?: number;
  piecesLost?: number;
  threeSixes?: number;
  // Clash rounds, split by the side the seat stood on. The two "lost" tallies are
  // the seat's own half of a round the opponent won.
  clashAttacksWon?: number;
  clashDefendsWon?: number;
  clashAttacksLost?: number;
  clashDefendsLost?: number;
  // Wall Breaker: clash chains won on a landing that stood a wall.
  clashWallBattlesWon?: number;
  clashWallsAttacked?: number;
  clashWallsDefended?: number;
}
export interface GameEndPayload {
  gameId: string;
  participants: GameEndParticipant[];
  // `completed` is a game with a winner, the default. `abandoned` is a room torn down
  // without one: every seat keeps a row, but nobody scores.
  status?: 'completed' | 'abandoned';
  // The room's channel (M3): every line and the ledger that says which pair fell out
  // when. One payload serves the whole room — the write below cuts it per seat, so a
  // row holds exactly what that player was shown.
  chat?: GameChatPayload;
  blocks?: GameChatBlock[];
}

// POST-GAME POINTS (piece-based): each piece home = 2 pts (PvP) or 1 pt (PvE),
// winner gets +1 bonus piece. Losers still earn points; bot seats are dropped
// before any row is written, so they earn nothing.

@Injectable()
// Post-game processing for POST /api/game/end: one MatchHistory row per seat, stats and
// piece-based rating, leaderboard refresh, achievement evaluation, and notifications.
export class MatchPostgameService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly achievements: AchievementsService,
    private readonly notifications: NotificationService,
    private readonly friendshipEvents: FriendshipEventsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // Write one match row per seat, update the career row each one holds, award the
  // piece-based rating, refresh the Redis leaderboard, and notify players. Called
  // by the engine when a match ends.
  async processGameEnd(data: GameEndPayload) {
    const { gameId, participants, status = 'completed', chat, blocks } = data;
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

    // Idempotency guard for an engine retry: only a COMPLETED row counts, because an
    // abandoned row may exist while the room is still live. The unique pair catches the
    // race; see the P2002 handling around the transaction.
    const completed = await this.prisma.db.matchHistory.findFirst({
      where: { game_id: gameId, status: 'COMPLETED' },
      select: { id: true },
    });
    if (completed) return { message: 'Game already processed', gameId };

    const matchData = await this.redis.hgetall(`match:${gameId}`);
    // The hash outlives this method, so read the seat colours once and let every row's
    // transcript projection stamp from the same map.
    const seatColors = seatColorsByUserId(matchData);

    // R21: /end is a completion pass, never an early close. A room is over when the
    // engine declared a winner (`state.status === 'finished'`) or when it closed the
    // room itself (the ABORTED marker closeRoom writes first). An engine state that
    // is genuinely gone falls through instead: a Redis restart mid-game is exactly
    // the case whose result must still land, and the start stamp below is what is
    // left to prove the game was played.
    const engineState = await readEngineState(this.redis, gameId);
    const engineOver = engineState?.status === 'finished';
    const roomOver = ENDED_MATCH_STATUSES.includes(matchData.status ?? '');
    if (engineState !== null && !engineOver && !roomOver) {
      throw new ConflictException({
        code: 'MATCH_END_STILL_ACTIVE',
        message: 'the game is still being played',
      });
    }
    // Load-bearing, not decorative: a waited room the idle watcher reaped is ABORTED
    // with no start stamp, and it is the only thing that separates "a waiting room
    // was reaped" from "a live game was abandoned" (both end with no `game:` state).
    if (!matchData.startedAt) {
      throw new ConflictException({
        code: 'MATCH_END_NEVER_STARTED',
        message: 'the game never started',
      });
    }
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

    // The seats that already hold a row: an abandoned seat's own row, written when
    // it left. This is the read that makes /end a completion pass instead of a
    // second full report. Those seats are skipped (the data would refuse a second
    // row anyway) and their statuses mark the snapshot's abandoned seats.
    const existingRows = await this.prisma.db.matchHistory.findMany({
      where: { game_id: gameId },
      select: { user_id: true, color: true, rank: true, status: true },
    });
    const recordedSeats = new Set(existingRows.map((row) => row.user_id));
    const pending = humans.filter((seat) => !recordedSeats.has(seat.userId));

    // A PvE game has a single human (its opponents are bots, which leave no rows),
    // while a PvP room always finishes with two or more, so fewer finishing humans
    // means a seat went missing. A seat already on record counts: a trio that lost
    // one seat still reports the two that finished, and the third holds its own row.
    if (gameType === 'PVP' && humans.length + existingRows.length < 2) {
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
      where: { id: { in: pending.map((p) => p.userId) } },
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
    const scored = pending.flatMap((seat) => {
      const user = accountById.get(seat.userId);
      return user ? [{ seat, user }] : [];
    });
    if (scored.length === 0) {
      // Every reported seat already holds a row: a redelivered report whose first
      // write landed (the P2002 catch below would answer the same way, from inside a
      // transaction that had nothing to do).
      if (pending.length === 0) return { message: 'Game already processed', gameId };
      // Nothing to record: refusing here leaves no row behind, where an empty
      // insert would have committed a set of rows with no seat.
      throw new BadRequestException({
        code: 'MATCH_END_PLAYERS_REQUIRED',
        message: 'no participant in this report holds an account',
      });
    }
    for (const p of pending) {
      if (!accountById.has(p.userId)) {
        console.warn(`Game ${gameId}: no account for participant ${p.userId}; skipping`);
      }
    }

    // The row's company line: every seat of the room, bots included, in rank order.
    // The ranks are the reported ones, plus the recorded ranks of the seats that
    // left (their row is the only place their place is still written), and the
    // abandoned seats are flagged from those same rows.
    const ranksByColor = new Map(humans.map((p) => [p.color.toUpperCase(), p.rank]));
    const piecesByColor = new Map<string, number>();
    for (const p of humans) {
      if (p.piecesInGoal !== undefined) piecesByColor.set(p.color.toUpperCase(), p.piecesInGoal);
    }
    const abandonedColors = new Set<string>();
    for (const row of existingRows) {
      ranksByColor.set(row.color, row.rank);
      if (row.status === 'ABANDONED') abandonedColors.add(row.color);
    }
    const snapshot = seatSnapshot(
      matchData,
      ranksByColor,
      accountById,
      abandonedColors,
      piecesByColor,
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

        // The career half of a completed match: the rating, the streak and the
        // lifetime counters. An abandoned report never reaches it, so the no-stats
        // rule (R19) is one condition, in one place, and a seat that quit can never
        // score. POINTS CALCULATION : every seat that gets here is a seat the room did
        // not flag as a bot, with an account to hold the result.
        const applyCareer = async (p: GameEndParticipant): Promise<number> => {
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
              // pvpGameStreak is its mirror, so each mode's streak is readable
              // without walking the history. Hotseat never reaches the backend
              // (demo-and-forget).
              pveGameStreak: gameType === 'PVE' ? { increment: 1 } : 0,
              pvpGameStreak: gameType === 'PVP' ? { increment: 1 } : 0,
              // Lifetime counters, written even when the room had clash off (where they
              // all read 0): they are the only place the lifetime rules can read.
              totalTurns: { increment: p.totalTurns ?? 0 },
              totalCaptures: { increment: p.piecesCaptured ?? 0 },
              totalPiecesInGoal: { increment: p.piecesInGoal ?? 0 },
              totalPiecesLost: { increment: p.piecesLost ?? 0 },
              totalThreeSixes: { increment: p.threeSixes ?? 0 },
              clashAttacksWon: { increment: p.clashAttacksWon ?? 0 },
              clashDefendsWon: { increment: p.clashDefendsWon ?? 0 },
              clashAttacksLost: { increment: p.clashAttacksLost ?? 0 },
              clashDefendsLost: { increment: p.clashDefendsLost ?? 0 },
              clashWallBattlesWon: { increment: p.clashWallBattlesWon ?? 0 },
              clashWallsAttacked: { increment: p.clashWallsAttacked ?? 0 },
              clashWallsDefended: { increment: p.clashWallsDefended ?? 0 },
            },
          });

          // Push the seat's fresh rating into the global Redis leaderboard.
          // Example: zadd('leaderboard:global', 110, 'alice-id'). A failed push only
          // logs: the leaderboard is a mirror of `rating`, rebuilt from it.
          try {
            await this.redis.zadd('leaderboard:global', newRating, p.userId);
          } catch {
            // ignore
          }
          return ratingDelta;
        };

        for (const { seat: p } of scored) {
          const ratingDelta = status === 'completed' ? await applyCareer(p) : 0;
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
              status: status === 'completed' ? 'COMPLETED' : 'ABANDONED',
              ratingDelta,
              totalTurns: p.totalTurns ?? 0,
              totalCaptures: p.piecesCaptured ?? 0,
              piecesInGoal: p.piecesInGoal ?? 0,
              piecesLost: p.piecesLost ?? 0,
              threeSixes: p.threeSixes ?? 0,
              clashAttacksWon: p.clashAttacksWon ?? 0,
              clashDefendsWon: p.clashDefendsWon ?? 0,
              clashAttacksLost: p.clashAttacksLost ?? 0,
              clashDefendsLost: p.clashDefendsLost ?? 0,
              clashWallBattlesWon: p.clashWallBattlesWon ?? 0,
              clashWallsAttacked: p.clashWallsAttacked ?? 0,
              clashWallsDefended: p.clashWallsDefended ?? 0,
              participants: snapshot,
              // The seat's own transcript (M3): the room's lines cut at the ledger, so a
              // row never carries a line this player was not shown.
              ...chatColumns(chat, blocks, p.userId, seatColors),
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

    // Everything below belongs to a completed match, and an abandoned report stops
    // here: no bell that says you finished a match you did not finish, no achievement
    // for a game you left, and no friends' push for a rating that never moved (R19's
    // "the bell says match_abandoned, not match_finished").
    if (status === 'completed') {
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
