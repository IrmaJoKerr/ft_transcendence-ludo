import { useEffect } from 'react';
import { GOAL_BURST_MS } from '../game/timing';
// The starburst's three keyframes, injected once however many copies are mounted. The
// durations stay in the inline `animation` strings, so `GOAL_BURST_MS` is the single
// source for how long the arrival lasts — the same arrangement `CaptureBurst` uses.
const KEYFRAMES_ID = 'goal-burst-keyframes';

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
      @keyframes goalRay {
        0%   { transform: scaleY(.08) scaleX(.45); opacity: 0; }
        14%  { opacity: 1; }
        46%  { transform: scaleY(1) scaleX(1); opacity: 1; }
        100% { transform: scaleY(1.06) scaleX(.1); opacity: 0; }
      }
      @keyframes goalCore {
        0%   { transform: scale(.25); opacity: 0; }
        12%  { transform: scale(1.35); opacity: 1; }
        45%  { transform: scale(1); opacity: .95; }
        100% { transform: scale(2.1); opacity: 0; }
      }
      @keyframes goalShock {
        from { transform: scale(.25); opacity: .95; }
        to   { transform: scale(2.6); opacity: 0; }
      }
    `;
  document.head.appendChild(style);
}

// Twelve rays on a 30° pitch, long and short alternating so the silhouette is a star and
// not a wheel: the four axes and the four diagonals carry the length, the four in between
// are half of it. The seat colour alternates with white, so three rays out of four still
// read on a neon start square and on a dark track cell alike.
const RAYS = [
  { angle: 0, len: 40 },
  { angle: 30, len: 22 },
  { angle: 60, len: 32 },
  { angle: 90, len: 40 },
  { angle: 120, len: 22 },
  { angle: 150, len: 32 },
  { angle: 180, len: 40 },
  { angle: 210, len: 22 },
  { angle: 240, len: 32 },
  { angle: 270, len: 40 },
  { angle: 300, len: 22 },
  { angle: 330, len: 32 },
];

/**
 * The goal's starburst — twelve rays, a hot core and one shock ring — drawn around a 0×0
 * anchor at its parent's origin, so the caller decides where on screen it goes (32.5).
 *
 * It is the arrival, not the celebration: it fires on the piece's last tick, in the same
 * frame the piece leaves its cell, and it plays on EVERY goal whatever the room's effects
 * rule says. The rule picks the overlay that follows it (`GoalConfetti` with the acts off,
 * the ramp card with them on), never whether the piece is seen to arrive.
 *
 * Pure cosmetic: no input, no layout, and its length is its keyframes' length.
 */
export function GoalBurst({ color }: { color: string }) {
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
      {RAYS.map((ray, i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            transform: `rotate(${ray.angle}deg)`,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: -3.5,
              top: -ray.len,
              width: 7,
              height: ray.len,
              transformOrigin: '50% 100%',
              background: `linear-gradient(to top, ${i % 4 === 2 ? '#ffffff' : color}, #ffffff)`,
              clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
              animation: `goalRay ${GOAL_BURST_MS}ms cubic-bezier(.2,.75,.35,1) forwards`,
            }}
          />
        </div>
      ))}
      {/* The core: the cell's own light, gone before the rays are. */}
      <div
        style={{
          position: 'absolute',
          left: -13,
          top: -13,
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: `radial-gradient(circle, #ffffff 22%, ${color} 62%, transparent 72%)`,
          animation: `goalCore ${GOAL_BURST_MS}ms ease-out forwards`,
        }}
      />
      {/* One ring, wider than the rays are long: it is what makes the burst read as a burst
          rather than a star sitting on the square. */}
      <div
        style={{
          position: 'absolute',
          left: -22,
          top: -22,
          width: 44,
          height: 44,
          borderRadius: '50%',
          border: `2px solid ${color}`,
          boxShadow: `0 0 14px ${color}`,
          animation: `goalShock ${GOAL_BURST_MS}ms ease-out forwards`,
        }}
      />
    </div>
  );
}
