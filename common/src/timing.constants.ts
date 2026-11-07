// The eight delays the engine and the SPA both count, in one file. Copied
// verbatim from `backend/app/ludo-engine/src/timing.ts` and
// `frontend/src/game/timing.ts`, which agreed value for value on 2026-11-04; from
// here on they read these declarations instead of each other's comments.
//
// Only the shared eight live here. The engine's own lifecycle and bot tunables, and
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

// --- the turn animation --------------------------------------------------------
// The client owns the pixels. The engine keeps the SAME two numbers because bot turns
// are paced so their move finishes animating before the next action fires.
export const MOVE_STEP_ANIM_MS = 180; // one board step of the path animation
export const DICE_ROLL_ANIM_MS = 750; // dice spin before the path starts
