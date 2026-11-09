import { COL, type ColorKey } from '../theme';

/**
 * The 1970s piece set: one bobblehead per seat, drawn in a 100×100 box.
 *
 * The box is 100 units because every number in the approved stills is in that box
 * (`/tmp/theme-mockups`, `bobble.py`): the head is 54 units, the torso 32, the arms
 * reach 42, and the neck leaves a 3-unit gap between the chin at y 63 and the
 * shoulders at y 66. A smaller box would mean re-deriving all of it, and the picks
 * were stamped at this weight.
 *
 * **Roles, not colours.** No part names a hex value except the ink and the creams,
 * which are the same on every seat. Every other paint is a slot — `base`, `lo`,
 * `deep`, `pop`… — that `piecePalette` fills from that seat's own value ladder, so
 * ONE drawing serves all four hues and parts are separated by lightness, never by
 * hue. The only hue-specific choice is `pop`, the accent, which is why a helmet
 * drawn for red can be handed to a blue seat without a redraw.
 *
 * The geometry is a hand port of `bobble.py`'s four helmets on its one shared body
 * (`bb_body` + `bb_h1`…`bb_h4`), and it is data rather than drawing calls so the
 * three places that paint a piece — the board's `Sphere`, the clash result's
 * `ResultFx`, and the home hero's crew — can share it while each keeps its own
 * renderer (SVG on the board, canvas in the hero). Nothing here snaps to a pixel:
 * the strokes are real, and a 14 px piece is drawn at 0.14 px per unit.
 */
export type PieceRole =
  | 'base'
  | 'hi'
  | 'lit'
  | 'shd'
  | 'lo'
  | 'deep'
  | 'deepink'
  | 'pop'
  | 'ink'
  | 'cream'
  | 'white'
  /** Linear body gradient, hi → base → lo: the torso. */
  | 'lid'
  /** The hero's torso: the same ramp lit flatter, for a figure 47 px tall. */
  | 'lidCrew'
  /** Radial body gradient, hi → base → lo: the helmet globe. */
  | 'gid';

/** A paint slot, or `none` for a stroke-only part. */
type Paint = PieceRole | 'none';

type Linecap = 'butt' | 'round';

/**
 * One part of the figure. Five shapes rather than one path string, because the
 * source is rect/circle/ellipse/line/path and both renderers have a native call for
 * each — a rotated ellipse baked into path arcs by hand is where a port like this
 * goes wrong silently.
 */
export type PiecePart =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      rx?: number;
      fill: Paint;
      stroke?: Paint;
      strokeW?: number;
      opacity?: number;
    }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      fill: Paint;
      stroke?: Paint;
      strokeW?: number;
      opacity?: number;
    }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      /** Degrees about the ellipse's own centre. */
      rotate?: number;
      fill: Paint;
      stroke?: Paint;
      strokeW?: number;
      opacity?: number;
    }
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: Paint;
      strokeW?: number;
      opacity?: number;
      linecap?: Linecap;
    }
  | {
      kind: 'path';
      d: string;
      fill: Paint;
      stroke?: Paint;
      strokeW?: number;
      opacity?: number;
      linecap?: Linecap;
    };

/** The ink every outline is drawn in: near-black, warmed so it reads on walnut. */
const INK = '#0a0716';

/**
 * One accent per hue that can never collide with its own body. Cream works for
 * three of them; on yellow it is invisible, so yellow gets the violet complement.
 * This is the ONLY hue-specific value in the set.
 */
const POP: Record<ColorKey, string> = {
  blue: '#ffb000',
  red: '#f6e7c6',
  green: '#5fb3b0',
  yellow: '#7b4dff',
};

/** The palette's fixed creams: the H2 faceplate and the highlight literals. */
const CREAM = '#ffe7bd';
const WHITE = '#ffffff';

