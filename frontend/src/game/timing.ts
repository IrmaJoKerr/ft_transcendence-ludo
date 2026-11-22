// Presentation delays only. The engine-shared acts and totals live in
// `common/src/timing.constants.ts`; the server sends deadlines, so a wrong local
// number cannot move a game.
import {
  CLASH_BREACH_RESULT_MS,
  CLASH_RESULT_MS,
  CLASH_TEXT_ONLY_MS,
  CLASH_WALL_RESULT_MS,
  DICE_ACCEL_MS,
  DICE_ACUTE_MS,
  DICE_ACUTE_SLOWDOWN_MS,
  DICE_FLOP_MS,
  DICE_SLOWDOWN_MS,
  GOAL_CARD_TOTAL_MS,
  GOAL_FX_MS,
} from '../__shared__/timing.constants';
import type { ClashResult } from './reducer';
import type { PlayerColor } from './types';

export const CLASH_FIGHT_FLASH_MS = 700; // "FIGHT!" flash at press start
export const CLASH_UI_TICK_MS = 250; // overlay re-render cadence
export const TOUCH_FLASH_MS = 120; // touch pad pressed state
// Key-shift presentation, all measured off the engine's absolute switch stamps, so a switch lands
// when the SERVER switches and never when a 250 ms tick happens to fire.
export const CLASH_SWITCH_WARN_MS = 400; // warning leads its switch by this much
export const CLASH_SWITCH_WARN_HOLD_MS = 300; // and lingers this long after it
export const CLASH_SWITCH_FLIP_MS = 110; // half a flip: edge-on exactly at the switch
export const CLASH_SWITCH_PAD_STAGGER_MS = 40; // per-circle landing delay

// `DICE_ACCEL_MS` is the gate: the throw owns the die until it is up on its corner, so a
// tap inside it is a double tap, not a catch. A catch the die cannot play must not shorten
// the landing, or the panel would land on a face the cube is still turning towards.
export const DICE_BRAKE_ARM_MS = DICE_ACCEL_MS; // a tap younger than this is a double tap, not a catch
export const RESULTS_MODAL_DELAY_MS = 900; // beat after the last move before the modal
export const PENDING_MOVE_GUARD_MS = 3000; // safety net for a move that never answers

// The result card a `clash_result` frame draws, and how long it lasts (25.8, 32.4).
export function clashCardMs(
  result: ClashResult | null,
  attacker: PlayerColor | undefined,
  animations: boolean,
): number {
  if (!animations) return CLASH_TEXT_ONLY_MS;
  // No stack, no beat: the pair's card is untouched by this pass, whatever the outcome.
  if ((result?.totalRounds ?? 1) <= 1) return CLASH_RESULT_MS;
  const attackerWon = !!result && result.winner === (result.attacker ?? attacker);
  // The frame reports the ledger AFTER the round, so an empty one on a wall is the last
  // defender gone; a mid-chain round names the rest of the stack and is not a breach.
  const lastDefender = (result?.remainingDefenderIds?.length ?? 0) === 0;
  return attackerWon && lastDefender ? CLASH_BREACH_RESULT_MS : CLASH_WALL_RESULT_MS;
}

export const CAPTURE_FX_MS = 600; // the capture burst's own length (its keyframes read it)
export const CAPTURE_FX_CARD_OPACITY = 0.7; // the burst as it reads over the clash card
export const CAPTURE_FX_AFTER_CARD_MS = 50; // beat between the card leaving and the real burst

export const GOAL_BURST_MS = 700; // the starburst's own length (its keyframes read it)

// The goal celebration a seat watches after the walk, and how long it lasts (32.5).
export function goalCelebrationMs(animations: boolean): number {
  return animations ? GOAL_CARD_TOTAL_MS : GOAL_FX_MS;
}

// The die's acts whose lengths are the client's alone.
const DICE_UNTAPPED_TAIL_MS = DICE_SLOWDOWN_MS + DICE_FLOP_MS; // 1180
const DICE_TAPPED_TAIL_MS = DICE_ACUTE_MS + DICE_ACUTE_SLOWDOWN_MS + DICE_FLOP_MS; // 1800

// How long one roll runs from its tap: ACCEL, the spin it drew, then its untapped tail.
export const diceRollMs = (spinMs: number): number =>
  DICE_ACCEL_MS + spinMs + DICE_UNTAPPED_TAIL_MS;

// The last instant a tap still has an act to play: the end of SPIN, not the ceiling.
export const diceTapClosesAt = (start: number, spinMs: number): number =>
  start + DICE_ACCEL_MS + spinMs;

// When a roll in flight lands, in one place because the tap's whole behaviour is this clamp.
// `start` is the tap that opened the roll, `spinMs` the length it drew, `valueAt` the moment the
// engine's face arrived and `brakeAt` the tap that caught the die (null when nothing did).
export const diceLandAt = (
  start: number,
  spinMs: number,
  valueAt: number,
  brakeAt: number | null,
): number => {
  const naturalEnd = start + diceRollMs(spinMs);
  const landAt =
    brakeAt === null ? naturalEnd : Math.min(naturalEnd, brakeAt + DICE_TAPPED_TAIL_MS);
  return Math.max(valueAt, landAt);
};
