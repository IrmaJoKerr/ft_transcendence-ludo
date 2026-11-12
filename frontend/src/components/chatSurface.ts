import type { CSSProperties } from 'react';

// The chat card's shell, one home for the three surfaces that draw it (24.1): the
// room's overlay, the lobby's copy of the same card and the waiting room's INVITE
// COMMS panel, which sat 8 px beside the card on the board windows' chrome until 24
// and read as another family.
//
// It is a module of its own and not a constant beside `CHAT_CARD_WIDTH` for the reason
// `chatCardTypes.ts` is a module of its own: `ChatCard.tsx` exports components, and
// `react/only-export-components` (`allowConstantExport`) accepts a number there but not
// an object literal — a shell is not a "constant export" to fast refresh. So the sizes
// stay with the card and this file holds the recipe.
//
// The recipe is the account popover's rather than `--bg-card`, and that is not a
// preference: none of the three has a scrim behind it, so 85% opaque over a lit lobby
// pass is mush. A cyan 1px edge with an outside glow is what reads as a surface there.
// It stays literals rather than becoming a token because it is one surface's answer to
// one position, and a token with one consumer would hide that answer.
//
// Layout is the consumer's: each surface keeps its own `position`, `left`, `top`,
// `width`, `height`, `zIndex` and flex keys.
export const CHAT_SURFACE: CSSProperties = {
  background: 'linear-gradient(180deg, rgba(20, 6, 46, 0.97), rgba(10, 2, 28, 0.985))',
  backdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid rgba(0, 240, 255, 0.45)',
  boxShadow: '0 24px 60px rgb(var(--shade-rgb) / 0.85), 0 0 24px rgba(0, 240, 255, 0.22)',
  borderRadius: 10,
  padding: 14,
  gap: 10,
  boxSizing: 'border-box',
};
