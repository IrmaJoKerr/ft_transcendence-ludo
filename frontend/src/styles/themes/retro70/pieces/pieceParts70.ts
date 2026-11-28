// The 1970s figures: each seat's body, globe and helmet flattened into one part
// list, then cut back into the layers a pose draws.

import type { ColorKey } from '../../../../theme';
import { BODY, PIECE_GLOBE } from './body';
import { PIECE_HELMET } from './helmets';
import type { PiecePart, PieceLayers } from '../../../../game/pieceTypes';

// Each seat's complete figure, body first: what the board stamps and what the clash
// result draws. The four helmet groups below are laid onto the shared body, so the
// art lives here once and every screen that draws a piece reads it from here.
export const PIECE_PARTS: Record<ColorKey, PiecePart[]> = {
  red: [...BODY, ...PIECE_GLOBE, ...PIECE_HELMET.red.visor, ...PIECE_HELMET.red.outside],
  green: [...BODY, ...PIECE_GLOBE, ...PIECE_HELMET.green.visor, ...PIECE_HELMET.green.outside],
  yellow: [...BODY, ...PIECE_GLOBE, ...PIECE_HELMET.yellow.visor, ...PIECE_HELMET.yellow.outside],
  blue: [...BODY, ...PIECE_GLOBE, ...PIECE_HELMET.blue.visor, ...PIECE_HELMET.blue.outside],
};
// The 70s figure cut at the neck: the helmet's `visor` group is the only turning part,
// and the outside pieces are drawn after it in the flat table's order.
function layers70(ck: ColorKey): PieceLayers {
  const all = PIECE_PARTS[ck];
  const { visor, outside } = PIECE_HELMET[ck];
  return [
    { parts: all.slice(0, all.length - visor.length - outside.length), turn: false },
    { parts: visor, turn: true },
    { parts: outside, turn: false },
  ];
}
// The 70s layers, one seat each, resolved once at module load.
export const PIECE_LAYERS: Record<ColorKey, PieceLayers> = {
  red: layers70('red'),
  green: layers70('green'),
  yellow: layers70('yellow'),
  blue: layers70('blue'),
};
