// The twelve delays the engine and the SPA both count, in one file. Copied
// verbatim from `backend/app/ludo-engine/src/timing.ts` and
// `frontend/src/game/timing.ts`, which agreed value for value on 2026-11-04; from
// here on they read these declarations instead of each other's comments.
//
// Only the shared twelve live here. The engine's own lifecycle and bot tunables, and
// the client's presentation-only timings (`CLASH_SWITCH_*`, `DICE_BRAKE_*`,
// `CAPTURE_FX_*`, `RESULTS_MODAL_*`), each have one reader and stay where they are.

// --- the clash QTE -------------------------------------------------------------
export const CLASH_ANNOUNCE_MS = 1500; // "CLASH!" flash, keys still hidden
export const CLASH_COUNTDOWN_MS = 3000; // 3-2-1, keys still hidden
export const CLASH_PRESS_MS = 5000; // press race window

// The result card is ADDED from its two beats rather than being one guessed number:
// the gesture the card plays, then the headline's read time. Both sides keep the
// parts, not just the sum, because the sum is also the engine's input freeze and the
// chain's next-round timer: re-timing a gesture moves the card on both sides at once
// instead of leaving a hand-computed 2900 to update.
export const RESULT_FX_MS = 1900; // how long the gesture lasts (1.2 s was the floor)
export const RESULT_HEADLINE_READ_MS = 1000; // the headline after the gesture stops
export const CLASH_RESULT_MS = RESULT_FX_MS + RESULT_HEADLINE_READ_MS; // the card: 2.9 s

// --- the opt-in capture flash card ---------------------------------------------
// A non-clash capture paints the clash card's own gesture over the board. Its clock is
// ADDED from its parts for the same reason the clash card's is, and the parts are shared
// because three readers count them: the client fades and unmounts on the card, the
// client's roll guard opens past it, and the engine paces a bot to wait it out. The
// gesture is `RESULT_FX_MS` verbatim — never a rescaled copy — so the two cards cannot
// play different clips.
//
// The gesture's own tail is 780 ms of a still cell (`fxCage` lands at 1121 of the 1900),
// so the hold only has to reach ~1 s of stillness, which is the beat a result needs.
export const CAPTURE_CARD_HOLD_MS = 210; // the cell, held still AFTER the gesture stops
export const CAPTURE_CARD_FADE_MS = 300; // the panel's own fade out
export const CAPTURE_CARD_MS =
  RESULT_FX_MS + CAPTURE_CARD_HOLD_MS + CAPTURE_CARD_FADE_MS; // the whole card: 2.4 s
export const CAPTURE_CARD_GRACE_MS = 150; // the roll guard's slack past the card

// --- the turn animation --------------------------------------------------------
// The client owns the pixels. The engine keeps the SAME two numbers because bot turns
// are paced so their move finishes animating before the next action fires.
export const MOVE_STEP_ANIM_MS = 180; // one board step of the path animation
export const DICE_ROLL_ANIM_MS = 750; // dice spin before the path starts
