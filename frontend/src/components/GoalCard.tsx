import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { PieceFigure } from './PieceFigure';
import { useApp } from '../store';
import { THEME_BY_ID } from '../styles/themes';
import { COL } from '../theme';
import type { PlayerColor } from '../game/types';
import { GOAL_CARD_MS } from '../__shared__/timing.constants';

// The card's own frame, exported so the panel in `Game.tsx` is sized by the drawing and
// never the other way round. It is the flash card's cap at a shorter ratio, because this
// card carries one line of art instead of a scene.
export const GOAL_CARD_MAX_PX = 336;
export const GOAL_CARD_VIEWBOX = '0 0 200 130';
export const GOAL_CARD_ASPECT = 200 / 130;

// The card's beats are fractions of its hold, so a retimed `GOAL_CARD_MS` carries them:
// climb, foot compression and slot flash on landing, then stillness before the wrapper
// fades (`GOAL_CARD_FADE_MS`).
const ARRIVE_AT = Math.round(GOAL_CARD_MS * 0.49); // 540: the feet reach the slot
const LAND_MS = Math.round(GOAL_CARD_MS * 0.24); // 264: the compress, then the settle
const BURST_MS = Math.round(GOAL_CARD_MS * 0.35); // 385: the slot's flash
// The rest of the climb. The station is where the piece is *counted*; the lane goes on past it to
// the goal mouth, and a piece that stopped at its own station read as parked on a step rather than
// home.
const ASCEND_AT = ARRIVE_AT; // the touchdown is the push-off, not a stop
const ASCEND_MS = Math.round(GOAL_CARD_MS * 0.22); // 242: ends at 71% of the hold

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
      /* The last stretch, from the station the piece just filled to the goal mouth, where
         it fades out: the ramp is climbed, not stepped. */
      @keyframes goalAscend {
        0%   { transform: translate(0, 0); opacity: 1; }
        100% { transform: translate(var(--ax), var(--ay)); opacity: 0; }
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

// The ramp: one parallelogram rising left to right — the home stretch, drawn as the lane it is —
// with four stations on its centre line, filled bottom to top as pieces arrive.
const RAMP = '10,118 58,118 160,44 112,44';
const SLOTS = [
  { x: 50.3, y: 106.2 },
  { x: 74.8, y: 88.4 },
  { x: 99.3, y: 70.6 },
  { x: 123.8, y: 52.9 },
];
const FOOT = { x: 34, y: 118 }; // where the climb starts: the ramp's own foot
// The goal mouth: the chevron at the top of the lane, and where the arriving piece is
// finally gone. Its feet leave at the lip, just under the chevron's apex.
const MOUTH = { x: 136, y: 36 };
const SLOT_R = 8.5;
const PIECE_SCALE = 0.42; // 42 units of figure against a 48-unit band

// The goal's ramp card — the overlay a room with its effects rule on gets instead of
// `GoalConfetti`, and the whole of that celebration (32.5).
export function GoalCard({ color, count }: { color: PlayerColor; count: number }) {
  const { theme } = useApp();
  const pieces = THEME_BY_ID[theme].pieces;
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
      <line
        x1="10"
        y1="118"
        x2="58"
        y2="118"
        stroke={hue}
        strokeWidth="2.6"
        strokeLinecap="round"
      />

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

      {/* The arriving piece. The travel is a CSS translate on the outer group (the climb
          is a straight line because the lane is), the last stretch to the goal mouth is a
          second translate on the wrapper that fades it out at the lip, the landing is a
          squash on the next one about its own bounding box's feet, and the figure itself
          carries the set. */}
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
          style={
            {
              animation: `goalAscend ${ASCEND_MS}ms cubic-bezier(.4,0,.7,1) ${ASCEND_AT}ms both`,
              '--ax': `${(MOUTH.x - arrived.x).toFixed(1)}px`,
              '--ay': `${(MOUTH.y - arrived.y).toFixed(1)}px`,
            } as CSSProperties & Record<'--ax' | '--ay', string>
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
              <PieceFigure ck={color} pieces={pieces} pose="front" />
            </g>
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
