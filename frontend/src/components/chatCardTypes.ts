import type { ReactNode } from 'react';

// The chat card's wire-side types and its one copy of the character cap, in a module of
// their own so `ChatCard.tsx` exports components only (fast refresh) and both hosts can
// import the shape without pulling the card in.

/** The composer's cap, mirroring the engine's `GAME_CHAT_MAX_CHARS` and the lobby's
 *  `CHAT_MAX_CHARS`: UTF-16 units, exactly what the server counts. */
export const CHAT_MAX_CHARS = 300;

/** How long a line is, in the one unit both servers count: UTF-16 code units, so an
 *  ordinary character is 1 and anything above the BMP — every emoji — is 2, which is
 *  what it also costs on the wire. Trimmed first, because both servers trim before
 *  they measure (`room-chat.ts` `raw.trim()`, the lobby's `send` the same), so the
 *  counter never charges for the spaces a send will drop. One function for both
 *  composers and both pre-send guards, so the room's `n / 300`, the lobby's, and the
 *  two refusals cannot drift apart. */
export function chatLength(text: string): number {
  return text.trim().length;
}

/** One line, as both hosts hold it. The lobby's `at` is an ISO string on the wire; a
 *  host normalizes it to ms here so the card has one clock. */
export type ChatCardLine = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  at: number;
  ch?: string;
  /** A line the engine wrote. `text` is empty and `code` is the locale key. */
  kind?: 'system';
  code?: 'left' | 'started';
};

/** What the band under the composer can say. The text is already resolved, so a
 *  channel refusal and a friend action's localized error share one line. */
export type ChatCardStatus = { tone: 'error' | 'info'; text: string };

/** A system line's copy: a code the engine stored, rendered in this reader's locale,
 *  so a transcript written today still reads correctly tomorrow. */
export function systemLineText(
  t: (key: string, options?: Record<string, unknown>) => string,
  line: ChatCardLine,
): string {
  const code = line.code === 'started' ? 'started' : 'left';
  return t(`gameChat.system.${code}`, { name: line.senderName });
}

/** The optional slot the occupancy column mounts into, declared here so the card and
 *  its hosts share one spelling. */
export type ChatCardSideSlot = ReactNode;
