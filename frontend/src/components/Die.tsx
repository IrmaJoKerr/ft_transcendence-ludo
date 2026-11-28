import { useEffect, useRef, useState } from 'react';
import {
  DICE_ACCEL_MS,
  DICE_ACUTE_MS,
  DICE_ACUTE_SLOWDOWN_MS,
  DICE_FLOP_MS,
  DICE_SLOWDOWN_MS,
  DICE_SPIN_MAX_MS,
} from '../__shared__/timing.constants';
import { diceFace70, type DicePart, type DicePaint } from './diceParts70';
import { diceFace80 } from './diceParts80';
import { useApp } from '../store';
import { THEME_BY_ID } from '../styles/themes';
import { retroAudio, type DiceEra } from '../utils/audio';

// Pip indexes (3×3 grid, row-major) lit per face value.
const PIP_MAP: Partial<Record<number, number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

// A reading of the cube, and the spin carrying it: `rotateY(spin) rotateX(x) rotateY(y)`.
type Turn = { x: number; y: number };
type Pose = Turn & { spin: number };

// The cube at rest: the square the panel budgets for it. The acts are free to push the
// tumbling cube past it, so nothing around the die clips its box.
const SIZE = 80;
const HALF = SIZE / 2;
const FULL = 360;
const HALF_TURN = 180;
const QUARTER = 90;

// The stance a top stands in: a body diagonal on the vertical, which is the cube leaned back by
// atan(√2) about the screen's horizontal axis and then a corner's own 45° across.
const CORNER_TILT = 54.7356;
const CORNER_YAW = 45;

// The spin, drawn as beats of its own length rather than one transition, so the lean can breathe
// between them. A cube that turns without leaning is a cube on a pin; the wobble is what reads as
// a top, and it decays because a top that keeps its amplitude reads as a machine.
const SPIN_BEATS = 4;
const SPIN_TURNS = 4;
const NUTATION = [2.2, 1.5, 1, 0.5];

// The rattle's tempo, counted in quarter turns rather than in milliseconds (38.13): one tick per
// quarter, so the spin is `SPIN_BEATS × SPIN_TURNS` of them and their spacing is the spin's own
// drawn length divided by that count.
const TICKS_PER_SPIN = SPIN_BEATS * SPIN_TURNS;
const ACUTE_TURNS = 2;
const ACUTE_TICKS = ACUTE_TURNS * SPIN_TURNS;

// The tail: the die falls off balance onto an edge (`EDGE_TIP` 45°), then flops up to
// `FLOPS_MAX` times, each a quarter turn in `x`.
const EDGE_TIP = 45;
const FLOPS_MAX = 3;

// The rotation that brings a face to the front, in degrees. A roll starts wherever the
// die already rests and ends on the face the engine sent, so this table is the only
// mapping between a value and an orientation: the faces themselves never move.
const FACE_ROTATIONS: Record<number, Turn> = {
  1: { x: 0, y: 0 },
  2: { x: -QUARTER, y: 0 },
  3: { x: 0, y: -QUARTER },
  4: { x: 0, y: QUARTER },
  5: { x: QUARTER, y: 0 },
  6: { x: 0, y: 2 * QUARTER },
};

// Where each face sits on the cube: the inverse of its rotation above, so a face's own
// pips are painted once and the cube's turn is what shows them.
const FACE_PLACEMENT: Record<number, Turn> = {
  1: { x: 0, y: 0 },
  2: { x: QUARTER, y: 0 },
  3: { x: 0, y: QUARTER },
  4: { x: 0, y: -QUARTER },
  5: { x: -QUARTER, y: 0 },
  6: { x: 0, y: 2 * QUARTER },
};

const FACES = [1, 2, 3, 4, 5, 6] as const;

// The six faces' art, built once per era and never again: the shapes are static, so a render only
// maps them to elements. `PIP_MAP` is read HERE and nowhere else, which is what keeps it the one
// table of which cells a face lights — the era modules place a pip at the index they are handed.
function partsFor(
  art: (value: number, cells: readonly number[]) => DicePart[],
): Record<number, DicePart[]> {
  const table: Record<number, DicePart[]> = {};
  for (const n of FACES) table[n] = art(n, PIP_MAP[n] ?? []);
  return table;
}
const FACE_PARTS: Record<DiceEra, Record<number, DicePart[]>> = {
  retro70: partsFor(diceFace70),
  retro80: partsFor(diceFace80),
};

