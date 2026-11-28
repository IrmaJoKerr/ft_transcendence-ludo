// Pure postgame readers and row shapes shared by the completed-match writer and the
// one-seat abandonment writer. No connection or Nest dependency lives here.

import type Redis from 'ioredis';

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
  // Semantic seat name (`RED`..`BLUE`), stamped by the projection; the frontend resolves
  // it through the live palette. Absent on a system line, an unmapped sender or a legacy row.
  senderColor?: string;
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
export const HISTORY_TRIM = 50;

// Seat order the room hash is written in: slot N is `player<N>_*`, and its
// colour is `player<N>_color` (a hotseat room may skip a colour, so the default
// is only a fallback).
export const SLOT_COLORS = ['blue', 'red', 'green', 'yellow'];

// Bot colours come only from `player<N>_isBot`, never from an id. A missing hash flags
// nobody, and the account check in `processGameEnd` still keeps seats without a User
// row out of the transaction.
export function botSeatColors(matchData: Record<string, string>): Set<string> {
  const bots = new Set<string>();
  SLOT_COLORS.forEach((fallback, index) => {
    const slot = index + 1;
    if (matchData[`player${slot}_isBot`] !== 'true') return;
    bots.add((matchData[`player${slot}_color`] || fallback).toLowerCase());
  });
  return bots;
}

// The seat colour for each user id in the room hash, keyed for the transcript's
// `senderId`. The hash stores `player<N>_id` and `player<N>_color` side by side, and
// the colour is uppercased to the semantic name the profile stores. An empty slot has
// no id and is skipped; a slot with an id but no colour takes its positional fallback,
// exactly as the participant snapshot does. Bots are harmless here: they have no chat
// lines, so no stamp is ever read for them.
export function seatColorsByUserId(matchData: Record<string, string>): Map<string, string> {
  const colors = new Map<string, string>();
  SLOT_COLORS.forEach((fallback, index) => {
    const slot = index + 1;
    const userId = matchData[`player${slot}_id`];
    if (!userId) return;
    colors.set(userId, (matchData[`player${slot}_color`] || fallback).toUpperCase());
  });
  return colors;
}

// Prisma raises P2002 for a unique index. Checked structurally so this file needs
// no import of the generated runtime just to name one error.
export function isUniqueViolation(err: unknown): boolean {
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
export function seatSnapshot(
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
  seatColors: Map<string, string>,
): { lines: GameChatLine[]; truncated: boolean } | null {
  const lines = Array.isArray(chat?.lines) ? chat.lines : [];
  if (lines.length === 0) return null;

  // Only a pair that includes this seat cuts anything; a block between two other
  // players is not this reader's business and changes nothing here.
  const cuts = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block.a === seatUserId || block.b === seatUserId)
    .map((block) => ({
      other: block.a === seatUserId ? block.b : block.a,
      atSeq: block.atSeq,
    }));

  const kept = lines
    .filter((line) => {
      if (typeof line.id !== 'string' || typeof line.seq !== 'number') return false;
      if (!line.senderId || line.senderId === seatUserId) return true;
      return !cuts.some((cut) => cut.other === line.senderId && line.seq >= cut.atSeq);
    })
    // Clone before stamping: the payload belongs to the caller and one projection must
    // not colour the next seat's copy. A system line and an unmapped sender stay exactly
    // as the room stored them, which is also the fallback an old row relies on.
    .map((line) => {
      if (!line.senderId || line.kind === 'system') return line;
      const senderColor = seatColors.get(line.senderId);
      return senderColor ? { ...line, senderColor } : line;
    });
  return { lines: kept, truncated: chat?.truncated === true };
}

// The two columns a row takes from the room's channel, in one place so both writers
// spell them the same way: `chat` stays absent when the room had no channel or never
// spoke, and `chatTruncated` is only ever true when the engine had to cut the payload.
export function chatColumns(
  chat: GameChatPayload | undefined,
  blocks: GameChatBlock[] | undefined,
  seatUserId: string,
  seatColors: Map<string, string>,
): { chat?: GameChatLine[]; chatTruncated: boolean } {
  const projected = chatForSeat(chat, blocks, seatUserId, seatColors);
  if (!projected) return { chatTruncated: false };
  return { chat: projected.lines, chatTruncated: projected.truncated };
}

// The engine's own view of a room, read straight from `game:<id>` (`state` holds
// the JSON). `null` means the key is genuinely gone or unreadable, which is the
// one case the R21 guard falls through instead of refusing. The reader is the
// third of its kind beside seat-finalization.ts, in the same shape and for the
// same reason: the hash and the state disagree, and the state is the authority
// for what the engine did.
export interface EngineRoomState {
  status?: string;
  players?: Array<{ color?: string; status?: string }>;
}

export async function readEngineState(
  redis: Redis,
  gameId: string,
): Promise<EngineRoomState | null> {
  const raw = await redis.hget(`game:${gameId}`, 'state');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EngineRoomState;
  } catch {
    return null;
  }
}
