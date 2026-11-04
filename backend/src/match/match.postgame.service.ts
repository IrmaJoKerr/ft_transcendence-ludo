import { Injectable, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import Redis from 'ioredis';
import { AchievementsService } from '../achievements/achievements.service';
import { NotificationService } from '../notification/notification.service';
import { publishRoomsChanged } from '../common/channels';
import { ratingDeltaFor } from '../common/scoring';
import { readRoomRules } from './room-rules';
import { FriendshipEventsService } from '../friends/friendship-events.service';
import { ENDED_MATCH_STATUSES } from './active-game';

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
  // Wall Breaker: clash chains won on a landing that stood a wall.
  clashWallBattlesWon?: number;
  clashWallsAttacked?: number;
  clashWallsDefended?: number;
}
export interface GameEndPayload {
  gameId: string;
  participants: GameEndParticipant[];
  // The kind of rows this report writes. `completed` is a game that ended with a
  // winner and is the default; `abandoned` is a room torn down without one, where
  // every seat keeps a row but nobody scores (R19: the no-stats rule is one
  // condition, in one place).
  status?: 'completed' | 'abandoned';
  // The room's channel (M3): every line and the ledger that says which pair fell out
  // when. One payload serves the whole room — the write below cuts it per seat, so a
  // row holds exactly what that player was shown.
  chat?: GameChatPayload;
  blocks?: GameChatBlock[];
}

// One line of the room's channel, as the engine stores it. The backend never mints an
// id, a sequence or a timestamp: it projects what the room said. A type alias, not an
// interface, so an array of them is assignable to Prisma's `Json` input without a cast.
export type GameChatLine = {
  id: string;
  seq: number;
  senderId: string; // '' on a system line
  senderName: string;
  text: string;
  at: number;
  ch: string;
  kind?: 'system';
  code?: 'left' | 'started';
};

// One block, stamped with the room's chat sequence at the moment the engine applied
// it. A line is hidden from a pair when its own sequence is at or after the cut.
export interface GameChatBlock {
  a: string;
  b: string;
  atSeq: number;
}

export interface GameChatPayload {
  // True when the engine had to re-post the newest lines only: a cut transcript must
  // never render as a complete one.
  truncated?: boolean;
  lines?: GameChatLine[];
}

// Engine → backend payload for POST /api/game/:id/abandon: one seat that left a
// room before anybody won. The counters are the tallies as they stood when the
// seat left (the engine captures them before its pieces are parked), and `rank`
// is the room's player count: an abandoned seat placed last, never first.
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
  diceRolls?: number;
  sixes?: number;
  clashDefends?: number;
  clashAttacksWon?: number;
  clashWallBattlesWon?: number;
  clashWallsAttacked?: number;
  clashWallsDefended?: number;
  // The room's channel, the same two fields `/end` carries: this seat's row keeps what
  // it was shown up to the moment it left.
  chat?: GameChatPayload;
  blocks?: GameChatBlock[];
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
  // Set on a seat whose own row is abandoned (or that left a room which still
  // finished). The card renders such a seat with no rank badge: it did not place.
  // Absent on a row written before this flag existed, which reads as not abandoned.
  abandoned?: boolean;
  // The seat's pieces home, when the report carried it. A bot seat and a seat
  // recorded at its departure have no count, and its card then prints the name only.
  piecesInGoal?: number;
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
// either; an empty slot is skipped. `abandonedColors` names the seats whose own
// row says ABANDONED: the completing report carries the seats still playing, and
// the rows already written carry the ones that left, so the card can tell a seat
// that dropped from a seat that lost.
function seatSnapshot(
  matchData: Record<string, string>,
  ranksByColor: Map<string, number>,
  accounts: Map<
    string,
    { username: string; displayName: string; avatarStyle: string; hasAvatarPhoto: boolean }
  >,
  abandonedColors: Set<string> = new Set(),
  piecesByColor: Map<string, number> = new Map(),
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
        abandoned: false,
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
      abandoned: abandonedColors.has(color),
      // Absent, not 0: a seat recorded at its departure has no count, and a card
      // that printed "0/4" for it would read as a seat that never moved.
      ...(piecesByColor.has(color) ? { piecesInGoal: piecesByColor.get(color) } : {}),
    });
  });
  // Winners first, then the unranked (a bot the engine never ranked) in seat order.
  return seats.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}