// The acts' own easing. ACCEL is the throw, SPIN is constant energy, the two slowdowns
// give way, and each flop carries a hair past the edge it lands on before it settles.
const EASE = {
  accel: 'cubic-bezier(0.4, 0, 0.9, 0.6)',
  spin: 'linear',
  acute: 'cubic-bezier(0.15, 0.85, 0.25, 1)',
  slowdown: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
  flop: 'cubic-bezier(0.34, 1.45, 0.64, 1)',
} as const;

// The nearest full turn of the same reading: an angle plus 360k is the same die.
function nearestTurn(from: number, to: number): number {
  return to + Math.round((from - to) / FULL) * FULL;
}

// The same reading, brought back inside one turn.
function normalise(angle: number): number {
  return angle - Math.round(angle / FULL) * FULL;
}

// The next whole turn at or after an angle: a spin has to stop on one, or the reading drifts.
function wholeTurnAtOrAfter(from: number): number {
  return Math.ceil(from / FULL) * FULL;
}

// How a roll ends, drawn by the device that starts it rather than sent: how many times the die
// flops over an edge on its way to the face, and which way it falls.
type Flops = { count: number; dir: number };

// One, two or three flops, weighted towards the middle: one reads as a die barely thrown.
function drawFlops(): Flops {
  const draw = Math.random();
  return {
    count: draw < 0.25 ? 1 : draw < 0.7 ? 2 : FLOPS_MAX,
    dir: Math.random() < 0.5 ? -1 : 1,
  };
}

// The tail, planned BACKWARDS from the face the engine sent (38.1).
function tailOf(face: Turn, flops: Flops) {
  const steps = flops.count - 1; // the fall off the edge is the tail's first flop
  const first = face.x - steps * flops.dir * QUARTER;
  const landings: number[] = [];
  for (let i = 0; i <= steps; i++) landings.push(first + i * flops.dir * QUARTER);

  // Each flop is shorter than the one before it, and the lengths are the same total as the
  // act they play in: the last one takes what the rounding of the others left.
  const weights = landings.map((_, i) => landings.length - i);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let spent = 0;
  const lengths = landings.map((_, i) => {
    const last = i === landings.length - 1;
    const ms = last ? DICE_FLOP_MS - spent : Math.round((DICE_FLOP_MS * weights[i]) / total);
    spent += ms;
    return ms;
  });

  return { edge: first - flops.dir * EDGE_TIP, landings, lengths };
}

