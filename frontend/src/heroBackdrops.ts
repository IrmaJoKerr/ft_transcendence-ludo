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

import type { HeroScene, RoomScene, Synthwave80sScene } from './heroScenes';

/** One drifting star. `y` is advance-mutated by the painter, as it always was. */
export type Star = { x: number; y: number; size: number; speed: number; alpha: number };

/** One tumbling meteor crossing the room window. */
export type Meteor = { x: number; y: number; vx: number; vy: number; len: number; alpha: number };

/** The clocks the painters advance, shared by both cards. */
export type HeroFrame = { time: number; gridOffset: number };

/** What a scene carries between frames: its starfield, seeded once per scene, the
 *  scene's own still once it has decoded (`sceneArt`), and the room's meteors. */
export type SceneState = {
  stars: Star[];
  room?: { key: string; canvas: HTMLCanvasElement | OffscreenCanvas };
  plateImg?: HTMLImageElement;
  meteors?: Meteor[];
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
/** One meteor at a random edge, drifting across the card at a slow tumble. */
function seedMeteor(width: number): Meteor {
  const fromLeft = Math.random() < 0.5;
  return {
    x: fromLeft ? -50 : width + 50,
    y: 40 + Math.random() * 190,
    vx: fromLeft ? 0.1 + Math.random() * 0.1 : -(0.1 + Math.random() * 0.1),
    vy: (Math.random() - 0.5) * 0.14,
    len: 10 + Math.random() * 20,
    alpha: 0.35 + Math.random() * 0.5,
  };
}

function seedMeteors(count: number, width: number): Meteor[] {
  return Array.from({ length: count }, () => seedMeteor(width));
}

export function createSceneState(scene: HeroScene, width: number): SceneState {
  if (scene.kind === 'room') {
    // The sky is the window, not the card: pinpricks between y 50 and 210, which is
    // the aperture's own band with a margin so none lands on the bezel.
    return {
      stars: seedPinpricks(scene.starCount, 6, width - 6, 50, 210),
      meteors: seedMeteors(5, width),
    };
  }
  return { stars: seedStars(scene.starCount, width, scene.horizonY) };
}

/** The 70s room's palette. These are the same values as
 *  `styles/themes/retro70/theme.css` and the art's walnut: a canvas cannot read a CSS
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
 * The window: the app's own bands, top to bottom — marquee 30, frame 30..230, ledge
 * 234..245, the press-start card (DOM) below the canvas, the legend 341..373, the
 * console 326..400. The opening is y 30..230 and x 74..646, taller and rounder than
 * it was, so the colony centrepiece has room to breathe.
 */
const WIN = { x: 74, y: 30, w: 572, h: 200, r: 40 } as const;
const LIP_B = 229;

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

/** The four nudges that make a glyph's halo: left, right, up, down. */
const LABEL_HALO = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

/**
 * The 80s card: the era's own still, drifting stars, four hologram nodes and the
 * marquee on top — or, until that still decodes, the sunset this card used to be:
 * a banded sun, a horizon grid running towards the camera, and the same stars,
 * nodes and marquee over it.
 */
export function paintSynthwave(
  ctx: CanvasRenderingContext2D,
  scene: Synthwave80sScene,
  state: SceneState,
  frame: HeroFrame,
  marquee: string,
): void {
  const { width, height } = ctx.canvas;
  const horizonY = scene.horizonY;
  const time = frame.time;

  ctx.clearRect(0, 0, width, height);

  // 1. Deep Canvas Background with gradient. Not decoration: this is what the card
  //    shows for the frames before its still decodes, and forever if it never
  //    does, because a plate that cannot resolve must not blank a surface.
  const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
  bgGrad.addColorStop(0, scene.bgTop);
  bgGrad.addColorStop(0.65, scene.bgMid);
  bgGrad.addColorStop(1, scene.bgBot);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const plated = paintPlate(ctx, scene, state);

  // 2. Distant Sun — only as the fallback. The still carries a sun of its own,
  //    drawn as the upper half of a disc with its rim on the horizon, so the two
  //    compositions are the same shot: whichever is up, the frame does not jump.
  if (!plated) paintSun(ctx, scene);

  // 3. Floating Stars — over either ground. The still's sky is a still; these are
  //    the only thing in it that moves.
  state.stars.forEach((st) => {
    st.y += st.speed;
    if (st.y > horizonY) st.y = 0;
    ctx.fillStyle = `rgba(${scene.starfield}, ${st.alpha * (0.8 + 0.2 * Math.sin(time * 3 + st.x))})`;
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.size, 0, Math.PI * 2);
    ctx.fill();
  });

  // 4. Horizon Perspective Grid — the other half of the drawn card, retired with
  //    the sun: the still's ground already carries one, in the same perspective
  //    from the same vanishing point, so a second would only fight it.
  if (!plated) paintGrid(ctx, scene, frame.gridOffset);

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
    // The plate put a bright ground under this line, and the red seat over the
    // still's magenta reflection measured 1.98:1 without help. A one-pixel halo in
    // the card's own ground colour is the caption every photograph gets: the glyph
    // keeps its seat hue and the ground stops competing with it. The halo carries
    // the label alone — the node keeps its glow, which is what makes it a hologram.
    ctx.shadowBlur = 0;
    ctx.fillStyle = scene.bgBot;
    for (const [dx, dy] of LABEL_HALO) {
      ctx.fillText(p.label, p.x + dx, p.y - 13 + pulse + dy);
    }
    ctx.fillStyle = p.color;
    ctx.fillText(p.label, p.x, p.y - 13 + pulse);
    ctx.restore();
  });

  // 6. Marquee Title on Top of Screen
  ctx.save();
  ctx.font = '13px "Atkinson Hyperlegible Next", sans-serif';
  ctx.textAlign = 'center';
  // Same reason as the labels above, at 13px: the sky behind it is a photograph
  // now, stars included, and one of those stars is the brightest pixel in the
  // marquee's band.
  ctx.fillStyle = scene.bgBot;
  for (const [dx, dy] of LABEL_HALO) {
    ctx.fillText(marquee, 360 + dx, 28 + dy);
  }
  ctx.fillStyle = scene.marqueeColor;
  ctx.shadowColor = scene.marqueeColor;
  ctx.shadowBlur = 11;
  ctx.fillText(marquee, 360, 28);
  ctx.shadowBlur = 0;
  ctx.restore();
}

