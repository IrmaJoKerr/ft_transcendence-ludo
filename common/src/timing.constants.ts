// The twenty-one delays the engine and the SPA both count, in one file. Copied
// verbatim from `backend/app/ludo-engine/src/timing.ts` and
// `frontend/src/game/timing.ts`, which agreed value for value on 2026-11-04; from
// here on they read these declarations instead of each other's comments.
//
// Only the shared twenty-one live here. The engine's own lifecycle and bot tunables, and
// the client's presentation-only timings (`CLASH_SWITCH_*`, `DICE_BRAKE_*`,
// `CAPTURE_FX_*`, `RESULTS_MODAL_*`), each have one reader and stay where they are.

// --- the clash QTE -------------------------------------------------------------
export const CLASH_ANNOUNCE_MS = 1500; // "CLASH!" flash, keys still hidden
export const CLASH_COUNTDOWN_MS = 3000; // 3-2-1, keys still hidden
export const CLASH_PRESS_MS = 5000; // press race window

// The result card is ADDED from its parts rather than being one guessed number, and the
// scene is those parts: the attack, whose last beat falls at 703 ms, and the jail, which
// opens where the subtraction's last frame falls and lands its bars 421 ms later (25.8).
// Cutting the old 1900 ms gesture into its two acts re-times nothing — only the
// denominator each act's keyframes are written against — and it lets a third act sit
// between them (the cloud on a breach) without touching either. Both sides keep the parts,
// not just the sum, because the sum is also the engine's input freeze and the chain's
// next-round timer: re-timing an act moves the card on both sides at once instead of
// leaving a hand-computed 2900 to update.
export const SCENE_ATTACK_MS = 700; // the beam, the strike, the wall's flare, the subtraction
export const SCENE_JAIL_MS = 1200; // the bars travel, land at 421 and hold for 779 ms
// A wall's attack act is the pair's plus one beat (32.4), and the beat carries the TAIL of
// the act, never the head: the beam arrives at 247, the flare peaks at 323 and the line is
// subtracted at 418 on every path, and inside a longer act those instants are the same 247,
// 323 and 418 because the head of the act did not move. What the extra 900 buys is the dome
// being seen to take the hit and then to hold: the strip the pair spends on a still cell is
// the strip a wall cannot spare, because its shield is the thing that was hit.
export const SCENE_WALL_BEAT_MS = 900; // a wall only: the dome takes the hit, then holds
export const SCENE_WALL_ATTACK_MS = SCENE_ATTACK_MS + SCENE_WALL_BEAT_MS; // 1.6 s
// The breach's own act, and the only act a card does not always have: a mushroom cloud
// grows from the ground where the wall stood, and the sentence lives inside it (25.4).
// Everything after it moves by its length when it plays, and by nothing else.
export const SCENE_CLOUD_MS = 1400; // breach only: the cloud, then the sentence inside it
export const RESULT_FX_MS = SCENE_ATTACK_MS + SCENE_JAIL_MS; // the two-act scene: 1.9 s
export const RESULT_HEADLINE_READ_MS = 1000; // the headline after the gesture stops
export const CLASH_RESULT_MS = RESULT_FX_MS + RESULT_HEADLINE_READ_MS; // the card: 2.9 s
// A wall's card is that plus the beat, read window and all: the acts do not change, one of
// them grows, so 3800 = 1900 + 900 + 1000 and no reader has to know which act moved. A wall
// can also be REPULSED, and a repulse plays the same wall stage, so this is every wall card
// that is not the breach — the won round with defenders left and the lost one alike.
export const CLASH_WALL_RESULT_MS =
  RESULT_FX_MS + SCENE_WALL_BEAT_MS + RESULT_HEADLINE_READ_MS; // 3.8 s
// A breach is the one card that grows twice, and the only one whose sentence is inside a
// scene act rather than after it: a wall's three acts and NO read window, so it is shorter
// than `CLASH_WALL_RESULT_MS + SCENE_CLOUD_MS` by exactly the read window it gives up
// (4200 against 4800). It is also a FINAL card by definition (there is no defender left to
// fight), and it is the longest card there is, so the engine's freeze is derived from it
// (`CLASH_RESULT_FREEZE_MS`, 4400) instead of a 4000 kept beside it (D31, 32.4).
export const CLASH_BREACH_RESULT_MS = SCENE_WALL_ATTACK_MS + SCENE_CLOUD_MS + SCENE_JAIL_MS; // 4.2 s
// With the acts switched off there is no scene at all, so the card is its text and nothing
// else: it needs enough time to be read, not a gesture's worth. Deliberately neither the
// 1000 ms read window (short because a scene has just carried the meaning) nor the 2900 ms
// card (long because a gesture is playing). D32.
export const CLASH_TEXT_ONLY_MS = 1400;
// The receipt's one-way trip (25.8): a client that shows a card tells the engine it is done
// at the card's own length plus this, and a card nobody sits on is timed by the engine to
// the same figure — so the margin needs a reader on each side of the wire and lives with
// the cards it adds to (32.4).
export const CARD_HOLD_MARGIN_MS = 200;

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
