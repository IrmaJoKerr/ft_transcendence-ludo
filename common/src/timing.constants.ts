// The thirty-two delays the engine and the SPA both count — plus the room's own idle
// window, which is the one number here no animation reads — in one file. Copied
// verbatim from `backend/app/ludo-engine/src/timing.ts` and
// `frontend/src/game/timing.ts`, which agreed value for value on 2026-11-04; from
// here on they read these declarations instead of each other's comments.
//
// Only the shared thirty-two live here. The engine's own lifecycle and bot tunables, and
// the client's presentation-only timings (`CLASH_SWITCH_*`, `DICE_BRAKE_ARM_MS`,
// `CAPTURE_FX_*`, `GOAL_BURST_MS`, `RESULTS_MODAL_*`), each have one reader and stay where
// they are. The die's acts are the exception that proves the rule (38): only the client
// draws them, and they are here because the ceiling they add up to, `DICE_ROLL_ANIM_MS`, is
// the number the engine paces a bot with.

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
export const SCENE_JAIL_MS = 1000; // the bars travel, land at 421 and hold for 579 ms
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
export const RESULT_FX_MS = SCENE_ATTACK_MS + SCENE_JAIL_MS; // the two-act scene: 1.7 s
export const RESULT_HEADLINE_READ_MS = 1000; // the headline after the gesture stops
export const CLASH_RESULT_MS = RESULT_FX_MS + RESULT_HEADLINE_READ_MS; // the card: 2.7 s
// A wall's card is that plus the beat, read window and all: the acts do not change, one of
// them grows, so 3600 = 1700 + 900 + 1000 and no reader has to know which act moved. A wall
// can also be REPULSED, and a repulse plays the same wall stage, so this is every wall card
// that is not the breach — the won round with defenders left and the lost one alike.
export const CLASH_WALL_RESULT_MS =
  RESULT_FX_MS + SCENE_WALL_BEAT_MS + RESULT_HEADLINE_READ_MS; // 3.6 s
// A breach is the one card that grows twice, and the only one whose sentence is inside a
// scene act rather than after it: a wall's three acts and NO read window, so it is shorter
// than `CLASH_WALL_RESULT_MS + SCENE_CLOUD_MS` by exactly the read window it gives up
// (4000 against 5000). It is also a FINAL card by definition (there is no defender left to
// fight), and it is the longest card there is, so the engine's freeze is derived from it
// (`CLASH_RESULT_FREEZE_MS`, 4200) rather than a number kept beside it (D31, 32.4).
export const CLASH_BREACH_RESULT_MS = SCENE_WALL_ATTACK_MS + SCENE_CLOUD_MS + SCENE_JAIL_MS; // 4.0 s
// With the acts switched off there is no scene at all, so the card is its text and nothing
// else: it needs enough time to be read, not a gesture's worth. Deliberately neither the
// 1000 ms read window (short because a scene has just carried the meaning) nor the 2700 ms
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
// The gesture's own tail is 579 ms of a still cell (`fxCage` lands at 1121 of the 1700),
// and the hold is added to that rather than replacing it, so the card ends on a beat of
// stillness — what a result needs — however long the jail act itself runs.
export const CAPTURE_CARD_HOLD_MS = 210; // the cell, held still AFTER the gesture stops
export const CAPTURE_CARD_FADE_MS = 300; // the panel's own fade out
export const CAPTURE_CARD_MS =
  RESULT_FX_MS + CAPTURE_CARD_HOLD_MS + CAPTURE_CARD_FADE_MS; // the whole card: 2.2 s
export const CAPTURE_CARD_GRACE_MS = 150; // the roll guard's slack past the card

