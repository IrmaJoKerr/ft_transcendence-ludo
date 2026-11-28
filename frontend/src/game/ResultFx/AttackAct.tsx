import type { CSSProperties } from 'react';
import type { PieceSetDefinition } from '../pieceTypes';
import type { PlayerColor } from '../types';
import { CastPiece } from './CastPiece';
import {
  DOME_RADII,
  DOME_STROKES,
  GLYPH_Y,
  GROUND_Y,
  WALL_ATTACKER_X,
  shieldCurve,
} from './geometry';

export function AttackAct({
  wallGate,
  domeBeat,
  wallFloorX1,
  wallFloorX2,
  wallBoxes,
  wallLayers,
  defender,
  defenderColor,
  attacker,
  attackerWon,
  pieces,
  wallFx,
  pivot,
}: {
  wallGate: CSSProperties;
  domeBeat: CSSProperties;
  wallFloorX1: number;
  wallFloorX2: number;
  wallBoxes: { x: number; y: number; size: number }[];
  wallLayers: number;
  defender: PlayerColor;
  defenderColor: string;
  attacker: PlayerColor;
  attackerWon: boolean;
  pieces: PieceSetDefinition;
  wallFx: (name: string) => string;
  pivot: CSSProperties;
}) {
  return (
    <g style={wallGate}>
      {/* the floor the wall stands on */}
      <line
        x1={wallFloorX1}
        y1={GROUND_Y}
        x2={wallFloorX2}
        y2={GROUND_Y}
        stroke={defenderColor}
        strokeOpacity=".22"
        strokeWidth="2"
      />

      {/* the defenders: `n` glyphs on the cast's own diagonal, the front-most — lowest
              and right-most, nearest the attacker — first, each further one up, left and
              smaller, overlapping the one in front (25.3 rule 1). The struck defender fades
              as its line goes: one defender, one line, always together (rule 4). Every one
              of them looks right, at the attacker, because that is the seat the shot comes
              from and a wall faces the thing that hit it. */}
      {wallBoxes.map(({ x, y, size }, i) => (
        <CastPiece
          key={`defender-${i}`}
          x={x}
          y={y}
          size={size}
          color={defender}
          pieces={pieces}
          pose="right"
          style={attackerWon && i === 0 ? { animation: wallFx('fxDefenderFade') } : undefined}
        />
      ))}

      {/* the dome: `n` of the four frozen rings, the innermost `n`, so the one fitted
              to the ink is always drawn and the shield hugs the group it protects. The
              strokes run the other way from the old curves, 2.2 inside to 3.2 out, so the
              outermost ring — both the face the shot meets and the line that glitches out
              when a defender is taken (rules 3 and 4) — is the heaviest of them. All of them
              paint in front of the glyphs, because an enclosing curve never crosses one; the
              count reads twice: `n` glyphs and `n` rings. The group carries the beat: the
              whole dome takes the blow and settles, because the blow is the shield's, and the
              face's own glitch (a transform on the path) travels with it (32.4). */}
      <g style={domeBeat}>
        {DOME_RADII.slice(0, wallLayers).map((r, i) => {
          const isFace = i === wallLayers - 1;
          return (
            <path
              key={`dome-${i}`}
              d={shieldCurve(r)}
              fill="none"
              stroke={defenderColor}
              strokeOpacity={isFace ? 1 : 0.55}
              strokeWidth={DOME_STROKES[i]}
              style={
                isFace && attackerWon
                  ? ({
                      ...pivot,
                      '--g1': '5px',
                      '--g2': '-6px',
                      animation: wallFx('fxLayerOut'),
                    } as CSSProperties)
                  : undefined
              }
            />
          );
        })}
      </g>

      {/* the attacker, in frame, on the ground and outside the dome: the reflected
              shot has to have somebody visible to strike (rule 6). */}
      <CastPiece x={WALL_ATTACKER_X} y={GLYPH_Y} color={attacker} pieces={pieces} pose="left" />
    </g>
  );
}
