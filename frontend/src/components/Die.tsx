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
// The spin leads because it is the turn about the vertical, the one axis the other two
// cannot reach once the cube is standing on a corner — and every pose is written in all
// three terms, because a transform list interpolates term by term only while both ends
// are the same list, and the alternative is the browser blending whole matrices.
type Turn = { x: number; y: number };
type Pose = Turn & { spin: number };

// The cube at rest: the square the panel budgets for it. The acts are free to push the
// tumbling cube past it, so nothing around the die clips its box.
const SIZE = 80;
const HALF = SIZE / 2;
const FULL = 360;
const HALF_TURN = 180;
const QUARTER = 90;

// The stance a top stands in: a body diagonal on the vertical, which is the cube leaned
// back by atan(√2) about the screen's horizontal axis and then a corner's own 45° across.
// Both signs of the lean are that same stance — a cube has four corners on a diagonal — so
// the act below picks whichever end is nearer the face the die already shows, which is what
// keeps every roll's tip the same size.
const CORNER_TILT = 54.7356;
const CORNER_YAW = 45;

// The spin, drawn as beats of its own length rather than one transition, so the lean can
// breathe between them. A cube that turns without leaning is a cube on a pin; the wobble is
// what reads as a top, and it decays because a top that keeps its amplitude reads as a
// machine. The last beat's offset is under a degree, so the act after it starts level.
const SPIN_BEATS = 4;
const SPIN_TURNS = 4;
const NUTATION = [2.2, 1.5, 1, 0.5];

// The rattle's tempo, counted in quarter turns rather than in milliseconds (38.13): one tick
// per quarter, so the spin is `SPIN_BEATS × SPIN_TURNS` of them and their spacing is the spin's
// own drawn length divided by that count. A tap's acute act turns two more turns, and those
// eight ticks use their own act's spacing for the same reason. Neither number is a length to
// tune — the lengths are the acts in `common/src/timing.constants.ts` — which is why neither
// is a constant anybody has to keep in step.
const TICKS_PER_SPIN = SPIN_BEATS * SPIN_TURNS;
const ACUTE_TURNS = 2;
const ACUTE_TICKS = ACUTE_TURNS * SPIN_TURNS;

// The tail. The die comes off the balance onto an edge, falls off it onto a face, and then
// flops over as many edges as its momentum still had: the first fall is the edge pose's own
// 45°, and each flop after it is a quarter turn about the screen's horizontal axis — `x`
// moving by a quarter, which is why the whole tail is planned in `x` alone.
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

// The six faces' art, built once per era and never again: the shapes are static, so a render
// only maps them to elements. `PIP_MAP` is read HERE and nowhere else, which is what keeps it
// the one table of which cells a face lights — the era modules place a pip at the index they
// are handed.
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

/** The nearest full turn of the same reading: an angle plus 360k is the same die. */
function nearestTurn(from: number, to: number): number {
  return to + Math.round((from - to) / FULL) * FULL;
}

/**
 * The same reading, brought back inside one turn. A spin only means anything modulo a
 * whole turn, and unlike the other two axes it is never anchored to a face — so it is this
 * that keeps the leading angle from growing a few thousand degrees over a match, and what
 * makes the next roll begin its own turn from level instead of unwinding the last one.
 */
function normalise(angle: number): number {
  return angle - Math.round(angle / FULL) * FULL;
}

/** The next whole turn at or after an angle: a spin has to stop on one, or the reading drifts. */
function wholeTurnAtOrAfter(from: number): number {
  return Math.ceil(from / FULL) * FULL;
}

// How a roll ends, drawn by the device that starts it rather than sent: how many times the
// die flops over an edge on its way to the face, and which way it falls. Both are the
// tail's decoration — its length is `DICE_FLOP_MS` whatever the draw is — so nothing outside
// this file reads them, two devices watching the same roll need not agree, and no replay of
// the acts can move the face, because the face is what the tail is planned from.
type Flops = { count: number; dir: number };

/** One, two or three flops, weighted towards the middle: one reads as a die barely thrown. */
function drawFlops(): Flops {
  const draw = Math.random();
  return {
    count: draw < 0.25 ? 1 : draw < 0.7 ? 2 : FLOPS_MAX,
    dir: Math.random() < 0.5 ? -1 : 1,
  };
}

/**
 * The tail, planned BACKWARDS from the face the engine sent (38.1).
 *
 * A flop is a quarter turn about the screen's horizontal axis, which in the pose's own terms
 * is `x` moving by a quarter, so the face the die has to be falling towards when the tail
 * starts is the sent face undone by as many quarter turns as it still has to flop. The die
 * is then balanced one tip short of that face — on the edge it falls over — and the sequence
 * lands on the sent face exactly, whichever way the draw went and however many flops it
 * bought. The count only ever decides how many faces are seen on the way there.
 */
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

