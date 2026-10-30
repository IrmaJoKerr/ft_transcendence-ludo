import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { COL } from '../theme';
import type { PlayerColor } from './types';
import { PIECE_GLYPH } from './boardGeometry';
import { RESULT_FX_MS } from './timing';
import { retroAudio } from '../utils/audio';

/**
 * The five ways a clash round can end, named for the object that plays the beat:
 *
 *   ropes     1v1, attacker wins — the beaten piece is tied up and dragged to its base
 *   shield    1v1, defender wins — the shield holds and the sword snaps
 *   raspberry 1v wall, defender wins ANY round — the taunt (a wall still stands)
 *   brick     1v wall, attacker wins a round — a cannonball punches one brick out
 *   crumble   1v wall, attacker wins every round — the courses let go top-down
 *
 * The set is deliberately all objects the board already speaks (piece, wall, sword,
 * shield, rope): no human figure, so nothing looks borrowed from another game.
 */
export type ResultFxKind = 'ropes' | 'shield' | 'raspberry' | 'brick' | 'crumble';

// The keyframes, injected once for however many cards render them. Durations are NOT
// written in here: `fx()` builds each `animation` string from RESULT_FX_MS minus that
// element's own stagger, so every gesture — and every staggered piece inside it — lands
// exactly on the budget and nothing can play past the card it belongs to.
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
      /* ropes: the piece is tied, then dragged off. */
      @keyframes ropeTie {
        0%, 6%   { stroke-dashoffset: 64; opacity: 0; }
        20%      { opacity: 1; }
        34%,100% { stroke-dashoffset: 0; opacity: 1; }
      }
      @keyframes ropeDrag {
        0%, 30%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
        56%       { transform: translate(-24px, 14px) rotate(-5deg); opacity: 1; }
        100%      { transform: translate(-88px, 52px) rotate(-16deg); opacity: 0; }
      }
      /* shield: it braces, the sword strikes, the blade snaps and the tip falls. */
      @keyframes shieldBrace {
        0%   { transform: translate(-14px, 0); }
        18%  { transform: translate(0, 0); }
        27%  { transform: translate(-4px, 2px); }
        37%,100% { transform: translate(0, 0); }
      }
      @keyframes swordStrike {
        0%   { transform: translate(44px, -44px); opacity: 0; }
        14%  { opacity: 1; }
        26%  { transform: translate(0, 0); opacity: 1; }
        34%  { transform: translate(-4px, 3px); }
        100% { transform: translate(-1px, 1px); opacity: 1; }
      }
      @keyframes swordShard {
        0%, 34% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
        100%    { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; }
      }
      @keyframes impactStar {
        0%, 26%  { transform: scale(.2); opacity: 0; }
        33%      { transform: scale(1.15); opacity: 1; }
        62%,100% { transform: scale(.85); opacity: 0; }
      }
      /* raspberry: the taunt. */
      @keyframes raspberryFace {
        0%   { transform: scale(.5) rotate(-9deg); }
        34%  { transform: scale(1.12) rotate(4deg); }
        58%  { transform: scale(.97) rotate(-2deg); }
        100% { transform: scale(1) rotate(0deg); }
      }
      @keyframes raspberrySpit {
        from { transform: translate(0, 0) scale(1); opacity: 1; }
        to   { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0; }
      }
      /* crumble: one course lets go at a time, top-down, each with its own dust. */
      @keyframes crumbBrick {
        0%, 42% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
        100%    { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; }
      }
      @keyframes crumbDust {
        0%       { transform: translate(0, 0) scale(.35); opacity: 0; }
        22%      { opacity: .5; }
        100%     { transform: translate(0, 18px) scale(2.1); opacity: 0; }
      }
      /* brick: the shot flies flat, one brick leaves, the dust blows out the back. */
      @keyframes ballFly {
        0%   { transform: translate(-150px, 0); opacity: 0; }
        7%   { opacity: 1; }
        42%  { transform: translate(0, 0); opacity: 1; }
        43%,100% { transform: translate(0, 0); opacity: 0; }
      }
      @keyframes brickOut {
        0%, 40% { transform: translate(0, 0) rotate(0deg); opacity: 1; }
        100%    { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; }
      }
      @keyframes puffOut {
        0%, 42% { transform: translate(0, 0) scale(.3); opacity: 0; }
        54%     { opacity: .55; }
        100%    { transform: translate(var(--dx), var(--dy)) scale(2); opacity: 0; }
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

// The wall: twelve bricks in four courses of three. Coordinates are the 200x120 stage,
// shared by the crumble (all four courses) and by the stone the cannonball hits. Each
// brick carries the direction it leaves in, so a collapse reads outwards, not as a
// fade.
//
// The crumble's clock is a fraction of the gesture's budget, not a fixed 170 ms: a
// hardcoded step made the last course start 510 ms in and fall until 1810 ms, i.e. half
// a second past RESULT_FX_MS, which only looked harmless because the card happened to be
// longer than the gesture. As a fraction the four courses always fit, and `fx()` gives
// each brick the remainder of the budget, so the last one lands ON the budget.
const CRUMBLE_COURSES = 4;
const COURSE_DELAY_MS = Math.round(RESULT_FX_MS * 0.14); // 182 ms between courses
const WALL_X = [8, 71, 134];
const BRICKS = [0, 1, 2, 3].flatMap((row) =>
  [0, 1, 2].map((col) => ({
    x: WALL_X[col],
    y: 6 + row * 28,
    row,
    dx: (col - 1) * 26 + (row % 2 === 0 ? -6 : 6),
    dy: 78 + row * 14,
    rot: (col - 1) * 22 + (row % 2 === 0 ? -14 : 14),
  })),
);

// Spit from the raspberry's mouth, up and to the right.
const SPIT = [
  { dx: 34, dy: -14, size: 5 },
  { dx: 44, dy: -2, size: 4 },
  { dx: 38, dy: 8, size: 6 },
  { dx: 26, dy: 16, size: 4 },
  { dx: 48, dy: -18, size: 3 },
];

/**
 * The result card's animation stage: one gesture per outcome, played alongside the
 * text rather than before it. `attacker` and `defender` are the round's two seats, and
 * the colours do the explaining — sword and cannonball in the attacker's colour,
 * shield, rope and the falling brick in the defender's — so five animations stay
 * readable with no text at all. Cosmetics only: no input, `aria-hidden`, and under
 * `prefers-reduced-motion` every gesture becomes a cross-fade of the same length, so
 * the card's timing and its sound never move.
 */
export function ResultFx({
  kind,
  attacker,
  defender,
}: {
  kind: ResultFxKind;
  attacker: PlayerColor;
  defender: PlayerColor;
}) {
  useEffect(ensureKeyframes, []);
  const reduced = useReducedMotion();
  const attackerColor = COL[attacker].base;
  const defenderColor = COL[defender].base;

  // The sound is the gesture's first frame, so it fires with the animation, once per
  // mounted card. The card is keyed on its id, so each round of a chain gets its own.
  useEffect(() => {
    if (kind === 'ropes') retroAudio.playRopeBind();
    else if (kind === 'shield') retroAudio.playSwordBreak();
    else if (kind === 'raspberry') retroAudio.playRaspberry();
    else if (kind === 'brick') retroAudio.playBrickHit();
    else retroAudio.playWallCrumble();
  }, [kind]);

  // One clock for the whole stage: an element that starts `delayMs` late gets exactly
  // RESULT_FX_MS - delayMs of animation, so the gesture's last frame IS the last frame
  // of the budget. A gesture with no stagger (ropes, shield, raspberry) gets the lot.
  const fx = (name: string, delayMs = 0) =>
    `${reduced ? 'fxFade' : name} ${RESULT_FX_MS - delayMs}ms ease-out both`;
  // SVG shapes need their own box for `transform-origin` to mean anything.
  const pivot: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };
  const vars = (dx: number, dy: number, rot = 0) =>
    ({ '--dx': `${dx}px`, '--dy': `${dy}px`, '--rot': `${rot}deg` }) as CSSProperties;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 120"
      width="100%"
      height="100%"
      style={{ display: 'block', overflow: 'visible', pointerEvents: 'none' }}
    >
      {kind === 'ropes' && (
        // The loser's own invader glyph, tied with three rope strokes in that seat's
        // colour and dragged toward its base (the stage's lower left).
        <g style={{ ...pivot, animation: fx('ropeDrag') }}>
          <g transform="translate(78 44) scale(4)" shapeRendering="crispEdges">
            <path
              d={PIECE_GLYPH[defender]}
              fill="none"
              stroke="#000000"
              strokeWidth="1"
              strokeLinejoin="miter"
            />
            <path d={PIECE_GLYPH[defender]} fill={defenderColor} />
          </g>
          {['M74 52 Q100 42 126 52', 'M73 64 Q100 58 127 66', 'M100 38 L100 82'].map((d, i) => (
            <g key={i} style={{ animation: fx('ropeTie', i * 90) }}>
              <path d={d} fill="none" stroke="#0b0118" strokeWidth="6" strokeLinecap="round" />
              <path
                d={d}
                fill="none"
                stroke={defenderColor}
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="64"
              />
            </g>
          ))}
        </g>
      )}

      {kind === 'shield' && (
        <g>
          <g style={{ ...pivot, animation: fx('shieldBrace') }}>
            <path
              d="M100 20 L132 30 V58 C132 80 114 94 100 100 C86 94 68 80 68 58 V30 Z"
              fill={defenderColor}
              stroke="#0b0118"
              strokeWidth="3"
            />
            <path
              d="M100 30 L122 37 V58 C122 72 111 82 100 87 C89 82 78 72 78 58 V37 Z"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2"
              opacity=".55"
            />
          </g>
          {/* A vertical sword, rotated 38° about the stage centre so it comes in from
              the upper right; the tip below the break flies off on impact. */}
          <g style={{ ...pivot, animation: fx('swordStrike') }}>
            <g transform="rotate(38 100 60)">
              <rect x="96" y="4" width="8" height="20" rx="3" fill="#cfc9e6" stroke="#0b0118" strokeWidth="2" />
              <rect x="84" y="24" width="32" height="7" rx="3" fill="#cfc9e6" stroke="#0b0118" strokeWidth="2" />
              <path d="M95 31 H105 V58 H95 Z" fill={attackerColor} stroke="#0b0118" strokeWidth="2" />
              <g style={{ ...pivot, animation: fx('swordShard'), ...vars(30, 46, 74) }}>
                <path d="M95 58 H105 L100 78 Z" fill={attackerColor} stroke="#0b0118" strokeWidth="2" />
              </g>
            </g>
          </g>
          <path
            d="M100 50 L104 58 L112 62 L104 66 L100 74 L96 66 L88 62 L96 58 Z"
            fill="#ffffff"
            stroke="#0b0118"
            strokeWidth="1.5"
            style={{ ...pivot, animation: fx('impactStar') }}
          />
        </g>
      )}
      {kind === 'raspberry' && (
        <g>
          {SPIT.map((s, i) => (
            <circle
              key={i}
              cx={126 + i * 2}
              cy={52 + i * 3}
              r={s.size}
              fill={attackerColor}
              style={{ ...pivot, animation: fx('raspberrySpit'), ...vars(s.dx, s.dy) }}
            />
          ))}
          <text
            x="94"
            y="60"
            textAnchor="middle"
            dominantBaseline="middle"
            fontSize="62"
            style={{
              ...pivot,
              animation: fx('raspberryFace'),
              fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif',
            }}
          >
            😝
          </text>
        </g>
      )}

      {kind === 'crumble' &&
        // Top course first, each one a beat after the last (see COURSE_DELAY_MS).
        BRICKS.map((b, i) => (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width="58"
            height="24"
            rx="3"
            fill="#7a7392"
            stroke="#0b0118"
            strokeWidth="2"
            style={{
              ...pivot,
              animation: fx('crumbBrick', b.row * COURSE_DELAY_MS),
              ...vars(b.dx, b.dy, b.rot),
            }}
          />
        ))}

      {kind === 'crumble' &&
        // A dust puff per course, at the moment that course lets go.
        Array.from({ length: CRUMBLE_COURSES }, (_, row) => (
          <circle
            key={row}
            cx="100"
            cy={14 + row * 28}
            r="16"
            fill="#b9b2cc"
            style={{
              ...pivot,
              animation: fx('crumbDust', row * COURSE_DELAY_MS + 60),
              ...vars((row % 2 === 0 ? 1 : -1) * 22, 0),
            }}
          />
        ))}

      {kind === 'brick' && (
        <g>
          {BRICKS.map((b, i) => {
            // The one brick the shot takes out: middle course, middle column, tinted
            // in the captured defender's colour so the brick IS the piece leaving.
            const hit = b.row === 1 && b.x === WALL_X[1];
            return (
              <rect
                key={i}
                x={b.x}
                y={b.y}
                width="58"
                height="24"
                rx="3"
                fill={hit ? defenderColor : '#7a7392'}
                stroke="#0b0118"
                strokeWidth="2"
                style={
                  hit
                    ? { ...pivot, animation: fx('brickOut'), ...vars(64, -18, 26) }
                    : undefined
                }
              />
            );
          })}
          {/* The shot: flat, from the left, with its smoke trail behind it. The trail
              circles ride inside the flying group, so they leave the stage with it. */}
          <g style={{ ...pivot, animation: fx('ballFly') }}>
            <circle cx="58" cy="46" r="3.5" fill="#cfc9e6" opacity=".18" />
            <circle cx="70" cy="46" r="5" fill="#cfc9e6" opacity=".26" />
            <circle cx="84" cy="46" r="6.5" fill="#cfc9e6" opacity=".38" />
            <circle cx="100" cy="46" r="9" fill="#1a1030" stroke="#cfc9e6" strokeWidth="2.5" />
            <circle cx="97" cy="43" r="2.5" fill="#ffffff" opacity=".6" />
          </g>
          {/* Dust blown out the far side: the penetration beat. */}
          {[
            { dx: 30, dy: -20, size: 7 },
            { dx: 38, dy: -4, size: 9 },
            { dx: 30, dy: 12, size: 6 },
            { dx: 18, dy: 24, size: 5 },
          ].map((p, i) => (
            <circle
              key={i}
              cx="132"
              cy="46"
              r={p.size}
              fill="#b9b2cc"
              style={{ ...pivot, animation: fx('puffOut', i * 40), ...vars(p.dx, p.dy) }}
            />
          ))}
        </g>
      )}
    </svg>
  );
}
