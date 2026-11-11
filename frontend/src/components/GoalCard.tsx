import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { PieceFigure } from './PieceFigure';
import { useApp } from '../store';
import { COL } from '../theme';
import type { PlayerColor } from '../game/types';
import { GOAL_CARD_MS } from '../__shared__/timing.constants';

// The card's own frame, exported so the panel in `Game.tsx` is sized by the drawing and
// never the other way round. It is the flash card's cap at a shorter ratio, because this
// card carries one line of art instead of a scene.
export const GOAL_CARD_MAX_PX = 336;
export const GOAL_CARD_VIEWBOX = '0 0 200 130';
export const GOAL_CARD_ASPECT = 200 / 130;

// The card's beats, all fractions of its hold so a re-timed `GOAL_CARD_MS` carries them
// with it: the piece climbs for the first half, compresses its feet on arrival, the slot's
// flash fires with the landing, and what is left is the hold — the stillness a result needs
// before its panel fades (`GOAL_CARD_FADE_MS`, in the wrapper).
const ARRIVE_AT = Math.round(GOAL_CARD_MS * 0.49); // 540: the feet reach the slot
const LAND_MS = Math.round(GOAL_CARD_MS * 0.24); // 264: the compress, then the settle
const BURST_MS = Math.round(GOAL_CARD_MS * 0.35); // 385: the slot's flash

