// The four 1970s helmets, each cut into a turning visor and upright pods or
// aerials, plus the seat-to-helmet assignment the board draws.

import type { ColorKey } from '../../../../theme';
import type { HelmetSet, PiecePart } from '../../../../game/pieceTypes';

// The ear pods, part of the silhouette: they must not be squashed with the visor.
const PODS: PiecePart[] = [25.5, 74.5].flatMap((cx): PiecePart[] => [
  { kind: 'circle', cx, cy: 41, r: 9, fill: 'lo', stroke: 'ink', strokeW: 2.8 },
  { kind: 'circle', cx, cy: 41, r: 9, fill: 'none', stroke: 'hi', strokeW: 1.5, opacity: 0.55 },
  { kind: 'circle', cx, cy: 41, r: 3.4, fill: 'pop', stroke: 'deepink', strokeW: 1.4 },
]);
// H1 EAR PODS: the widest silhouette, and the busiest of the four at board size.
const H1: HelmetSet = {
  visor: [
    // The visor is ink with an accent gasket, so it never reads as a face.
    { kind: 'rect', x: 30, y: 27, w: 40, h: 26, rx: 13, fill: 'ink', stroke: 'pop', strokeW: 3.2 },
    {
      kind: 'ellipse',
      cx: 41.2,
      cy: 34.8,
      rx: 5.4,
      ry: 2.6,
      rotate: -16,
      fill: 'white',
      opacity: 0.45,
    },
  ],
  outside: PODS,
};
// H2 INSET FACEPLATE: cream, inset to 28 of the head's 54 units so seat-coloured shell shows at
// both temples.
const H2: HelmetSet = {
  visor: [
    { kind: 'rect', x: 26, y: 30, w: 10, h: 18, rx: 5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
    { kind: 'rect', x: 64, y: 30, w: 10, h: 18, rx: 5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
    {
      kind: 'rect',
      x: 36,
      y: 28.5,
      w: 28,
      h: 29,
      rx: 13.5,
      fill: 'cream',
      stroke: 'ink',
      strokeW: 2.8,
    },
    // A wash of the seat hue keeps the cream plate belonging to its own piece.
    { kind: 'rect', x: 38, y: 30.5, w: 24, h: 25, rx: 12, fill: 'base', opacity: 0.14 },
    {
      kind: 'rect',
      x: 38,
      y: 30.5,
      w: 24,
      h: 25,
      rx: 12,
      fill: 'none',
      stroke: 'deepink',
      strokeW: 1.6,
      opacity: 0.9,
    },
    {
      kind: 'path',
      d: 'M36.5 36.5 Q50 31.5 63.5 36.5',
      fill: 'none',
      stroke: 'deepink',
      strokeW: 2.8,
      linecap: 'round',
    },
    { kind: 'path', d: 'M39 50 Q50 55.5 61 50 L61 54 Q50 58.5 39 54 Z', fill: 'lo', opacity: 0.35 },
    { kind: 'ellipse', cx: 44, cy: 37.5, rx: 5, ry: 2.4, rotate: -16, fill: 'white', opacity: 0.5 },
  ],
  outside: [],
};
// H3's aerial, trimmed to y 7.5 so the figure is no taller than its neighbours'.
const AERIAL: PiecePart[] = [
  { kind: 'line', x1: 50, y1: 15, x2: 50, y2: 8, stroke: 'deepink', strokeW: 5.4 },
  { kind: 'line', x1: 50, y1: 15, x2: 50, y2: 8.6, stroke: 'lit', strokeW: 2.4 },
  { kind: 'circle', cx: 50, cy: 7.6, r: 3.1, fill: 'hi', stroke: 'deepink', strokeW: 1.6 },
];
const H3: HelmetSet = {
  visor: [
    { kind: 'rect', x: 31, y: 39, w: 38, h: 12, rx: 6, fill: 'ink', stroke: 'pop', strokeW: 2.8 },
    {
      kind: 'path',
      d: 'M36 43 H47',
      fill: 'none',
      stroke: 'white',
      strokeW: 2,
      opacity: 0.3,
      linecap: 'round',
    },
  ],
  outside: AERIAL,
};
const H4: HelmetSet = {
  visor: [
    { kind: 'rect', x: 26, y: 27, w: 48, h: 16, rx: 4, fill: 'ink', stroke: 'pop', strokeW: 2.8 },
    { kind: 'ellipse', cx: 37, cy: 33, rx: 5, ry: 1.9, rotate: -8, fill: 'white', opacity: 0.35 },
  ],
  outside: [],
};
// Which design each seat wears. The assignment is the one the wait-room crew, the board and the
// stills all use: red H2 inset cream faceplate, green H3 Mercury slit, yellow H4 Apollo brow, blue
// H1 ear pods — so no two seats on a board share a silhouette, even in greyscale.
export const PIECE_HELMET: Record<ColorKey, HelmetSet> = {
  red: H2,
  green: H3,
  yellow: H4,
  blue: H1,
};
