import type { PieceSetDefinition } from '../../../../game/pieceTypes';
import { piecePalette } from './palette';
import { PIECE_LAYERS } from './pieceParts70';

export {
  GLOBE_BOX,
  GLOBE_GRADIENT,
  LID_VECTOR,
  PIECE_GRADIENT,
  TORSO_BOX,
} from '../../../../game/piecePaint';
export { PIECE_GLOBE } from './body';
export { PIECE_HELMET } from './helmets';
export { piecePalette } from './palette';
export { PIECE_LAYERS, PIECE_PARTS } from './pieceParts70';
export { CREW_TURN, cutAtNeck, poseTurn } from '../../../../game/pieceGeometry';
export type {
  HelmetSet,
  PieceLayer,
  PieceLayers,
  PiecePalette,
  PiecePart,
  PiecePose,
  PieceRole,
  PieceSet,
  PieceSetDefinition,
} from '../../../../game/pieceTypes';

// The 1970s set as the theme hands it to the renderer: one figure per seat, the
// helmet's visor as the only turning run, and the shared ladder at its 52 % rung.
export const RETRO_70_PIECES: PieceSetDefinition = {
  id: 'retro70',
  layers: (ck) => PIECE_LAYERS[ck],
  palette: piecePalette,
};