const KEYFRAMES_ID = 'goal-card-keyframes';

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
      @keyframes goalClimb {
        0%   { transform: translate(var(--gx), var(--gy)); opacity: 0; }
        14%  { opacity: 1; }
        100% { transform: translate(0, 0); opacity: 1; }
      }
      @keyframes goalLand {
        0%   { transform: scale(1, 1); }
        45%  { transform: scale(1.1, .9); }
        100% { transform: scale(1, 1); }
      }
      @keyframes goalSlotBurst {
        0%   { transform: scale(.3); opacity: 0; }
        22%  { opacity: .95; }
        100% { transform: scale(1.9); opacity: 0; }
      }
    `;
  document.head.appendChild(style);
}

// The ramp: one parallelogram rising left to right — the home stretch, drawn as the lane it
// is — with four stations on its centre line, filled bottom to top as pieces arrive. The
// stations sit at 0.16, 0.40, 0.64 and 0.88 of the band, so the last one is not at the lip:
// the lane goes on past it to the goal mouth, which is the chevron at the top.
const RAMP = '10,118 58,118 160,44 112,44';
const SLOTS = [
  { x: 50.3, y: 106.2 },
  { x: 74.8, y: 88.4 },
  { x: 99.3, y: 70.6 },
  { x: 123.8, y: 52.9 },
];
const FOOT = { x: 34, y: 118 }; // where the climb starts: the ramp's own foot
const SLOT_R = 8.5;
const PIECE_SCALE = 0.42; // 42 units of figure against a 48-unit band

/**
 * The goal's ramp card — the overlay a room with its effects rule **on** gets instead of
 * `GoalConfetti`, and the whole of that celebration (32.5).
 *
 * It is the goal counter made spatial: the home stretch as a ramp with four stations, one
 * per piece a seat can bring home, filled bottom to top. The piece climbs from the ramp's
 * foot to the station it just filled — the higher the count, the longer the climb — lands
 * with its feet compressing, and the station's flash fires on the landing. What is left of
 * `GOAL_CARD_MS` is the hold, and the panel's own `GOAL_CARD_FADE_MS` fade is the wrapper's
 * (`Game.tsx`), exactly as the flash card's is.
 *
 * `count` is the seat's pieces home **after** this move, so the arriving piece is station
 * `count - 1`. The figure is `PieceFigure`, the same one the board and the clash cast draw:
 * a card that drew its own token would be a second, subtly different piece on screen.
 */
export function GoalCard({ color, count }: { color: PlayerColor; count: number }) {
  const { theme } = useApp();
  useEffect(ensureKeyframes, []);
  const hue = COL[color].base;
  const filled = Math.min(SLOTS.length, Math.max(1, count));
  const arrived = SLOTS[filled - 1];
  const gradientId = `goal-ramp-${color}`;

  return (
    <svg
      viewBox={GOAL_CARD_VIEWBOX}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      role="presentation"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor={hue} stopOpacity="0.36" />
          <stop offset="100%" stopColor={hue} stopOpacity="0.1" />
        </linearGradient>
      </defs>

      {/* The lane, then its lower edge as the one heavy line: a ramp is read by the surface
          it stands on, not by its outline. */}
      <polygon
        points={RAMP}
        fill={`url(#${gradientId})`}
        stroke={hue}
        strokeOpacity="0.5"
        strokeWidth="1.4"
      />
      <line x1="10" y1="118" x2="58" y2="118" stroke={hue} strokeWidth="2.6" strokeLinecap="round" />

      {/* The goal mouth: the lane's own opening, past the last station. */}
      <polygon
        points="116,42 156,42 136,26"
        fill="none"
        stroke={hue}
        strokeOpacity="0.55"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* The four stations: a hollow one is a piece still out, a filled one is a piece
          home. The one this move filled is the brightest and carries the flash. */}
      {SLOTS.slice(0, filled).map((slot, i) => (
        <circle
          key={i}
          cx={slot.x}
          cy={slot.y}
          r={SLOT_R}
          fill={hue}
          fillOpacity={i === filled - 1 ? 0.95 : 0.55}
          stroke="#ffffff"
          strokeOpacity={i === filled - 1 ? 0.9 : 0.35}
          strokeWidth="1.4"
        />
      ))}
      {SLOTS.slice(filled).map((slot, i) => (
        <circle
          key={`empty-${i}`}
          cx={slot.x}
          cy={slot.y}
          r={SLOT_R}
          fill="rgba(5,2,18,.75)"
          stroke={hue}
          strokeOpacity="0.45"
          strokeWidth="1.4"
        />
      ))}

      {/* The landing's flash, on the station the piece just filled. */}
      <circle
        cx={arrived.x}
        cy={arrived.y}
        r={SLOT_R + 6}
        fill="none"
        stroke={hue}
        strokeWidth="2"
        style={{
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `goalSlotBurst ${BURST_MS}ms ease-out ${ARRIVE_AT - 10}ms both`,
        }}
      />

      {/* The arriving piece. The travel is a CSS translate on the outer group (the climb is
          a straight line because the lane is), the landing is a squash on the inner one
          about its own bounding box's feet, and the figure itself carries the set. */}
      <g
        style={
          {
            animation: `goalClimb ${ARRIVE_AT}ms cubic-bezier(.35,.08,.3,1) both`,
            '--gx': `${(FOOT.x - arrived.x).toFixed(1)}px`,
            '--gy': `${(FOOT.y - arrived.y).toFixed(1)}px`,
          } as CSSProperties & Record<'--gx' | '--gy', string>
        }
      >
        <g
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'bottom center',
            animation: `goalLand ${LAND_MS}ms ease-out ${ARRIVE_AT}ms both`,
          }}
        >
          <g
            transform={`translate(${arrived.x} ${arrived.y}) scale(${PIECE_SCALE}) translate(-50 -95.5)`}
          >
            <PieceFigure ck={color} set={theme === 'retro70' ? 'retro70' : 'retro80'} pose="front" />
          </g>
        </g>
      </g>

      {/* The count, in the bay badge's own typography: the board's `GOAL n/4`, read here as
          the ramp's own tally. */}
      <text
        x="192"
        y="30"
        textAnchor="end"
        fill={hue}
        style={{
          fontFamily: 'var(--font-mono)',
          fontWeight: 700,
          fontSize: 22,
          letterSpacing: '0.5px',
          filter: `drop-shadow(0 0 6px ${hue})`,
        }}
      >
        {filled}/4
      </text>
    </svg>
  );
}
