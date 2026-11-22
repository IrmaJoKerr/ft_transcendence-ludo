import type { CSSProperties } from 'react';
import { PieceFigure } from '../../components/PieceFigure';
import type { PiecePose } from '../pieceParts';
import type { PlayerColor } from '../types';
import { PIECE_W } from './geometry';

// One cast piece, filled by the 70s or 80s art in the same box: 36 units for the pair,
// smaller for each wall rung. `pose` changes only the face plate; the seat and box stay
// fixed across every act.
export function CastPiece({
  x,
  y,
  size = PIECE_W,
  color,
  retro70,
  pose = 'front',
  style,
}: {
  x: number;
  y: number;
  size?: number;
  color: PlayerColor;
  retro70: boolean;
  pose?: PiecePose;
  style?: CSSProperties;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 100})`} style={style}>
      <PieceFigure ck={color} set={retro70 ? 'retro70' : 'retro80'} pose={pose} />
    </g>
  );
}