/**
 * The card's still, or `false` while it has not decoded.
 *
 * Cover-cropped to the card rather than stretched, then positioned by its own
 * horizon instead of by its centre: the art draws its ground's haze line 62 per
 * cent down, the card's own horizon is at 65, and putting one on the other is what
 * keeps the skyline above the grid and makes the swap from the drawn fallback
 * invisible. The dim over it is the navy the shell dims its plate with — lighter
 * alphas, because what reads over this one is a marquee and four labels.
 */
function paintPlate(
  ctx: CanvasRenderingContext2D,
  scene: Synthwave80sScene,
  state: SceneState,
): boolean {
  const img = state.plateImg;
  if (!img?.complete || img.naturalWidth === 0) return false;

  const { width, height } = ctx.canvas;
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, (width - w) / 2, scene.horizonY - scene.plate.horizon * h, w, h);

  const dim = ctx.createLinearGradient(0, 0, 0, height);
  dim.addColorStop(0, scene.plate.dim[0]);
  dim.addColorStop(1, scene.plate.dim[1]);
  ctx.fillStyle = dim;
  ctx.fillRect(0, 0, width, height);
  return true;
}

/** The drawn sunset: the upper half of a disc, plus scanlines that share its clip
 *  path so a stroke cannot reach past the silhouette. */
function paintSun(ctx: CanvasRenderingContext2D, scene: Synthwave80sScene): void {
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

  // Kept translucent so they band the sun instead of painting solid black over it.
  ctx.strokeStyle = scene.sun.scanline;
  ctx.lineWidth = 2;
  for (let sy = sunY - 60; sy < sunY; sy += 8) {
    ctx.beginPath();
    ctx.moveTo(360 - sunRadius, sy);
    ctx.lineTo(360 + sunRadius, sy);
    ctx.stroke();
  }
  ctx.restore();
}

/** The ground grid: lines running towards the camera, then the radiating ones from
 *  the vanishing point at (360, `horizonY`). `gridOffset` scrolls the former. */
