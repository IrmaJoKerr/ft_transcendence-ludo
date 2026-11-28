// Engine-only delays. Shared timing lives in `./__shared__/timing.constants`.

import { CARD_HOLD_MARGIN_MS, CLASH_BREACH_RESULT_MS } from './__shared__/timing.constants';

// --- clash QTE ----------------------------------------------------------------
// Key-shift switches are drawn inside their windows, so two never land on a metronome.
// The worst-case schedule still leaves enough of the press window for the final letter.
export const CLASH_SWITCH_FIRST_MIN_MS = 2000; // earliest first switch
export const CLASH_SWITCH_FIRST_MAX_MS = 2500; // latest first switch
export const CLASH_SWITCH_GAP_MIN_MS = 800; // shortest gap between two switches
export const CLASH_SWITCH_GAP_MAX_MS = 1100; // longest gap between two switches

// The engine never draws the card, but its freeze and next-round timer use the longest
// shared card, which is the breach.
export const CLASH_RESULT_FREEZE_MS = CLASH_BREACH_RESULT_MS + CARD_HOLD_MARGIN_MS; // 4200
export const CARD_HOLD_MIN_MS = 250; // floor for a client's card hold

// Each key shift extends the press window, so the sweep covers the longest two-switch
// window: 4500 ms of announce and countdown plus 8000 ms of presses.
export const CLASH_KEYSHIFT_EXTRA_MS = 1500; // press-window extension per key shift
export const CLASH_SWEEP_GRACE_MS = 18000; // outer cleanup bound from clash start
export const CLASH_SWEEP_INTERVAL_MS = 5000; // orphaned-clash sweep cadence
export const CLASH_PRESS_CAP_MS = 110; // min ms between accepted presses per side (~9 Hz)
// Bot press interval bases, one per profile. The fast base stays above
// `CLASH_PRESS_CAP_MS` so routing bots through the capped path cannot silently drop presses.
export const CLASH_BOT_FAST_MS_BASE = 128; // fast profile's press interval base
export const CLASH_BOT_CASUAL_MS_BASE = 135; // casual profile's press interval base
export const CLASH_BOT_JITTER_MS = 30; // random spread added to each interval
// Bot reaction pauses are fixed per profile: fast models recognition plus muscle memory,
// casual pays choice reaction time. They are never drawn; the gap jitter carries tempo.
export const CLASH_BOT_FAST_REACTION_MS = 400; // recognition, then muscle memory
export const CLASH_BOT_CASUAL_REACTION_MS = 700; // top of the choice-reaction band
// Re-read cost after a mid-round letter switch, paid from the window extension the
// key-shift mutator already grants.
export const CLASH_BOT_REREAD_MS = 150;

// --- turn animation ------------------------------------------------------------
// Bot pacing waits for the shared move and dice animations to finish.
export const BOT_MOVE_STEP_MS = 220; // the engine's slack over MOVE_STEP_ANIM_MS
export const BOT_THINK_MS = 500; // flat pause before a bot acts
// The flash card's four beats are shared too (25.17): the engine waits the card out, so
// the wait is derived from the card's own parts rather than a second hand-counted number.

// --- transport ----------------------------------------------------------------
export const PING_INTERVAL_MS = 10 * 1000;
export const PING_TIMEOUT_MS = 15 * 1000;
export const EVENT_WINDOW_MS = 5 * 1000; // inbound budget window, per socket
export const CLASH_EVENT_WINDOW_MS = 5 * 1000; // the press bucket's own window
// Room chat send spacing is `CHAT_COOLDOWN_MS` in `common/src/chat.constants.ts`:
// per account here, per socket in the lobby.

// --- lifecycle ----------------------------------------------------------------
export const IDLE_LOBBY_TIMEOUT_MS = 5 * 60 * 1000; // empty PvP lobby
export const POST_GAME_TIMEOUT_MS = 60 * 1000; // finished room teardown
export const DISCONNECT_GRACE_MS = 45000; // PvP reconnect window
// Hotseat only needs to cover a reload. At expiry the single-socket room closes itself.
export const HOTSEAT_DISCONNECT_GRACE_MS = 5 * 1000;
// A waiting seat keeps a long away window. The host's expiry closes the room, because
// only the host can ready the seat and an absent host would block the start.
export const WAITING_SEAT_GRACE_MS = 5 * 60 * 1000; // WAITING-room away window
export const SINGLE_SOCKET_DISCONNECT_GRACE_MS = 60 * 60 * 1000; // bot-mode reconnect window
