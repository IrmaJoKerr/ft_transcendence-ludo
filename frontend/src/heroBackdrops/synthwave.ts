import type { HeroPlate, PlateCircle, Synthwave80sScene } from '../heroScenes';
import type { HeroFrame, SceneState } from './sceneState';

// The 80s card: still placement, the drawn fallback, grid and marquee.

// The four nudges that make a glyph's halo: left, right, up, down.
const LABEL_HALO = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

// The 80s card: the era's own still, drifting stars and the marquee on top — or, until that still
// decodes, the sunset this card used to be: a banded sun, a horizon grid running towards the
// camera, and the same stars and marquee over it.
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

// The marquee: one line, 13 px, centred on the card's midline at y 28, in the scene's own accent
// with a one-pixel halo in the card's ink.
export function paintMarquee(
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

// Where the still lands on the card: cover-cropped rather than stretched, and its art row
//  `horizon` put on the card row `at`. The painter and the frame mask both read it, so a
//  mask keyed off these pixels cannot drift away from the pixels it was keyed from.
export function placePlate(
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

// One circle of the still, on the card: `art` is in the art's own fractions, and this is the same
// placement the still is drawn with, so the porthole and the planet stay on the glass and the disc
// whatever the crop does.
export function plateCircle(
  plate: HeroPlate,
  img: HTMLImageElement,
  width: number,
  height: number,
  art: PlateCircle,
): PlateCircle {
  const { x, y, w, h } = placePlate(plate, img, width, height);
  return { cx: x + art.cx * w, cy: y + art.cy * h, r: art.r * w };
}

// The card's still, or `false` while it has not decoded.
export function paintPlate(
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

// The drawn sunset: the upper half of a disc, plus scanlines that share its clip
//  path so a stroke cannot reach past the silhouette.
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

// The ground grid: lines running towards the camera, then the radiating ones from
//  the vanishing point at (360, `horizonY`). `gridOffset` scrolls the former.
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
