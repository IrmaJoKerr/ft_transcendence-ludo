// Every delay the engine owns, in one place. The client mirrors the shared subset in
// `frontend/src/game/timing.ts`, and the timing contract harness asserts the two
// agree, so a one-sided change fails there instead of drifting unnoticed.

// --- clash QTE ----------------------------------------------------------------
export const CLASH_ANNOUNCE_MS = 1500; // "CLASH!" flash, keys still hidden
export const CLASH_COUNTDOWN_MS = 3000; // 3-2-1, keys still hidden
export const CLASH_PRESS_MS = 5000; // press race window
export const CLASH_RESULT_MS = 2000; // result card, displayed by the client
export const CLASH_RESULT_FREEZE_MS = 4000; // input freeze CEILING: a card hold only shortens it
export const CARD_HOLD_MIN_MS = 250; // floor for a client's card hold
export const CLASH_SWEEP_GRACE_MS = 15000; // outer cleanup bound from clash start
export const CLASH_SWEEP_INTERVAL_MS = 5000; // orphaned-clash sweep cadence
export const CLASH_PRESS_CAP_MS = 110; // min ms between accepted presses per side (~9 Hz)
export const CLASH_BOT_WIN_MS_BASE = 125; // winner's press interval base
export const CLASH_BOT_LOSE_MS_BASE = 155; // loser's press interval base
export const CLASH_BOT_JITTER_MS = 30; // random spread added to each interval

// --- turn animation ------------------------------------------------------------
// The client owns the pixels. The engine keeps the SAME step and dice numbers because
// bot turns are paced so their move finishes animating before the next action fires.
export const MOVE_STEP_ANIM_MS = 180; // one board step, client-side
export const DICE_ROLL_ANIM_MS = 750; // dice spin before the path starts
export const BOT_MOVE_STEP_MS = 220; // the engine's slack over MOVE_STEP_ANIM_MS
export const BOT_THINK_MS = 500; // flat pause before a bot acts

// --- transport ----------------------------------------------------------------
export const PING_INTERVAL_MS = 10 * 1000;
export const PING_TIMEOUT_MS = 15 * 1000;
export const EVENT_WINDOW_MS = 5 * 1000; // inbound budget window, per socket
export const CLASH_EVENT_WINDOW_MS = 5 * 1000; // the press bucket's own window

// --- lifecycle ----------------------------------------------------------------
export const IDLE_LOBBY_TIMEOUT_MS = 5 * 60 * 1000; // empty PvP lobby
export const POST_GAME_TIMEOUT_MS = 60 * 1000; // finished room teardown
export const DISCONNECT_GRACE_MS = 45000; // PvP reconnect window
export const SINGLE_SOCKET_DISCONNECT_GRACE_MS = 60 * 60 * 1000; // bot-mode reconnect window
