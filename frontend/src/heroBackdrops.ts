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

import type {
  Colony70sScene,
  HeroPlate,
  HeroScene,
  PlateCircle,
  Synthwave80sScene,
} from './heroScenes';

/** One drifting star. `y` is advance-mutated by the painter, as it always was. */
export type Star = { x: number; y: number; size: number; speed: number; alpha: number };

/** One streak crossing the sky: a short stroke drawn back along its own velocity. */
export type Meteor = { x: number; y: number; vx: number; vy: number; len: number; alpha: number };

/** One tumbling stone crossing the sky: a polygon that turns as it travels. */
export type Rock = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  angle: number;
  spin: number;
  alpha: number;
};

/** The clocks the painters advance, shared by both cards. */
export type HeroFrame = { time: number; gridOffset: number };

/** What a scene carries between frames: its starfield, seeded once per scene, the
 *  scene's own still once it has decoded (`sceneArt`), and whatever drifts across
 *  the card — stars on the 80s card, streaks and stones on the 70s one. */
export type SceneState = {
  stars: Star[];
  plateImg?: HTMLImageElement;
  meteors?: Meteor[];
  rocks?: Rock[];
  /** The 70s card's frame, keyed off the still once it decodes: the pixels the sky
   *  must not be painted over. Null until the still is there, and forever if it is
   *  not — a card with no picture has no frame to hide anything behind. */
  frameMask?: HTMLCanvasElement | null;
  /** The layer the stones and streaks are drawn into before the frame cuts them. */
  skyLayer?: HTMLCanvasElement;
  /** Set once the 70s traffic has been seeded against the still's own porthole. The
   *  first frame the still is up reseeds everything `createSceneState` placed at the
   *  card's edges, so no stone spends its first pass drifting over the colony's
   *  terraces — which is where the card-wide seeds put it, because before the picture
   *  arrives there is no window to enter through. */
  trafficPlaced?: boolean;
};

/** A full turn, for the arcs and ellipses a painter closes. */
const TAU = Math.PI * 2;

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

/**
 * The band the traffic drifts in, as fractions of the porthole's radius either side of
 * its centre: -1 is the window's crown and 0 its middle. The traffic lives above the
 * middle, which is the sky the colony's town sits under — the band `-0.90..-0.28` is
 * the card rows 58 to 196 on a 720×400 card, i.e. under the marquee's baseline and
 * over the tallest spire.
 */
const GLASS_BAND: readonly [number, number] = [-0.9, -0.28];

/** How far outside the glass a streak or a stone is seeded, so it slides out from
 *  behind the frame instead of appearing in the middle of the sky. */
const GLASS_SPAWN_MARGIN = 16;

/** A spawn point on the porthole's rim: the row it enters at, and the side it enters
 *  from. Both painters read it, so a streak and a stone come in through the same
 *  window rather than through two different bands. */
function glassEdge(glass: PlateCircle): { x: number; y: number; fromLeft: boolean } {
  const dy = glass.r * (GLASS_BAND[0] + Math.random() * (GLASS_BAND[1] - GLASS_BAND[0]));
  const y = glass.cy + dy;
  // The chord's half-width at this row: where the glass's edge actually is here, since
  // the window is a circle and its edges lean away from the middle.
  const half = Math.sqrt(Math.max(0, glass.r * glass.r - dy * dy));
  const fromLeft = Math.random() < 0.5;
  const x = glass.cx + (fromLeft ? -1 : 1) * (half + GLASS_SPAWN_MARGIN);
  return { x, y, fromLeft };
}

/** Whether traffic has crossed the whole window and may be seeded again: past the far
 *  edge of the glass, or lost above/below it. `vx` decides which edge is the far one, so
 *  an object still outside the near edge — where it was just seeded — is not reseeded.
 *  The painters fall back to the card-wide bounds while there is no still, and so no
 *  porthole, to measure against. */
function leftGlass(thing: { x: number; y: number; vx: number }, glass: PlateCircle): boolean {
  const dy = Math.abs(thing.y - glass.cy);
  if (dy > glass.r) return true;
  // The chord's half-width at this row: the window is a circle, so its edges lean away
  // from the middle and a fixed x cannot say whether a thing has left it.
  const half = Math.sqrt(Math.max(0, glass.r * glass.r - dy * dy));
  return thing.vx >= 0
    ? thing.x > glass.cx + half + GLASS_SPAWN_MARGIN
    : thing.x < glass.cx - half - GLASS_SPAWN_MARGIN;
}