/**
 * The die, as the acts its roll is made of (38.1).
 *
 * One cube, its six faces painted once from `PIP_MAP`, thrown as a top: ACCEL tips it off
 * the face it is resting on and up onto a corner, SPIN turns it about the vertical with a
 * lean that decays beat by beat, and then — untapped — SLOWDOWN finishes the spin on a whole
 * turn and drops it onto an edge, or tapped, ACUTE takes the spin further and its
 * three-quarter slowdown does the same; either way FLOP flops it over one, two or three
 * edges onto the face the engine sent. The tail is planned BACKWARDS from that face, so its
 * last flop is the settle, there is no stop act behind it, and the reading is never left
 * mid-turn. The angles are normalised onto the nearest full turn, which is what keeps a
 * match from growing one continuous angle for its length.
 *
 * Every length comes from `common/src/timing.constants.ts`, because the total they add up
 * to is a number the engine paces a bot with. `spinMs` is the length the roller drew at
 * `beginRoll` (and the ceiling for a roll this device only watches); `tappedAt` is the
 * catch's own timestamp, which branches the acts and cuts the spin where the hand met it.
 * The tail's own draw is not a prop: nothing outside this file reads how many times the die
 * flops, and the face it lands on is the face the tail is planned from either way.
 *
 * The faces are the era's (`diceParts70.ts` / `diceParts80.ts`), and the roll is heard as
 * well as seen: a tick per quarter turn, a flop per landing and a settle on the last (38.Q).
 * Both come off the same plan the cube turns on, so a re-timed act moves the picture and the
 * sound together.
 */
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
  // The era the faces are painted in, read from the store as `Board.tsx:15` reads it for the
  // piece set — so the five props stay five and no call site passes a theme (38).
  const { theme } = useApp();
  const era: DiceEra = theme === 'retro70' ? 'retro70' : 'retro80';
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

    // ACCEL tips the die off the face it is resting on and up onto a corner, half a turn
    // already on it, so the throw has begun before the spin does. Which end of the diagonal
    // and which way across are the near ones, so the tip is the same size every roll
    // whatever face the die was left showing.
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
    // The tail from an instant: one flop per landing, each shorter than the one before it.
    // The last landing is the settle, so the roll's face is HEARD as well as seen (38.Q); a
    // tail of one flop is therefore a settle with no flop ahead of it. Each impact falls at the
    // END of the turn that carries it — the die is arriving, not leaving — which is what puts
    // the settle exactly on `diceLandAt` and the flops before it on the faces on the way.
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

    // The rattle (38.13): a tick at each quarter turn's own instant, which is the spin's
    // plan and never a second schedule beside it. It opens on the FIRST quarter — the throw
    // itself is ACCEL's sound — and its spacing is the drawn spin divided by the quarters it
    // turns, so a short draw rattles faster than a long one and neither is a new number.
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
      // A catch replans only what is LEFT of the roll (38.2): the spin was cut where the hand
      // met it, so its acts are not re-run — the cut takes the spin two turns further from
      // where it had got to, a top knocked into spinning harder rather than a top stopped —
      // and its slowdown falls from the balance to the same edge, so the tail plays unchanged.
      // Every target here is a pure function of the rest pose, the catch and the tail's draw,
      // so a second render (the frame arriving, say) replans the same instants rather than
      // adding turns.
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

/** One shape of a face, in the 100-unit box both era modules draw in. */
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

/**
 * One painted face: the body the stylesheet gives it — its gradient, its border, its
 * rounded edge — and the era's own art inside it (`diceParts70.ts` / `diceParts80.ts`), in
 * the 100-unit box the piece sets use. `size` is the only difference between the cube's
 * 80 px faces and the 38 px die in the roster rows, which is why `MiniDie` in
 * `pages/Game.tsx` is this component and nothing else (38.P): one face, one `PIP_MAP`, one
 * set of tokens, at two sizes.
 *
 * The era is read from the store, as `Board.tsx:15` reads it for the piece set, so no call
 * site passes a theme and the two readers cannot disagree. The 80s bloom is the
 * `data-era` rule in `styles/app.css` — a `box-shadow` on this div, never an SVG filter.
 */
export function DiceFace({ value, size = SIZE }: { value: number; size?: number }) {
  const { theme } = useApp();
  const era: DiceEra = theme === 'retro70' ? 'retro70' : 'retro80';
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
