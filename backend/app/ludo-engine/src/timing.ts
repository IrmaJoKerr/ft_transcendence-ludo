// Every delay the engine owns and no other build counts. The ones both builds count
// (the three clash windows, the result card's acts and the four lengths they make, the
// receipt's margin, the flash card's four and the step and dice animations) live in
// `common/src/timing.constants.ts` and reach this tree as
// `./__shared__/timing.constants`, so there is nothing left to mirror.

import { CARD_HOLD_MARGIN_MS, CLASH_BREACH_RESULT_MS } from './__shared__/timing.constants';

// --- clash QTE ----------------------------------------------------------------
// The three clash windows and the result card's lengths are NOT here: both builds
// count them, so they live in `common/src/timing.constants.ts` (`./__shared__/
// timing.constants` is the copy this tree compiles). Everything below has exactly one
// reader, which is the engine.
// The key-shift mutator's schedule, measured from `countdownDeadline` (the instant
// the press phase opens). Every switch is DRAWN inside its window, so two switches
// never land on a metronome. Worst case (2500 + 1100) still leaves 1400 ms of the
// 5000 ms press window after the last switch, and the 1100 ms press cap means at
// least ten presses are still available on the final letter.
export const CLASH_SWITCH_FIRST_MIN_MS = 2000; // earliest first switch
export const CLASH_SWITCH_FIRST_MAX_MS = 2500; // latest first switch
export const CLASH_SWITCH_GAP_MIN_MS = 800; // shortest gap between two switches
export const CLASH_SWITCH_GAP_MAX_MS = 1100; // longest gap between two switches
// The result card's lengths are the shared ones too (see the top of the file): the
// engine never draws the card, but it owns the freeze stamped on the game and the
// chain's next-round timer, so it reads the same constants the client draws from —
// and reads them for the LONGEST card, which is the breach.
export const CLASH_RESULT_FREEZE_MS = CLASH_BREACH_RESULT_MS + CARD_HOLD_MARGIN_MS; // 4400
export const CARD_HOLD_MIN_MS = 250; // floor for a client's card hold
// The key-shift mutator widens the press window: each switch adds this to the base
// `CLASH_PRESS_MS` (see `startClash` in clash.ts), so the sweep's outer bound has to
// cover the longest window. 18000 keeps the headroom 15000 gave the 5000 ms window:
// the two-switch clash runs 4500 ms of announce + countdown plus 8000 ms of presses.
export const CLASH_KEYSHIFT_EXTRA_MS = 1500; // press-window extension per key shift
export const CLASH_SWEEP_GRACE_MS = 18000; // outer cleanup bound from clash start
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
// time, decoding the symbol and picking the finger: 400..600 ms. Since the QTE's
// letters change mid-round (decision 4.7, 2026-11-09) both constants sit at the top
// of their band or just above it — 200 and 600 — because nobody in this room is
// reading a key they already know: recognition comes first, muscle memory second,
// and 100..150 assumes the first half is free. 200 sits just above the touch-typist
// band and 600 on the casual band's top edge, so the fast profile now models
// recognition plus muscle memory, which is exactly what a human pays when the
// letter under their finger is replaced. The pause is a constant on purpose, so the
// hesitation IS the profile, and every draw left in the schedule is the mash tempo
// (CLASH_BOT_JITTER_MS on the gaps). What the widening costs is jitter, not presses:
// the fit in `botPressTimes` leaves fast ~540 ms of slack against ~555 ms of drawn
// jitter and casual ~110 against ~480, so a casual bot reads close to a metronome
// and no press leaves the window (the arithmetic is in 4.7).
export const CLASH_BOT_FAST_REACTION_MS = 200; // recognition, then muscle memory
export const CLASH_BOT_CASUAL_REACTION_MS = 600; // top of the choice-reaction band
// What a bot pays when the letters change mid-round: the re-read a human pays at a
// switch, on top of the profile's own pause (so 350 fast, 750 casual). It comes out
// of the extension the key-shift mutator already grants the window
// (`CLASH_KEYSHIFT_EXTRA_MS` per switch), which the fit never spent — the bot's
// schedule stayed inside the plain 5000 ms while the window was 6500 or 8000.
export const CLASH_BOT_REREAD_MS = 150;

// --- turn animation ------------------------------------------------------------
// The step and dice numbers are shared (bot turns are paced so their move finishes
// animating before the next action fires), so they moved to
// `common/src/timing.constants.ts`. These two are the engine's own pacing.
export const BOT_MOVE_STEP_MS = 220; // the engine's slack over MOVE_STEP_ANIM_MS
export const BOT_THINK_MS = 500; // flat pause before a bot acts
// The flash card's four beats are shared too (25.17): the engine waits the card out, so
// the wait is derived from the card's own parts rather than a second hand-counted number.

// --- transport ----------------------------------------------------------------
export const PING_INTERVAL_MS = 10 * 1000;
export const PING_TIMEOUT_MS = 15 * 1000;
export const EVENT_WINDOW_MS = 5 * 1000; // inbound budget window, per socket
export const CLASH_EVENT_WINDOW_MS = 5 * 1000; // the press bucket's own window
// The room channel's send spacing is a chat number, not a timing: it lives in
// `common/src/chat.constants.ts` as `CHAT_COOLDOWN_MS`, with the lobby's, although the
// two scope it differently (per account here, per socket there).

// --- lifecycle ----------------------------------------------------------------
export const IDLE_LOBBY_TIMEOUT_MS = 5 * 60 * 1000; // empty PvP lobby
export const POST_GAME_TIMEOUT_MS = 60 * 1000; // finished room teardown
export const DISCONNECT_GRACE_MS = 45000; // PvP reconnect window
// A waiting-room seat gets a longer window on purpose (R12/R17): no game is being
// played, returning to the lobby never costs the seat, and the clock is there to
// notice a player who is not coming back. The host's window closes the room itself,
// because only the host can mark their seat ready, so a room with an absent host can
// never start.
export const WAITING_SEAT_GRACE_MS = 5 * 60 * 1000; // WAITING-room away window
export const SINGLE_SOCKET_DISCONNECT_GRACE_MS = 60 * 60 * 1000; // bot-mode reconnect window
