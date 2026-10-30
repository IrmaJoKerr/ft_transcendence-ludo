// Every delay the engine owns, in one place. The client mirrors the shared subset in
// `frontend/src/game/timing.ts`, and the timing contract harness asserts the two
// agree, so a one-sided change fails there instead of drifting unnoticed.

// --- clash QTE ----------------------------------------------------------------
export const CLASH_ANNOUNCE_MS = 1500; // "CLASH!" flash, keys still hidden
export const CLASH_COUNTDOWN_MS = 3000; // 3-2-1, keys still hidden
export const CLASH_PRESS_MS = 5000; // press race window
// The key-shift mutator's schedule, measured from `countdownDeadline` (the instant
// the press phase opens). Every switch is DRAWN inside its window, so two switches
// never land on a metronome. Worst case (2500 + 1100) still leaves 1400 ms of the
// 5000 ms press window after the last switch, and the 1100 ms press cap means at
// least ten presses are still available on the final letter.
export const CLASH_SWITCH_FIRST_MIN_MS = 2000; // earliest first switch
export const CLASH_SWITCH_FIRST_MAX_MS = 2500; // latest first switch
export const CLASH_SWITCH_GAP_MIN_MS = 800; // shortest gap between two switches
export const CLASH_SWITCH_GAP_MAX_MS = 1100; // longest gap between two switches
// The result card, ADDED from the same two beats the client adds (it mirrors
// `frontend/src/game/timing.ts`): the gesture the card plays, then the headline's read
// time. The engine never draws the card, but it owns the freeze stamped on the game and
// the chain's next-round timer, so it has to know the sum to the millisecond; keeping
// the two parts here means re-timing the gesture moves the card on both sides at once
// instead of leaving a hand-computed 2600 to update.
export const RESULT_FX_MS = 1300; // the result card's gesture (ResultFx.tsx)
export const RESULT_HEADLINE_READ_MS = 1300; // the headline once the gesture stops
export const CLASH_RESULT_MS = RESULT_FX_MS + RESULT_HEADLINE_READ_MS; // 2600
export const CLASH_RESULT_FREEZE_MS = 4000; // input freeze CEILING: a card hold only shortens it
export const CARD_HOLD_MIN_MS = 250; // floor for a client's card hold
export const CLASH_SWEEP_GRACE_MS = 15000; // outer cleanup bound from clash start
export const CLASH_SWEEP_INTERVAL_MS = 5000; // orphaned-clash sweep cadence
export const CLASH_PRESS_CAP_MS = 110; // min ms between accepted presses per side (~9 Hz)
// Bot presser bases: one per pacing profile. The profile decides how many presses
// a side makes (38 fast, 33 casual, see clash-pace.ts); these are the interval the
// count is built from. The fast base sits JUST above CLASH_PRESS_CAP_MS: bots call
// the store directly today, so they bypass the cap, and a base under 110 would
// silently start losing presses the day they are routed through the capped path.
export const CLASH_BOT_FAST_MS_BASE = 111; // fast profile's press interval base
export const CLASH_BOT_CASUAL_MS_BASE = 129; // casual profile's press interval base
export const CLASH_BOT_JITTER_MS = 30; // random spread added to each interval
// Bot reaction pauses: one CONSTANT per profile, never drawn. The bands are the
// research figures for "see the key, then press it". A touch-typist does not read
// the letter, muscle memory does: 100..150 ms. Everyone else pays choice reaction
// time, decoding the symbol and picking the finger: 400..600 ms. The pause is a
// constant on purpose, so the hesitation IS the profile, and every draw left in
// the schedule is the mash tempo (CLASH_BOT_JITTER_MS on the gaps).
export const CLASH_BOT_FAST_REACTION_MS = 120; // touch-typist: muscle memory
export const CLASH_BOT_CASUAL_REACTION_MS = 500; // choice reaction: 400..600 band

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
