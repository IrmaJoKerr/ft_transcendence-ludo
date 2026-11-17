import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  DICE_ACCEL_MS,
  DICE_ACUTE_MS,
  DICE_ACUTE_SLOWDOWN_MS,
  DICE_FLOP_MS,
  DICE_SLOWDOWN_MS,
  DICE_SPIN_MAX_MS,
} from '../__shared__/timing.constants';

// Pip indexes (3×3 grid, row-major) lit per face value.
const PIP_MAP: Partial<Record<number, number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

type Pose = { x: number; y: number };

// The cube at rest: the square the panel budgets for it. The acts are free to push the
// tumbling cube past it, so nothing around the die clips its box.
const SIZE = 80;
const HALF = SIZE / 2;
const FULL = 360;
const QUARTER = 90;

// The rotation that brings a face to the front, in degrees. A roll starts wherever the
// die already rests and ends on the face the engine sent, so this table is the only
// mapping between a value and an orientation: the faces themselves never move.
const FACE_ROTATIONS: Record<number, Pose> = {
  1: { x: 0, y: 0 },
  2: { x: -QUARTER, y: 0 },
  3: { x: 0, y: -QUARTER },
  4: { x: 0, y: QUARTER },
  5: { x: QUARTER, y: 0 },
  6: { x: 0, y: 2 * QUARTER },
};

// Where each face sits on the cube: the inverse of its rotation above, so a face's own
// pips are painted once and the cube's turn is what shows them.
const FACE_PLACEMENT: Record<number, Pose> = {
  1: { x: 0, y: 0 },
  2: { x: QUARTER, y: 0 },
  3: { x: 0, y: QUARTER },
  4: { x: 0, y: -QUARTER },
  5: { x: -QUARTER, y: 0 },
  6: { x: 0, y: 2 * QUARTER },
};

const FACES = [1, 2, 3, 4, 5, 6] as const;

// The acts' own easing. ACCEL is the throw, SPIN is constant energy, the two slowdowns
// give way, and FLOP's last tumble carries a hair past the face and settles.
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

/** One more full turn, then exactly the target's own reading: the flop ends on a face. */
function flopTo(from: number, to: number): number {
  const remainder = (((to - from) % FULL) + FULL) % FULL;
  return from + FULL + remainder;
}

