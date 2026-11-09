import { useEffect, useRef, type RefObject } from 'react';
import { createSceneState, paintHero, type HeroFrame } from '../heroBackdrops';
import { HERO_SCENES } from '../heroScenes';
import type { ThemeType } from '../store';

/**
 * Drives the home cabinet's one canvas: seeds the scene, advances the frame clocks
 * and calls the painter its theme picked, once per animation frame.
 *
 * The frame state lives in this effect rather than in React state on purpose — a
 * `useState` clock at 60 Hz would re-render the whole dashboard sixty times a
 * second to draw on a canvas React does not own. `theme` is the only dependency, so
 * a theme flip tears the loop down and starts the other painter from frame zero;
 * a language switch does not, because the marquee rides a ref that the loop reads
 * each frame (that is what keeps the starfield from being reshuffled by a
 * `useTranslation` re-render).
 */
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

    const scene = HERO_SCENES[theme];
    const state = createSceneState(scene, canvas.width);
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
