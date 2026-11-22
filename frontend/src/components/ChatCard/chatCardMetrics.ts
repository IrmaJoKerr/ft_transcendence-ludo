// The card's budget, one home for both hosts (19.3): 480 wide, 16 off the window's edges.
export const CHAT_CARD_WIDTH = 480;
export const CHAT_CARD_MIN_HEIGHT = 420;
export const CHAT_CARD_VH = 0.6;
export const CHAT_CARD_MAX_HEIGHT = 720;
export const CHAT_CARD_MARGIN = 16;

export function chatCardHeight(viewportHeight = window.innerHeight): number {
  return Math.round(
    Math.min(CHAT_CARD_MAX_HEIGHT, Math.max(CHAT_CARD_MIN_HEIGHT, viewportHeight * CHAT_CARD_VH)),
  );
}

// The composer's ceiling once it starts growing: six rows at the card's line (20 px
// of line plus 6 + 6 of padding), about 140 px, after which the box keeps its own
// scrollbar. One row to start. This keeps three preview lines in the collapsed slot.
export const COMPOSER_MAX_HEIGHT = 140;
export const PREVIEW_LINES = 3;
export const PANEL_WIDTH = 240;
export const PANEL_GAP = 8;

// The glyph the room puts in the card's head: the INVITE COMMS panel's switch.
export const INVITE_GLYPH = '👥';
