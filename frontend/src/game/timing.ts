// The delays the client shows, in one place. The names shared with the engine must keep
// the same value as `backend/app/ludo-engine/src/timing.ts`: the engine-unit
// `timing-contract` harness asserts it, so a one-sided edit fails there and not on a
// tablet.
//
// The clash windows below are presentation only (the server sends absolute deadlines and
// the client derives its phases from them). The result card, the board step and the dice
// spin are a real contract: the hold forecast is measured against CLASH_RESULT_MS, and
// the engine paces bots with the same step and dice numbers.

export const CLASH_ANNOUNCE_MS = 1500; // Card A splash ("CLASH!") 
export const CLASH_COUNTDOWN_MS = 3000; // GET READY, then 3-2-1
export const CLASH_PRESS_MS = 5000; // keys and bars race
export const CLASH_RESULT_MS = 2000; // Card D result card, and the hold forecast

export const CLASH_FIGHT_FLASH_MS = 700; // "FIGHT!" flash at press start
export const CLASH_UI_TICK_MS = 250; // overlay re-render cadence
export const TOUCH_FLASH_MS = 120; // touch pad pressed state

export const MOVE_STEP_ANIM_MS = 180; // one board step of the path animation
export const DICE_ROLL_ANIM_MS = 750; // dice spin before the path starts
export const RESULTS_MODAL_DELAY_MS = 900; // beat after the last move before the modal
export const PENDING_MOVE_GUARD_MS = 3000; // safety net for a move that never answers
export const CARD_HOLD_MARGIN_MS = 200; // the receipt's one-way trip
