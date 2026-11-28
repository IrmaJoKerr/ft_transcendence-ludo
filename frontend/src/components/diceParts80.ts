import type { DicePaint, DicePart } from './diceParts70';
import { diceCell } from './diceParts70';

// The 1980s die face: a dark core inside an LED ring, drawn in the 70s module's 100-unit box and
// painted in the same little language (`DicePart` / `DicePaint`, both imported from
// `diceParts70.ts`).

// The six satellites of a rosette, in units from its centre: every 60°, clockwise.
const ROSETTE_ORBIT = 5.4;
const ROSETTE_SATELLITES = [0, 60, 120, 180, 240, 300].map((deg) => {
  const rad = (deg * Math.PI) / 180;
  return { dx: Math.cos(rad) * ROSETTE_ORBIT, dy: Math.sin(rad) * ROSETTE_ORBIT };
});

// One pip as the era draws it: a small cluster of seven lit discs, ringed by its socket.
function rosettePip(cx: number, cy: number, paint: DicePaint): DicePart[] {
  const discs: DicePart[] = ROSETTE_SATELLITES.map(({ dx, dy }) => ({
    kind: 'circle' as const,
    cx: cx + dx,
    cy: cy + dy,
    r: 2.7,
    fill: paint,
  }));
  return [
    // The socket: a faint ring that separates the cluster from the core behind it.
    { kind: 'circle', cx, cy, r: 9.4, fill: 'none', stroke: 'edge', strokeW: 1, opacity: 0.35 },
    { kind: 'circle', cx, cy, r: 3.6, fill: paint },
    ...discs,
  ];
}

// The 80s face: the recessed core, the LED strip around the face's edge in two passes — every
// segment unlit, then the lit ones dashed over them, so the strip reads as a band with gaps rather
// than as a dotted circle — and one rosette per lit cell.
export function diceFace80(value: number, cells: readonly number[]): DicePart[] {
  const paint: DicePaint = value === 4 || value === 6 ? 'pipAlt' : 'pip';
  return [
    // The core is pressed into the face: a dark panel, its rim in the era's edge colour.
    { kind: 'rect', x: 4, y: 4, w: 92, h: 92, r: 12, fill: 'pipShade', opacity: 0.25 },
    {
      kind: 'rect',
      x: 4,
      y: 4,
      w: 92,
      h: 92,
      r: 12,
      fill: 'none',
      stroke: 'edge',
      strokeW: 1.2,
      opacity: 0.6,
    },
    // The LED strip. The unlit pass first: the strip is there whether or not it is burning.
    {
      kind: 'circle',
      cx: 50,
      cy: 50,
      r: 45,
      fill: 'none',
      stroke: 'hi',
      strokeW: 2,
      opacity: 0.16,
    },
    {
      kind: 'circle',
      cx: 50,
      cy: 50,
      r: 45,
      fill: 'none',
      stroke: 'hi',
      strokeW: 2,
      opacity: 0.9,
      dash: '7 5',
    },
    ...cells.flatMap((index) => {
      const { cx, cy } = diceCell(index);
      return rosettePip(cx, cy, paint);
    }),
  ];
}
