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
