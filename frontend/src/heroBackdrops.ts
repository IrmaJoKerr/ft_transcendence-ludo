import {
  CREW_HEAD,
  CREW_TURN,
  GLOBE_BOX,
  GLOBE_GRADIENT,
  LID_VECTOR,
  PIECE_BODY_CREW,
  PIECE_CREW,
  PIECE_GLOBE,
  PIECE_GRADIENT,
  PIECE_HELMET,
  TORSO_BOX,
  piecePalette,
  type PiecePalette,
  type PiecePart,
  type PieceRole,
} from './game/pieceParts';

/**
 * The attract-mode painters: one function per theme, each handed a scene from
 * `heroScenes.ts` and one frame of animation state.
 *
 * They are plain functions over a 2D context, not components and not hooks: the
 * cabinet in `Home.tsx` owns exactly one canvas, one effect and one rAF loop, and a
 * theme chooses which painter that loop calls. The alternative — a canvas per theme,
 * or a component that remounts — would put two animations on one screen or throw
 * the loop away on every hair-trigger render.
 *
 * Geometry stays here as literals next to the calls that use them; only colour comes
 * from the scene. The card is the canvas's own 720×400 (its `width`/`height` are
 * attributes, not CSS), so a painter reads its size from `ctx.canvas` and nothing
 * has to agree on a constant.
 */

import type { HeroScene, RoomScene, SynthwaveScene } from './heroScenes';

/** One drifting star. `y` is advance-mutated by the painter, as it always was. */
export type Star = { x: number; y: number; size: number; speed: number; alpha: number };

/** The clocks the painters advance, shared by both cards. */
export type HeroFrame = { time: number; gridOffset: number };

/** What a scene carries between frames: its starfield, seeded once per scene, and —
 *  for the room, which never moves — the sheet it was painted onto. */
export type SceneState = {
  stars: Star[];
  room?: { key: string; canvas: HTMLCanvasElement | OffscreenCanvas };
};

/** The starfield the synthwave card drifts, seeded once per scene. */
export function seedStars(count: number, width: number, horizon: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * horizon,
    size: Math.random() * 1.8 + 0.5,
    speed: Math.random() * 0.3 + 0.1,
    alpha: Math.random() * 0.7 + 0.3,
  }));
}

/** Pinpricks for a static sky: no drift, and a band rather than a whole card. */
function seedPinpricks(
  count: number,
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number,
): Star[] {
  return Array.from({ length: count }, () => ({
    x: xMin + Math.random() * (xMax - xMin),
    y: yMin + Math.random() * (yMax - yMin),
    size: Math.random() * 1.2 + 0.5,
    speed: 0,
    alpha: 0.25 + Math.random() * 0.65,
  }));
}

/** Seed a scene's state. Both cards get stars; only one of them moves them. */
export function createSceneState(scene: HeroScene, width: number): SceneState {
  if (scene.kind === 'room') {
    // The sky is the window, not the card: pinpricks between y 50 and 210, which is
    // the aperture's own band with a margin so none lands on the bezel.
    return { stars: seedPinpricks(scene.starCount, 6, width - 6, 50, 210) };
  }
  return { stars: seedStars(scene.starCount, width, scene.horizonY) };
}

/** The 70s room's palette. These are the same values as `retrowave.css`'s
 *  `[data-theme='retro70']` block and the art's walnut: a canvas cannot read a CSS
 *  custom property without a `getComputedStyle` per frame, so the handful the room
 *  paints are written out, and the two that a designer moves are tokens. */
const ROOM = {
  wall: [0, '#241a12', 0.5, '#1b1510', 1, '#120d0a'] as const,
  wallSeam: 'rgba(11, 8, 5, 0.5)',
  wallSeamHi: 'rgba(255, 231, 189, 0.06)',
  crest: '#2b1e15',
  bezel: '#ffe7bd',
  lip: 'rgba(201, 176, 138, 0.55)',
  ledge: [0, '#2e2117', 1, '#1a1310'] as const,
  ledgeEdge: 'rgba(255, 231, 189, 0.85)',
  ledgeShadow: 'rgba(11, 8, 5, 0.7)',
  consoleFace: [0, '#241a13', 1, '#15100c'] as const,
  consoleEdge: 'rgba(201, 176, 138, 0.22)',
  rivet: 'rgba(201, 176, 138, 0.7)',
  key: '#3a2a1c',
  keyEdge: '#0b0805',
  keyGloss: 'rgba(201, 176, 138, 0.35)',
  sky: [0, '#07060e', 0.62, '#150c22', 1, '#20102c'] as const,
  planet: [0, '#ffd27a', 0.6, '#f28a0f', 1, '#8e2b0a'] as const,
  band: '#8e2b0a',
  ringOuter: 'rgba(201, 176, 138, 0.55)',
  ringInner: 'rgba(255, 231, 189, 0.32)',
  planetEdge: 'rgba(255, 231, 189, 0.5)',
  star: '#ffffff',
  cream: '#ffe7bd',
  sand: '#c9b08a',
  amber: '#ffb000',
  teal: '#5fb3b0',
  ink: '#0b0805',
};

