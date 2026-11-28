import { cutAtNeck } from '../../../../game/pieceGeometry';
import type { PieceSetDefinition } from '../../../../game/pieceTypes';
import { piecePalette80 } from './palette';
import { PIECE_FACE_80, PIECE_HEAD_80, PIECE_PARTS_80 } from './pieceParts80';

export { piecePalette80 } from './palette';
export { PIECE_FACE_80, PIECE_HEAD_80, PIECE_PARTS_80 } from './pieceParts80';

// The 1980s set as the theme hands it to the renderer: the same 100-unit box, the
// face slice as the turning run, and the garment rung lifted to 30 %.
export const RETRO_80_PIECES: PieceSetDefinition = {
  id: 'retro80',
  layers: (ck) => cutAtNeck(PIECE_PARTS_80[ck], PIECE_HEAD_80[ck], PIECE_FACE_80[ck]),
  palette: piecePalette80,
};
