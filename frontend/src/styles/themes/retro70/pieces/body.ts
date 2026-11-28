// The body and helmet globe every 1970s bobblehead stands on, in the shared
// 100-unit box, as flat part lists.

import type { PiecePart } from '../../../../game/pieceTypes';

// The one shared body: neck, stub torso with two straps, hanging arms with mitts, two boots, and
// exactly one accent — a thin ring on the chest.
export const BODY: PiecePart[] = [
  {
    kind: 'rect',
    x: 42.5,
    y: 52,
    w: 15,
    h: 18,
    rx: 3.5,
    fill: 'lo',
    stroke: 'deepink',
    strokeW: 2.6,
  },
  {
    kind: 'path',
    d: 'M39 66 Q34.5 69 34 78 L33.2 87 Q33.2 90.5 37 90.5 L63 90.5 Q66.8 90.5 66.8 87 L66 78 Q65.5 69 61 66 Z',
    fill: 'lid',
    stroke: 'ink',
    strokeW: 3,
    linecap: 'round',
  },
  // The 70s suit harness: two thin straps down the chest, dark value on the gradient.
  { kind: 'line', x1: 43.2, y1: 70, x2: 43.2, y2: 88, stroke: 'lo', strokeW: 2.2, opacity: 0.85 },
  { kind: 'line', x1: 56.8, y1: 70, x2: 56.8, y2: 88, stroke: 'lo', strokeW: 2.2, opacity: 0.85 },
  // Arms hang outside the torso, mitts at the bottom: the figure's widest point.
  { kind: 'rect', x: 29, y: 70, w: 9, h: 17, rx: 4.5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
  { kind: 'rect', x: 62, y: 70, w: 9, h: 17, rx: 4.5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
  { kind: 'circle', cx: 33.5, cy: 88, r: 4.7, fill: 'shd', stroke: 'ink', strokeW: 2.4 },
  { kind: 'circle', cx: 66.5, cy: 88, r: 4.7, fill: 'shd', stroke: 'ink', strokeW: 2.4 },
  // Boots, wide enough to read as feet rather than as a stem.
  {
    kind: 'rect',
    x: 36.5,
    y: 88.5,
    w: 9,
    h: 7,
    rx: 2.4,
    fill: 'deep',
    stroke: 'deepink',
    strokeW: 2.2,
  },
  {
    kind: 'rect',
    x: 54.5,
    y: 88.5,
    w: 9,
    h: 7,
    rx: 2.4,
    fill: 'deep',
    stroke: 'deepink',
    strokeW: 2.2,
  },
  { kind: 'circle', cx: 50, cy: 79, r: 4.2, fill: 'none', stroke: 'pop', strokeW: 1.8 },
];

// The helmet globe every design is built on, plus its specular arc.
export const PIECE_GLOBE: PiecePart[] = [
  { kind: 'circle', cx: 50, cy: 36, r: 27, fill: 'gid', stroke: 'ink', strokeW: 3 },
  {
    kind: 'path',
    d: 'M30.02 30.6 A25.92 25.92 0 0 1 48.38 10.62',
    fill: 'none',
    stroke: 'white',
    strokeW: 3.51,
    opacity: 0.55,
    linecap: 'round',
  },
];
