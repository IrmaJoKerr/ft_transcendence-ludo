import { useEffect, useRef, type RefObject } from 'react';
import { createSceneState, paintHero, type HeroFrame } from '../heroBackdrops';
import { sceneArt } from '../heroScenes';
import { THEME_BY_ID, type ThemeType } from '../styles/themes';

// Drives the home cabinet's one canvas: seeds the scene, advances the frame clocks and calls the
// painter its theme picked, once per animation frame.
export function useHeroScene(
  theme: ThemeType,
  marquee: string,
): RefObject<HTMLCanvasElement | null> {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const marqueeRef = useRef(marquee);

  useEffect(() => {
    marqueeRef.current = marquee;
  }, [marquee]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scene = THEME_BY_ID[theme].heroScene;
    const state = createSceneState(scene, canvas.width);
        // The scene's own still loads in the background; the rAF loop paints it the frame it decodes, and
    // until then the painter draws what that card was before it had one. The file sits in its theme's
    // folder (todo.md 33, decision 19) and `sceneArt` is what says which file belongs to which scene.
    const art = new Image();
    art.src = sceneArt(scene);
    state.plateImg = art;
    const frame: HeroFrame = { time: 0, gridOffset: 0 };

    let animId = 0;
    const loop = () => {
      frame.time += 0.02;
      frame.gridOffset = (frame.gridOffset + 1.3) % 26;
      paintHero(ctx, scene, state, frame, marqueeRef.current);
      animId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, [theme]);

  return canvasRef;
}