/** `t` of the way from `a` to `b`, both `#rrggbb`. */
function mix(a: string, b: string, t: number): string {
  const parts = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const [ar, ag, ab] = parts(a);
  const [br, bg, bb] = parts(b);
  return (
    '#' +
    [ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]
      .map((v) => Math.round(v).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Every colour role resolved for one seat. The three gradient roles are built from
 *  these stops, not from a colour of their own. */
export type PiecePalette = Record<Exclude<PieceRole, 'lid' | 'lidCrew' | 'gid'>, string>;

/**
 * The value ladder: `hi`/`lit` lift the seat hue towards white, `shd`/`lo`/`deep`
 * sink it towards black, and `deepink` is a hue-tinted near-black so an outline
 * still belongs to the piece it surrounds. Percentages are the stills'.
 */
export function piecePalette(color: ColorKey): PiecePalette {
  const base = COL[color].base;
  return {
    base,
    hi: mix(base, WHITE, 0.62),
    lit: mix(base, WHITE, 0.34),
    shd: mix(base, '#000000', 0.22),
    lo: mix(base, '#000000', 0.52),
    deep: mix(base, '#000000', 0.74),
    deepink: mix(base, INK, 0.86),
    pop: POP[color],
    ink: INK,
    cream: CREAM,
    white: WHITE,
  };
}

/**
 * The two body gradients, as stops the renderer turns into ink: `lid` is linear
 * (torso), `gid` radial about 0.33/0.28 at radius 0.9 (helmet globe). Both run
 * hi → base → lo, and the offsets are the stills'. `lidCrew` is the hero's torso:
 * the same figure lit a little flatter, because at 47 px the tighter ramp bands.
 */
export const PIECE_GRADIENT = {
  lid: { from: 'hi', mid: 'base', to: 'lo', midAt: 0.46 },
  lidCrew: { from: 'lit', mid: 'base', to: 'lo', midAt: 0.55 },
  gid: { from: 'hi', mid: 'base', to: 'lo', midAt: 0.5 },
} as const satisfies Record<
  'lid' | 'lidCrew' | 'gid',
  { from: PieceRole; mid: PieceRole; to: PieceRole; midAt: number }
>;

/** Where `gid`'s radial gradient sits: the light comes from upper left. */
export const GLOBE_GRADIENT = { cx: 0.33, cy: 0.28, r: 0.9 } as const;

/** `lid`'s vector, in bounding-box fractions (the SVG's own `x1/y1/x2/y2`). */
export const LID_VECTOR = { x1: 0.12, y1: 0, x2: 0.62, y2: 1 } as const;

/**
 * The two bounding boxes the gradients are measured against, in the 100-box. A
 * renderer needs them because a canvas gradient is a coordinate, not a fraction:
 * 0.12 of `TORSO_BOX`'s width from its left edge is x 37.23.
 */
export const TORSO_BOX = { x: 33.2, y: 66, w: 33.6, h: 24.5 } as const;
export const GLOBE_BOX = { x: 23, y: 9, w: 54, h: 54 } as const;

/**
 * The one shared body: neck, stub torso with two straps, hanging arms with mitts,
 * two boots, and exactly one accent — a thin ring on the chest.
 *
 * The neck is drawn FIRST, before the helmet, so the dome covers its top on every
 * design and only the three units between chin and shoulders ever show. The body is
 * the constant across the four seats, so a board compares helmets and nothing else.
 */
const BODY: PiecePart[] = [
  {
    kind: 'rect',
    x: 42.5,
    y: 52,
    w: 15,
    h: 18,
    rx: 3.5,
    fill: 'lo',
    stroke: 'deepink',
    strokeW: 2.6,
  },
  {
    kind: 'path',
    d: 'M39 66 Q34.5 69 34 78 L33.2 87 Q33.2 90.5 37 90.5 L63 90.5 Q66.8 90.5 66.8 87 L66 78 Q65.5 69 61 66 Z',
    fill: 'lid',
    stroke: 'ink',
    strokeW: 3,
    linecap: 'round',
  },
  // The 70s suit harness: two thin straps down the chest, dark value on the gradient.
  { kind: 'line', x1: 43.2, y1: 70, x2: 43.2, y2: 88, stroke: 'lo', strokeW: 2.2, opacity: 0.85 },
  { kind: 'line', x1: 56.8, y1: 70, x2: 56.8, y2: 88, stroke: 'lo', strokeW: 2.2, opacity: 0.85 },
  // Arms hang outside the torso, mitts at the bottom: the figure's widest point.
  { kind: 'rect', x: 29, y: 70, w: 9, h: 17, rx: 4.5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
  { kind: 'rect', x: 62, y: 70, w: 9, h: 17, rx: 4.5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
  { kind: 'circle', cx: 33.5, cy: 88, r: 4.7, fill: 'shd', stroke: 'ink', strokeW: 2.4 },
  { kind: 'circle', cx: 66.5, cy: 88, r: 4.7, fill: 'shd', stroke: 'ink', strokeW: 2.4 },
  // Boots, wide enough to read as feet rather than as a stem.
  {
    kind: 'rect',
    x: 36.5,
    y: 88.5,
    w: 9,
    h: 7,
    rx: 2.4,
    fill: 'deep',
    stroke: 'deepink',
    strokeW: 2.2,
  },
  {
    kind: 'rect',
    x: 54.5,
    y: 88.5,
    w: 9,
    h: 7,
    rx: 2.4,
    fill: 'deep',
    stroke: 'deepink',
    strokeW: 2.2,
  },
  { kind: 'circle', cx: 50, cy: 79, r: 4.2, fill: 'none', stroke: 'pop', strokeW: 1.8 },
];

/** The helmet globe every design is built on, plus its specular arc. */
export const PIECE_GLOBE: PiecePart[] = [
  { kind: 'circle', cx: 50, cy: 36, r: 27, fill: 'gid', stroke: 'ink', strokeW: 3 },
  {
    kind: 'path',
    d: 'M30.02 30.6 A25.92 25.92 0 0 1 48.38 10.62',
    fill: 'none',
    stroke: 'white',
    strokeW: 3.51,
    opacity: 0.55,
    linecap: 'round',
  },
];

/**
 * A helmet in two groups, because the hero's crew turns its head towards its partner
 * and the turn has to reach the right parts: `visor` is drawn inside a squashed,
 * slid group (a flat visor seen at 37°, cos 37° = 0.80), `outside` after it at full
 * width, since a pod stays round and an aerial stays upright however the head turns.
 *
 * On the board nothing turns, so both groups are drawn untransformed and the split
 * costs nothing: it is the same table either way.
 */
export type HelmetSet = { visor: PiecePart[]; outside: PiecePart[] };

/** The ear pods, part of the silhouette: they must not be squashed with the visor. */
const PODS: PiecePart[] = [25.5, 74.5].flatMap(
  (cx): PiecePart[] => [
    { kind: 'circle', cx, cy: 41, r: 9, fill: 'lo', stroke: 'ink', strokeW: 2.8 },
    { kind: 'circle', cx, cy: 41, r: 9, fill: 'none', stroke: 'hi', strokeW: 1.5, opacity: 0.55 },
    { kind: 'circle', cx, cy: 41, r: 3.4, fill: 'pop', stroke: 'deepink', strokeW: 1.4 },
  ],
);

/** H1 EAR PODS: the widest silhouette, and the busiest of the four at board size. */
const H1: HelmetSet = {
  visor: [
    // The visor is ink with an accent gasket, so it never reads as a face.
    { kind: 'rect', x: 30, y: 27, w: 40, h: 26, rx: 13, fill: 'ink', stroke: 'pop', strokeW: 3.2 },
    {
      kind: 'ellipse',
      cx: 41.2,
      cy: 34.8,
      rx: 5.4,
      ry: 2.6,
      rotate: -16,
      fill: 'white',
      opacity: 0.45,
    },
  ],
  outside: PODS,
};
/**
 * H2 INSET FACEPLATE: cream, inset to 28 of the head's 54 units so seat-coloured
 * shell shows at both temples. Cream is the one fixed colour in the set, so the ink
 * bezel and the dark brow are what keep it legible on every hue (yellow worst) — the
 * inset seam is DARK rather than the accent, because on the red seat the accent is
 * itself cream.
 */
const H2: HelmetSet = {
  visor: [
    { kind: 'rect', x: 26, y: 30, w: 10, h: 18, rx: 5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
    { kind: 'rect', x: 64, y: 30, w: 10, h: 18, rx: 5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
    {
      kind: 'rect',
      x: 36,
      y: 28.5,
      w: 28,
      h: 29,
      rx: 13.5,
      fill: 'cream',
      stroke: 'ink',
      strokeW: 2.8,
    },
    // A wash of the seat hue keeps the cream plate belonging to its own piece.
    { kind: 'rect', x: 38, y: 30.5, w: 24, h: 25, rx: 12, fill: 'base', opacity: 0.14 },
    {
      kind: 'rect',
      x: 38,
      y: 30.5,
      w: 24,
      h: 25,
      rx: 12,
      fill: 'none',
      stroke: 'deepink',
      strokeW: 1.6,
      opacity: 0.9,
    },
    {
      kind: 'path',
      d: 'M36.5 36.5 Q50 31.5 63.5 36.5',
      fill: 'none',
      stroke: 'deepink',
      strokeW: 2.8,
      linecap: 'round',
    },
    { kind: 'path', d: 'M39 50 Q50 55.5 61 50 L61 54 Q50 58.5 39 54 Z', fill: 'lo', opacity: 0.35 },
    { kind: 'ellipse', cx: 44, cy: 37.5, rx: 5, ry: 2.4, rotate: -16, fill: 'white', opacity: 0.5 },
  ],
  outside: [],
};

/** H3's aerial, trimmed to y 7.5 so the figure is no taller than its neighbours'. */
const AERIAL: PiecePart[] = [
  { kind: 'line', x1: 50, y1: 15, x2: 50, y2: 8, stroke: 'deepink', strokeW: 5.4 },
  { kind: 'line', x1: 50, y1: 15, x2: 50, y2: 8.6, stroke: 'lit', strokeW: 2.4 },
  { kind: 'circle', cx: 50, cy: 7.6, r: 3.1, fill: 'hi', stroke: 'deepink', strokeW: 1.6 },
];

const H3: HelmetSet = {
  visor: [
    { kind: 'rect', x: 31, y: 39, w: 38, h: 12, rx: 6, fill: 'ink', stroke: 'pop', strokeW: 2.8 },
    {
      kind: 'path',
      d: 'M36 43 H47',
      fill: 'none',
      stroke: 'white',
      strokeW: 2,
      opacity: 0.3,
      linecap: 'round',
    },
  ],
  outside: AERIAL,
};

const H4: HelmetSet = {
  visor: [
    { kind: 'rect', x: 26, y: 27, w: 48, h: 16, rx: 4, fill: 'ink', stroke: 'pop', strokeW: 2.8 },
    { kind: 'ellipse', cx: 37, cy: 33, rx: 5, ry: 1.9, rotate: -8, fill: 'white', opacity: 0.35 },
  ],
  outside: [],
};

/**
 * Which design each seat wears. The assignment is the one the wait-room crew, the
 * board and the stills all use: red H2 inset cream faceplate, green H3 Mercury slit,
 * yellow H4 Apollo brow, blue H1 ear pods — so no two seats on a board share a
 * silhouette, even in greyscale.
 */
export const PIECE_HELMET: Record<ColorKey, HelmetSet> = {
  red: H2,
  green: H3,
  yellow: H4,
  blue: H1,
};

/**
 * The crew's stance: the same figure, seen from a lounge rather than from above a
 * board. Two paint-order/stance changes and no change of shape — the arms go BEHIND
 * the torso and the mitts stop above the boots.
 *
 * On the board the piece is 14-28 px and neither matters: a 4-px arm is a pixel
 * either way. In the window the same body is 47 px tall, and with the arms in front
 * their ink outlines cut two columns out of the torso and the mitts land on the
 * boots' row, so the figure reads as a box with a knob on it. Behind the torso the
 * arms are a silhouette again; lifted, the hands stop being feet.
 */
export const PIECE_BODY_CREW: PiecePart[] = [
  // The neck seal: without it the head floats three units above the shoulders,
  // which at 112 px is a 4 px gap of sky.
  {
    kind: 'rect',
    x: 42.5,
    y: 52,
    w: 15,
    h: 18,
    rx: 3.5,
    fill: 'lo',
    stroke: 'deepink',
    strokeW: 2.6,
  },
  // Arms behind the torso, a little wider apart and higher than the board's.
  { kind: 'rect', x: 27.5, y: 68, w: 9, h: 15, rx: 4.5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
  { kind: 'rect', x: 63.5, y: 68, w: 9, h: 15, rx: 4.5, fill: 'lo', stroke: 'ink', strokeW: 2.6 },
  { kind: 'circle', cx: 32, cy: 84, r: 4.6, fill: 'shd', stroke: 'ink', strokeW: 2.4 },
  { kind: 'circle', cx: 68, cy: 84, r: 4.6, fill: 'shd', stroke: 'ink', strokeW: 2.4 },
  {
    kind: 'path',
    d: 'M39 66 Q34.5 69 34 78 L33.2 87 Q33.2 90.5 37 90.5 L63 90.5 Q66.8 90.5 66.8 87 L66 78 Q65.5 69 61 66 Z',
    fill: 'lidCrew',
    stroke: 'ink',
    strokeW: 3,
    linecap: 'round',
  },
  { kind: 'line', x1: 43.2, y1: 70, x2: 43.2, y2: 88, stroke: 'lo', strokeW: 2.2, opacity: 0.85 },
  { kind: 'line', x1: 56.8, y1: 70, x2: 56.8, y2: 88, stroke: 'lo', strokeW: 2.2, opacity: 0.85 },
  {
    kind: 'rect',
    x: 36.5,
    y: 88.5,
    w: 9,
    h: 7,
    rx: 2.4,
    fill: 'deep',
    stroke: 'deepink',
    strokeW: 2.2,
  },
  {
    kind: 'rect',
    x: 54.5,
    y: 88.5,
    w: 9,
    h: 7,
    rx: 2.4,
    fill: 'deep',
    stroke: 'deepink',
    strokeW: 2.2,
  },
  { kind: 'circle', cx: 50, cy: 79, r: 4.2, fill: 'none', stroke: 'pop', strokeW: 1.8 },
];

/** The crew's head is 85 per cent, about the neck: 62 per cent head reads as a ball
 *  on a box at 112 px, which is why the board and the window disagree here. */
export const CREW_HEAD = { neck: 62, scale: 0.85, span: 95.5 } as const;

/** A turned visor's horizontal squash, cos 37 degrees. */
export const CREW_TURN = { squash: 0.8, slide: 6 } as const;

/** One figure in the window: where it stands, how tall it is, which way it looks. */
export type CrewFigure = { color: ColorKey; face: 1 | -1; x: number; height: number };

/**
 * Left to right in the seat legend's own order: red, green, yellow, blue. The two
 * pairs stand close enough to touch helmet rims and the seam between them is the
 * widest gap in the row, so the group reads as two conversations rather than a
 * frieze; the outside pair is a size up, which gives the row a front edge.
 */
export const PIECE_CREW: CrewFigure[] = [
  { color: 'red', face: 1, x: 178, height: 112 },
  { color: 'green', face: -1, x: 246, height: 106 },
  { color: 'yellow', face: 1, x: 320, height: 106 },
  { color: 'blue', face: -1, x: 404, height: 112 },
];

/**
 * Each seat's complete figure, body first: what the board stamps and what the clash
 * result draws. The hero's crew draws `PIECE_BODY_CREW` and the helmet groups below
 * in a pose of its own, so the art lives here once and the pose lives with the
 * painter.
 */
export const PIECE_PARTS: Record<ColorKey, PiecePart[]> = {
  red: [...BODY, ...PIECE_GLOBE, ...H2.visor, ...H2.outside],
  green: [...BODY, ...PIECE_GLOBE, ...H3.visor, ...H3.outside],
  yellow: [...BODY, ...PIECE_GLOBE, ...H4.visor, ...H4.outside],
  blue: [...BODY, ...PIECE_GLOBE, ...H1.visor, ...H1.outside],
};
