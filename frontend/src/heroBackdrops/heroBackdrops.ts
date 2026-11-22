import type { HeroScene } from '../heroScenes';
import type { HeroFrame, SceneState } from './sceneState';
import { paintColony } from './colony';
import { paintSynthwave } from './synthwave';

// The attract-mode painters: one function per theme, each handed a scene from `heroScenes.ts` and
// one frame of animation state.

// Paint one frame of whichever card the theme picked.
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