function paintGrid(
  ctx: CanvasRenderingContext2D,
  scene: Synthwave80sScene,
  gridOffset: number,
): void {
  const { width, height } = ctx.canvas;

  ctx.save();
  ctx.strokeStyle = scene.gridColor;
  ctx.lineWidth = 1;

  for (let gy = 0; gy < 140; gy += 14) {
    const y = scene.horizonY + Math.pow((gy + gridOffset) / 145, 1.8) * 140;
    if (y <= height) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  for (let x = -250; x <= width + 250; x += 45) {
    ctx.beginPath();
    ctx.moveTo(360, scene.horizonY);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.restore();
}

/* ------------------------------------------------------------------------------------
   THE ROOM: the four seats, drawn from `game/pieceParts.ts`
   ------------------------------------------------------------------------------------ */

const TAU = Math.PI * 2;

/**
 * The 70s card: a walnut lounge, a porthole onto the orbital colony, and the four
 * seats standing in the window under the marquee.
 *
 * The bands are the app's own and nothing crosses them: the wall and its panelling
 * stop above the ledge at 234, the sky is clipped to the opening (74..646 × 30..230),
 * the ledge fills 234..245, the press-start card is DOM below the canvas, the legend
 * prints at 341..373 and the console face takes 326..400. That is why the opening is
 * 200 tall and not 174: the colony centrepiece needs the room.
 *
 * **Painted once, then blitted.** Nothing in this room moves: not the stars, not the
 * lamps, not the planet's slow turn. The two things that can change are the marquee,
 * which follows the language, and the still, which arrives on its own schedule — so
 * the sheet is cached under both and rebuilt only when one of them changes. The
 * still is the reason this key exists at all: a sheet painted before the colony
 * decoded would otherwise be reused forever, and a cold load would show a window
 * with no colony in it. That matters because every body gradient has to be built in
 * the current transform, so painting the room from scratch is more per-frame
 * allocation than the 80s card spends — and this card is a still.
 */
export function paintRoom(
  ctx: CanvasRenderingContext2D,
  scene: RoomScene,
  state: SceneState,
  frame: HeroFrame,
  marquee: string,
): void {
  const { width, height } = ctx.canvas;
  const img = state.plateImg;
  const art = !!img?.complete && img.naturalWidth > 0;
  // The readiness leads the key, so a sheet painted before the still arrived can
  // never be mistaken for one painted after it, whatever the marquee says.
  const key = `${art ? 'still' : 'empty'}:${marquee}`;

  if (!state.room || state.room.key !== key || state.room.canvas.width !== width) {
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
    state.room = { key, canvas };
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

/**
 * Paint one frame of the room's slowly turning planet: a lit sphere with banded
 * cloud stripes and an equatorial belt, rotated by the frame clock.
 */
function paintRotatingPlanet(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  t: number,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t * 0.035);

  const body = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, r);
  body.addColorStop(0, '#ffd27a');
  body.addColorStop(0.5, '#f28a0f');
  body.addColorStop(1, '#8e2b0a');
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fill();

  ctx.strokeStyle = ROOM.band;
  ctx.lineWidth = 2.6;
  const turn = t * 0.035;
  for (const rr of [r * 0.9, r * 0.62, r * 0.35]) {
    ctx.beginPath();
    ctx.arc(0, 0, rr, -2.2 + turn, -0.9 + turn);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0.9 + turn, 2.2 + turn);
    ctx.stroke();
  }

  ctx.fillStyle = ROOM.band;
  ctx.beginPath();
  ctx.ellipse(0, 0, r * 0.92, r * 0.14, turn, 0, TAU);
  ctx.fill();

  ctx.restore();
}

/**
 * Advance and paint the meteors tumbling past the window; each one respawns at a
 * random edge once it leaves the card.
 */
function paintMeteors(ctx: CanvasRenderingContext2D, state: SceneState): void {
  const { width, height } = ctx.canvas;
  ctx.lineWidth = 1.3;
  state.meteors?.forEach((m) => {
    m.x += m.vx;
    m.y += m.vy;
    if (m.x < -60 || m.x > width + 60 || m.y < -60 || m.y > height + 60) {
      Object.assign(m, seedMeteor(width));
    }
    ctx.strokeStyle = `rgba(255, 231, 189, ${m.alpha})`;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - m.vx * m.len, m.y - m.vy * m.len);
    ctx.stroke();
  });
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

  // 2. The view: sky, stars, the colony centrepiece, a slowly rotating planet
  //    and the occasional meteor — all clipped to the opening.
  ctx.save();
  roundRect(ctx, WIN.x, WIN.y, WIN.w, WIN.h, WIN.r);
  ctx.clip();

  ctx.fillStyle = vgrad(ctx, 40, WIN.y + WIN.h, ROOM.sky);
  ctx.fillRect(WIN.x - 4, 40, WIN.w + 8, WIN.h - 6);

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

  // Centrepiece: the orbital colony, cover-cropped to the opening once it loads.
  const colony = state.plateImg;
  if (colony?.complete && colony.naturalWidth > 0) {
    const scale = Math.max(WIN.w / colony.naturalWidth, WIN.h / colony.naturalHeight);
    const sw = colony.naturalWidth * scale;
    const sh = colony.naturalHeight * scale;
    ctx.globalAlpha = 0.82;
    ctx.drawImage(colony, WIN.x + (WIN.w - sw) / 2, WIN.y + (WIN.h - sh) / 2, sw, sh);
    ctx.globalAlpha = 1;
  }

  // The planet turns imperceptibly beneath the colony lights.
  paintRotatingPlanet(ctx, WIN.x + WIN.w / 2, WIN.y + WIN.h / 2, 60, frame.time);

  // Occasional meteors tumble past the window.
  paintMeteors(ctx, state);

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