// --- the goal beat -------------------------------------------------------------
// A piece reaching home is the one move whose celebration the SEAT watches after the walk,
// so both builds count it: the client plays it, and the engine paces a bot past it exactly
// as it paces one past a capture card. The celebration is exactly ONE overlay, and which
// one is the room's effects rule — never both (32.5):
//
//   effects off -> confetti over the board, `GOAL_FX_MS`
//   effects on  -> a ramp card, `GOAL_CARD_MS` and then its `GOAL_CARD_FADE_MS` fade
//
// Only the overlay answers to the rule. The starburst on the piece's last tick and the
// fanfare play on every goal, and the result modal waits for the celebration and THEN for
// its own beat (`RESULTS_MODAL_DELAY_MS`, 900): the sum, never the larger of the two, so a
// game that ends on a goal shows the piece arrive, then the burst, then the card.
export const GOAL_FX_MS = 900; // the confetti: the whole celebration with the card off
export const GOAL_CARD_MS = 1100; // the ramp card's hold, before its fade
export const GOAL_CARD_FADE_MS = 300; // the panel's own fade — the lever if 1400 reads long
export const GOAL_CARD_TOTAL_MS = GOAL_CARD_MS + GOAL_CARD_FADE_MS; // the card: 1.4 s

// --- the turn animation --------------------------------------------------------
// The client owns the pixels. The engine keeps the SAME numbers because bot turns
// are paced so their move finishes animating before the next action fires.
export const MOVE_STEP_ANIM_MS = 180; // one board step of the path animation

// --- the die's acts ------------------------------------------------------------
// A roll is ACCEL from the face the die already rests on, a SPIN whose length is drawn per
// roll, then either the slowdown and the flop or, if a player taps the die, the acute spin
// and its three-quarter slowdown ahead of the same flop. The flop's last tumble is the
// settle, so there is no stop act behind it and the face is never left mid-turn.
//
// Every length here is GENEROUS on purpose (2026-11-18): the roll is something the room
// watches, not something it waits on, and a roll that reads as long is a knob turned down
// later, while a roll that reads as rushed has already eaten the two cues it was given. The
// four knobs are ACCEL (how long the throw is seen), the spin pair (how long the rattle
// lasts), FLOP (how heavy the settle is) and ACUTE (how much a catch adds). Nothing else in
// the file reads any of them, so they can be re-timed one at a time.
//
// The ceiling is ADDED from the acts for the reason the result card's is: `DICE_ROLL_ANIM_MS`
// is also an engine input, the pause a bot's next action waits out
// (`DICE_ROLL_ANIM_MS + BOT_THINK_MS` in `socket/server.ts`), so retiming one act has to
// move both builds at once instead of leaving a hand-computed total to update. It is the
// sum at the WIDEST spin, because the spin is drawn per roll: no roll outlasts it, and a tap
// only ever spends what is left of it.
export const DICE_ACCEL_MS = 320; // flat, then onto its axis, from the face already showing
export const DICE_SPIN_MIN_MS = 1800; // the initial spin, shortest draw
export const DICE_SPIN_MAX_MS = 2200; // and longest: the tap window's far edge
export const DICE_ACUTE_MS = 760; // a tap's own act, fixed, so the tap always reads
export const DICE_SLOWDOWN_MS = 560; // the standard slowdown into the flop
export const DICE_ACUTE_SLOWDOWN_MS = Math.round(DICE_SLOWDOWN_MS * 0.75); // the tapped one: 420
export const DICE_FLOP_MS = 620; // the tumbling settle onto the face the engine sent
export const DICE_ROLL_ANIM_MS =
  DICE_ACCEL_MS + DICE_SPIN_MAX_MS + DICE_SLOWDOWN_MS + DICE_FLOP_MS; // the ceiling: 3.70 s

// --- the room's own window -----------------------------------------------------
// The one number here that neither build animates: the life of the two hashes a live room
// keeps — the engine's `game:<id>` state and the backend's `match:<id>` record beside it,
// plus the room channel's two keys, which lapse with the room that wrote them. Every save
// re-arms it, so it is an IDLE window and never a game clock: nothing a player does is
// timed by it, and no score, row or seat is decided by it. Three hours, down from a day:
// a room nobody touches for an evening should not still be holding its seats tomorrow
// (a finished room closes itself in `POST_GAME_TIMEOUT_MS`; an abandoned one is closed by
// the departure funnel, so this is only the backstop for both).
export const GAME_STATE_TTL_S = 3 * 60 * 60;