/**
 * The die, as the acts its roll is made of (38.1).
 *
 * One cube, its six faces painted once from `PIP_MAP`, turned by ACCEL, SPIN and then —
 * untapped — SLOWDOWN and FLOP, or tapped, ACUTE, its three-quarter slowdown and the same
 * FLOP. FLOP's last tumble is the settle, so there is no stop act behind it and the face
 * is never left mid-turn. The angles are normalised onto the nearest full turn, which is
 * what keeps a match from growing one continuous angle for its length.
 *
 * Every length comes from `common/src/timing.constants.ts`, because the total they add up
 * to is a number the engine paces a bot with. `spinMs` is the length the roller drew at
 * `beginRoll` (and the ceiling for a roll this device only watches); `tappedAt` is the
 * catch's own timestamp, which branches the acts and cuts the spin where the hand met it.
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
  const face = FACE_ROTATIONS[value] ?? FACE_ROTATIONS[1];
  // The cube's live orientation and the transition carrying it there: one render per act,
  // each with its own duration, which is what makes the acts read as acts.
  const [pose, setPose] = useState<Pose>(() => ({ ...face }));
  const [turn, setTurn] = useState<{ ms: number; ease: string }>({ ms: 0, ease: EASE.spin });
  const poseRef = useRef(pose);
  // What this roll is planned from: the pose it started on and the instant it started. A
  // tap re-runs the acts from here, so a branch taken mid-spin re-plans the rest of the
  // roll instead of turning the cube again from wherever it happens to be.
  const restRef = useRef<Pose | null>(null);
  const beganRef = useRef(0);

  useEffect(() => {
    // At rest the die is the face the engine sent, and nothing here has to write state for
    // it: the render reads the stored angle's nearest full turn, which is the same die.
    if (!rolling) {
      restRef.current = null;
      return;
    }

    if (restRef.current == null) {
      // Planned from the resting reading, never from the raw angle: the flop ends on the
      // face plus a whole number of turns, and starting the next roll there is what keeps
      // one match from accumulating a thousand degrees (38.3).
      restRef.current = {
        x: nearestTurn(poseRef.current.x, face.x),
        y: nearestTurn(poseRef.current.y, face.y),
      };
      beganRef.current = startAt ?? performance.now();
    }
    const rest = restRef.current;
    const beganAt = beganRef.current;

    // ACCEL turns the face already showing onto its axis; SPIN adds two more turns and a
    // quarter over on X, so the cube reads as tumbling rather than as spinning on one pin.
    const accel: Pose = { x: rest.x, y: rest.y + FULL };
    const spun: Pose = { x: rest.x + FULL, y: rest.y + 3 * FULL };
    const acute: Pose = { x: spun.x, y: spun.y + 2 * FULL };
    const acuteDown: Pose = { x: acute.x, y: acute.y + HALF };
    const slowed: Pose = { x: spun.x, y: spun.y + HALF };

    // The tap has an act to play only while SPIN is still running (38.2): a catch after
    // it lands finds a die already slowing, and that roll plays its untapped branch.
    const spinEndsAt = DICE_ACCEL_MS + spinMs;
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
    const flopFrom = (from: Pose): Pose => ({
      x: flopTo(from.x, face.x),
      y: flopTo(from.y, face.y),
    });

    if (catchAt == null) {
      // The whole untapped roll: ACCEL from the face already showing, SPIN to its drawn
      // end, SLOWDOWN, then the flop that settles onto the engine's face.
      runAt(0, () => turnTo(accel, DICE_ACCEL_MS, EASE.accel));
      runAt(DICE_ACCEL_MS, () => turnTo(spun, spinMs, EASE.spin));
      runAt(spinEndsAt, () => turnTo(slowed, DICE_SLOWDOWN_MS, EASE.slowdown));
      runAt(spinEndsAt + DICE_SLOWDOWN_MS, () =>
        turnTo(flopFrom(slowed), DICE_FLOP_MS, EASE.flop),
      );
    } else {
      // A catch replans only what is LEFT of the roll (38.2): the spin was cut where the
      // hand met it, so its acts are not re-run, and the acute pair starts from the pose
      // the cube was already heading for — nothing rewinds, and every target here is a
      // pure function of the rest pose and the catch, so a second render (the frame
      // arriving, say) replans the same instants rather than adding turns.
      const acuteEndsAt = catchAt + DICE_ACUTE_MS;
      const acuteSlowedAt = acuteEndsAt + DICE_ACUTE_SLOWDOWN_MS;
      runAt(catchAt, () => turnTo(acute, DICE_ACUTE_MS, EASE.acute));
      runAt(acuteEndsAt, () => turnTo(acuteDown, DICE_ACUTE_SLOWDOWN_MS, EASE.slowdown));
      runAt(acuteSlowedAt, () => turnTo(flopFrom(acuteDown), DICE_FLOP_MS, EASE.flop));
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [rolling, startAt, spinMs, tappedAt, face.x, face.y]);

  // What the cube shows. While a roll runs that is the live act; at rest it is the stored
  // angle's nearest full turn of the engine's face, which is the same die seen the same way
  // and is how the angle is normalised between rolls (38.3).
  const shown = rolling
    ? pose
    : { x: nearestTurn(pose.x, face.x), y: nearestTurn(pose.y, face.y) };

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
            transform: `rotateX(${shown.x}deg) rotateY(${shown.y}deg)`,
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

// One face of the cube: a pip grid painted once and placed by its own rotation, so the
// cube's turn is the only thing that decides which face is showing.
function Face({ value }: { value: number }) {
  const placement = FACE_PLACEMENT[value];
  const box: CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gridTemplateRows: '1fr 1fr 1fr',
    padding: 13,
    gap: 3,
    boxSizing: 'border-box',
    borderRadius: 17,
    border: '1px solid var(--dice-edge)',
    background: 'linear-gradient(150deg, var(--dice-face), var(--dice-face-shade))',
    backfaceVisibility: 'hidden',
    transform: `rotateX(${placement.x}deg) rotateY(${placement.y}deg) translateZ(${HALF}px)`,
  };
  const on = PIP_MAP[value] ?? [];

  return (
    <div style={box}>
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} style={{ display: 'grid', placeItems: 'center' }}>
          {on.includes(i) ? (
            <div
              style={{
                width: 13,
                height: 13,
                borderRadius: '50%',
                background:
                  'radial-gradient(circle at 35% 30%, var(--dice-pip), var(--dice-pip-shade))',
                boxShadow: 'inset 0 1px 1px rgb(0 0 0 / 0.35)',
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
