import type { Colony70sScene, PlateCircle } from '../heroScenes';
import { TAU, type Meteor, type Rock, type SceneState } from './sceneState';

// Space traffic: seeding, advancing and painting meteors and rocks.

// The band the traffic drifts in, as fractions of the porthole's radius either side of its centre:
// -1 is the window's crown and 0 its middle.
const GLASS_BAND: readonly [number, number] = [-0.9, -0.28];

// How far outside the glass a streak or a stone is seeded, so it slides out from
//  behind the frame instead of appearing in the middle of the sky.
const GLASS_SPAWN_MARGIN = 16;

// A spawn point on the porthole's rim: the row it enters at, and the side it enters
//  from. Both painters read it, so a streak and a stone come in through the same
//  window rather than through two different bands.
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

// Whether traffic has crossed the whole window and may be seeded again: past the far edge of the
// glass, or lost above/below it. `vx` decides which edge is the far one, so an object still
// outside the near edge — where it was just seeded — is not reseeded.
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

// Hold a drifting thing inside the band it was seeded in.
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

// One streak at a random edge, drifting across the sky at a slow crawl.
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

export function seedMeteors(
  count: number,
  width: number,
  glass: PlateCircle | null = null,
): Meteor[] {
  return Array.from({ length: count }, () => seedMeteor(width, glass));
}

// One stone at a random edge, tumbling slowly across the same band the streaks use.
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

export function seedRocks(count: number, width: number, glass: PlateCircle | null = null): Rock[] {
  return Array.from({ length: count }, () => seedRock(width, glass));
}

// Seven facets at fixed angles, as multiples of a stone's own radius, so every stone
// is the same stone turned: a random outline per stone would make the tumble read as
// flicker, because the silhouette would change on every respawn.
const ROCK_RIM: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0.95, 0.82],
  [1.85, 1.06],
  [2.8, 0.86],
  [3.7, 1],
  [4.6, 0.78],
  [5.5, 0.92],
];

// Advance and paint the streaks crossing the sky, each respawning at a random edge once it leaves
// it.
export function paintMeteors(
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

// Advance and paint the stones: a dark polygon with a lit edge, turned by its own spin.
export function paintRocks(
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