/** Hold a drifting thing inside the band it was seeded in. The window's rim is where it
 *  would otherwise leave early — the band's top row is only a fraction of a radius under
 *  the crown, so a slow upward drift reaches it long before the far edge — and a stone
 *  that vanishes at the top of the sky reads as a dropped frame rather than as a pass.
 *  The drift is reflected rather than clamped, so a stone keeps moving. */
function holdInBand(thing: { y: number; vy: number }, glass: PlateCircle): void {
  const top = glass.cy + GLASS_BAND[0] * glass.r;
  const bottom = glass.cy + GLASS_BAND[1] * glass.r;
  if (thing.y < top) {
    thing.y = top;
    thing.vy = Math.abs(thing.vy);
  } else if (thing.y > bottom) {
    thing.y = bottom;
    thing.vy = -Math.abs(thing.vy);
  }
}

/** One streak at a random edge, drifting across the sky at a slow crawl. Its band is
 *  the 70s card's air — below the marquee's 28 px baseline, above the colony's domes —
 *  and its pace is a tenth of a pixel a frame: a streak that crossed the card in a
 *  second would read as an effect rather than as distance. Inside the porthole it
 *  enters at the glass's own edge (`glassEdge`); before the still resolves there is no
 *  porthole, so it enters at the card's. */
function seedMeteor(width: number, glass: PlateCircle | null): Meteor {
  const edge = glass ? glassEdge(glass) : null;
  const fromLeft = edge?.fromLeft ?? Math.random() < 0.5;
  return {
    x: edge?.x ?? (fromLeft ? -50 : width + 50),
    y: edge?.y ?? 40 + Math.random() * 150,
    vx: fromLeft ? 0.1 + Math.random() * 0.1 : -(0.1 + Math.random() * 0.1),
    vy: (Math.random() - 0.5) * 0.14,
    len: 10 + Math.random() * 20,
    alpha: 0.2 + Math.random() * 0.3,
  };
}

function seedMeteors(count: number, width: number, glass: PlateCircle | null = null): Meteor[] {
  return Array.from({ length: count }, () => seedMeteor(width, glass));
}

/**
 * One stone at a random edge, tumbling slowly across the same band the streaks use.
 *
 * The smallest is 6 px across and the largest 12, which at this card's scale is a
 * pebble rather than a moon — big enough to keep its cream rim on a sky this busy,
 * small enough not to read as a second porthole — and the spin is 0.002..0.005 rad a
 * frame, so a rotation takes the better part of a minute: the sky should feel like it
 * is drifting, not like it is being shaken.
 *
 * A stone is seeded at the porthole's rim, not at the card's: the window is the only
 * place a rock belongs, and one that appeared over the colony's terraces read as a
 * ghost drifting through the habitat.
 */
function seedRock(width: number, glass: PlateCircle | null): Rock {
  const edge = glass ? glassEdge(glass) : null;
  const fromLeft = edge?.fromLeft ?? Math.random() < 0.5;
  return {
    x: edge?.x ?? (fromLeft ? -20 : width + 20),
    y: edge?.y ?? 40 + Math.random() * 130,
    vx: (fromLeft ? 1 : -1) * (0.06 + Math.random() * 0.08),
    vy: (Math.random() - 0.5) * 0.1,
    r: 3.2 + Math.random() * 2.8,
    angle: Math.random() * TAU,
    spin: (Math.random() < 0.5 ? -1 : 1) * (0.002 + Math.random() * 0.003),
    alpha: 0.45 + Math.random() * 0.3,
  };
}

function seedRocks(count: number, width: number, glass: PlateCircle | null = null): Rock[] {
  return Array.from({ length: count }, () => seedRock(width, glass));
}

