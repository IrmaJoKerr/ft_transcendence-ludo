import type { HeroScene } from '../heroScenes';
import { seedMeteors, seedRocks } from './traffic';

// Shared scene state, star seeding and the per-scene state factory.

// One drifting star. `y` is advance-mutated by the painter, as it always was.
export type Star = { x: number; y: number; size: number; speed: number; alpha: number };

// One streak crossing the sky: a short stroke drawn back along its own velocity.
export type Meteor = { x: number; y: number; vx: number; vy: number; len: number; alpha: number };

// One tumbling stone crossing the sky: a polygon that turns as it travels.
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

// The clocks the painters advance, shared by both cards.
export type HeroFrame = { time: number; gridOffset: number };

// What a scene carries between frames: its starfield, seeded once per scene, the
//  scene's own still once it has decoded (`sceneArt`), and whatever drifts across
//  the card — stars on the 80s card, streaks and stones on the 70s one.
export type SceneState = {
  stars: Star[];
  plateImg?: HTMLImageElement;
  meteors?: Meteor[];
  rocks?: Rock[];
    // The 70s card's frame, keyed off the still once it decodes: the pixels the sky
  //  must not be painted over. Null until the still is there, and forever if it is
  //  not — a card with no picture has no frame to hide anything behind.
  frameMask?: HTMLCanvasElement | null;
    // The layer the stones and streaks are drawn into before the frame cuts them.
  skyLayer?: HTMLCanvasElement;
        // Set once the 70s traffic has been seeded against the still's own porthole.
  trafficPlaced?: boolean;
};

// A full turn, for the arcs and ellipses a painter closes.
export const TAU = Math.PI * 2;

// The starfield the synthwave card drifts, seeded once per scene.
export function seedStars(count: number, width: number, horizon: number): Star[] {
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * horizon,
    size: Math.random() * 1.8 + 0.5,
    speed: Math.random() * 0.3 + 0.1,
    alpha: Math.random() * 0.7 + 0.3,
  }));
}

// Pinpricks for a static sky: no drift, and a band rather than a whole card.
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

// Seed a scene's state. Both cards get stars; only the 80s card moves them.
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
