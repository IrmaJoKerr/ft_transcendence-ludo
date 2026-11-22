import type { Colony70sScene, HeroPlate, PlateCircle } from '../heroScenes';
import { TAU, type HeroFrame, type SceneState } from './sceneState';
import { paintMeteors, paintRocks, seedMeteors, seedRocks } from './traffic';
import { paintMarquee, paintPlate, placePlate, plateCircle } from './synthwave';

// The 70s card: frame mask, sky layer and moving traffic.

// The colony's frame, as the pixels the sky must not be painted over.
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

// The layer the stones and streaks are drawn into: one canvas per scene, kept between
//  frames rather than allocated on each of them.
function skyLayer(state: SceneState, width: number, height: number): HTMLCanvasElement {
  const layer = state.skyLayer ?? document.createElement('canvas');
  if (layer.width !== width) layer.width = width;
  if (layer.height !== height) layer.height = height;
  state.skyLayer = layer;
  return layer;
}

// The 70s card: the orbital colony's own still, full bleed, with its sky moving.
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

    // 2. What the picture cannot have: stones and streaks, in its own band — and behind the window's
  // frame rather than over it.
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

    // The frame is not read: the stones advance by their own velocity and this card has no grid to
  // scroll. It stays in the signature because `paintHero` hands one frame to whichever painter the
  // theme picked, and a painter that could not take one could not be swapped for the other.
  void frame;
}