/** Seed a scene's state. Both cards get stars; only the 80s card moves them. */
export function createSceneState(scene: HeroScene, width: number): SceneState {
  if (scene.kind === '70s-Colony') {
    // The pinpricks are for the frames before the still decodes: they stand in for
    // the art's own stars, in the band the stones cross, and never move.
    return {
      stars: seedPinpricks(scene.starCount, 4, width - 4, 16, 190),
      meteors: seedMeteors(scene.meteorCount, width),
      rocks: seedRocks(scene.rockCount, width),
    };
  }
  return { stars: seedStars(scene.starCount, width, scene.horizonY) };
}

/** The four nudges that make a glyph's halo: left, right, up, down. */
const LABEL_HALO = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

/**
 * The 80s card: the era's own still, drifting stars and the marquee on top — or,
 * until that still decodes, the sunset this card used to be: a banded sun, a horizon
 * grid running towards the camera, and the same stars and marquee over it.
 *
 * The four hologram nodes that used to stand along the card's bottom edge (RED,
 * GREEN, YELLOW, BLUE, at y 350-360) are gone: the row sat in the card's lowest band,
 * which put four coloured pawn labels on the same line as the cabinet's PRESS TO START
 * button and made the button look like part of the crew's legend. The still says the
 * era on its own, and the marquee is the one line the card needs.
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

  const plated = paintPlate(ctx, scene.plate, state);

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

  // 5. Marquee Title on Top of Screen
  paintMarquee(ctx, marquee, scene.marqueeColor, scene.bgBot);
}

/**
 * The marquee: one line, 13 px, centred on the card's midline at y 28, in the scene's
 * own accent with a one-pixel halo in the card's ink.
 *
 * Both cards want exactly this and want it for the same reason: the sky behind it is a
 * photograph, and the brightest pixel in that band is never the type. Four nudges
 * rather than a shadow, so a glyph stays crisp while the glow does its work — the 80s
 * card measured 1.98:1 before the halo, and the 70s card's worst pixel is 1.95:1
 * (todo.md 34, decision 10). The offset is one pixel because the card is drawn at its
 * own 720×400 and never scaled.
 */
function paintMarquee(
  ctx: CanvasRenderingContext2D,
  text: string,
  colour: string,
  halo: string,
): void {
  ctx.save();
  ctx.font = '13px "Atkinson Hyperlegible Next", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = halo;
  for (const [dx, dy] of LABEL_HALO) {
    ctx.fillText(text, 360 + dx, 28 + dy);
  }
  ctx.fillStyle = colour;
  ctx.shadowColor = colour;
  ctx.shadowBlur = 11;
  ctx.fillText(text, 360, 28);
  ctx.shadowBlur = 0;
  ctx.restore();
}

/** Where the still lands on the card: cover-cropped rather than stretched, and its art row
 *  `horizon` put on the card row `at`. The painter and the frame mask both read it, so a
 *  mask keyed off these pixels cannot drift away from the pixels it was keyed from. */
function placePlate(
  plate: HeroPlate,
  img: HTMLImageElement,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  return { x: (width - w) / 2, y: plate.at - plate.horizon * h, w, h };
}

/** One circle of the still, on the card: `art` is in the art's own fractions, and this is
 *  the same placement the still is drawn with, so the porthole and the planet stay on the
 *  glass and the disc whatever the crop does. The radius rides the width because the
 *  placement scales both axes by one factor. */
function plateCircle(
  plate: HeroPlate,
  img: HTMLImageElement,
  width: number,
  height: number,
  art: PlateCircle,
): PlateCircle {
  const { x, y, w, h } = placePlate(plate, img, width, height);
  return { cx: x + art.cx * w, cy: y + art.cy * h, r: art.r * w };
}

/**
 * The card's still, or `false` while it has not decoded.
 *
 * One placement for both eras, out of the plate's own two numbers: the art is
 * cover-cropped to the card rather than stretched, and the art row `plate.horizon`
 * is put on the card row `plate.at`. The 80s card uses it to put the art's haze line
 * (62 per cent down) on its own horizon at 260, which keeps the skyline above the
 * grid and makes the swap from the drawn fallback invisible; the 70s card pins the
 * art's top edge to the card's, because a poster has no horizon to line up with.
 *
 * The dim over it comes from the plate too: each era dims with its own ink, and the
 * alphas are the portrait's — what reads over a plate is a marquee rather than body
 * text.
 */
