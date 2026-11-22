import type { CSSProperties } from 'react';
import type { ColorKey } from '../theme';
import {
  GLOBE_GRADIENT,
  LID_VECTOR,
  PIECE_GRADIENT,
  PIECE_LAYERS,
  cutAtNeck,
  piecePalette,
  piecePalette80,
  poseTurn,
  type PieceLayers,
  type PiecePalette,
  type PiecePart,
  type PiecePose,
  type PieceRole,
  type PieceSet,
} from '../game/pieceParts';
import { PIECE_FACE_80, PIECE_HEAD_80, PIECE_PARTS_80 } from '../game/pieceParts80';

// Draws a seat's SVG figure from `game/pieceParts.ts` (70s) or `pieceParts80.ts` (80s).
// It renders bare `<g>` content, so the caller owns the frame and transform. `pose` turns
// only the face plate; the head and body stay put.

// The palette for a set: the 80s ladder lifts its garment rung, the 70s does not.
function paletteFor(ck: ColorKey, set: PieceSet): PiecePalette {
  return set === 'retro80' ? piecePalette80(ck) : piecePalette(ck);
}

// The two body gradients, scoped per seat because they use `objectBoundingBox` units.
// No pose mirrors a figure now, so the authored vectors are the only ones used.
function Gradients({ ck, set }: { ck: ColorKey; set: PieceSet }) {
  const pal = paletteFor(ck, set);
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

function Part({ part, ck, set }: { part: PiecePart; ck: ColorKey; set: PieceSet }) {
  const pal = paletteFor(ck, set);
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

// Which decade's drawing to lay down: `pieceParts.ts` owns the union, this re-exports it
//  with the component, which is where callers used to find it.
export type { PieceSet };

// One seat's figure in the shared 100-unit box. `set` picks the part table, not the box;
// both sets put feet on 95.5, so a theme change does not move a piece. `pose` only turns
// the marked face run; nothing is mirrored.
export function PieceFigure({
  ck,
  set = 'retro70',
  pose = 'front',
  style,
}: {
  ck: ColorKey;
  set?: PieceSet;
  pose?: PiecePose;
  style?: CSSProperties;
}) {
  const layers: PieceLayers =
    set === 'retro80'
      ? cutAtNeck(PIECE_PARTS_80[ck], PIECE_HEAD_80[ck], PIECE_FACE_80[ck])
      : PIECE_LAYERS[ck];
  const turn = poseTurn(pose);
  const draw = (parts: PiecePart[], key: string) =>
    parts.map((part, i) => <Part key={`${key}${i}`} part={part} ck={ck} set={set} />);

  return (
    <g style={style}>
      <Gradients ck={ck} set={set} />
      {layers.map((layer, i) =>
        layer.turn ? (
          <g key={`t${i}`} transform={turn ?? undefined}>
            {draw(layer.parts, `t${i}`)}
          </g>
        ) : (
          <g key={`s${i}`}>{draw(layer.parts, `s${i}`)}</g>
        ),
      )}
    </g>
  );
}

// The figure's scale when it is stamped into a `size` px box, from the 100-box.
export const PIECE_UNIT = 1 / 100;