/**
 * The window: the app's own bands, top to bottom — marquee 30, frame 41..221, ledge
 * 222..233, the press-start card (DOM) 234..324, the legend 341..373, the console
 * 326..400. The opening is y 44..218 and x 74..646, the card's own width, so the
 * marquee, the aperture, the card and the legend sit on one margin and the sky is
 * never spent where the card hides it.
 */
const WIN = { x: 74, y: 44, w: 572, h: 174, r: 30 } as const;
const LIP_B = 215;

/** A vertical gradient over `y0..y1` from a flat `[offset, colour, ...]` list. */
function vgrad(
  ctx: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  stops: readonly (number | string)[],
): CanvasGradient {
  const grad = ctx.createLinearGradient(0, y0, 0, y1);
  for (let i = 0; i < stops.length; i += 2) {
    grad.addColorStop(stops[i] as number, stops[i + 1] as string);
  }
  return grad;
}

/** A rounded-rectangle sub-path. `roundRect` is baseline in every browser this ships to. */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** A four-point star: the diffraction spike every painted cover put on its brightest. */
function flare(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  opacity: number,
): void {
  ctx.save();
  ctx.strokeStyle = ROOM.star;
  ctx.fillStyle = ROOM.star;
  ctx.globalAlpha = opacity;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.globalAlpha = opacity * 0.7;
  ctx.beginPath();
  ctx.moveTo(x - r, y);
  ctx.lineTo(x + r, y);
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.stroke();
  ctx.restore();
}

/**
 * The 80s card: deep gradient, a banded sun, drifting stars, a horizon grid running
 * towards the camera, four hologram nodes and the marquee on top.
 */
