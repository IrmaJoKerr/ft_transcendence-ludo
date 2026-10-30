import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { CAPTURE_FX_MS } from '../game/timing';

// The burst's two keyframes, injected once however many copies are mounted (the
// board's, and the clash card's dim copy). Durations stay in the inline `animation`
// strings, so CAPTURE_FX_MS is the single source for how long a burst lasts.
const KEYFRAMES_ID = 'capture-fx-keyframes';

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
      @keyframes captureRing {
        from { transform: scale(.2); opacity: .9; }
        to   { transform: scale(1.9); opacity: 0; }
      }
      @keyframes captureSpark {
        from { transform: translate(0,0) scale(1); opacity: 1; }
        to   { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0; }
      }
    `;
  document.head.appendChild(style);
}

// Eight sparks: four on the axes, four on the diagonals, the seat colour alternating
// with white so the burst reads on a dark track cell and on a neon start square alike.
const SPARKS = [
  { dx: 0, dy: -20, size: 7, white: true },
  { dx: 0, dy: 20, size: 7, white: false },
  { dx: -20, dy: 0, size: 6, white: true },
  { dx: 20, dy: 0, size: 6, white: false },
  { dx: -14, dy: -14, size: 5, white: false },
  { dx: 14, dy: -14, size: 5, white: true },
  { dx: -14, dy: 14, size: 5, white: true },
  { dx: 14, dy: 14, size: 5, white: false },
];

/**
 * The capture burst — one expanding ring and eight sparks — drawn around a 0×0
 * anchor at its parent's origin, so the caller decides where on screen it goes: the
 * board anchors it in the landing cell, the clash card's dim copy pins it over the
 * cell the capture happened on. `opacity` multiplies the whole burst (each element's
 * keyframes fade themselves, so it dims rather than replaces them). Pure cosmetic:
 * no input, no layout.
 */
export function CaptureBurst({ color, opacity = 1 }: { color: string; opacity?: number }) {
  useEffect(ensureKeyframes, []);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        opacity,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: -17,
          top: -17,
          width: 34,
          height: 34,
          borderRadius: '50%',
          border: `3px solid ${color}`,
          boxShadow: `0 0 12px ${color}aa`,
          animation: `captureRing ${CAPTURE_FX_MS}ms ease-out forwards`,
        }}
      />
      {SPARKS.map((s, i) => (
        <div
          key={i}
          style={
            {
              position: 'absolute',
              left: -s.size / 2,
              top: -s.size / 2,
              width: s.size,
              height: s.size,
              borderRadius: '50%',
              background: s.white ? '#ffffff' : color,
              animation: `captureSpark ${CAPTURE_FX_MS}ms ease-out forwards`,
              '--dx': `${s.dx}px`,
              '--dy': `${s.dy}px`,
            } as CSSProperties & Record<'--dx' | '--dy', string>
          }
        />
      ))}
    </div>
  );
}
