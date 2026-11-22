import type { ReactNode } from 'react';

// Chat card wire types, kept separate so `ChatCard.tsx` exports only components for fast
// refresh. The character cap and `chatLength` live in `common/src/chat.constants.ts`;
// this tree compiles the generated `__shared__` copy.

// One line, as both hosts hold it. The lobby's `at` is an ISO string on the wire; a
//  host normalizes it to ms here so the card has one clock.
export type ChatCardLine = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  at: number;
  ch?: string;
    // A line the engine wrote. `text` is empty and `code` is the locale key.
  kind?: 'system';
  code?: 'left' | 'started';
};

// What the band under the composer can say. The text is already resolved, so a
//  channel refusal and a friend action's localized error share one line.
export type ChatCardStatus = { tone: 'error' | 'info'; text: string };

// The card head's switch: a glyph that opens a host's panel (the room's INVITE
//  COMMS). Declared here so the head and the hosts that pass it share one spelling;
//  `pressed` is the panel's state, which the press toggles.
export type ChatHeadGlyph = {
  glyph: string;
    // The tooltip and the visible caption under the glyph. A panel's name, never its
  //  state, because `aria-pressed` already carries that.
  label: string;
  pressed: boolean;
  onPress: () => void;
};

// A system line's copy: a code the engine stored, rendered in this reader's locale,
//  so a transcript written today still reads correctly tomorrow.
export function systemLineText(
  t: (key: string, options?: Record<string, unknown>) => string,
  line: ChatCardLine,
): string {
  const code = line.code === 'started' ? 'started' : 'left';
  return t(`gameChat.system.${code}`, { name: line.senderName });
}

// The optional slot the occupancy column mounts into, declared here so the card and
//  its hosts share one spelling.
export type ChatCardSideSlot = ReactNode;