export function paintSynthwave(
  ctx: CanvasRenderingContext2D,
  scene: SynthwaveScene,
  state: SceneState,
  frame: HeroFrame,
  marquee: string,
): void {
  const { width, height } = ctx.canvas;
  const horizonY = scene.horizonY;
  const time = frame.time;

  ctx.clearRect(0, 0, width, height);

  // 1. Deep Canvas Background with gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, scene.bgTop);
  bgGrad.addColorStop(0.65, scene.bgMid);
  bgGrad.addColorStop(1, scene.bgBot);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Distant Sun: the disc and its scanlines share one clip path, so a scanline
  //    stroke cannot reach past the sun's silhouette.
  const { y: sunY, r: sunRadius } = scene.sun;
  const sunGrad = ctx.createRadialGradient(360, sunY, 7, 360, sunY, sunRadius);
  sunGrad.addColorStop(0, scene.sun.c1);
  sunGrad.addColorStop(0.5, scene.sun.c2);
  sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

  ctx.save();
  ctx.beginPath();
  ctx.arc(360, sunY, sunRadius, Math.PI, 0, false);
  ctx.closePath();
  ctx.clip();

  ctx.fillStyle = sunGrad;
  ctx.fillRect(360 - sunRadius, sunY - sunRadius, sunRadius * 2, sunRadius);

  // Sun horizon scanlines (kept translucent so they band the sun instead of
  // painting solid black lines over it)
  ctx.strokeStyle = scene.sun.scanline;
  ctx.lineWidth = 2;
  for (let sy = sunY - 60; sy < sunY; sy += 8) {
    ctx.beginPath();
    ctx.moveTo(360 - sunRadius, sy);
    ctx.lineTo(360 + sunRadius, sy);
    ctx.stroke();
  }
  ctx.restore();

  // 3. Floating Stars
  state.stars.forEach((st) => {
    st.y += st.speed;
    if (st.y > horizonY) st.y = 0;
    ctx.fillStyle = `rgba(${scene.starfield}, ${st.alpha * (0.8 + 0.2 * Math.sin(time * 3 + st.x))})`;
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.size, 0, Math.PI * 2);
    ctx.fill();
  });

  // 4. Horizon Perspective Grid
  ctx.save();
  ctx.strokeStyle = scene.gridColor;
  ctx.lineWidth = 1;

  // Horizontal grid lines moving toward camera
  for (let gy = 0; gy < 140; gy += 14) {
    const y = horizonY + Math.pow((gy + frame.gridOffset) / 145, 1.8) * 140;
    if (y <= height) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  // Perspective radiating vertical lines from vanishing point (360, 260)
  for (let x = -250; x <= width + 250; x += 45) {
    ctx.beginPath();
    ctx.moveTo(360, horizonY);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.restore();

  // 5. 4-Player Army Hologram Nodes
  scene.crew.forEach((p, idx) => {
    const pulse = Math.sin(time * 3 + idx * 1.5) * 2.4;
    ctx.save();
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 11;
    ctx.beginPath();
    ctx.arc(p.x, p.y + pulse, 7.5, 0, Math.PI * 2);
    ctx.fill();

    // Base ring
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 12, 15, 5, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.font = '8.5px "Atkinson Hyperlegible Next", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.label, p.x, p.y - 13 + pulse);
    ctx.restore();
  });

  // 6. Marquee Title on Top of Screen
  ctx.save();
  ctx.font = '13px "Atkinson Hyperlegible Next", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = scene.marqueeColor;
  ctx.shadowColor = scene.marqueeColor;
  ctx.shadowBlur = 11;
  ctx.fillText(marquee, 360, 28);
  ctx.shadowBlur = 0;
  ctx.restore();
}

/* ------------------------------------------------------------------------------------
   THE ROOM: the four seats, drawn from `game/pieceParts.ts`
   ------------------------------------------------------------------------------------ */

const TAU = Math.PI * 2;

/** Built once per part: the crew redraws ~25 of them a frame and none ever change. */
const PATH_CACHE = new WeakMap<PiecePart, Path2D>();

/** One rect, circle, ellipse, line or path as a `Path2D`. */
function pathFor(part: PiecePart): Path2D {
  const cached = PATH_CACHE.get(part);
  if (cached) return cached;
  let path: Path2D;
  switch (part.kind) {
    case 'rect':
      path = new Path2D();
      path.roundRect(part.x, part.y, part.w, part.h, part.rx ?? 0);
      break;
    case 'circle':
      path = new Path2D();
      path.arc(part.cx, part.cy, part.r, 0, TAU);
      break;
    case 'ellipse':
      path = new Path2D();
      path.ellipse(
        part.cx,
        part.cy,
        part.rx,
        part.ry,
        ((part.rotate ?? 0) * Math.PI) / 180,
        0,
        TAU,
      );
      break;
    case 'line':
      path = new Path2D();
      path.moveTo(part.x1, part.y1);
      path.lineTo(part.x2, part.y2);
      break;
    case 'path':
      path = new Path2D(part.d);
      break;
  }
  PATH_CACHE.set(part, path);
  return path;
}

/** Resolve one paint slot to a canvas style. The two body gradients are built in the
 *  current transform, so they lean, squash and scale with the figure they belong to. */
function paintStyle(
  ctx: CanvasRenderingContext2D,
  role: PieceRole,
  pal: PiecePalette,
): string | CanvasGradient {
  if (role === 'lid' || role === 'lidCrew') {
    const spec = PIECE_GRADIENT[role];
    const g = ctx.createLinearGradient(
      TORSO_BOX.x + LID_VECTOR.x1 * TORSO_BOX.w,
      TORSO_BOX.y + LID_VECTOR.y1 * TORSO_BOX.h,
      TORSO_BOX.x + LID_VECTOR.x2 * TORSO_BOX.w,
      TORSO_BOX.y + LID_VECTOR.y2 * TORSO_BOX.h,
    );
    g.addColorStop(0, pal[spec.from]);
    g.addColorStop(spec.midAt, pal[spec.mid]);
    g.addColorStop(1, pal[spec.to]);
    return g;
  }
  if (role === 'gid') {
    const spec = PIECE_GRADIENT.gid;
    const cx = GLOBE_BOX.x + GLOBE_GRADIENT.cx * GLOBE_BOX.w;
    const cy = GLOBE_BOX.y + GLOBE_GRADIENT.cy * GLOBE_BOX.h;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, GLOBE_GRADIENT.r * GLOBE_BOX.w);
    g.addColorStop(0, pal[spec.from]);
    g.addColorStop(spec.midAt, pal[spec.mid]);
    g.addColorStop(1, pal[spec.to]);
    return g;
  }
  return pal[role];
}

