import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { COL } from '../theme';
import type { PlayerColor } from './types';
import { PIECE_GLYPH } from './boardGeometry';
import { RESULT_FX_MS, RESULT_HEADLINE_READ_MS } from '../__shared__/timing.constants';
import { retroAudio } from '../utils/audio';

/**
 * The two gestures a clash round can end on, named for what the round was about:
 *
 *   capture  the attacker won — the beam punctures the defender's dome and a layer
 *            goes out (a wall) or the captured piece falls (a 1v1). At n === 1 on a
 *            wall it is the total breach: the last layer collapses and the bloom fires.
 *   repulse  the defender won — the beam meets the dome, the barrier flares, the beam
 *            deflects and the attacker's piece is dragged off. One shape at any n,
 *            because the wall is not what the round was about.
 *
 * A single `n` (the layer count) parameterises the whole set, so the five object
 * animations of the first cut collapse into two readable gestures.
 */
export type ResultFxKind = 'capture' | 'repulse';

// The keyframes, injected once for however many cards render them. Durations are NOT
// written in here: `fx()` builds each `animation` string from RESULT_FX_MS minus that
// element's own stagger, so every gesture lands exactly on the budget and nothing can
// play past the card it belongs to. The read-window banner is the one exception: it
// uses `readFx()`, which starts at RESULT_FX_MS and runs for RESULT_HEADLINE_READ_MS.
const KEYFRAMES_ID = 'result-fx-keyframes';

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
      @keyframes fxFade {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      @keyframes fxFadeIn {
        from { opacity: 0; }
        to   { opacity: 1; }
      }
      /* capture: the beam leaves the attacker and reaches the dome (0-260 ms). */
      @keyframes fxBeam {
        0%   { transform: translateX(-150px); opacity: 0; }
        4%   { opacity: 1; }
        13%  { transform: translateX(0); opacity: 1; }
        20%  { transform: translateX(0); opacity: 0; }
        100% { opacity: 0; }
      }
      /* the wall flares where the beam lands (puncture, 260-420 ms). */
      @keyframes fxPuncture {
        0%, 13% { transform: scale(.4); opacity: 0; }
        17%     { transform: scale(1.15); opacity: 1; }
        22%     { transform: scale(1.6); opacity: 0; }
        100%    { opacity: 0; }
      }
      /* a layer glitches TWICE and goes out — no fade-through, no hard cut (420-700). */
      @keyframes fxLayerOut {
        0%, 22%  { transform: translateX(0); opacity: 1; }
        25%      { transform: translateX(var(--g1)); opacity: .25; }
        28%      { transform: translateX(0); opacity: 1; }
        31%      { transform: translateX(var(--g2)); opacity: .25; }
        34%      { transform: translateX(0); opacity: .55; }
        37%,100% { transform: translateX(0); opacity: 0; }
      }
      /* the last layer collapses into the bloom (total breach, 420-700). */
      @keyframes fxLayerCollapse {
        0%, 22%  { transform: scale(1); opacity: 1; }
        30%      { transform: scale(1.04); opacity: .7; }
        37%,100% { transform: scale(.55); opacity: 0; }
      }
      /* the bloom: two rings + a cap, fill-opacity steps, no SVG filters (700-1120). */
      @keyframes fxBloomRing {
        0%, 37%  { transform: scale(.15); opacity: 0; }
        43%      { opacity: .85; }
        58%      { transform: scale(1); opacity: 0; }
        100%     { transform: scale(1); opacity: 0; }
      }
      @keyframes fxBloomRing2 {
        0%, 42%  { transform: scale(.15); opacity: 0; }
        47%      { opacity: .7; }
        58%      { transform: scale(1); opacity: 0; }
        100%     { transform: scale(1); opacity: 0; }
      }
      @keyframes fxBloomCap {
        0%, 40%  { transform: scale(.4); opacity: 0; }
        50%      { transform: scale(1); opacity: .85; }
        58%,100% { transform: scale(1); opacity: .72; }
      }
      /* the cage slams down over a capture (1120-1320). */
      @keyframes fxCage {
        0%, 54%  { transform: translateY(-52px); opacity: 0; }
        58%      { opacity: 1; }
        69%      { transform: translateY(0); opacity: 1; }
        100%     { transform: translateY(0); opacity: 1; }
      }
      /* repulse: the barrier flares (260-420), the beam deflects (420-700). */
      @keyframes fxBarrierFlare {
        0%, 13% { opacity: 0; }
        17%     { opacity: .9; }
        22%     { opacity: 0; }
        100%    { opacity: 0; }
      }
      @keyframes fxDeflect {
        0%, 22%  { transform: translate(0, 0) rotate(0deg); opacity: 0; }
        25%      { opacity: 1; }
        36%      { transform: translate(-46px, -40px) rotate(-42deg); opacity: 0; }
        100%     { opacity: 0; }
      }
      @keyframes fxDragOff {
        0%, 22%  { transform: translate(0, 0) rotate(0deg); opacity: 1; }
        36%      { transform: translate(-120px, 46px) rotate(-22deg); opacity: 0; }
        100%     { transform: translate(-120px, 46px) rotate(-22deg); opacity: 0; }
      }
      /* 1v1 capture: the field cracks and the piece falls (no bloom). */
      @keyframes fxFieldCrack {
        0%, 13%  { opacity: 0; }
        18%      { opacity: .95; }
        28%,100% { opacity: .55; }
      }
      @keyframes fxPieceFall {
        0%, 22%  { transform: translate(0, 0) rotate(0deg); opacity: 1; }
        36%      { transform: translate(8px, 44px) rotate(72deg); opacity: .15; }
        100%     { transform: translate(8px, 44px) rotate(72deg); opacity: 0; }
      }
      /* WALL BROKEN reads in the read window (1900-2900): two pulses at most. */
      @keyframes fxBannerPulse {
        0%       { opacity: 0; }
        3%       { opacity: 1; }
        23%      { opacity: .55; }
        43%      { opacity: 1; }
        63%      { opacity: .55; }
        83%,100% { opacity: 1; }
      }
    `;
  document.head.appendChild(style);
}

/** True while the OS asks for reduced motion; false where the query is unsupported. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// ── Geometry ─────────────────────────────────────────────────────────────────
// One viewBox for every round: the largest dome (four layers) plus a banner row,
// computed once so neither the bloom nor the collapse resizes the stage.
const VB_W = 240;
const VB_H = 180;
const DOME_CX = 150;
const DOME_BASE_Y = 120;
// inner → outer. A four-layer dome is the maximum drawn, so a five-defender wall
// still reads as four rings (the spec's four-layer dome).
const LAYER_R = [26, 42, 56, 70];
const MAX_LAYERS = LAYER_R.length;
const BANNER_Y = 162;
// The bloom is capped at 0.85 of the four-layer dome's width, so it reads as a burst
// over the wall and never as a second wall.
const BLOOM_R = Math.round(0.85 * LAYER_R[MAX_LAYERS - 1]); // ~60
const ONE_ON_ONE_PIECE_X = DOME_CX;
const ONE_ON_ONE_PIECE_Y = 84;

// An eight-point star, centred on the impact, for the puncture flash.
const starAt = (cx: number, cy: number, r = 9) =>
  `M ${cx} ${cy - r} L ${cx + r * 0.28} ${cy - r * 0.28} L ${cx + r} ${cy} ` +
  `L ${cx + r * 0.28} ${cy + r * 0.28} L ${cx} ${cy + r} L ${cx - r * 0.28} ${cy + r * 0.28} ` +
  `L ${cx - r} ${cy} L ${cx - r * 0.28} ${cy - r * 0.28} Z`;


/**
 * The result card's animation stage: one gesture per outcome, played alongside the
 * text rather than before it. `attacker` and `defender` are the round's two seats and
 * the colours do the explaining — the beam and the bloom are the attacker's, the dome
 * and the barrier are the defender's — so both gestures stay readable with no text.
 * `n` is the layer count (remaining defenders + 1); `totalRounds > 1` says the square
 * is a wall, and gates the bloom and the `banner` to the total breach. Cosmetics only:
 * no input, `aria-hidden`, and under `prefers-reduced-motion` every shape becomes a
 * cross-fade of the same length, so the card's timing never moves.
 */
export function ResultFx({
  kind,
  attacker,
  defender,
  n,
  totalRounds,
  banner,
  card = 'clash',
}: {
  kind: ResultFxKind;
  attacker: PlayerColor;
  defender: PlayerColor;
  n: number;
  totalRounds: number;
  banner?: string;
  // Where the card lives, which only changes its SOUND palette (25.5 item 5): the clash
  // card owns all six beats, while a flash card is silent except one cage, because the
  // board's own capture burst already played the hit at the cell.
  card?: 'clash' | 'flash';
}) {
  useEffect(ensureKeyframes, []);
  const reduced = useReducedMotion();
  const attackerColor = COL[attacker].base;
  const defenderColor = COL[defender].base;

  // One clock for the whole gesture: an element that starts `delayMs` late gets exactly
  // RESULT_FX_MS - delayMs of animation, so its last frame IS the last frame of the
  // budget. The read-window banner is the exception (see `readFx`).
  const fx = (name: string, delayMs = 0) =>
    `${reduced ? 'fxFade' : name} ${RESULT_FX_MS - delayMs}ms ease-out both`;
  const readFx = (name: string) =>
    reduced
      ? `fxFadeIn 1ms ease-out ${RESULT_FX_MS}ms both`
      : `${name} ${RESULT_HEADLINE_READ_MS}ms ease-out ${RESULT_FX_MS}ms both`;
  // SVG shapes need their own box for `transform-origin` to mean anything.
  const pivot: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };

  const total = Math.max(1, Math.trunc(totalRounds) || 1);
  const isWall = total > 1;
  const layers = Math.min(Math.max(1, Math.trunc(n) || 1), MAX_LAYERS);
  const isOneOnOne = kind === 'capture' && !isWall;
  const isBreach = kind === 'capture' && isWall && layers === 1;
  // The dome is drawn for a wall (or a repulse's intact barrier); a 1v1 has no wall.
  const domeCount = isOneOnOne ? 0 : kind === 'repulse' ? Math.min(total, MAX_LAYERS) : layers;
  const outerR = LAYER_R[Math.max(0, domeCount - 1)];
  // The beam lands on the current outer layer's 45° flank (a wall) or the captured
  // piece's flank (a 1v1).
  const impactX = isOneOnOne
    ? Math.round(ONE_ON_ONE_PIECE_X - 16)
    : Math.round(DOME_CX - Math.SQRT1_2 * outerR);
  const impactY = isOneOnOne
    ? ONE_ON_ONE_PIECE_Y
    : Math.round(DOME_BASE_Y - Math.SQRT1_2 * outerR);
  const arc = (r: number) =>
    `M ${DOME_CX - r} ${DOME_BASE_Y} A ${r} ${r} 0 0 1 ${DOME_CX + r} ${DOME_BASE_Y}`;

  // Cage footprint: over the dome, or around the captured piece.
  const cageHalf = isOneOnOne ? 26 : outerR + 6;
  const cageTopY = isOneOnOne ? ONE_ON_ONE_PIECE_Y - 30 : DOME_BASE_Y - outerR - 6;
  const cageBars = 5;
  const steel = '#cfc9e6';

  // Six sounds, one per beat, on one table (25.5). Armed once per mounted card and
  // cleared on unmount, so a chain round that unmounts early leaves no timer behind.
  // Every offset lands by 1120 ms, so the 1900-2900 read window is silent under the
  // banner. The capture path plays beam → puncture → a layer out → (bloom, breach only)
  // → the cage; a repulse swaps the puncture for the parry and ends on the failure.
  useEffect(() => {
    // A flash card adds only the cage (~1000 ms): the board's own burst already fired the
    // hit at the cell, so the rest of the palette stays the clash's (25.5 item 5).
    if (card === 'flash') {
      const timer = window.setTimeout(() => retroAudio.playCageSnap(), 1000);
      return () => window.clearTimeout(timer);
    }
    const beats: Array<{ at: number; play: () => void }> = [
      { at: 0, play: () => retroAudio.playLaserBeam() },
    ];
    if (kind === 'repulse') {
      beats.push({ at: 260, play: () => retroAudio.playBarrierDeflect() });
      beats.push({ at: 420, play: () => retroAudio.playAttackFailed() });
    } else {
      beats.push({ at: 260, play: () => retroAudio.playBarrierPuncture() });
      beats.push({ at: 420, play: () => retroAudio.playCageSnap() });
      if (isBreach) beats.push({ at: 700, play: () => retroAudio.playBreachBloom() });
      beats.push({ at: 1120, play: () => retroAudio.playCageSnap() });
    }
    const timers = beats.map(({ at, play }) => window.setTimeout(play, at));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [kind, isBreach, card]);

  return (
    <svg
      aria-hidden='true'
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width='100%'
      height='100%'
      style={{ display: 'block', overflow: 'hidden', pointerEvents: 'none' }}
    >
      {/* the ground the dome stands on */}
      <line
        x1={DOME_CX - LAYER_R[MAX_LAYERS - 1] - 18}
        y1={DOME_BASE_Y}
        x2={DOME_CX + LAYER_R[MAX_LAYERS - 1] + 18}
        y2={DOME_BASE_Y}
        stroke={defenderColor}
        strokeOpacity='.22'
        strokeWidth='2'
      />

      {/* the dome: a wall's shrinking rings, or a repulse's intact barrier */}
      {!isOneOnOne &&
        Array.from({ length: domeCount }, (_, i) => {
          const r = LAYER_R[i];
          const isTopLayer = kind === 'capture' && i === domeCount - 1;
          const anim = !isTopLayer ? undefined : isBreach ? fx('fxLayerCollapse') : fx('fxLayerOut');
          return (
            <path
              key={`dome-${r}`}
              d={arc(r)}
              fill='none'
              stroke={defenderColor}
              strokeOpacity={isTopLayer ? 1 : 0.55}
              strokeWidth={isTopLayer ? 5 : 3}
              style={
                isTopLayer
                  ? ({ ...pivot, '--g1': '5px', '--g2': '-6px', animation: anim } as CSSProperties)
                  : undefined
              }
            />
          );
        })}


      {/* a 1v1: the captured piece stands where a dome would be, then falls */}
      {isOneOnOne && (
        <>
          <g style={{ animation: fx('fxFieldCrack') }}>
            <path
              d={`M ${ONE_ON_ONE_PIECE_X - 22} ${DOME_BASE_Y} L ${ONE_ON_ONE_PIECE_X - 8} ${DOME_BASE_Y - 8} L ${ONE_ON_ONE_PIECE_X - 2} ${DOME_BASE_Y}`}
              fill='none'
              stroke='#e8e2ff'
              strokeOpacity='.85'
              strokeWidth='1.5'
            />
            <path
              d={`M ${ONE_ON_ONE_PIECE_X + 4} ${DOME_BASE_Y} L ${ONE_ON_ONE_PIECE_X + 14} ${DOME_BASE_Y - 6} L ${ONE_ON_ONE_PIECE_X + 24} ${DOME_BASE_Y}`}
              fill='none'
              stroke='#e8e2ff'
              strokeOpacity='.85'
              strokeWidth='1.5'
            />
          </g>
          <g style={{ ...pivot, animation: fx('fxPieceFall') }}>
            <g
              transform={`translate(${ONE_ON_ONE_PIECE_X - 16} ${ONE_ON_ONE_PIECE_Y - 12}) scale(3)`}
              shapeRendering='crispEdges'
            >
              <path d={PIECE_GLYPH[defender]} fill='none' stroke='#000' strokeWidth='1' strokeLinejoin='miter' />
              <path d={PIECE_GLYPH[defender]} fill={defenderColor} />
            </g>
          </g>
        </>
      )}

      {/* the beam — every gesture starts here */}
      <g style={{ animation: fx('fxBeam') }}>
        <rect x='8' y={impactY - 3} width={Math.max(10, impactX - 8)} height='6' rx='3' fill={attackerColor} />
        <rect x={impactX - 12} y={impactY - 5} width='14' height='10' rx='4' fill='#ffffff' opacity='.7' />
      </g>


      {/* where the beam lands: a puncture starburst (capture) or a barrier flare (repulse) */}
      {kind === 'capture' && (
        <path
          d={starAt(impactX, impactY)}
          fill='#ffffff'
          stroke={attackerColor}
          strokeWidth='1.5'
          style={{ ...pivot, animation: fx('fxPuncture') }}
        />
      )}
      {kind === 'repulse' && (
        <>
          <ellipse
            cx={impactX}
            cy={impactY}
            rx={outerR * 0.5}
            ry={outerR * 0.5}
            fill={defenderColor}
            style={{ ...pivot, animation: fx('fxBarrierFlare') }}
          />
          <rect
            x={impactX}
            y={impactY - 3}
            width='40'
            height='6'
            rx='3'
            fill={attackerColor}
            style={{ ...pivot, animation: fx('fxDeflect') }}
          />
          <g style={{ ...pivot, animation: fx('fxDragOff') }}>
            <g transform={`translate(${impactX - 42} ${impactY + 8}) scale(2)`} shapeRendering='crispEdges'>
              <path d={PIECE_GLYPH[attacker]} fill='none' stroke='#000' strokeWidth='1' strokeLinejoin='miter' />
              <path d={PIECE_GLYPH[attacker]} fill={attackerColor} />
            </g>
          </g>
        </>
      )}

      {/* the bloom: the total breach only, two rings + a cap in the victor's colour */}
      {isBreach && (
        <g transform={`translate(${impactX} ${impactY})`}>
          <circle r={BLOOM_R} fill='none' stroke={attackerColor} strokeWidth='3' style={{ ...pivot, animation: fx('fxBloomRing') }} />
          <circle r={Math.round(BLOOM_R * 0.62)} fill='none' stroke='#ffffff' strokeWidth='2' style={{ ...pivot, animation: fx('fxBloomRing2') }} />
          <circle r={Math.round(BLOOM_R * 0.5)} fill={attackerColor} style={{ ...pivot, animation: fx('fxBloomCap') }} />
        </g>
      )}


      {/* the cage slams over a capture, never a repulse */}
      {kind === 'capture' && (
        <g style={{ animation: fx('fxCage') }}>
          <rect x={DOME_CX - cageHalf} y={cageTopY} width={cageHalf * 2} height='4' rx='2' fill={steel} />
          {Array.from({ length: cageBars }, (_, i) => {
            const bx = DOME_CX - cageHalf + ((cageHalf * 2) / (cageBars - 1)) * i;
            return (
              <rect
                key={`bar-${i}`}
                x={bx - 1.5}
                y={cageTopY}
                width='3'
                height={DOME_BASE_Y - cageTopY}
                fill={steel}
                opacity='.85'
              />
            );
          })}
        </g>
      )}

      {/* WALL BROKEN reads only on the total breach, in the read window (1900-2900) */}
      {isBreach && banner && (
        <>
          <text
            x={VB_W / 2}
            y={BANNER_Y}
            textAnchor='middle'
            fontSize='27'
            fontWeight={900}
            fontFamily='var(--font-display)'
            fill='none'
            stroke={attackerColor}
            strokeWidth='6'
            strokeOpacity='.35'
            style={{ animation: readFx('fxBannerPulse') }}
          >
            {banner}
          </text>
          <text
            x={VB_W / 2}
            y={BANNER_Y}
            textAnchor='middle'
            fontSize='27'
            fontWeight={900}
            fontFamily='var(--font-display)'
            fill={attackerColor}
            stroke='#0b0118'
            strokeWidth='0.75'
            paintOrder='stroke'
            style={{ animation: readFx('fxBannerPulse') }}
          >
            {banner}
          </text>
        </>
      )}
    </svg>
  );
}