// The transcript ONE seat's row keeps (M3): the room's lines in the order they were
// spoken, cut at the ledger so a row never carries a line that seat was not shown.
// A seat's own lines and every system line survive whatever the pairs say, and
// `null` means the room had no channel or never spoke, which leaves the column null.
export function chatForSeat(
  chat: GameChatPayload | undefined,
  blocks: GameChatBlock[] | undefined,
  seatUserId: string,
): { lines: GameChatLine[]; truncated: boolean } | null {
  const lines = Array.isArray(chat?.lines) ? chat.lines : [];
  if (lines.length === 0) return null;

  // Only a pair that includes this seat cuts anything; a block between two other
  // players is not this reader's business and changes nothing here.
  const cuts = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block && (block.a === seatUserId || block.b === seatUserId))
    .map((block) => ({
      other: block.a === seatUserId ? block.b : block.a,
      atSeq: block.atSeq,
    }));

  const kept = lines.filter((line) => {
    if (!line || typeof line.id !== 'string' || typeof line.seq !== 'number') return false;
    if (!line.senderId || line.senderId === seatUserId) return true;
    return !cuts.some((cut) => cut.other === line.senderId && line.seq >= cut.atSeq);
  });
  return { lines: kept, truncated: chat?.truncated === true };
}

// The two columns a row takes from the room's channel, in one place so both writers
// spell them the same way: `chat` stays absent when the room had no channel or never
// spoke, and `chatTruncated` is only ever true when the engine had to cut the payload.
function chatColumns(
  chat: GameChatPayload | undefined,
  blocks: GameChatBlock[] | undefined,
  seatUserId: string,
): { chat?: GameChatLine[]; chatTruncated: boolean } {
  const projected = chatForSeat(chat, blocks, seatUserId);
  if (!projected) return { chatTruncated: false };
  return { chat: projected.lines, chatTruncated: projected.truncated };
}

// The engine's own view of a room, read straight from `game:<id>` (`state` holds
// the JSON). `null` means the key is genuinely gone or unreadable, which is the
// one case the R21 guard falls through instead of refusing. The reader is the
// third of its kind beside seat-finalization.ts, in the same shape and for the
// same reason: the hash and the state disagree, and the state is the authority
// for what the engine did.
interface EngineRoomState {
  status?: string;
  players?: Array<{ color?: string; status?: string }>;
}

async function readEngineState(redis: Redis, gameId: string): Promise<EngineRoomState | null> {
  const raw = await redis.hget(`game:${gameId}`, 'state');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EngineRoomState;
  } catch {
    return null;
  }
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

    // Idempotency guard: an engine retry after a network blip hits this read and
    // returns early : points are never double-awarded. The guard is a *completed*
    // row, not any row: an abandoned seat's row exists while the room is still being
    // played, and answering "already processed" on it would throw away the real
    // result for the seats that stayed (the case this pass exists to fix).
    // `@@unique([user_id, game_id])` is the half that cannot race : see the P2002
    // catch around the transaction below.
    const completed = await this.prisma.db.matchHistory.findFirst({
      where: { game_id: gameId, status: 'COMPLETED' },
      select: { id: true },
    });
    if (completed) return { message: 'Game already processed', gameId };

    const matchData = await this.redis.hgetall(`match:${gameId}`);

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
              diceRolls: p.diceRolls ?? 0,
              sixes: p.sixes ?? 0,
              clashDefends: p.clashDefends ?? 0,
              clashAttacksWon: p.clashAttacksWon ?? 0,
              clashWallBattlesWon: p.clashWallBattlesWon ?? 0,
              clashWallsAttacked: p.clashWallsAttacked ?? 0,
              clashWallsDefended: p.clashWallsDefended ?? 0,
              participants: snapshot,
              // The seat's own transcript (M3): the room's lines cut at the ledger, so a
              // row never carries a line this player was not shown.
              ...chatColumns(chat, blocks, p.userId),
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

  // One seat left a room before anybody won: write that seat's row and nothing else.
  // Called by the engine at the departure itself (a room above quorum keeps playing
  // without it) and once per human seat by a room that loses quorum. What separates
  // this from /end is the guard: a seat that is still playing cannot be recorded, and
  // a room that never started has nothing to record. The route never deletes
  // `match:${id}`: the room may still be live for the others.
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
            diceRolls: seat.diceRolls ?? 0,
            sixes: seat.sixes ?? 0,
            clashDefends: seat.clashDefends ?? 0,
            clashAttacksWon: seat.clashAttacksWon ?? 0,
            clashWallBattlesWon: seat.clashWallBattlesWon ?? 0,
            clashWallsAttacked: seat.clashWallsAttacked ?? 0,
            clashWallsDefended: seat.clashWallsDefended ?? 0,
            participants: snapshot,
            // What this seat was shown of the room, up to the moment it left (M3).
            ...chatColumns(seat.chat, seat.blocks, userId),
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