function paintPlate(
  ctx: CanvasRenderingContext2D,
  plate: HeroPlate,
  state: SceneState,
): boolean {
  const img = state.plateImg;
  if (!img?.complete || img.naturalWidth === 0) return false;

  const { width, height } = ctx.canvas;
  const { x, y, w, h } = placePlate(plate, img, width, height);
  ctx.drawImage(img, x, y, w, h);

  const dim = ctx.createLinearGradient(0, 0, 0, height);
  dim.addColorStop(0, plate.dim[0]);
  dim.addColorStop(1, plate.dim[1]);
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
   THE COLONY: the era's own still, with stones tumbling across its sky
   ------------------------------------------------------------------------------------ */

/**
 * Seven facets at fixed angles, as multiples of a stone's own radius, so every stone
 * is the same stone turned: a random outline per stone would make the tumble read as
 * flicker, because the silhouette would change on every respawn.
 */
const ROCK_RIM: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0.95, 0.82],
  [1.85, 1.06],
  [2.8, 0.86],
  [3.7, 1],
  [4.6, 0.78],
  [5.5, 0.92],
];

/**
 * Advance and paint the streaks crossing the sky, each respawning at a random edge
 * once it leaves it.
 *
 * `colour` is the scene's cream rather than a literal because a canvas stroke cannot
 * read a theme's custom property: the streak is this era's own highlight, and the one
 * place it is written down is `RETRO70_CFG.meteorColor`.
 *
 * The context it is handed is the card's own or the sky layer's (`paintColony`): both are
 * the card's size, which is what the card-wide bounds fall back to when `glass` is null
 * (the frames before the still resolves, when there is no porthole to keep to).
 */
function paintMeteors(
  ctx: CanvasRenderingContext2D,
  state: SceneState,
  colour: string,
  glass: PlateCircle | null,
): void {
  const { width } = ctx.canvas;
  ctx.lineWidth = 1.3;
  state.meteors?.forEach((m) => {
    m.x += m.vx;
    m.y += m.vy;
    if (glass) holdInBand(m, glass);
    // The band is the respawn bound as well as the seed's: a streak outside it has
    // left the card, rather than drifted down to cross the marquee.
    if (glass ? leftGlass(m, glass) : m.x < -60 || m.x > width + 60 || m.y < -20 || m.y > 210) {
      Object.assign(m, seedMeteor(width, glass));
    }
    ctx.strokeStyle = `rgba(${colour}, ${m.alpha})`;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - m.vx * m.len, m.y - m.vy * m.len);
    ctx.stroke();
  });
}

/**
 * Advance and paint the stones: a dark polygon with a lit edge, turned by its own
 * spin.
 *
 * The fill is the card's own ground (`bgBot`) rather than a grey of its own, which is
 * what makes a stone read as a silhouette against the sky instead of as a pale blob:
 * backlit rock is dark. The rim is the same cream the streaks use, at two thirds of
 * the stone's own alpha, so a far stone fades as one object rather than as a body and
 * an outline.
 */
