// The 1970s palette: the shared ladder at its own garment rung.

import { paletteLadder } from '../../../../game/piecePaint';
import type { ColorKey } from '../../../../theme';
import type { PiecePalette } from '../../../../game/pieceTypes';

export function piecePalette(color: ColorKey): PiecePalette {
  return paletteLadder(color, 0.52);
}
