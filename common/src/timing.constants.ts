// Delays counted by more than one build, plus the acts behind those shared totals.
// `GAME_STATE_TTL_S` is here because both the engine and backend read it.

// --- the clash QTE -------------------------------------------------------------
export const CLASH_ANNOUNCE_MS = 1500; // "CLASH!" flash, keys still hidden
export const CLASH_COUNTDOWN_MS = 3000; // 3-2-1, keys still hidden
export const CLASH_PRESS_MS = 5000; // press race window

// The result card is the sum of its acts, so retiming one act moves both builds together.
// The attack and jail are the base; a wall beat and a breach cloud extend it.
export const SCENE_ATTACK_MS = 700; // the beam, the strike, the wall's flare, the subtraction
export const SCENE_JAIL_MS = 1000; // the bars travel, land at 421 and hold for 579 ms
// A wall's extra beat is appended to the attack, not inserted into it: the impact
// instants stay fixed while the dome takes the hit and holds.
export const SCENE_WALL_BEAT_MS = 900; // a wall only: the dome takes the hit, then holds
export const SCENE_WALL_ATTACK_MS = SCENE_ATTACK_MS + SCENE_WALL_BEAT_MS; // 1.6 s
// Breach-only act: the cloud grows where the wall stood and carries the sentence inside it.
export const SCENE_CLOUD_MS = 1400; // breach only: the cloud, then the sentence inside it
export const RESULT_FX_MS = SCENE_ATTACK_MS + SCENE_JAIL_MS; // the two-act scene: 1.7 s
export const RESULT_HEADLINE_READ_MS = 1000; // the headline after the gesture stops
export const CLASH_RESULT_MS = RESULT_FX_MS + RESULT_HEADLINE_READ_MS; // the card: 2.7 s
// Every wall card except a breach: the same acts plus the wall beat. A repulse plays this stage too.
export const CLASH_WALL_RESULT_MS =
  RESULT_FX_MS + SCENE_WALL_BEAT_MS + RESULT_HEADLINE_READ_MS; // 3.6 s
// A breach is a final card: wall attack, cloud and jail, with no separate read window.
// It is the longest card, so the engine derives its freeze from it.
export const CLASH_BREACH_RESULT_MS = SCENE_WALL_ATTACK_MS + SCENE_CLOUD_MS + SCENE_JAIL_MS; // 4.0 s
// Text-only card: enough time to read the sentence, with no scene to carry the meaning.
export const CLASH_TEXT_ONLY_MS = 1400;
// One-way receipt margin: the client reports a card done at its length plus this value,
// and the engine uses the same figure for a card nobody sits on.
export const CARD_HOLD_MARGIN_MS = 200;

// --- the opt-in capture flash card ---------------------------------------------
// A non-clash capture reuses the clash gesture (`RESULT_FX_MS`) and adds a still hold and fade.
// Client, roll guard and bot pacing all count the same total.
export const CAPTURE_CARD_HOLD_MS = 210; // the cell, held still AFTER the gesture stops
export const CAPTURE_CARD_FADE_MS = 300; // the panel's own fade out
export const CAPTURE_CARD_MS =
  RESULT_FX_MS + CAPTURE_CARD_HOLD_MS + CAPTURE_CARD_FADE_MS; // the whole card: 2.2 s
export const CAPTURE_CARD_GRACE_MS = 150; // the roll guard's slack past the card

// --- the goal beat -------------------------------------------------------------
// One overlay per goal, chosen by the effects rule, then the result modal's own beat.
export const GOAL_FX_MS = 900; // the confetti: the whole celebration with the card off
export const GOAL_CARD_MS = 1100; // the ramp card's hold, before its fade
export const GOAL_CARD_FADE_MS = 300; // the panel's own fade — the lever if 1400 reads long
export const GOAL_CARD_TOTAL_MS = GOAL_CARD_MS + GOAL_CARD_FADE_MS; // the card: 1.4 s

// --- the turn animation --------------------------------------------------------
// The client owns the path animation. The engine allows a slower step so a bot's
// move finishes before its next action fires.
export const MOVE_STEP_ANIM_MS = 180; // one board step of the path animation

// --- the die's acts ------------------------------------------------------------
// Accelerate, draw the spin, then slow and flop; a tap uses an acute branch.
// Lengths are generous and retunable; `DICE_ROLL_ANIM_MS` is the widest-spin ceiling.
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
// Idle life of a room's Redis state and chat keys, re-armed on every save. It is a backstop,
// not a game clock; finished and abandoned rooms close earlier through their own paths.
export const GAME_STATE_TTL_S = 3 * 60 * 60;