function paintRocks(
  ctx: CanvasRenderingContext2D,
  state: SceneState,
  scene: Colony70sScene,
  glass: PlateCircle | null,
): void {
  const { width } = ctx.canvas;
  state.rocks?.forEach((rock) => {
    rock.x += rock.vx;
    rock.y += rock.vy;
    rock.angle += rock.spin;
    if (glass) holdInBand(rock, glass);
    const gone = glass
      ? leftGlass(rock, glass)
      : rock.x < -40 || rock.x > width + 40 || rock.y < -20 || rock.y > 230;
    if (gone) {
      Object.assign(rock, seedRock(width, glass));
      return;
    }

    ctx.save();
    ctx.translate(rock.x, rock.y);
    ctx.rotate(rock.angle);
    ctx.beginPath();
    ROCK_RIM.forEach(([angle, k], i) => {
      const px = Math.cos(angle) * rock.r * k;
      const py = Math.sin(angle) * rock.r * k;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();

    ctx.globalAlpha = rock.alpha;
    ctx.fillStyle = scene.bgBot;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = `rgba(${scene.meteorColor}, ${rock.alpha * 0.7})`;
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
  });
}

/**
 * The colony's frame, as the pixels the sky must not be painted over.
 *
 * The card is a view *out* of the colony: the still's cream metal — the arch across the
 * top corners, the beam that crosses it, the struts and the ring the porthole is set in —
 * stands between the eye and the sky, so a stone that sails over it reads as a scratch on
 * the glass rather than as something passing behind it. The mask is the still's own
 * pixels, keyed once per scene, and the sky is cut with it before it lands on the card.
 *
 * The key is metal, in the three numbers that separate it from everything else on the
 * poster: the metal is never bluer than it is red (the sky is), never more than 0.62
 * saturated (the planet's bands are 0.85) and never darker than 55/255 (its shadows are
 * the floor of it). Everything the eye reads as frame passes; both skies fail at least
 * one test. Keyed off the art rather than a hand-measured clip path, so a replacement
 * still cannot leave an old outline behind — and a still that never decodes has no frame,
 * and so no mask.
 *
 * One hole is punched in it: the planet's disc. The planet is sky rather than frame — a
 * rock crossing in front of it is the one place a stone should be visible over something
 * bright — and the disc's own cream bands are exactly the metal key's third case, so left
 * alone the mask cut a stone in half as it crossed the giant.
 */
const FRAME_SATURATION_MAX = 0.62;
const FRAME_LUMINANCE_MIN = 55;

function plateFrameMask(
  plate: HeroPlate,
  state: SceneState,
  width: number,
  height: number,
  planet: PlateCircle | null,
): HTMLCanvasElement | null {
  if (state.frameMask !== undefined) return state.frameMask;
  const img = state.plateImg;
  // Nothing to key until the still is here, and the answer is not cached: the next frame
  // after it decodes builds the mask.
  if (!img?.complete || img.naturalWidth === 0) return null;

  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const mctx = mask.getContext('2d');
  if (!mctx) {
    state.frameMask = null;
    return null;
  }
  const { x, y, w, h } = placePlate(plate, img, width, height);
  mctx.drawImage(img, x, y, w, h);

  const pixels = mctx.getImageData(0, 0, width, height);
  const data = pixels.data;
  // The planet is sky, not frame: the traffic passes in front of it, and its cream bands
  // would otherwise key as metal and slice a stone in half as it crossed the disc. Its
  // bounding box is all that is tested, so the per-pixel square root never runs.
  const disc = planet
    ? {
        left: planet.cx - planet.r,
        right: planet.cx + planet.r,
        top: planet.cy - planet.r,
        bottom: planet.cy + planet.r,
        cx: planet.cx,
        cy: planet.cy,
        r2: planet.r * planet.r,
      }
    : null;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const sat = max === 0 ? 0 : (max - Math.min(r, g, b)) / max;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    let metal = b <= r + 2 && sat < FRAME_SATURATION_MAX && lum > FRAME_LUMINANCE_MIN;
    if (metal && disc) {
      const px = (i / 4) % width;
      const py = Math.floor(i / 4 / width);
      if (px >= disc.left && px <= disc.right && py >= disc.top && py <= disc.bottom) {
        const dx = px - disc.cx;
        const dy = py - disc.cy;
        if (dx * dx + dy * dy <= disc.r2) metal = false;
      }
    }
    // A mask, not a picture: `destination-out` reads the alpha and ignores the colour.
    data[i] = 0;
    data[i + 1] = 0;
    data[i + 2] = 0;
    data[i + 3] = metal ? 255 : 0;
  }
  mctx.putImageData(pixels, 0, 0);
  state.frameMask = mask;
  return mask;
}

/** The layer the stones and streaks are drawn into: one canvas per scene, kept between
 *  frames rather than allocated on each of them. */
function skyLayer(state: SceneState, width: number, height: number): HTMLCanvasElement {
  const layer = state.skyLayer ?? document.createElement('canvas');
  if (layer.width !== width) layer.width = width;
  if (layer.height !== height) layer.height = height;
  state.skyLayer = layer;
  return layer;
}

/**
 * The 70s card: the orbital colony's own still, full bleed, with its sky moving.
 *
 * The card is one band, not four. The still *is* the card (todo.md 34, decision 7):
 * it is laid down cover-cropped and top-anchored, dimmed, and the only things drawn
 * over it are what the picture cannot have — the stones that tumble across its upper
 * third and the streaks that cross with them, both of them behind the window's frame
 * (`plateFrameMask`) because the frame is in front of the sky, and both of them inside
 * the still's own porthole (`RETRO70_CFG.porthole`), so a stone enters and leaves at the
 * glass's edge rather than drifting over the colony's terraces. The marquee prints last,
 * through the same `paintMarquee` the 80s card uses, because amber over this card's
 * brighter sky measures 8.0:1 at the median and 1.95:1 at its worst, and the halo is
 * what carries that worst case (decision 10).
 *
 * Before the still decodes — and forever if it never does — the card is the retired
 * room's night sky and its pinpricks, with the same stones over them, so a cold load
 * shows a moving sky rather than an empty rectangle. That fallback is three colour
 * stops and no geometry: the room's own painters went with the room.
 */
export function paintColony(
  ctx: CanvasRenderingContext2D,
  scene: Colony70sScene,
  state: SceneState,
  frame: HeroFrame,
  marquee: string,
): void {
  const { width, height } = ctx.canvas;

  // 1. The ground, and what shows before the still arrives.
  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, scene.bgTop);
  sky.addColorStop(0.62, scene.bgMid);
  sky.addColorStop(1, scene.bgBot);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  if (!paintPlate(ctx, scene.plate, state)) {
    for (const star of state.stars) {
      ctx.fillStyle = `rgba(${scene.starfield}, ${star.alpha})`;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size, 0, TAU);
      ctx.fill();
    }
  }

  // 2. What the picture cannot have: stones and streaks, in its own band — and behind the
  //    window's frame rather than over it. They are drawn into a layer and the layer is
  //    cut with the still's own metal before it lands on the card, which is the whole
  //    difference between a stone passing behind a strut and a stone scratching the glass.
  //    A card with no still has no frame: its fallback sky is a gradient, so the traffic
  //    is drawn straight onto it.
  //    The two circles come off the same still: `glass` is the porthole the traffic enters
  //    and leaves through (so no stone ever drifts over the colony's terraces), and
  //    `planet` is the hole the mask leaves for the gas giant.
  const still = state.plateImg;
  const placed = still?.complete && still.naturalWidth > 0 ? still : null;
  const glass = placed ? plateCircle(scene.plate, placed, width, height, scene.porthole) : null;
  const planet = placed ? plateCircle(scene.plate, placed, width, height, scene.planet) : null;
  // The seeds `createSceneState` laid down entered at the card's edges, which is all that
  // can be known before the picture resolves; the first frame with a porthole replaces
  // them with seeds on its rim, so a stone never crosses the colony on its way in.
  if (glass && !state.trafficPlaced) {
    state.trafficPlaced = true;
    state.meteors = seedMeteors(scene.meteorCount, width, glass);
    state.rocks = seedRocks(scene.rockCount, width, glass);
  }
  const mask = plateFrameMask(scene.plate, state, width, height, planet);
  const layer = mask ? skyLayer(state, width, height) : null;
  const skyCtx = layer?.getContext('2d') ?? null;
  if (mask && skyCtx && layer) {
    skyCtx.clearRect(0, 0, width, height);
    paintMeteors(skyCtx, state, scene.meteorColor, glass);
    paintRocks(skyCtx, state, scene, glass);
    skyCtx.globalCompositeOperation = 'destination-out';
    skyCtx.drawImage(mask, 0, 0);
    skyCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(layer, 0, 0);
  } else {
    paintMeteors(ctx, state, scene.meteorColor, glass);
    paintRocks(ctx, state, scene, glass);
  }

  // 3. The marquee, over the brightest thing on the card.
  paintMarquee(ctx, marquee, scene.marqueeColor, scene.bgBot);

  // The frame is not read: the stones advance by their own velocity and this card has
  // no grid to scroll. It stays in the signature because `paintHero` hands one frame
  // to whichever painter the theme picked, and a painter that could not take one
  // could not be swapped for the other.
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
  if (scene.kind === '70s-Colony') paintColony(ctx, scene, state, frame, marquee);
  else paintSynthwave(ctx, scene, state, frame, marquee);
}

