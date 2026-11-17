// The delays the client owns and no other build counts. The ones the engine counts too (the
// clash windows, the result card's acts and the four lengths they make, the receipt's
// margin, the flash card's four, the goal celebration's four, the step animation and the
// die's acts) live in `common/src/timing.constants.ts` and reach this tree as
// `../__shared__/timing.constants`, so there is nothing left to mirror. What stays here is
// presentation only: the clash windows are still read as fallbacks, but the server sends
// deadlines, so a wrong number here cannot move a game.
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
// Key-shift presentation, all measured off the engine's absolute switch stamps, so a
// switch lands when the SERVER switches and never when a 250 ms tick happens to fire.
// The flip is anchored so the NEW letter is face-on at the switch instant: the badge
// is edge-on CLASH_SWITCH_FLIP_MS before it, and the two halves make a 220 ms flip.
export const CLASH_SWITCH_WARN_MS = 400; // warning leads its switch by this much
export const CLASH_SWITCH_WARN_HOLD_MS = 300; // and lingers this long after it
export const CLASH_SWITCH_FLIP_MS = 110; // half a flip: edge-on exactly at the switch
export const CLASH_SWITCH_PAD_STAGGER_MS = 40; // per-circle landing delay

export const DICE_BRAKE_ARM_MS = 200; // a tap younger than this is a double tap, not a catch
export const RESULTS_MODAL_DELAY_MS = 900; // beat after the last move before the modal
export const PENDING_MOVE_GUARD_MS = 3000; // safety net for a move that never answers

/**
 * The result card a `clash_result` frame draws, and how long it lasts (25.8, 32.4).
 *
 * Two readers, one number: the overlay's own timer and the receipt `Game.tsx` sends the
 * engine, which must be the card's own length plus the margin and never a constant — an
 * over-ask is harmless, an under-ask truncates. The engine reads the same shared lengths
 * for the one card nobody sits on, so the two sides cannot pick different cards.
 *
 * Three kinds, and the wall is the one that changed the shape of this test. A wall's act
 * carries an extra 900 ms beat (the dome taking the hit and holding), so every card drawn
 * on a wall is 900 longer than the pair's: 3600 against 2700. A wall's card is
 * `CLASH_WALL_RESULT_MS` whether the wall stood or fell, because the stage that plays the
 * beat is chosen by the stack (`isWall`) and not by who won — a repulse is a dome that
 * took the blow and held.
 *
 * A total breach — the attacker's win against the LAST defender of a wall — is the only
 * card with a third act (the cloud) and the only one whose sentence lives inside an act
 * instead of after the scene, so it is the longest card there is: three acts and no read
 * window, `CLASH_BREACH_RESULT_MS` 4000. The test is the three facts the scene itself
 * reads (`ResultFx`'s `isBreach`): the attacker won, the square was a wall, and no
 * defender is left. With the room's acts off there is no scene at all, so there is no
 * cloud — or beat — to wait for either.
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

/**
 * The goal celebration a seat watches after the walk, and how long it lasts (32.5).
 *
 * Two readers, one number: the overlay's own timer, and the result modal's delay when the
 * move that reached home also ended the game (`Game.tsx`'s `game_ended`), which is this
 * plus `RESULTS_MODAL_DELAY_MS`. The engine counts the same two lengths for a bot's wake
 * (`socket/server.ts`), so a human and a bot wait out the same celebration.
 *
 * The rule picks the overlay and nothing else: with the room's effects off the client
 * paints confetti over the board for `GOAL_FX_MS`, and with them on it mounts the ramp card
 * for `GOAL_CARD_MS` and then its fade — `GOAL_CARD_TOTAL_MS`, 1400 all told. The starburst
 * and the fanfare are not the rule's business and play on every goal, so a room that
 * switched the acts off still shows the piece arrive.
 */
export function goalCelebrationMs(animations: boolean): number {
  return animations ? GOAL_CARD_TOTAL_MS : GOAL_FX_MS;
}

// The die's acts whose lengths are the client's alone. `Die` plays them from
// `common/src/timing.constants.ts`, so nothing here restates a length; these two totals
// are the only sums this tree adds, and they are added from the acts for the reason the
// result card's are: re-timing one act has to move the total with it (38.4).
//
// An untapped roll slows down and flops (`DICE_SLOWDOWN_MS` + `DICE_FLOP_MS`); a tapped
// one catches the die and plays the acute pair instead (`DICE_ACUTE_MS` + its
// three-quarter slowdown), then the same flop onto the same face.
const DICE_UNTAPPED_TAIL_MS = DICE_SLOWDOWN_MS + DICE_FLOP_MS; // 850
const DICE_TAPPED_TAIL_MS = DICE_ACUTE_MS + DICE_ACUTE_SLOWDOWN_MS + DICE_FLOP_MS; // 1350

/**
 * How long one roll runs from its tap: ACCEL, the spin it drew, then its untapped tail.
 *
 * The spin is drawn once, at `beginRoll`, and this is the one place the total is worked
 * out — the die's acts, the tap window and the answer guard all read it, so a tap can
 * never be judged against a schedule the die is not playing (38.E).
 */
export const diceRollMs = (spinMs: number): number =>
  DICE_ACCEL_MS + spinMs + DICE_UNTAPPED_TAIL_MS;

/**
 * The last instant a tap still has an act to play: the end of SPIN, not the ceiling.
 *
 * A tap in SLOWDOWN or FLOP has nothing left to branch into, so the window closes here
 * rather than at `start + diceRollMs` (38.2). It is also what makes the two branches
 * land on the same ceiling: the tapped tail measured from a catch inside SPIN can never
 * run past the untapped end, which is why the landing is capped rather than extended.
 */
export const diceTapClosesAt = (start: number, spinMs: number): number =>
  start + DICE_ACCEL_MS + spinMs;

/**
 * When a roll in flight lands, in one place because the tap's whole behaviour is this
 * clamp. `start` is the tap that opened the roll, `spinMs` the length it drew, `valueAt`
 * the moment the engine's face arrived and `brakeAt` the tap that caught the die (null
 * when nothing did).
 *
 * A tap SPENDS the roll's remaining time and never adds to it: its landing is the tapped
 * tail measured from the catch, capped by the untapped end, so a catch late in the spin
 * gets a short acute act and every client lands on one instant. The value itself is
 * never touched, and a slow answer wins over the shortened window rather than settling
 * on a face nobody sent.
 */
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
