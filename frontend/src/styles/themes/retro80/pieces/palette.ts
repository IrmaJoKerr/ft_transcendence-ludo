// The 1980s palette: the same ladder, with black leather lifted off the board.

import { paletteLadder } from '../../../../game/piecePaint';
import type { ColorKey } from '../../../../theme';
import type { PiecePalette } from '../../../../game/pieceTypes';

export function piecePalette80(color: ColorKey): PiecePalette {
  return paletteLadder(color, 0.3);
}
