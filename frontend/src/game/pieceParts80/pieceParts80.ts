import type { ColorKey } from '../../theme';
import type { PiecePart } from '../pieceParts';
import { BIKER } from './biker';
import { CYBORG } from './cyborg';
import { NETRUNNER } from './netrunner';
import { PUNK } from './punk';

// The 1980s piece set: one figure per seat, drawn in a 100x100 box, traced from the supplied sheet
// (`spritesheet-80's.jpg`) and painted in the language of the 1970s set in `pieceParts.ts` — roles
// from that seat's value ladder, `pop` for the one accent, real strokes, no pixel snapping.

// How many of each figure's parts sit above the neck, which is how a pose finds the head:
// `parts80.py` authors every figure head-first and body-after with `HEAD_END` between them, and
// `bobble()` keeps that order, so the seam is a count.
export const PIECE_HEAD_80: Record<ColorKey, number> = {
  red: 12,
  blue: 13,
  green: 11,
  yellow: 6,
};

// The slice of each head a pose turns: `[from, to)`, counted from the top of the figure.
// Everything outside it - the jaw, the ears, the pods, the chin bar - is outline and stays where
// it was drawn, which is what keeps the head on its collar when it looks left.
export const PIECE_FACE_80: Record<ColorKey, readonly [number, number]> = {
  red: [4, 12],
  blue: [2, 5],
  green: [4, 6],
  yellow: [1, 4],
};

// One figure per seat, in the same 100-unit box as `PIECE_PARTS`.
export const PIECE_PARTS_80: Record<ColorKey, PiecePart[]> = {
  red: PUNK,
  blue: CYBORG,
  green: NETRUNNER,
  yellow: BIKER,
};