/** Fill, then stroke, one part. A line has no fill and a rect no cap, so each part
 *  contributes only the slots it declares. */
function paintPart(ctx: CanvasRenderingContext2D, part: PiecePart, pal: PiecePalette): void {
  const path = pathFor(part);
  const fill = part.kind === 'line' ? 'none' : part.fill;
  ctx.save();
  if (part.opacity !== undefined) ctx.globalAlpha *= part.opacity;
  if (fill !== 'none') {
    ctx.fillStyle = paintStyle(ctx, fill, pal);
    ctx.fill(path);
  }
  if (part.stroke && part.stroke !== 'none') {
    ctx.strokeStyle = paintStyle(ctx, part.stroke, pal);
    ctx.lineWidth = part.strokeW ?? 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'linecap' in part ? (part.linecap ?? 'butt') : 'butt';
    ctx.stroke(path);
  }
  ctx.restore();
}

/** A list of parts, in paint order. */
function paintAll(
  ctx: CanvasRenderingContext2D,
  parts: readonly PiecePart[],
  pal: PiecePalette,
): void {
  parts.forEach((part) => paintPart(ctx, part, pal));
}

/** The rim light on a turned head: it runs away from the turn, so it never crosses the
 *  visor, and it replaces the board's fixed specular arc. Screen angles — 90 is down. */
function paintRimLight(ctx: CanvasRenderingContext2D, face: 1 | -1): void {
  const [a0, a1] = face > 0 ? [188, 268] : [-88, -8];
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 3.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(50, 36, 24.3, (a0 * Math.PI) / 180, (a1 * Math.PI) / 180);
  ctx.stroke();
  ctx.restore();
}


/**
 * One member of the crew: soles on `feet`, `height` px from boot to head top.
 *
 * The pose is the pick's, and it is the only thing the window changes about the
 * piece: the head is scaled about the neck (a 62 per cent head reads as a ball on a
 * box at 112 px), it leans towards its partner by 3 units, and the visor alone is
 * squashed about the body's centre line and slid — a pod stays round and an aerial
 * stays upright however the head turns.
 */
function paintCrewFigure(
  ctx: CanvasRenderingContext2D,
  figure: (typeof PIECE_CREW)[number],
  feet: number,
): void {
  const { color, face, x, height } = figure;
  const pal = piecePalette(color);
  const helm = PIECE_HELMET[color];
  const headTop = CREW_HEAD.neck - 53 * CREW_HEAD.scale;
  const scale = height / (CREW_HEAD.span - headTop);
  const hx = 50 + face * 3;

  ctx.save();
  // 100-box → the card: put the box's origin at the figure's feet, so every part
  // below is drawn in the units it was authored in.
  ctx.translate(x, feet);
  ctx.scale(scale, scale);
  ctx.translate(-50, -CREW_HEAD.span);

  paintAll(ctx, PIECE_BODY_CREW, pal);

  ctx.save();
  ctx.translate(50, CREW_HEAD.neck);
  ctx.scale(CREW_HEAD.scale, CREW_HEAD.scale);
  ctx.translate(-50, -CREW_HEAD.neck);

  ctx.translate(hx - 50, 0);
  paintAll(ctx, PIECE_GLOBE, pal);
  paintRimLight(ctx, face);
  ctx.translate(50 - hx, 0);

  // The visor: slid along the turn, then squashed about x = 50.
  ctx.save();
  ctx.translate(face * CREW_TURN.slide, 0);
  ctx.translate(50, 0);
  ctx.scale(CREW_TURN.squash, 1);
  ctx.translate(-50, 0);
  paintAll(ctx, helm.visor, pal);
  ctx.restore();

  ctx.translate(hx - 50, 0);
  paintAll(ctx, helm.outside, pal);

  ctx.restore();
  ctx.restore();
}


