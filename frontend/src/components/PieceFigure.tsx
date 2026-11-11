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

/**
 * A piece, drawn as SVG from `game/pieceParts.ts` (the 70s bobbleheads) or
 * `game/pieceParts80.ts` (the 80s characters).
 *
 * One component for both places a piece stands on a game screen: the board's
 * `Sphere` and the clash result's cast. A result FX that drew its own token would be
 * a second, subtly different piece on the same screen — the same argument the pixel
 * glyph made for the invaders, kept for the figures.
 *
 * It renders bare `<g>` content (no `<svg>`), so the caller owns the frame: the
 * board gives it a 100-unit `viewBox` and a drop shadow, the clash result places it
 * in its own coordinate system with a transform.
 *
 * **The pose.** `front` is the default and what a board draws; `left` and `right` are
 * for the clash card, where the defender and the attacker share a line and the shot
 * needs a direction. Both sets are authored looking at the viewer, and a profile would
 * be eight new drawings, so a pose is one transform on a FACE PLATE inside a head that
 * stays put (`poseTurn`, `cutAtNeck`): the plate squashes to 0.8 and slides 6 units, the
 * numbers the hero's crew has turned its heads with since the wait-room window. The cut
 * is the seam each set already had — the 70s helmet's `visor` group, the 80s generator's
 * `PIECE_FACE_80` — so a jaw, an ear, a pod or a chin bar stays on the collar and only
 * the face looks somewhere.
 */

/** The palette for a set: the 80s ladder lifts its garment rung, the 70s does not. */
function paletteFor(ck: ColorKey, set: PieceSet): PiecePalette {
  return set === 'retro80' ? piecePalette80(ck) : piecePalette(ck);
}

/**
 * The two body gradients, scoped to one seat so two seats can share a document.
 *
 * They are measured in `objectBoundingBox` units, i.e. inside the part they fill, which is
 * why they need to be declared once per seat rather than once per document. They used to
 * be declared twice: a mirrored figure travels with its own shading, so `mirrored` reversed
 * both vectors to keep the light where the scene put it. No pose mirrors a figure any more
 * (`todo.md` 30), so the authored vectors are the only ones there are.
 */
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

/** Which decade's drawing to lay down: `pieceParts.ts` owns the union, this re-exports it
 *  with the component, which is where callers used to find it. */
export type { PieceSet };

/**
 * One seat's figure, in the 100-unit box both sets are authored in.
 *
 * `set` picks the table, never the box: `PIECE_PARTS` (one body, four helmets) or
 * `PIECE_PARTS_80` (four whole characters). Both are 100-unit art with feet on the
 * same 95.5 line, so the frame, the scale and the clash result's 33-unit cast are
 * identical across themes and a piece never moves when the theme changes.
 *
 * `pose` is the facing (`front` by default): the run the table marks as `turn` is wrapped
 * in one matrix (the face plate's squash and slide), and the runs are drawn in the table's
 * own order, so `front` is the drawing that was signed off and a pose moves a face and
 * nothing else. Nothing is mirrored on either set, which is why a still of a `left` figure
 * and a still of a `right` one differ only in where the face sits.
 */
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

/** The figure's scale when it is stamped into a `size` px box, from the 100-box. */
export const PIECE_UNIT = 1 / 100;
