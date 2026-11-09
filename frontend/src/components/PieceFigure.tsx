import type { CSSProperties } from 'react';
import type { ColorKey } from '../theme';
import {
  GLOBE_GRADIENT,
  LID_VECTOR,
  PIECE_GRADIENT,
  PIECE_PARTS,
  piecePalette,
  type PiecePalette,
  type PiecePart,
  type PieceRole,
} from '../game/pieceParts';

/**
 * The 1970s piece, drawn as SVG from `game/pieceParts.ts`.
 *
 * One component for both places a piece stands on a game screen: the board's
 * `Sphere` and the clash result's cast. A result FX that drew its own token would be
 * a second, subtly different piece on the same screen — the same argument
 * `boardGeometry.PIECE_GLYPH` makes for the invader, kept for the bobblehead.
 *
 * It renders bare `<g>` content (no `<svg>`), so the caller owns the frame: the
 * board gives it a 100-unit `viewBox` and a drop shadow, the clash result places it
 * in its own coordinate system with a transform.
 */

/** The two body gradients, scoped to one seat so two seats can share a document. */
function Gradients({ ck }: { ck: ColorKey }) {
  const pal = piecePalette(ck);
  const stops = (key: 'lid' | 'gid') => {
    const spec = PIECE_GRADIENT[key];
    return [
      <stop key='0' offset={0} stopColor={pal[spec.from]} />,
      <stop key='1' offset={spec.midAt} stopColor={pal[spec.mid]} />,
      <stop key='2' offset={1} stopColor={pal[spec.to]} />,
    ];
  };
  return (
    <defs>
      <linearGradient
        id={`piece-lid-${ck}`}
        x1={LID_VECTOR.x1}
        y1={LID_VECTOR.y1}
        x2={LID_VECTOR.x2}
        y2={LID_VECTOR.y2}
      >
        {stops('lid')}
      </linearGradient>
      <radialGradient
        id={`piece-gid-${ck}`}
        cx={GLOBE_GRADIENT.cx}
        cy={GLOBE_GRADIENT.cy}
        r={GLOBE_GRADIENT.r}
      >
        {stops('gid')}
      </radialGradient>
    </defs>
  );
}

function paint(role: PieceRole | 'none' | undefined, pal: PiecePalette, ck: ColorKey): string {
  if (!role || role === 'none') return 'none';
  if (role === 'lid' || role === 'lidCrew') return `url(#piece-lid-${ck})`;
  if (role === 'gid') return `url(#piece-gid-${ck})`;
  return pal[role];
}

function Part({ part, ck }: { part: PiecePart; ck: ColorKey }) {
  const pal = piecePalette(ck);
  const fill = paint(part.kind === 'line' ? 'none' : part.fill, pal, ck);
  const stroke = paint(part.stroke, pal, ck);
  const common = {
    fill,
    stroke,
    strokeWidth: part.stroke ? (part.strokeW ?? 1) : undefined,
    strokeOpacity: part.stroke ? (part.opacity ?? 1) : undefined,
    fillOpacity:
      part.kind !== 'line' && part.fill !== 'none' && part.opacity !== undefined
        ? part.opacity
        : undefined,
    strokeLinejoin: 'round' as const,
    strokeLinecap: (part.kind === 'line' || part.kind === 'path'
      ? (part.linecap ?? 'butt')
      : 'butt') as 'butt' | 'round',
  };

  switch (part.kind) {
    case 'rect':
      return (
        <rect x={part.x} y={part.y} width={part.w} height={part.h} rx={part.rx ?? 0} {...common} />
      );
    case 'circle':
      return <circle cx={part.cx} cy={part.cy} r={part.r} {...common} />;
    case 'ellipse':
      return (
        <ellipse
          cx={part.cx}
          cy={part.cy}
          rx={part.rx}
          ry={part.ry}
          transform={part.rotate ? `rotate(${part.rotate} ${part.cx} ${part.cy})` : undefined}
          {...common}
        />
      );
    case 'line':
      return (
        <line
          x1={part.x1}
          y1={part.y1}
          x2={part.x2}
          y2={part.y2}
          {...common}
          fill='none'
          strokeOpacity={part.opacity ?? 1}
        />
      );
    case 'path':
      return <path d={part.d} {...common} />;
  }
}

/** One seat's figure, in the 100-unit box the art is authored in. */
export function PieceFigure({ ck, style }: { ck: ColorKey; style?: CSSProperties }) {
  return (
    <g style={style}>
      <Gradients ck={ck} />
      {PIECE_PARTS[ck].map((part, i) => (
        <Part key={i} part={part} ck={ck} />
      ))}
    </g>
  );
}

/** The figure's scale when it is stamped into a `size` px box, from the 100-box. */
export const PIECE_UNIT = 1 / 100;