/**
 * The 70s card: a walnut lounge, a porthole onto a ringed planet, and the four seats
 * standing in the window under the marquee.
 *
 * The bands are the app's own and nothing crosses them: the wall and its panelling
 * stop above the ledge at 222, the sky is clipped to the opening (74..646 × 44..218),
 * the ledge fills 222..233, the press-start card is DOM on 234..324, the legend
 * prints at 341..373 and the console face takes 326..400. That is why the opening is
 * 174 tall and not 242: a window reaching 286 would put its bottom 52 px behind the
 * card, where the only thing that reads is a smudge.
 *
 * **Painted once, then blitted.** Nothing in this room moves: not the stars, not the
 * crew, not the lamps. The one thing that can change is the marquee, which follows
 * the language, so the sheet is cached under that string and rebuilt only when it
 * changes. That matters because the crew is a hundred parts and every body gradient
 * has to be built in the current transform, so painting the room from scratch is more
 * per-frame allocation than the 80s card spends — and this card is a still.
 */
export function paintRoom(
  ctx: CanvasRenderingContext2D,
  scene: RoomScene,
  state: SceneState,
  frame: HeroFrame,
  marquee: string,
): void {
  const { width, height } = ctx.canvas;

  if (!state.room || state.room.key !== marquee || state.room.canvas.width !== width) {
    const canvas = scratchCanvas(width, height);
    if (!canvas) {
      // No offscreen available (a test harness): draw straight onto the target, so
      // there is one drawing path and nothing to keep in step.
      paintRoomScene(ctx, scene, state, frame, marquee);
      return;
    }
    const scratch = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!scratch) {
      paintRoomScene(ctx, scene, state, frame, marquee);
      return;
    }
    paintRoomScene(scratch, scene, state, frame, marquee);
    state.room = { key: marquee, canvas };
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(state.room.canvas, 0, 0);
}

