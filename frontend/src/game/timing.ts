// The delays the client shows, in one place. The names shared with the engine must
// match `backend/app/ludo-engine/src/timing.ts`; the timing contract harness asserts
// it. The clash windows are presentation only, since the server sends deadlines.

export const CLASH_ANNOUNCE_MS = 1500; // Card A splash ("CLASH!")
export const CLASH_COUNTDOWN_MS = 3000; // GET READY, then 3-2-1
export const CLASH_PRESS_MS = 5000; // keys and bars race
export const CLASH_RESULT_MS = 2000; // Card D result card, and the hold forecast

export const CLASH_FIGHT_FLASH_MS = 700; // "FIGHT!" flash at press start
export const CLASH_UI_TICK_MS = 250; // overlay re-render cadence
export const TOUCH_FLASH_MS = 120; // touch pad pressed state

export const MOVE_STEP_ANIM_MS = 180; // one board step of the path animation
export const DICE_ROLL_ANIM_MS = 750; // dice spin before the path starts
export const DICE_BRAKE_ARM_MS = 200; // a tap younger than this is a double tap, not a brake
export const DICE_BRAKE_FLOOR_MS = 450; // shortest braked roll, so nothing teleports
export const DICE_BRAKE_SETTLE_MS = 150; // near-miss face, then the true one
export const RESULTS_MODAL_DELAY_MS = 900; // beat after the last move before the modal
export const PENDING_MOVE_GUARD_MS = 3000; // safety net for a move that never answers
export const CARD_HOLD_MARGIN_MS = 200; // the receipt's one-way trip
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
