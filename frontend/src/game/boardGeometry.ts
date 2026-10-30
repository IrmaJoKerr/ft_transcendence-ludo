import type { ColorKey } from '../theme';

/**
 * Board geometry: the engine's logical steps (0-57) mapped onto the 15×15 cross
 * board. Pure data and pure functions, so both the board's renderer and anything
 * that needs to point at a square (the capture burst's anchor) share ONE mapping.
 * The board has exact 4-fold symmetry, so one red segment is rotated four times.
 */
export type Cell = { r: number; c: number };

const RED_SEGMENT: Cell[] = [
  { r: 6, c: 1 },
  { r: 6, c: 2 },
  { r: 6, c: 3 },
  { r: 6, c: 4 },
  { r: 6, c: 5 },
  { r: 5, c: 6 },
  { r: 4, c: 6 },
  { r: 3, c: 6 },
  { r: 2, c: 6 },
  { r: 1, c: 6 },
  { r: 0, c: 6 },
  { r: 0, c: 7 },
  { r: 0, c: 8 },
];

/** 90° clockwise rotation about the 15×15 grid's center (7,7). */
function rotate90({ r, c }: Cell): Cell {
  return { r: c, c: 14 - r };
}

function rotateN(cell: Cell, n: number): Cell {
  let out = cell;
  for (let i = 0; i < n; i++) out = rotate90(out);
  return out;
}

/** The full 52-cell shared outer loop, track position 1-52 → board cell. */
export const TRACK_CELLS: Cell[] = [0, 1, 2, 3].flatMap((rot) =>
  RED_SEGMENT.map((cell) => rotateN(cell, rot)),
);

const RED_HOME_LANE: Cell[] = [
  { r: 7, c: 1 },
  { r: 7, c: 2 },
  { r: 7, c: 3 },
  { r: 7, c: 4 },
  { r: 7, c: 5 },
];

const HOME_LANES: Record<ColorKey, Cell[]> = {
  red: RED_HOME_LANE,
  green: RED_HOME_LANE.map((cell) => rotateN(cell, 1)),
  yellow: RED_HOME_LANE.map((cell) => rotateN(cell, 2)),
  blue: RED_HOME_LANE.map((cell) => rotateN(cell, 3)),
};

const TRACK_OFFSET: Record<ColorKey, number> = { red: 0, green: 13, yellow: 26, blue: 39 };

/** Map a piece's logical step (1-57) to a board cell, or null if not on the board (base/goal). */
export function stepToCell(color: ColorKey, step: number): Cell | null {
  if (step >= 52 && step <= 56) return HOME_LANES[color][step - 52];
  if (step >= 1 && step <= 51) {
    const trackPos = ((step + TRACK_OFFSET[color] - 1) % 52) + 1;
    return TRACK_CELLS[trackPos - 1];
  }
  return null;
}

/**
 * The invader glyph each seat's pieces are drawn with, in an 11×8 pixel grid. Lives
 * here rather than in `components/Board.tsx` so the board's `Sphere` and the clash
 * result's "trussed piece" share ONE piece: a result FX that invented its own token
 * would be a second, subtly different piece on the same screen.
 */
export const PIECE_GLYPH: Record<ColorKey, string> = {
  yellow: `
    M2,0 h1 v1 h-1 z  M8,0 h1 v1 h-1 z
    M3,1 h1 v1 h-1 z  M7,1 h1 v1 h-1 z
    M2,2 h7 v1 h-7 z
    M1,3 h2 v1 h-2 z  M4,3 h3 v1 h-3 z  M8,3 h2 v1 h-2 z
    M0,4 h11 v1 h-11 z
    M0,5 h1 v1 h-1 z  M2,5 h7 v1 h-7 z  M10,5 h1 v1 h-1 z
    M0,6 h1 v1 h-1 z  M2,6 h1 v1 h-1 z  M8,6 h1 v1 h-1 z  M10,6 h1 v1 h-1 z
    M3,7 h2 v1 h-2 z  M6,7 h2 v1 h-2 z
  `,
  red: `
    M0,0 h1 v2 h-1 z  M10,0 h1 v2 h-1 z
    M2,1 h7 v1 h-7 z
    M1,2 h2 v1 h-2 z  M4,2 h3 v1 h-3 z  M8,2 h2 v1 h-2 z
    M0,3 h11 v1 h-11 z
    M0,4 h1 v1 h-1 z  M2,4 h7 v1 h-7 z  M10,4 h1 v1 h-1 z
    M0,5 h1 v1 h-1 z  M2,5 h1 v1 h-1 z  M8,5 h1 v1 h-1 z  M10,5 h1 v1 h-1 z
    M3,6 h2 v1 h-2 z  M6,6 h2 v1 h-2 z
    M2,7 h1 v1 h-1 z  M8,7 h1 v1 h-1 z
  `,
  green: `
    M4,0 h3 v1 h-3 z
    M3,1 h5 v1 h-5 z
    M2,2 h7 v1 h-7 z
    M1,3 h2 v1 h-2 z  M4,3 h3 v1 h-3 z  M8,3 h2 v1 h-2 z
    M0,4 h11 v1 h-11 z
    M1,5 h1 v1 h-1 z  M3,5 h5 v1 h-5 z  M9,5 h1 v1 h-1 z
    M0,6 h1 v1 h-1 z  M10,6 h1 v1 h-1 z
    M1,7 h1 v1 h-1 z  M9,7 h1 v1 h-1 z
  `,
  blue: `
    M3,0 h5 v1 h-5 z
    M1,1 h9 v1 h-9 z
    M0,2 h11 v1 h-11 z
    M0,3 h2 v1 h-2 z  M4,3 h3 v1 h-3 z  M9,3 h2 v1 h-2 z
    M0,4 h11 v1 h-11 z
    M2,5 h2 v1 h-2 z  M7,5 h2 v1 h-2 z
    M1,6 h1 v1 h-1 z  M4,6 h1 v1 h-1 z  M6,6 h1 v1 h-1 z  M9,6 h1 v1 h-1 z
    M0,7 h1 v1 h-1 z  M10,7 h1 v1 h-1 z
  `,
};

