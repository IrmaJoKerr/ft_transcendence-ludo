// The delays the client owns and no other build counts. The ones the engine counts too (the
// clash windows, the result card's three acts and the two lengths they make, the flash card's
// four, and the step and dice animations) live in `common/src/timing.constants.ts` and reach
// this tree as `../__shared__/timing.constants`, so there is nothing left to mirror. What
// stays here is presentation only: the clash windows are still read as fallbacks, but the
// server sends deadlines, so a wrong number here cannot move a game.
import {
  CLASH_BREACH_RESULT_MS,
  CLASH_RESULT_MS,
  CLASH_TEXT_ONLY_MS,
  DICE_ROLL_ANIM_MS,
} from '../__shared__/timing.constants';
import type { ClashResult } from './reducer';
import type { PlayerColor } from './types';

export const CLASH_FIGHT_FLASH_MS = 700; // "FIGHT!" flash at press start
export const CLASH_UI_TICK_MS = 250; // overlay re-render cadence
export const TOUCH_FLASH_MS = 120; // touch pad pressed state
// Key-shift presentation, all measured off the engine's absolute switch stamps, so a
// switch lands when the SERVER switches and never when a 250 ms tick happens to fire.
// The flip is anchored so the NEW letter is face-on at the switch instant: the badge
// is edge-on CLASH_SWITCH_FLIP_MS before it, and the two halves make a 220 ms flip.
export const CLASH_SWITCH_WARN_MS = 400; // warning leads its switch by this much
export const CLASH_SWITCH_WARN_HOLD_MS = 300; // and lingers this long after it
export const CLASH_SWITCH_FLIP_MS = 110; // half a flip: edge-on exactly at the switch
export const CLASH_SWITCH_PAD_STAGGER_MS = 40; // per-circle landing delay

export const DICE_BRAKE_ARM_MS = 200; // a tap younger than this is a double tap, not a brake
export const DICE_BRAKE_FLOOR_MS = 450; // shortest braked roll, so nothing teleports
export const DICE_BRAKE_SETTLE_MS = 150; // near-miss face, then the true one
export const RESULTS_MODAL_DELAY_MS = 900; // beat after the last move before the modal
export const PENDING_MOVE_GUARD_MS = 3000; // safety net for a move that never answers
export const CARD_HOLD_MARGIN_MS = 200; // the receipt's one-way trip

/**
 * The result card a `clash_result` frame draws, and how long it lasts (25.8).
 *
 * Two readers, one number: the overlay's own timer and the receipt `Game.tsx` sends the
 * engine, which must be the card's own length plus the margin and never a constant — an
 * over-ask is harmless, an under-ask truncates.
 *
 * A total breach — the attacker's win against the LAST defender of a wall — is the only
 * card with a third act (the cloud) and the only one whose sentence lives inside an act
 * instead of after the scene, so it is the only card that is not `CLASH_RESULT_MS`. The
 * test is the three facts the scene itself reads (`ResultFx`'s `isBreach`): the attacker
 * won, the square was a wall, and no defender is left. With the room's acts off there is
 * no scene at all, so there is no cloud to wait for either.
 *
 * `attacker` is the round's attacker resolved by the caller, because an older engine's
 * frame may omit it and the overlay falls back to the live clash's.
 */
export function clashCardMs(
  result: ClashResult | null,
  attacker: PlayerColor | undefined,
  animations: boolean,
): number {
  if (!animations) return CLASH_TEXT_ONLY_MS;
  const attackerWon = !!result && result.winner === (result.attacker ?? attacker);
  const isWall = (result?.totalRounds ?? 1) > 1;
  const lastDefender = (result?.remainingDefenderIds?.length ?? 0) === 0;
  return attackerWon && isWall && lastDefender ? CLASH_BREACH_RESULT_MS : CLASH_RESULT_MS;
}

export const CAPTURE_FX_MS = 600; // the capture burst's own length (its keyframes read it)
export const CAPTURE_FX_CARD_OPACITY = 0.7; // the burst as it reads over the clash card
export const CAPTURE_FX_AFTER_CARD_MS = 50; // beat between the card leaving and the real burst

// When a roll in flight may land, all in one place because the brake's whole
// behaviour is this clamp. `start` is the tap that opened the roll, `valueAt` the
// moment the server's face arrived and `brakeAt` the tap that braked it (null when
// nothing did). A brake moves the landing between the floor and the natural end and
// never past it, so a roll can be shortened but never extended; the value itself is
// never touched, and a slow answer wins over the shortened window rather than
// settling on a face nobody sent.
export const diceLandAt = (start: number, valueAt: number, brakeAt: number | null): number => {
  if (brakeAt === null) return Math.max(valueAt, start + DICE_ROLL_ANIM_MS);
  const braked = Math.min(
    start + DICE_ROLL_ANIM_MS,
    Math.max(
      start + DICE_BRAKE_FLOOR_MS,
      brakeAt + DICE_BRAKE_SETTLE_MS,
      // A late answer still gets the near-miss, but never by pushing the landing
      // past the natural end.
      valueAt + DICE_BRAKE_SETTLE_MS,
    ),
  );
  return Math.max(valueAt, braked);
};
