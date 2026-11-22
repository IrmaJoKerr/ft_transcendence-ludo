// The 1970s figures: each seat's body, globe and helmet flattened into one part
// list, then cut back into the layers a pose draws.

import type { ColorKey } from '../../theme';
import { BODY, PIECE_GLOBE } from './body';
import { PIECE_HELMET } from './helmets';
import type { PiecePart, PieceLayers, PiecePose } from './types';

// A turned visor's horizontal squash, cos 37 degrees.
export const CREW_TURN = { squash: 0.8, slide: 6 } as const;
// Each seat's complete figure, body first: what the board stamps and what the clash
// result draws. The four helmet groups below are laid onto the shared body, so the
// art lives here once and every screen that draws a piece reads it from here.
export const PIECE_PARTS: Record<ColorKey, PiecePart[]> = {
  red: [...BODY, ...PIECE_GLOBE, ...PIECE_HELMET.red.visor, ...PIECE_HELMET.red.outside],
  green: [...BODY, ...PIECE_GLOBE, ...PIECE_HELMET.green.visor, ...PIECE_HELMET.green.outside],
  yellow: [...BODY, ...PIECE_GLOBE, ...PIECE_HELMET.yellow.visor, ...PIECE_HELMET.yellow.outside],
  blue: [...BODY, ...PIECE_GLOBE, ...PIECE_HELMET.blue.visor, ...PIECE_HELMET.blue.outside],
};
// The turn's two numbers: a horizontal squash about the box's centre, and a slide towards the side
// the figure is looking — `CREW_TURN`'s pair, unchanged since the first crew card turned its heads
// with it, and now read only by `poseTurn` below.

// The turn as the one matrix a pose needs: x -> 50 + (x - 50) * squash + dir * slide.
export function poseTurn(pose: PiecePose): string | null {
  const dir = pose === 'left' ? -1 : pose === 'right' ? 1 : 0;
  if (!dir) return null;
  const a = CREW_TURN.squash;
  const e = 50 * (1 - a) + dir * CREW_TURN.slide;
  return `matrix(${a} 0 0 1 ${e} 0)`;
}
// Cut a flat part list into the runs a pose draws: outline, face, outline, body.
export function cutAtNeck(
  parts: PiecePart[],
  headCount: number,
  face: readonly [number, number],
): PieceLayers {
  const [from, to] = face;
  return [
    { parts: parts.slice(0, from), turn: false },
    { parts: parts.slice(from, to), turn: true },
    { parts: parts.slice(to, headCount), turn: false },
    { parts: parts.slice(headCount), turn: false },
  ].filter((run) => run.parts.length > 0);
}
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
