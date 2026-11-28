// The paint vocabulary both piece sets share: the fixed creams, the one skin
// tone, the value ladder and the gradient boxes. A theme owns only which rung
// its garment takes; the gradients and the accent rule are common.

import { COL, type ColorKey } from '../theme';
import type { PiecePalette, PieceRole } from './pieceTypes';

// The ink every outline is drawn in: near-black, warmed so it reads on walnut.
const INK = '#0a0716';
// One accent per hue that can never collide with its own body. Cream works for
// three of them; on yellow it is invisible, so yellow gets the violet complement.
// This is the ONLY hue-specific value in the set.
const POP: Record<ColorKey, string> = {
  blue: '#ffb000',
  red: '#f6e7c6',
  green: '#5fb3b0',
  yellow: '#7b4dff',
};
// The palette's fixed creams: the H2 faceplate and the highlight literals.
const CREAM = '#ffe7bd';
const WHITE = '#ffffff';
// The 80s set's one face paint. One tone, no shading wash: at 30 px a second
//  skin tone is 1.6 px of blended mud, and roles-not-colours holds — a face is a
//  face, not a surface, so it sits beside the creams rather than on the ladder.
const SKIN = '#c98a63';

// `t` of the way from `a` to `b`, both `#rrggbb`.
function mix(a: string, b: string, t: number): string {
  const parts = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const [ar, ag, ab] = parts(a);
  const [br, bg, bb] = parts(b);
  return (
    '#' +
    [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('')
  );
}

// The value ladder: `hi`/`lit` lift the seat hue, `shd`/`lo`/`deep` sink it, `deepink`
// is a hue-tinted near-black. `lo` is the one rung a theme moves: 52 % for the 70s,
// 30 for the 80s, because black leather on a synthwave cell is a silhouette at 30 px.
export function paletteLadder(color: ColorKey, lo: number): PiecePalette {
  const base = COL[color].base;
  return {
    base,
    hi: mix(base, WHITE, 0.62),
    lit: mix(base, WHITE, 0.34),
    shd: mix(base, '#000000', 0.22),
    lo: mix(base, '#000000', lo),
    deep: mix(base, '#000000', 0.74),
    deepink: mix(base, INK, 0.86),
    pop: POP[color],
    ink: INK,
    cream: CREAM,
    white: WHITE,
    skin: SKIN,
  };
}

// The two body gradients, as stops the renderer turns into ink: `lid` is linear (torso), `gid`
// radial about 0.33/0.28 at radius 0.9 (helmet globe).
export const PIECE_GRADIENT = {
  lid: { from: 'hi', mid: 'base', to: 'lo', midAt: 0.46 },
  lidCrew: { from: 'lit', mid: 'base', to: 'lo', midAt: 0.55 },
  gid: { from: 'hi', mid: 'base', to: 'lo', midAt: 0.5 },
} as const satisfies Record<
  'lid' | 'lidCrew' | 'gid',
  { from: PieceRole; mid: PieceRole; to: PieceRole; midAt: number }
>;
// Where `gid`'s radial gradient sits: the light comes from upper left.
export const GLOBE_GRADIENT = { cx: 0.33, cy: 0.28, r: 0.9 } as const;
// `lid`'s vector, in bounding-box fractions (the SVG's own `x1/y1/x2/y2`).
export const LID_VECTOR = { x1: 0.12, y1: 0, x2: 0.62, y2: 1 } as const;
// The two bounding boxes the gradients are measured against, in the 100-box. A
// renderer needs them because a canvas gradient is a coordinate, not a fraction:
// 0.12 of `TORSO_BOX`'s width from its left edge is x 37.23.
export const TORSO_BOX = { x: 33.2, y: 66, w: 33.6, h: 24.5 } as const;
export const GLOBE_BOX = { x: 23, y: 9, w: 54, h: 54 } as const;
