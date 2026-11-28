// The 1970s die face: one molded plastic body with a recessed well, drawn in the same 100-unit box
// the piece sets use (`styles/themes/retro70/pieces/`), so a number read off a still ports without
// arithmetic.

// A paint slot: one of the die's tokens by role, or `none` for a stroke-only shape.
export type DicePaint = 'hi' | 'edge' | 'pip' | 'pipShade' | 'pipAlt' | 'none';

// One shape of the face. Two kinds are enough for both eras — discs and rounded
// rectangles — and the flat list is painted in array order, so a part later in the list
// covers the one before it.
export type DicePart =
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      fill?: DicePaint;
      stroke?: DicePaint;
      strokeW?: number;
      // 0..1; the recesses and the molded highlights are all drawn faint.
      opacity?: number;
      // A dashed stroke, in units: the 80s LED ring is segments rather than a line.
      dash?: string;
    }
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      // Corner radius.
      r: number;
      fill?: DicePaint;
      stroke?: DicePaint;
      strokeW?: number;
      opacity?: number;
    };

// The nine pip cells of the face's 3x3 grid, as the centres of the 100 box, 22.5 units apart and
// centred on 50.
export const DICE_CELLS = [27.5, 50, 72.5] as const;

// The centre of the cell a `PIP_MAP` index names, row-major.
export function diceCell(index: number): { cx: number; cy: number } {
  return {
    cx: DICE_CELLS[index % 3],
    cy: DICE_CELLS[Math.floor(index / 3)],
  };
}

// One molded pip: an ink rim, the body, and the sheen the molding catches.
function moldedPip(cx: number, cy: number, paint: DicePaint): DicePart[] {
  return [
    {
      kind: 'circle',
      cx,
      cy,
      r: 9.4,
      fill: 'none',
      stroke: 'pipShade',
      strokeW: 2.4,
      opacity: 0.85,
    },
    { kind: 'circle', cx, cy, r: 7.8, fill: paint },
    { kind: 'circle', cx: cx - 2.1, cy: cy - 2.1, r: 2.2, fill: 'hi', opacity: 0.45 },
  ];
}

// The 70s face: a cream body with a molded bevel, a well sunk into it, and one pip per lit cell.
// Faces 4 and 6 take the era's teal instead of its ink — the one place a die of this period is
// ever two-coloured, and the reason `--dice-pip-alt` exists.
export function diceFace70(value: number, cells: readonly number[]): DicePart[] {
  const paint: DicePaint = value === 4 || value === 6 ? 'pipAlt' : 'pip';
  return [
    // The bevel: a highlight just inside the face's own border, which is what makes a flat
    // gradient read as a molded edge rather than as a card.
    {
      kind: 'rect',
      x: 3,
      y: 3,
      w: 94,
      h: 94,
      r: 13,
      fill: 'none',
      stroke: 'hi',
      strokeW: 2.5,
      opacity: 0.7,
    },
    // The well: a faint darker disc with its own ink rim, so the pips sit in something
    // instead of on a slab. Its radius is the pips' cluster plus a margin, and it is the
    // largest disc a 3x3 face can carry without the rim crossing a corner pip.
    { kind: 'circle', cx: 50, cy: 50, r: 43, fill: 'pipShade', opacity: 0.08 },
    {
      kind: 'circle',
      cx: 50,
      cy: 50,
      r: 43,
      fill: 'none',
      stroke: 'pipShade',
      strokeW: 2.5,
      opacity: 0.3,
    },
    ...cells.flatMap((index) => {
      const { cx, cy } = diceCell(index);
      return moldedPip(cx, cy, paint);
    }),
  ];
}
