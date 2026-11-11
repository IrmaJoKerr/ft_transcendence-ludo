import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { GOAL_FX_MS } from '../__shared__/timing.constants';

// The confetti's one keyframe, injected once. It is a throw and a fall in three stops: out
// of the cell and up, arcing over, then down past the square. `GOAL_FX_MS` stays in the
// inline `animation` strings so the overlay's length has one source.
const KEYFRAMES_ID = 'goal-confetti-keyframes';

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
      @keyframes goalConfetti {
        0%   { transform: translate(0, 0) rotate(0deg) scaleX(.4); opacity: 0; }
        7%   { opacity: 1; }
        42%  { transform: translate(calc(var(--dx) * .55), calc(var(--dy) * .16 - 46px)) rotate(calc(var(--rot) * .45)) scaleX(1); opacity: 1; }
        82%  { opacity: 1; }
        100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)) scaleX(.55); opacity: 0; }
      }
    `;
  document.head.appendChild(style);
}

// Twenty pieces: a hand-laid spread rather than a random one, so two goals in one game
// throw the same shape and the overlay never depends on `Math.random` at paint time. The
// `dy` values all clear +40 so no piece lands back on the square it came from — the piece
// has left it, and a square still wearing confetti reads as a piece still there.
const PIECES = [
  { dx: -66, dy: 96, rot: -320, delay: 40, size: 7, white: false },
  { dx: -54, dy: 128, rot: 250, delay: 0, size: 6, white: true },
  { dx: -44, dy: 74, rot: 380, delay: 90, size: 8, white: false },
  { dx: -36, dy: 142, rot: -210, delay: 20, size: 6, white: false },
  { dx: -28, dy: 88, rot: 300, delay: 120, size: 7, white: true },
  { dx: -20, dy: 120, rot: -410, delay: 60, size: 6, white: false },
  { dx: -12, dy: 66, rot: 220, delay: 10, size: 8, white: false },
  { dx: -4, dy: 134, rot: -290, delay: 100, size: 6, white: true },
  { dx: 4, dy: 82, rot: 350, delay: 30, size: 7, white: false },
  { dx: 12, dy: 112, rot: -240, delay: 130, size: 6, white: false },
  { dx: 20, dy: 70, rot: 300, delay: 50, size: 8, white: true },
  { dx: 28, dy: 138, rot: -360, delay: 15, size: 6, white: false },
  { dx: 36, dy: 86, rot: 260, delay: 110, size: 7, white: false },
  { dx: 44, dy: 118, rot: -300, delay: 70, size: 6, white: true },
  { dx: 52, dy: 64, rot: 330, delay: 5, size: 8, white: false },
  { dx: 60, dy: 132, rot: -220, delay: 95, size: 6, white: false },
  { dx: 68, dy: 92, rot: 280, delay: 35, size: 7, white: true },
  { dx: -50, dy: 52, rot: 400, delay: 80, size: 5, white: true },
  { dx: 2, dy: 46, rot: -380, delay: 125, size: 5, white: false },
  { dx: 46, dy: 44, rot: 240, delay: 55, size: 5, white: false },
];

/**
 * The goal's confetti — twenty pieces thrown from a 0×0 anchor at its parent's origin,
 * for `GOAL_FX_MS` (32.5).
 *
 * This is the overlay a room with its effects rule **off** gets, and it is the whole of
 * that celebration: the starburst before it and the fanfare with it are not the rule's
 * business. With the rule on the ramp card takes its place — the two are never mounted
 * together, and `Game.tsx` picks between them from `view.captureFx` alone.
 *
 * Pure cosmetic: no input, no layout.
 */
export function GoalConfetti({ color }: { color: string }) {
  useEffect(ensureKeyframes, []);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        pointerEvents: 'none',
      }}
    >
      {PIECES.map((p, i) => (
        <div
          key={i}
          style={
            {
              position: 'absolute',
              left: -p.size / 2,
              top: -p.size / 2,
              width: p.size,
              height: p.size * 0.6,
              borderRadius: 1,
              background: p.white ? '#ffffff' : color,
              boxShadow: p.white ? `0 0 6px ${color}` : 'none',
              // Each piece's own clock ends exactly with the overlay, so the last piece
              // lands on the last frame and nothing is still falling when the layer
              // unmounts.
              animation: `goalConfetti ${GOAL_FX_MS - p.delay}ms cubic-bezier(.25,.6,.4,1) ${p.delay}ms both`,
              '--dx': `${p.dx}px`,
              '--dy': `${p.dy}px`,
              '--rot': `${p.rot}deg`,
            } as CSSProperties & Record<'--dx' | '--dy' | '--rot', string>
          }
        />
      ))}
    </div>
  );
}