// The die, as the acts its roll is made of (38.1).
export function Die({
  value,
  rolling,
  startAt = null,
  spinMs = DICE_SPIN_MAX_MS,
  tappedAt = null,
}: {
  value: number;
  rolling: boolean;
  // When this die's roll began, on `performance.now`'s clock. Null for a roll this device
  // did not start, whose acts begin when its frame arrives.
  startAt?: number | null;
  // The spin this roll drew, or the ceiling when the draw belongs to somebody else.
  spinMs?: number;
  // The catch's timestamp, null for a roll nobody tapped.
  tappedAt?: number | null;
}) {
  // The era the faces are painted in, read from the theme registry as `Board` reads its
  // piece set — so the five props stay five and no call site passes a theme (38).
  const { theme } = useApp();
  const era: DiceEra = THEME_BY_ID[theme].diceEra;
  const face = FACE_ROTATIONS[value] ?? FACE_ROTATIONS[1];
  // The cube's live orientation and the transition carrying it there: one render per act,
  // each with its own duration, which is what makes the acts read as acts.
  const [pose, setPose] = useState<Pose>(() => ({ spin: 0, ...face }));
  const [turn, setTurn] = useState<{ ms: number; ease: string }>({ ms: 0, ease: EASE.spin });
  const poseRef = useRef(pose);
  // What this roll is planned from: the pose it started on, the tail it drew and the instant
  // it started. A tap re-runs the acts from here, so a branch taken mid-spin re-plans the
  // rest of the roll instead of turning the cube again from wherever it happens to be.
  const restRef = useRef<Pose | null>(null);
  // The tail's draw, taken on that same gate so it survives every re-render the roll takes.
  // The value the ref starts on is never read: a roll always draws before its tail is planned.
  const flopsRef = useRef<Flops>({ count: 2, dir: 1 });
  const beganRef = useRef(0);

  useEffect(() => {
    // At rest the die is the face the engine sent, and nothing here has to write state for
    // it: the render reads the stored angle's nearest full turn, which is the same die.
    if (!rolling) {
      restRef.current = null;
      return;
    }

    if (restRef.current == null) {
      // Planned from the resting reading, never from the raw angle: the tail ends on the
      // face plus a whole number of turns, and starting the next roll there is what keeps
      // one match from accumulating a thousand degrees (38.3).
      restRef.current = {
        spin: normalise(poseRef.current.spin),
        x: nearestTurn(poseRef.current.x, face.x),
        y: nearestTurn(poseRef.current.y, face.y),
      };
      flopsRef.current = drawFlops();
      beganRef.current = startAt ?? performance.now();
    }
    const rest = restRef.current;
    const flops = flopsRef.current;
    const beganAt = beganRef.current;

        // ACCEL tips the die off the face it is resting on and up onto a corner, half a turn already on
    // it, so the throw has begun before the spin does.
    const corner: Pose = {
      spin: rest.spin + HALF_TURN,
      x: rest.x > 0 ? CORNER_TILT : -CORNER_TILT,
      y: rest.y + CORNER_YAW,
    };
    // One beat of the spin: the act's whole turning spread across `SPIN_BEATS`, with the lean
    // set off the balance by a decaying orbit — the nutation that makes it read as a top.
    const beat = (i: number): Pose => {
      const phase = (i / SPIN_BEATS) * 2 * Math.PI;
      const lean = NUTATION[i] ?? 0;
      return {
        spin: corner.spin + SPIN_TURNS * FULL * ((i + 1) / SPIN_BEATS),
        x: corner.x + lean * Math.cos(phase),
        y: corner.y + lean * Math.sin(phase),
      };
    };
    const spun = beat(SPIN_BEATS - 1);
    const spinEndsAt = DICE_ACCEL_MS + spinMs;
    // A reading only exists modulo a whole turn, so the spin has to be stopped on one.
    const settleSpin = wholeTurnAtOrAfter(spun.spin);
    const tail = tailOf(face, flops);
    // The tail's own poses, from the edge down to the sent face. The spin holds at that whole
    // turn through them: a die does not keep turning about the vertical once it is falling
    // over an edge, and holding it is what makes the last flop land exactly where planned.
    const falls = (spin: number): Pose[] => tail.landings.map((x) => ({ spin, x, y: face.y }));

    // The tap has an act to play only while SPIN is still running (38.2): a catch after
    // it lands finds a die already slowing, and that roll plays its untapped branch.
    const caughtAt = tappedAt == null ? null : tappedAt - beganAt;
    const catchAt =
      caughtAt != null && caughtAt >= DICE_ACCEL_MS && caughtAt < spinEndsAt ? caughtAt : null;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const runAt = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, Math.max(0, beganAt + ms - performance.now())));
    };
    const turnTo = (to: Pose, ms: number, ease: string) => {
      poseRef.current = to;
      setTurn({ ms, ease });
      setPose(to);
    };
    // Whether an instant in this plan is still ahead of us. A replan turns the cube to the
    // same targets, but it must not re-voice what the room has already heard.
    const ahead = (ms: number) => beganAt + ms > performance.now();
        // The tail from an instant: one flop per landing, each shorter than the one before it. The last
    // landing is the settle, so the roll's face is HEARD as well as seen (38. Q); a tail of one flop
    // is therefore a settle with no flop ahead of it.
    const flopFrom = (spin: number, at: number) => {
      const landings = falls(spin);
      landings.forEach((to, i) => {
        const ms = tail.lengths[i];
        const last = i === landings.length - 1;
        runAt(at, () => turnTo(to, ms, EASE.flop));
        const hits = at + ms;
        // A replan (a catch, or the face arriving mid-spin) recomputes the same landings, so
        // only an instant still ahead of us is voiced: the roll is not heard twice.
        if (ahead(hits)) {
          runAt(hits, () => {
            if (last) retroAudio.playDiceSettle(value, era);
            else retroAudio.playDiceFlop(i, era);
          });
        }
        at = hits;
      });
    };

        // The rattle (38.13): a tick at each quarter turn's own instant, which is the spin's plan and
    // never a second schedule beside it.
    const tickEvery = spinMs / TICKS_PER_SPIN;
    const tickAt = (ms: number) => {
      if (!ahead(ms)) return;
      runAt(ms, () => retroAudio.playDiceSpinTick(era));
    };
    const acuteEvery = DICE_ACUTE_MS / ACUTE_TICKS;

    if (catchAt == null) {
      // The whole untapped roll: up onto the corner, the spin to its drawn end, off the
      // balance onto the edge, then the flops that settle onto the engine's face.
      runAt(0, () => turnTo(corner, DICE_ACCEL_MS, EASE.accel));
      for (let i = 0; i < SPIN_BEATS; i++) {
        // The beats divide the drawn length, so the act's angular speed is the draw's.
        const since = Math.round((spinMs * i) / SPIN_BEATS);
        const until = Math.round((spinMs * (i + 1)) / SPIN_BEATS);
        runAt(DICE_ACCEL_MS + since, () => turnTo(beat(i), until - since, EASE.spin));
      }
      for (let i = 1; i <= TICKS_PER_SPIN; i++) tickAt(DICE_ACCEL_MS + i * tickEvery);
      runAt(spinEndsAt, () =>
        turnTo({ spin: settleSpin, x: tail.edge, y: face.y }, DICE_SLOWDOWN_MS, EASE.slowdown),
      );
      flopFrom(settleSpin, spinEndsAt + DICE_SLOWDOWN_MS);
    } else {
      // A catch replans only what is left of the roll: the spin is cut where the hand met it,
      // the tail keeps its unchanged slowdown, and every target is a pure function of pose,
      // catch and tail draw.
      const spunFor = catchAt - DICE_ACCEL_MS;
      const cut: Pose = {
        spin: corner.spin + SPIN_TURNS * FULL * (spunFor / spinMs) + ACUTE_TURNS * FULL,
        x: corner.x,
        y: corner.y,
      };
      const cutSpin = wholeTurnAtOrAfter(cut.spin);
      const acuteEndsAt = catchAt + DICE_ACUTE_MS;
      const acuteSlowedAt = acuteEndsAt + DICE_ACUTE_SLOWDOWN_MS;
      runAt(catchAt, () => turnTo(cut, DICE_ACUTE_MS, EASE.acute));
      // The ticks the catch cancelled are not replayed: the acute act has its own, from the
      // catch onwards, at the spacing the act itself turns at.
      for (let i = 1; i <= ACUTE_TICKS; i++) tickAt(catchAt + i * acuteEvery);
      runAt(acuteEndsAt, () =>
        turnTo({ spin: cutSpin, x: tail.edge, y: face.y }, DICE_ACUTE_SLOWDOWN_MS, EASE.slowdown),
      );
      flopFrom(cutSpin, acuteSlowedAt);
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [rolling, startAt, spinMs, tappedAt, face, value, era]);

  // What the cube shows. While a roll runs that is the live act; at rest it is the stored
  // angle's nearest full turn of the engine's face, which is the same die seen the same way
  // and is how the angle is normalised between rolls (38.3).
  const shown = rolling
    ? pose
    : {
        spin: normalise(pose.spin),
        x: nearestTurn(pose.x, face.x),
        y: nearestTurn(pose.y, face.y),
      };

  return (
    // The shadow sits outside the cube: a filter on the element that carries
    // `preserve-3d` flattens it, which is the one thing that would break the die.
    <div
      style={{ width: SIZE, height: SIZE, filter: 'drop-shadow(0 14px 12px var(--dice-shadow))' }}
    >
      <div style={{ width: SIZE, height: SIZE, perspective: 520 }}>
        <div
          className="die-cube"
          style={{
            position: 'relative',
            width: SIZE,
            height: SIZE,
            transformStyle: 'preserve-3d',
            // The spin leads: it is the turn about the vertical, which the lean makes the
            // cube's own diagonal, so the list reads as a top and then as a tumble.
            transform: `rotateY(${shown.spin}deg) rotateX(${shown.x}deg) rotateY(${shown.y}deg)`,
            // At rest there is never a turn to play: the flop already landed the face, and
            // a die that was never watched (a rejoin) is simply correct on its next render.
            transition: rolling && turn.ms > 0 ? `transform ${turn.ms}ms ${turn.ease}` : 'none',
            willChange: 'transform',
          }}
        >
          {FACES.map((n) => (
            <Face key={n} value={n} />
          ))}
        </div>
      </div>
    </div>
  );
}

