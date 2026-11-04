import type { ChatBlock, ChatLine, GameState, PlayerColor } from './types';

// The room's chat channel (M3), in one module: its keys, its limits, the line
// builders, and the per-seat filter that every reader shares (live emit, join
// replay and the transcript a row stores). Every limit sits at the top of the file
// on purpose — the panel counts against `GAME_CHAT_MAX_CHARS`, the store trims to
// `GAME_CHAT_MAX_LINES`, and the fallback re-post cuts to
// `GAME_CHAT_FALLBACK_LINES` — so raising one is a one-line change in one place.
//
// The key shape mirrors `backend/src/common/channels.ts`: the channel name is
// `game:<id>`, so its log is `chat:game:<id>:log` and its sequence
// `chat:game:<id>:seq`. The engine never publishes chat on pub/sub: the room's own
// socket set is the audience, so the fan-out is the emit that is already there.

/** Lines the room keeps. Past this the oldest are trimmed: a transcript, not an archive. */
export const GAME_CHAT_MAX_LINES = 1000;
/** Characters one line may carry. Counted in UTF-16 units (`.length`), which is
 *  exactly what the composer counts, so the panel and the engine agree to the unit. */
export const GAME_CHAT_MAX_CHARS = 300;
/** Lines the fallback re-post keeps when a body is refused as too large. */
export const GAME_CHAT_FALLBACK_LINES = 400;
/** The transcript outlives a quiet room for a day, the same window the state keeps. */
export const GAME_CHAT_TTL_S = 86400;

/** The channel name: one per room, and the `ch` every line carries. */
export function chatChannel(gameId: string): string {
  return `game:${gameId}`;
}

export function chatLogKey(gameId: string): string {
  return `chat:${chatChannel(gameId)}:log`;
}

export function chatSeqKey(gameId: string): string {
  return `chat:${chatChannel(gameId)}:seq`;
}

// Why a send was refused. The same four codes the lobby answers with, so the panel
// reuses `chat.error.*` copy and one reserved band for both channels.
export type ChatRefusal = 'CHAT_EMPTY' | 'CHAT_TOO_LONG' | 'CHAT_COOLDOWN' | 'CHAT_UNAVAILABLE';

// `chat:send`'s answer. A refusal is a code rather than silence: the composer keeps
// the text and says why, so the sender always knows whether the line went out.
export type ChatAck = { ok: true } | { ok: false; error: ChatRefusal };

// A player's line, built here so the id, the channel and the sequence stamp can
// never disagree: `seq` is allocated by the store's INCR and is the block ledger's
// cut, so it travels in the body as well as in the id.
export function playerLine(
  gameId: string,
  seq: number,
  sender: { id: string; name: string },
  text: string,
  at = Date.now(),
): ChatLine {
  return {
    id: `${chatChannel(gameId)}:${seq}`,
    seq,
    senderId: sender.id,
    senderName: sender.name,
    text,
    at,
    ch: chatChannel(gameId),
  };
}

// A system line: a code, never prose. The seat it is about travels as `senderName`,
// so "X has left" is rendered by whichever locale the reader holds, today or a year
// from now.
export function systemLine(
  gameId: string,
  seq: number,
  code: NonNullable<ChatLine['code']>,
  name: string,
  at = Date.now(),
): ChatLine {
  return {
    id: `${chatChannel(gameId)}:${seq}`,
    seq,
    senderId: '',
    senderName: name,
    text: '',
    at,
    ch: chatChannel(gameId),
    kind: 'system',
    code,
  };
}

// One stored line, or null for a line this build cannot render. The reader is
// defensive because the list is JSON written by whichever build ran before: a line
// with no id or no sequence cannot be keyed or cut, so it is dropped rather than
// painted as a broken row.
export function parseChatLine(raw: string): ChatLine | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const line = parsed as Partial<ChatLine>;
    if (typeof line.id !== 'string' || line.id === '') return null;
    if (typeof line.seq !== 'number' || !Number.isFinite(line.seq)) return null;
    if (typeof line.text !== 'string') return null;
    return {
      id: line.id,
      seq: line.seq,
      senderId: typeof line.senderId === 'string' ? line.senderId : '',
      senderName: typeof line.senderName === 'string' ? line.senderName : '',
      text: line.text,
      at: typeof line.at === 'number' ? line.at : 0,
      ch: typeof line.ch === 'string' ? line.ch : '',
      ...(line.kind === 'system' ? { kind: 'system' as const } : {}),
      ...(line.code === 'left' || line.code === 'started' ? { code: line.code } : {}),
    };
  } catch {
    return null;
  }
}

// The newest `max` lines, still oldest first: what a fallback re-post carries, and
// what a report keeps when it has to shrink.
export function chatForTransport(lines: ChatLine[], max: number): ChatLine[] {
  if (lines.length <= max) return lines;
  return lines.slice(lines.length - max);
}

// The transcript as ONE seat saw it. A line is hidden when a block between that seat
// and the sender was applied at or before the line's own sequence, in either
// direction; a seat never loses its own lines and never loses a system line, which
// carries no speech. Pre-block lines stay: the player who blocked keeps the history
// of what happened, which is the point of stamping the cut instead of deleting.
export function filterChatForSeat(
  lines: ChatLine[],
  blocks: ChatBlock[] | undefined,
  seatUserId: string,
): ChatLine[] {
  if (!seatUserId || !blocks || blocks.length === 0) return lines;
  const cuts = blocks
    .filter((block) => block && (block.a === seatUserId || block.b === seatUserId))
    .map((block) => ({
      other: block.a === seatUserId ? block.b : block.a,
      atSeq: block.atSeq,
    }));
  if (cuts.length === 0) return lines;
  return lines.filter((line) => {
    if (line.senderId === '' || line.senderId === seatUserId) return true;
    return !cuts.some((cut) => cut.other === line.senderId && line.seq >= cut.atSeq);
  });
}

// The room's ledger, normalized: a state written before blocks existed has none, and
// a malformed entry is dropped rather than trusted as a cut.
export function normalizeBlocks(blocks: ChatBlock[] | undefined): ChatBlock[] {
  if (!Array.isArray(blocks)) return [];
  return blocks.filter(
    (block) =>
      !!block &&
      typeof block.a === 'string' &&
      typeof block.b === 'string' &&
      typeof block.atSeq === 'number' &&
      Number.isFinite(block.atSeq),
  );
}

// Add one block to the ledger, replacing any earlier one for the same pair (a
// re-block after an unblock cuts at the newer sequence).
export function withBlock(blocks: ChatBlock[] | undefined, block: ChatBlock): ChatBlock[] {
  const kept = normalizeBlocks(blocks).filter(
    (existing) =>
      !(
        (existing.a === block.a && existing.b === block.b) ||
        (existing.a === block.b && existing.b === block.a)
      ),
  );
  return [...kept, block];
}

// Remove a pair's block: after an unblock the room reads like the lobby again, where
// the filter is the live set and nothing is retroactively hidden.
export function withoutBlock(blocks: ChatBlock[] | undefined, a: string, b: string): ChatBlock[] {
  return normalizeBlocks(blocks).filter(
    (existing) =>
      !((existing.a === a && existing.b === b) || (existing.a === b && existing.b === a)),
  );
}

// The name a system line prints for a seat: what the room shows, falling back to the
// account name and then to the colour.
export function seatDisplayName(state: GameState, color: PlayerColor): string {
  const seat = state.players.find((player) => player.color === color);
  return seat?.displayName?.trim() || seat?.username || color;
}