/** An offscreen canvas, or null where the environment has neither flavour. */
function scratchCanvas(
  width: number,
  height: number,
): HTMLCanvasElement | OffscreenCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/** Everything the room is made of, in paint order. */
function paintRoomScene(
  ctx: CanvasRenderingContext2D,
  scene: RoomScene,
  state: SceneState,
  frame: HeroFrame,
  marquee: string,
): void {
  const { width, height } = ctx.canvas;
  /** Where the crew stands: the sill, just inside the aperture's bottom edge. */
  const feet = 214;

  ctx.clearRect(0, 0, width, height);

  // 1. The wall: walnut, with panel seams that stop at the ledge.
  ctx.fillStyle = vgrad(ctx, 0, height, ROOM.wall);
  ctx.fillRect(0, 0, width, height);
  for (let x = 90; x < width; x += 112) {
    ctx.strokeStyle = ROOM.wallSeam;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 226);
    ctx.stroke();
    ctx.strokeStyle = ROOM.wallSeamHi;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(x + 3, 0);
    ctx.lineTo(x + 3, 226);
    ctx.stroke();
  }
  ctx.fillStyle = ROOM.crest;
  ctx.fillRect(0, 0, width, 6);

  // 2. The view: sky, stars, the planet, then the crew — all clipped to the opening.
  ctx.save();
  roundRect(ctx, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r);
  ctx.clip();

  ctx.fillStyle = vgrad(ctx, 40, 222, ROOM.sky);
  ctx.fillRect(70, 40, 580, 182);

  ctx.fillStyle = ROOM.star;
  state.stars.forEach((st) => {
    ctx.globalAlpha = st.alpha;
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.size, 0, TAU);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  flare(ctx, 150, 92, 5, 0.7);
  flare(ctx, 612, 62, 6, 0.7);

  // One planet and no moon: in a frame whose four subjects are glossy spheres, a
  // fifth sphere in the sky reads as a helmet that got away.
  const px = 545;
  const py = 90;
  const pr = 46;
  const rings = (): void => {
    ctx.strokeStyle = ROOM.ringOuter;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(0, 0, 118, 24, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = ROOM.ringInner;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, 102, 19, 0, 0, TAU);
    ctx.stroke();
  };
  const ringFrame = (): void => {
    ctx.translate(px, py);
    ctx.rotate((-14 * Math.PI) / 180);
  };

  ctx.save();
  ringFrame();
  rings();
  ctx.restore();

  ctx.fillStyle = vgrad(ctx, py - pr, py + pr, ROOM.planet);
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, TAU);
  ctx.fill();
  ctx.fillStyle = ROOM.band;
  ctx.globalAlpha = 0.45;
  ctx.fillRect(px - 40, py - 17, 80, 6);
  ctx.globalAlpha = 0.35;
  ctx.fillRect(px - 34, py + 3, 68, 5);
  ctx.globalAlpha = 1;

  // The near half of the ring crosses in front of the disc, so it is drawn twice:
  // whole, then again through a clip that keeps only what is below the centre line.
  ctx.save();
  ringFrame();
  ctx.beginPath();
  ctx.rect(-115, 0, 240, 74);
  ctx.clip();
  rings();
  ctx.restore();

  ctx.strokeStyle = ROOM.planetEdge;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(px, py, pr, 0, TAU);
  ctx.stroke();

  // 3. The crew, standing on the sill.
  PIECE_CREW.forEach((figure) => paintCrewFigure(ctx, figure, feet));
  ctx.restore();


  // 4. The frame: the bezel, then the lip that stops at the sill.
  ctx.strokeStyle = ROOM.bezel;
  ctx.lineWidth = 6;
  roundRect(ctx, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r);
  ctx.stroke();

  ctx.strokeStyle = ROOM.lip;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(82, LIP_B);
  ctx.lineTo(82, 74);
  ctx.quadraticCurveTo(82, 52, 104, 52);
  ctx.lineTo(616, 52);
  ctx.quadraticCurveTo(638, 52, 638, 74);
  ctx.lineTo(638, LIP_B);
  ctx.stroke();

  // 5. The ledge, the console face and its keys.
  ctx.fillStyle = vgrad(ctx, 222, 233, ROOM.ledge);
  ctx.fillRect(0, 222, width, 11);
  ctx.strokeStyle = ROOM.ledgeEdge;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(0, 222);
  ctx.lineTo(width, 222);
  ctx.stroke();
  ctx.strokeStyle = ROOM.ledgeShadow;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 233);
  ctx.lineTo(width, 233);
  ctx.stroke();

  ctx.fillStyle = vgrad(ctx, 326, 400, ROOM.consoleFace);
  ctx.fillRect(0, 326, width, 74);
  ctx.strokeStyle = ROOM.consoleEdge;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, 326);
  ctx.lineTo(width, 326);
  ctx.stroke();

  ctx.fillStyle = ROOM.rivet;
  for (const [rx, ry] of [
    [90, 60],
    [630, 60],
    [90, 202],
    [630, 202],
  ]) {
    ctx.beginPath();
    ctx.arc(rx, ry, 2.6, 0, TAU);
    ctx.fill();
  }

  for (let x = 152; x < 600; x += 56) {
    ctx.fillStyle = ROOM.key;
    ctx.strokeStyle = ROOM.keyEdge;
    ctx.lineWidth = 1.2;
    roundRect(ctx, x, 384, 40, 16, 4);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = ROOM.keyGloss;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 5, 391);
    ctx.lineTo(x + 35, 391);
    ctx.stroke();
  }

  const lamps: Array<[number, string]> = [
    [40, ROOM.amber],
    [62, ROOM.teal],
  ];
  for (const [lx, colour] of lamps) {
    ctx.fillStyle = colour;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.arc(lx, 346, 4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(lx, 346, 7, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 6. The two pieces of chrome this theme prints on the canvas rather than in DOM:
  //    the seat legend under the card, and the marquee above the frame.
  for (const seat of scene.legend) {
    ctx.fillStyle = seat.color;
    ctx.beginPath();
    ctx.arc(seat.x, 356, 7.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = seat.color;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.ellipse(seat.x, 368, 15, 5, 0, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = ROOM.cream;
    ctx.font = '8.5px "Atkinson Hyperlegible Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(seat.label, seat.x, 341);
  }

  ctx.save();
  ctx.font = '13px "Atkinson Hyperlegible Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = scene.marqueeColor;
  ctx.shadowColor = scene.marqueeColor;
  ctx.shadowBlur = 11;
  ctx.fillText(marquee, 360, 30);
  ctx.restore();

  // The room is a room: nothing drifts but the light. Its frame is handed in anyway,
  // because a painter that could not take one could not be swapped for the other.
  void frame;
}


/**
 * Paint one frame of whichever card the theme picked.
 *
 * One entry point, so the hook has no `switch` of its own and a third theme is one
 * painter plus one scene, not a third branch in two files.
 */
export function paintHero(
  ctx: CanvasRenderingContext2D,
  scene: HeroScene,
  state: SceneState,
  frame: HeroFrame,
  marquee: string,
): void {
  if (scene.kind === 'room') paintRoom(ctx, scene, state, frame, marquee);
  else paintSynthwave(ctx, scene, state, frame, marquee);
}