// One face of the cube: the era's art painted once and placed by its own rotation, so the
// cube's turn is the only thing that decides which face is showing.
function Face({ value }: { value: number }) {
  const placement = FACE_PLACEMENT[value];
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        backfaceVisibility: 'hidden',
        transform: `rotateX(${placement.x}deg) rotateY(${placement.y}deg) translateZ(${HALF}px)`,
      }}
    >
      <DiceFace value={value} />
    </div>
  );
}

// How a face module's paint slot becomes a colour: the eight `--dice-*` tokens by role, and
// the only place those names meet the stylesheet. No hex lives here, so the two eras can
// disagree about what a die is without one line of this file changing.
const PAINT_TOKEN: Record<DicePaint, string> = {
  hi: 'var(--dice-hi)',
  edge: 'var(--dice-edge)',
  pip: 'var(--dice-pip)',
  pipShade: 'var(--dice-pip-shade)',
  pipAlt: 'var(--dice-pip-alt)',
  none: 'none',
};

// One shape of a face, in the 100-unit box both era modules draw in.
function DiceShape({ part }: { part: DicePart }) {
  const paint = (slot?: DicePaint) => (slot === undefined ? undefined : PAINT_TOKEN[slot]);
  if (part.kind === 'rect') {
    return (
      <rect
        x={part.x}
        y={part.y}
        width={part.w}
        height={part.h}
        rx={part.r}
        fill={paint(part.fill)}
        stroke={paint(part.stroke)}
        strokeWidth={part.strokeW}
        opacity={part.opacity}
      />
    );
  }
  return (
    <circle
      cx={part.cx}
      cy={part.cy}
      r={part.r}
      fill={paint(part.fill)}
      stroke={paint(part.stroke)}
      strokeWidth={part.strokeW}
      strokeDasharray={part.dash}
      opacity={part.opacity}
    />
  );
}

// One die face: the stylesheet body plus the current era's art from `diceParts70/80`.
// `size` is the only difference between the 80 px cube and the 38 px roster die, so
// `MiniDie` reuses this component. Era comes from the store; the 80s bloom is CSS.
export function DiceFace({ value, size = SIZE }: { value: number; size?: number }) {
  const { theme } = useApp();
  const era: DiceEra = THEME_BY_ID[theme].diceEra;
  const parts = FACE_PARTS[era][value] ?? [];

  return (
    <div
      className="die-face"
      data-era={era}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        boxSizing: 'border-box',
        borderRadius: Math.round((size * 17) / SIZE),
        border: '1px solid var(--dice-edge)',
        background: 'linear-gradient(150deg, var(--dice-face), var(--dice-face-shade))',
        overflow: 'hidden',
      }}
    >
      <svg
        viewBox="0 0 100 100"
        aria-hidden="true"
        style={{ display: 'block', width: '100%', height: '100%' }}
      >
        {parts.map((part, i) => (
          <DiceShape key={i} part={part} />
        ))}
      </svg>
    </div>
  );
}
