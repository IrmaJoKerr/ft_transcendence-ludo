import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { COL } from '../theme';
import { useApp } from '../store';
import { PieceFigure } from '../components/PieceFigure';
import type { PiecePose } from './pieceParts';
import type { PlayerColor } from './types';
import {
  RESULT_HEADLINE_READ_MS,
  SCENE_ATTACK_MS,
  SCENE_CLOUD_MS,
  SCENE_JAIL_MS,
} from '../__shared__/timing.constants';
import { retroAudio } from '../utils/audio';

/**
 * The clash card's scene: one fixed 240 x 180 stage, two acts back to back, on both hosts.
 *
 *   the pair    the DEFENDER stands on the left and the ATTACKER on the right, on any
 *               card and in any act, never swapped (25.3 rule 1).
 *   capture     the attacker won — the beam leaves the attacker's front face (its left),
 *               strikes the defender's right flank, and the cell closes on the defender
 *               travelling the beam's own direction.
 *   repulse     the defender won — the beam leaves the defender's front face (its right),
 *               strikes the attacker, and the cell closes on the attacker travelling the
 *               beam's own direction.
 *
 * In a round the winner always fires and the bars always follow the winning blow's vector,
 * which is why no card can turn its cell the wrong way, and why a capture reads as one
 * sweep repeated: a shot, then a cell.
 *
 * A **wall** changes the composition of the attack act, never the jail's: a square held by
 * more than one defender is drawn as those defenders — `n` glyphs on a diagonal with the
 * front-most nearest the attacker, `n` nested curves over them as the shield, and the
 * attacker himself standing in the right-hand bay — and one success subtracts one defender
 * and one line (25.3). The frame is then cleared once, at the attack's last instant, and
 * the jail plays on the pair stage like any other round, which is the only cut in the
 * sequence and the only place the cast changes (rule 4).
 *
 * A **breach** — the last defender of a wall, beaten — adds one act that nothing else has:
 * a mushroom cloud grows from the ground where the wall stood, the sentence naming the
 * winner pulses inside it, and the frame is cleared a second time before the jail (25.4).
 * So a breach card is attack + cloud + jail, the only card in the game that is longer than
 * the 2900 ms every other card plays at, and the only one whose sentence is inside an act
 * instead of after the scene.
 *
 * `kind` chooses only whose colour is on the ink. `n` is the wall's defender count,
 * `totalRounds > 1` says the square is a wall at all, and `banner` is the finished breach
 * sentence — this component draws strings, never looks one up.
 *
 * The clock is per act, not per scene (25.8): an element is budgeted in the act it plays
 * in — the attack's 700 ms, the cloud's 1400 or the jail's 1200 — so an act can be re-timed
 * without touching the others', and every instant a player sees stayed the instant the card
 * played before the split.
 */
export type ResultFxKind = 'capture' | 'repulse';

// The cell's two beats, in the JAIL act's own clock. They were 44 % and 59 % of the one
// 1900 ms gesture, i.e. 836 and 1121 ms of the card: the jail opens at 700, so they are
// 136 and 421 ms into its 1200, and its first 136 ms are the stillness the old card
// already had before the bars move. The sound's landing is derived from the same pair, so
// the slam can never drift from the drawing — and because the jail is the THIRD act on a
// breach, that derivation takes the act's own start rather than a constant (see
// `jailStartMs`: 1121 ms of the card everywhere, 2521 on a breach).
const CAGE_START_IN_JAIL_MS = 136;
const CAGE_LAND_IN_JAIL_MS = 421;
// The cell's half-width: 26 x 36 / 33, the old half-width carried along with the box it
// encloses, so the cell still closes on the piece with the margin it had.
const CAGE_HALF = 28.4;
// How far the cell travels: its own width, so it starts clear of the piece it closes on.
const CAGE_TRAVEL_PX = CAGE_HALF * 2;
// The beam starts a full stage clear of its own tail, on the shooter's side.
const BEAM_TRAVEL_PX = 150;

// The attack act's beats, in ms from its own start, shared by the keyframes below and by
// 25.5's soundtrack so the sound cannot drift from the drawing: the beam lands at 247, the
// star blooms where it lands and peaks at 323, and the line starts glitching at 418. The
// wall's flare peaks at the star's own peak, and the first clear — the cast change — is the
// act's last instant.
const BEAM_LAND_AT_MS = 247;
const PUNCTURE_PEAK_AT_MS = 323;
const SUBTRACT_AT_MS = 418;
const IMPACT_AT_MS = 260; // the puncture, a beat after the beam arrives
const CLEAR_AT_MS = SCENE_ATTACK_MS; // the first clear: the attack's last frame
// One puncture per layer, 40 ms apart, so a three-line wall is heard as three.
const PUNCTURE_GAP_MS = 40;

// The cloud act's two beats, in ms from its own start: the cloud is up at 500 and holds,
// and the sentence joins it 400 ms later so it reads over a cloud already moving and
// finishes exactly with the act (25.4, D34). Both are also the soundtrack's instants — the
// full-weight bloom opens the act, and nothing is scheduled with the sentence.
const CLOUD_GROW_AT_MS = 500;
const CLOUD_TEXT_LEAD_MS = 400;

// The keyframes are written in milliseconds and converted here, so a beat reads as its
// instant instead of a percentage somebody has to divide by 19 in their head. Each act's
// percentages are of that act: the attack's 700, the jail's 1200 and the cloud's 1400.
const aPct = (ms: number) => +((ms / SCENE_ATTACK_MS) * 100).toFixed(2);
const jPct = (ms: number) => +((ms / SCENE_JAIL_MS) * 100).toFixed(2);
const cPct = (ms: number) => +((ms / SCENE_CLOUD_MS) * 100).toFixed(2);

// The keyframes, injected once for however many cards render them. No duration is written
// in here: `fx()`, `jailFx()`, `atJailStart()` and `cloudFx()` build each `animation` string
// from the act that owns the element, so nothing can play past the act it belongs to. The
// read window is the one exception: it follows the scene and is built by `readFx()`, which
// takes its start.
const KEYFRAMES_ID = 'result-fx-keyframes';

function ensureKeyframes() {
  if (document.getElementById(KEYFRAMES_ID)) return;
  const style = document.createElement('style');
  style.id = KEYFRAMES_ID;
  style.textContent = `
      /* the strike: the beam leaves the shooter's front face and crosses the lane
         (0-247 ms), then is gone by 380. It enters from the shooter's side, so the tail
         direction is per-instance. */
      @keyframes fxBeam {
        0%            { transform: translateX(var(--beamFrom, -${BEAM_TRAVEL_PX}px)); opacity: 0; }
        ${aPct(76)}%  { opacity: 1; }
        ${aPct(BEAM_LAND_AT_MS)}%  { transform: translateX(0); opacity: 1; }
        ${aPct(380)}% { transform: translateX(0); opacity: 0; }
        100%          { opacity: 0; }
      }
      /* the wall flares where the beam lands (247-418 ms), peaking at the star's 323. */
      @keyframes fxPuncture {
        0%, ${aPct(BEAM_LAND_AT_MS)}%      { transform: scale(.4); opacity: 0; }
        ${aPct(PUNCTURE_PEAK_AT_MS)}%      { transform: scale(1.15); opacity: 1; }
        ${aPct(SUBTRACT_AT_MS)}%           { transform: scale(1.6); opacity: 0; }
        100%                               { opacity: 0; }
      }
      /* a line glitches TWICE and goes out — no fade-through, no hard cut (D1). It is the
         wall's outermost curve on every path, a breach's last one included: the last
         defender is not a special case (25.4). */
      @keyframes fxLayerOut {
        0%, ${aPct(SUBTRACT_AT_MS)}%  { transform: translateX(0); opacity: 1; }
        ${aPct(475)}%    { transform: translateX(var(--g1)); opacity: .25; }
        ${aPct(532)}%    { transform: translateX(0); opacity: 1; }
        ${aPct(589)}%    { transform: translateX(var(--g2)); opacity: .25; }
        ${aPct(646)}%    { transform: translateX(0); opacity: .55; }
        ${aPct(SCENE_ATTACK_MS)}% { transform: translateX(0); opacity: 0; }
      }
      /* the defender the shot struck leaves the wall as its line goes — one defender, one
         line, always together, and the flare has already cleared (25.4). It is a wall
         effect and not a hand-off into the cell: the clear re-presents the same piece as
         the prisoner on the pair stage. */
      @keyframes fxDefenderFade {
        0%, ${aPct(SUBTRACT_AT_MS)}%      { opacity: 1; }
        ${aPct(SCENE_ATTACK_MS)}%, 100%   { opacity: 0; }
      }
      /* the clear: the wall and the defenders it has left leave the frame at the attack's
         last instant, and the jail's pair stage takes over (25.3 rule 4). It is one of the
         two places in the whole sequence where the cast changes, so it is a cut — a cut
         softened by a frame, because a shape that vanishes between two frames reads as a
         dropped frame rather than as a cut. */
      @keyframes fxWallClear {
        0%, ${aPct(SCENE_ATTACK_MS - 28)}% { opacity: 1; }
        ${aPct(SCENE_ATTACK_MS)}%, 100%    { opacity: 0; }
      }
      /* the jail re-presents the pair where the wall stood: the second and last cast
         change. It starts at 0 so the wall is gone before the pair arrives — never two
         casts in one frame — and lands 96 ms in, before the bars' first movement at 136
         (CAGE_START_IN_JAIL_MS). Paired with a forwards-only fill, so the pair's base
         opacity of 0 holds for the whole attack act and only the jail act turns it on. */
      @keyframes fxCastIn {
        0%   { opacity: 0; }
        8%, 100% { opacity: 1; }
      }
      /* the cloud: two marks and one clear, all on the cloud act's own clock (25.4). The
         ring is the ground taking the blast — it opens where the wall stood, races out to
         the cloud's own width and is gone in the act's first 500 ms. The body is the
         mushroom itself: stem and head as one group hanging off the ground line, so a
         single scale about the group's bottom is "it grows upward from the ground". It
         stays up once grown — this is the one mark in the card that does not end when its
         growth ends — and the clear takes it. */
      @keyframes fxCloudRing {
        0%                          { transform: scale(.15); opacity: 0; }
        ${cPct(90)}%                { opacity: .85; }
        ${cPct(CLOUD_GROW_AT_MS)}%  { transform: scale(1); opacity: 0; }
        100%                        { transform: scale(1); opacity: 0; }
      }
      @keyframes fxCloudBody {
        0%                          { transform: scale(.12); opacity: 0; }
        ${cPct(120)}%               { opacity: 1; }
        ${cPct(CLOUD_GROW_AT_MS)}%  { transform: scale(1); opacity: 1; }
        100%                        { transform: scale(1); opacity: 1; }
      }
      /* the second clear: the cloud leaves the frame at the cloud act's last instant and
         the jail takes over, the same softened cut the wall's clear makes (25.3 rule 4).
         There are exactly two casts in a breach card — the wall's, then the cloud's. */
      @keyframes fxCloudClear {
        0%, ${cPct(SCENE_CLOUD_MS - 28)}% { opacity: 1; }
        ${cPct(SCENE_CLOUD_MS)}%, 100%    { opacity: 0; }
      }
      /* the cell closes on the loser, slamming in from the winner's side, and holds
         (11.33-35.08 % of the jail act, i.e. 136-421 ms into its 1200, 836-1121 ms of the
         card — ~600 ms after the 247 ms strike). */
      @keyframes fxCage {
        0%, ${jPct(CAGE_START_IN_JAIL_MS)}% { transform: translateX(var(--cageFrom, -${CAGE_TRAVEL_PX}px)); opacity: 0; }
        ${jPct(212)}%       { opacity: 1; }
        ${jPct(CAGE_LAND_IN_JAIL_MS)}%      { transform: translateX(0); opacity: 1; }
        100%                { transform: translateX(0); opacity: 1; }
      }
      /* the bars are energy, not steel: an irregular flicker as the cell holds its
         prisoner. Opacity only — a filter is the one thing that costs frames here. The
         cadence is the one the 1900 ms gesture had, read in the jail's own clock. */
      @keyframes fxArc {
        0%, ${jPct(CAGE_START_IN_JAIL_MS)}% { opacity: 0; }
        ${jPct(212)}%       { opacity: .82; }
        ${jPct(288)}%       { opacity: 1; }
        ${jPct(364)}%       { opacity: .7; }
        ${jPct(CAGE_LAND_IN_JAIL_MS)}%      { opacity: 1; }
        ${jPct(554)}%       { opacity: .88; }
        ${jPct(668)}%, 100% { opacity: 1; }
      }
      /* the strike lands: the field cracks under the loser and stays cracked (247-532 ms).
         The loser itself never moves — it stands exactly where it was struck until the
         bars close on it (25.18). */
      @keyframes fxFieldCrack {
        0%, ${aPct(BEAM_LAND_AT_MS)}%  { opacity: 0; }
        ${aPct(342)}%     { opacity: .95; }
        ${aPct(532)}%, 100% { opacity: .55; }
      }
      /* WALL BROKEN reads in the read window (1900-2900): two pulses at most. */
      @keyframes fxBannerPulse {
        0%       { opacity: 0; }
        3%       { opacity: 1; }
        23%      { opacity: .55; }
        43%      { opacity: 1; }
        63%      { opacity: .55; }
        83%,100% { opacity: 1; }
      }
    `;
  document.head.appendChild(style);
}

// ── Geometry ─────────────────────────────────────────────────────────────────
// One fixed stage for every act and both cards (D28): the box never changes size, only
// what is drawn in it and where each act's centre falls.
const VB_W = 240;
const VB_H = 180;
// The ground line every act stands on, and the row under it the sentence reads in.
const GROUND_Y = 120;
const BANNER_Y = 162;

// ── The pair stage ───────────────────────────────────────────────────────────
// The 1v1's two seats, and the seats every jail act re-presents the pair on: the DEFENDER
// on the left and the ATTACKER on the right, one line for both, never swapped on any card
// or in any act (25.3 rule 1) — which is what makes a chain's rounds read as one
// continuous shot. `PIECE_W` is the cast's box: 36 stage units, the footprint every
// strike is measured from and the box every glyph is drawn into. It was 33 — the invaders'
// old 11 glyph units at scale 3, the space the 70s and 80s sprites filled — until 32.2
// widened it because the drawn figures read small in the card's pair; the seats did not
// move with it, so the boxes grew outward from their centres at 24.5 and 150.5.
const PAIR_CX = 150;
const PIECE_W = 36;
const STRIKE_Y = 84; // the strike line: 13 under the box's top, 23 over its floor
const GLYPH_Y = STRIKE_Y - 13; // 71: the box is y 71 to 107, 13 units of ground under it
const DEFENDER_GLYPH_X = 6.5; // 24.5, the seat's own centre, less half the box
const ATTACKER_GLYPH_X = PAIR_CX - 17.5; // 132.5: the same seat held on the right
// The widest x BOTH cards can show: the flash window's own width. A mark drawn past it
// would be cut on the small card and kept on the big one, which is the one difference
// the two cards are not allowed to have (25.18).
const SHARED_X_MAX = 192;

// ── The wall stage ───────────────────────────────────────────────────────────
// A wall is its defenders (25.3): `n` glyphs on a diagonal and `n` curves arcing over
// them, one pair subtracted per success, four at most — one colour defends a square and a
// player owns four pieces (D4, D24).
//
// The fit, because the shield is the widest thing either card draws: a group of four spans
// 3 x 20 + 36 = 96 units of run, from x 48 (the rear-most box's left edge) to 144 (the
// front-most's right edge), so the shield is centred on x 118 with its outermost curve at
// 64 — x 54 to 182 — and the attacker takes the right-hand bay at x 196 to 232 at the same
// 36 units, on the same ground line. The shield's own face at the strike height is x 171,
// so the wall reads left to right in one sweep: rear-most, shield, face, attacker.
const WALL_MAX = 4;
const WALL_CX = 118;
const WALL_R = 64; // the outermost curve's radius
const WALL_RING_STEP = 8; // ...and the gap to the next one, one ring per defender
const WALL_INK = 5; // the innermost curve's weight; the arcs thin as they go outward
// The diagonal's run and rise, one defender to the next. The rise is shallow against the
// run on purpose: a true 45 degree recession pushes the rear-most defender out from under
// the shield's rim and hides the count, and the count is what a wall exists to show. Twenty
// units of run by fourteen of rise still separates the glyphs enough to be counted one by
// one, which is the whole job of the diagonal.
const WALL_DX = 20;
const WALL_DY = 14;
const WALL_FRONT_X = WALL_CX - 10; // 108: the front-most box, straddling the centre
const WALL_ATTACKER_X = 196; // the attacker's own 36-unit bay, outside the shield
const BEAM_INSET = 6; // the shot leaves its shooter 6 units inside the glyph's edge
// The shield's outer face: the outermost curve's own right flank **at the strike height**,
// because every shot in the game travels on `STRIKE_Y` — so a wall's punch and its return
// are one line at one height, the line the pair is struck on, and the beam meets the shield
// instead of the ground beside it.
const SHIELD_FACE_X = Math.round(
  WALL_CX + Math.sqrt(WALL_R ** 2 - (GROUND_Y - STRIKE_Y) ** 2),
); // 171

// ── The cloud stage ───────────────────────────────────────────────────────────
// The breach's own act (25.4), and the only thing in the card drawn on the wall's centre
// line instead of around a piece: a mushroom cloud stands where the wall stood, so its
// marks are all offsets from `CLOUD_CX` on the ground line. The ring is the blast's own
// footprint — the head's width, and well inside the shield's 64 — so it reads as the
// ground giving way under the wall and never as a second wall.
const CLOUD_CX = WALL_CX; // 118
const CLOUD_RING_R = 46;
const CLOUD_RING_RY = 9; // a ring lying on the ground is seen edge-on, so it is flat
// The mushroom: a stem that widens as it reaches the ground and a head of three puffs (two
// side, one crown) joined by a belly bar. The head is solid and the stem is veiled, which
// is the two-value ladder the rest of the card uses, and the head is twice the stem's
// width at every point — that proportion, not the number of puffs, is what makes it read
// as a mushroom rather than a cloud of smoke.
const CLOUD_STEM_BASE_HALF = 15; // ...at the ground
const CLOUD_STEM_TOP_HALF = 7; // ...where it meets the head
const CLOUD_STEM_TOP_UP = 41; // above the ground line; also the belly's underside
const CLOUD_HEAD_UP = 50; // the side puffs' centres, above the ground line
const CLOUD_HEAD_R = 17;
const CLOUD_HEAD_X = 18; // their centres' offset from `CLOUD_CX`
const CLOUD_CROWN_UP = 64; // the crown puff, one step higher and wider
const CLOUD_CROWN_R = 22;
const CLOUD_BELLY_UP = 56; // the bar that joins the three puffs to the stem
const CLOUD_BELLY_HALF = 21;

// The sentence's fit, because it carries a player's name and 27 was sized for an eleven
// character word (25.4). The estimate is the display face's average advance at weight 900,
// and the floor is the smallest size that still reads at the small card's scale. When even
// the floor overflows — a very long display name — both text layers are squeezed with
// `textLength` instead of being cropped, so the halo can never leave the fill.
const BANNER_MAX_FS = 27;
const BANNER_MIN_FS = 11;
const BANNER_ADVANCE = 0.62; // per character, at `--font-display` weight 900
const BANNER_PAD = 8; // each side of the stage

// The clash stage's own cap, read by `ClashOverlay` so the two cards cannot drift apart.
export const CLASH_STAGE_MAX_PX = 420;
// The flash card is the clash stage at 0.8: the same 4:3 and the same pixels per unit
// (420 / 240 = 336 / 192 = 1.75), showing the side of the frame both pieces stand on.
// 192 x 144 is 0.8 of the stage in BOTH directions, and the cell's own box (y 54-120)
// sits dead centre in the 144 units it shows — 39 above, 39 below.
// It never shows a wall: a capture outside a clash plays `n = 1`, passed as a literal, so
// its 192-unit window only has to hold the pair and the cage (25.3).
export const FLASH_CARD_STAGE_MAX_PX = 336;
export const FLASH_CARD_VIEWBOX = '0 15 192 144';
export const FLASH_CARD_ASPECT = 192 / 144;

// An eight-point star, centred on the impact, for the puncture flash.
const starAt = (cx: number, cy: number, r = 9) =>
  `M ${cx} ${cy - r} L ${cx + r * 0.28} ${cy - r * 0.28} L ${cx + r} ${cy} ` +
  `L ${cx + r * 0.28} ${cy + r * 0.28} L ${cx} ${cy + r} L ${cx - r * 0.28} ${cy + r * 0.28} ` +
  `L ${cx - r} ${cy} L ${cx - r * 0.28} ${cy - r * 0.28} Z`;

// The shield's curve, r units out from the wall's centre: a half circle standing on the
// ground line, which is as much curvature as a card of this size can read. Gentler or
// flatter is allowed — it is a fitting value and not a shape ruling (25.3 rule 5).
const shieldCurve = (r: number) =>
  `M ${WALL_CX - r} ${GROUND_Y} A ${r} ${r} 0 0 1 ${WALL_CX + r} ${GROUND_Y}`;

/**
 * One piece of the cast, at the box both renderings share: the 70s figure or the 80s
 * character from `game/pieceParts*.ts`, either filling the same 36 units. The box is
 * the contract — every strike is measured from its edge — so neither drawing can move
 * the shot, and a wall's defenders are drawn by the same call as the pair (25.17 item 2).
 *
 * `pose` is the facing, and it is the only thing about the cast that changes across an
 * act: the defender holds the left seat and looks right, the attacker holds the right
 * seat and looks left, on every card in every act — the same rule that pins their
 * places (25.3 rule 1). A pose is one matrix on a face plate inside a head that stays
 * put — the same rule on both sets, since the 80s art lost its props and gained a face
 * slice (`todo.md` 30) — so it costs the box nothing: 0 of 32 posed renders leave it
 * (`posecheck.py`), and the head holds its collar on all 16 posed rows, outline 0.0 and
 * face ±6.0 (`neckcheck.py`) — both in `.scratch/80s`.
 */
function CastPiece({
  x,
  y,
  color,
  retro70,
  pose = 'front',
  style,
}: {
  x: number;
  y: number;
  color: PlayerColor;
  retro70: boolean;
  pose?: PiecePose;
  style?: CSSProperties;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${PIECE_W / 100})`} style={style}>
      <PieceFigure ck={color} set={retro70 ? 'retro70' : 'retro80'} pose={pose} />
    </g>
  );
}


/**
 * The result card's animation stage: one fixed stage, played alongside the text rather
 * than before it. `attacker` and `defender` are the round's two seats, and the winner's
 * colour is on every mark — the beam, the strike and the bars — so the picture says who
 * won without a word, and the loser is always the piece inside the cell. `n` is the wall's
 * defender count (the defenders still standing, plus the one a success takes); `totalRounds
 * > 1` says the square is a wall at all, which is what draws the wall's attack act and gates
 * the bloom to the total breach. Cosmetics only: no input, `aria-hidden`, and every act is
 * one switch — the room's `captureFx` — so nothing here reads the OS.
 */
export function ResultFx({
  kind,
  attacker,
  defender,
  n,
  totalRounds,
  banner,
  viewBox = `0 0 ${VB_W} ${VB_H}`,
}: {
  kind: ResultFxKind;
  attacker: PlayerColor;
  defender: PlayerColor;
  n: number;
  totalRounds: number;
  banner?: string;
  // The visible window into the stage. The clash card shows all of it; the flash card
  // shows `FLASH_CARD_VIEWBOX`, a 0.8-scaled crop of the same frame at the same pixels
  // per unit, so the two clips are one clip (25.17 item 3).
  viewBox?: string;
}) {
  useEffect(ensureKeyframes, []);
  const { theme } = useApp();
  const isRetro70 = theme === 'retro70';
  const attackerColor = COL[attacker].base;
  const defenderColor = COL[defender].base;
  // Who won, and therefore whose colour is on every mark and whose side the cell slams in
  // from: `capture` is the attacker's win, `repulse` the defender's. That is the only
  // thing `kind` decides (25.18).
  const attackerWon = kind === 'capture';
  const winnerColor = attackerWon ? attackerColor : defenderColor;
  const loserColor = attackerWon ? defenderColor : attackerColor;

  // What kind of card this is, first, because two of the three clocks below depend on it:
  // a breach is the only card with a third act, and everything the jail does starts after
  // the cloud when there is one.
  const total = Math.max(1, Math.trunc(totalRounds) || 1);
  const isWall = total > 1;
  const layers = Math.min(Math.max(1, Math.trunc(n) || 1), WALL_MAX);
  // A single-defender round is piece-level in EITHER direction: two glyphs, no shield.
  const isPieceLevel = !isWall;
  // The total breach: the attacker's win against the LAST defender of a wall. It is the one
  // path with a cloud and a sentence, and the only card longer than `CLASH_RESULT_MS`.
  const isBreach = attackerWon && isWall && layers === 1;
  // A capture subtracts one defender, so the wall is drawn one layer fuller than it is
  // left; a repulse subtracts nothing, and there `n` is the whole set plus the one that
  // would have gone, which is why the total is the ceiling.
  const wallLayers = attackerWon ? layers : Math.min(total, WALL_MAX);

  // One clock per act (25.8): an element is budgeted in the act it plays in, so nothing can
  // outlive that act and re-timing one act leaves the others' instants alone. The read
  // window is not an act: it follows the scene, and it is the only caller of `readFx` — and
  // a breach has none, because its sentence lives inside the cloud instead.
  const fx = (name: string) => `${name} ${SCENE_ATTACK_MS}ms ease-out both`;
  const cloudFx = (name: string) =>
    `${name} ${SCENE_CLOUD_MS}ms ease-out ${SCENE_ATTACK_MS}ms both`;
  // The jail is the second act everywhere and the THIRD on a breach, where the cloud sits
  // between the two clears. One number says when it opens, and the cell's drawing, the
  // cast-in and the slam's own beat are all derived from it, so a breach moves them
  // together and by the cloud's length alone.
  const jailStartMs = SCENE_ATTACK_MS + (isBreach ? SCENE_CLOUD_MS : 0); // 700 or 2100
  const jailFx = (name: string) => `${name} ${SCENE_JAIL_MS}ms ease-out ${jailStartMs}ms both`;
  // The jail act's clock, held OPEN by its delay rather than by `both`: an element that must
  // not exist before the jail keeps its base style until its own act starts.
  const atJailStart = (name: string) =>
    `${name} ${SCENE_JAIL_MS}ms ease-out ${jailStartMs}ms forwards`;
  const readFx = (name: string, startMs: number) =>
    `${name} ${RESULT_HEADLINE_READ_MS}ms ease-out ${startMs}ms both`;
  // SVG shapes need their own box for `transform-origin` to mean anything.
  const pivot: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };
  // The cloud grows upward out of the ground, so its own box's bottom edge — the stem's base
  // on the ground line — is the point it scales about.
  const growsUp: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center bottom' };

  // The strike: from the winner's front face to whatever takes it. The tail sits 6 units
  // inside the shooter's glyph, so the beam leaves a piece instead of crossing an empty
  // lane (25.17 item 2). The front face is the attacker's LEFT and the defender's RIGHT,
  // now that the defender holds the left seat. On a wall the shield's outer face is what
  // the shot meets: a capture punches through it, and a 1v1 frame has no shield to bounce
  // from, so the reflect is a wall beat only (25.3 rule 2, 25.4 path C).
  const beamFrom = attackerWon
    ? isWall
      ? WALL_ATTACKER_X + BEAM_INSET // 202: the attacker's front face, in the wall's bay
      : ATTACKER_GLYPH_X + BEAM_INSET // 138.5
    : isWall
      ? SHIELD_FACE_X // 171: the shot returns off the face it struck
      : DEFENDER_GLYPH_X + PIECE_W - BEAM_INSET; // 36.5
  const impactX = attackerWon
    ? isWall
      ? SHIELD_FACE_X // 171: the shield's outer face takes the hit
      : DEFENDER_GLYPH_X + PIECE_W // 42.5: the defender's right flank, the box's own edge
    : isWall
      ? WALL_ATTACKER_X // 196: the reflected shot strikes the attacker's flank
      : ATTACKER_GLYPH_X; // 132.5: the attacker's left flank
  const beamX = Math.min(beamFrom, impactX);
  const beamW = Math.abs(impactX - beamFrom);
  // The white-hot head sits 12 units back toward the shooter on a capture — to the right,
  // where the attacker stands — and 2 units inside the struck piece on a repulse, which is
  // the same relationship the shot had before the pair was mirrored.
  const hotX = attackerWon ? impactX + 12 : impactX + 2;

  // The cell: it closes on the LOSER on the pair stage, because the jail is always the pair
  // stage plus one effect, never a new stage (25.3) — the defender's glyph on a capture
  // (left seat), the attacker's on a repulse (right seat) — and its centre is that piece's
  // own, so the bars follow the winning blow's vector (rule 3). On a wall both the prisoner
  // and the piece that jailed them are re-presented there after the clear (25.4).
  const cageBars = 5;
  const defenderCx = DEFENDER_GLYPH_X + PIECE_W / 2; // 24.5
  const attackerCx = ATTACKER_GLYPH_X + PIECE_W / 2; // 150.5
  const loserCx = attackerWon ? defenderCx : attackerCx;
  // Both edges are clamped into the window the two cards share: the left one, because the
  // defender's cell (centre 24.5, half-width 28.4) would otherwise start at -3.9 and be cut
  // by the stage's edge, and the right one against `SHARED_X_MAX` 192, so the flash card
  // can never crop a cell the clash card keeps (D35).
  const cageCx = Math.min(SHARED_X_MAX - CAGE_HALF, Math.max(CAGE_HALF, loserCx));
  const cageTopY = STRIKE_Y - 30; // 54, the top of the cell's box
  const cageH = GROUND_Y - cageTopY; // 66
  // The bars start on the winner's side and travel away from it: right to left on a
  // capture (the attacker is on the right), left to right on a repulse — the same vector
  // as the beam, so the card reads as one sweep repeated.
  const cageFrom = `${attackerWon ? CAGE_TRAVEL_PX : -CAGE_TRAVEL_PX}px`;
  // The beam travels a full stage clear on the pair, and its own width on a wall: the
  // attacker stands beside the shield there, so the shot is a punch at close range rather
  // than a lance across the frame (25.3). It keeps the act's 247 ms either way, because the
  // puncture and the flare are pinned to that instant on every path.
  const beamTravel = isWall ? beamW : BEAM_TRAVEL_PX;
  const beamEntry = `${attackerWon ? beamTravel : -beamTravel}px`;
  // The floor each composition stands on. The wall's runs from behind the rear-most
  // defender to past the attacker's own bay; the pair's follows the cell and stops at
  // x 192, the widest both cards can show, so the flash card never cuts a mark the clash
  // card keeps.
  const pairFloorX1 = Math.max(0, cageCx - CAGE_HALF - 16);
  const pairFloorX2 = Math.min(SHARED_X_MAX, cageCx + CAGE_HALF + 16);
  const wallFloorX1 = Math.max(4, WALL_FRONT_X - (wallLayers - 1) * WALL_DX - 12);
  const wallFloorX2 = Math.min(VB_W - 4, WALL_ATTACKER_X + PIECE_W + 8); // 236: the stage's edge

  // The three compositions' gates. The frame is cleared twice on a breach and once
  // everywhere else (25.3 rule 4): the wall leaves at the attack's last instant, the cloud
  // leaves at the cloud act's last instant, and the jail's pair arrives on the pair stage
  // after whichever of them was the last — so no group holds a pixel of another act.
  const wallGate: CSSProperties = { animation: fx('fxWallClear') };
  const pairGate: CSSProperties = isWall
    ? { opacity: 0, animation: atJailStart('fxCastIn') }
    : {};
  const cloudGate: CSSProperties = { animation: cloudFx('fxCloudClear') };

  // The sentence's own numbers, from the string it draws (25.4): the same key carries a
  // player's name now, so 27 — sized for an eleven-character word — is a ceiling and not a
  // constant. Both layers take the same size and, when even the floor overflows, the same
  // squeeze, or the halo drifts off the fill.
  const sentenceAtMs = CLEAR_AT_MS + CLOUD_TEXT_LEAD_MS; // 1100: 400 ms into the cloud
  const sentenceLen = Math.max(1, banner?.length ?? 1);
  const bannerFs = Math.max(
    BANNER_MIN_FS,
    Math.min(
      BANNER_MAX_FS,
      Math.floor((VB_W - 2 * BANNER_PAD) / (BANNER_ADVANCE * sentenceLen)),
    ),
  );
  const bannerBudget = VB_W - 2 * BANNER_PAD;
  const bannerSqueeze =
    BANNER_ADVANCE * bannerFs * sentenceLen > bannerBudget
      ? { textLength: bannerBudget, lengthAdjust: 'spacingAndGlyphs' as const }
      : {};
  // The halo and the hairline are the two widths that were tuned against a 27 px word, so
  // they follow the size: at the ceiling they land on exactly 6 and 0.75 units, and at the
  // floor they are thin enough to leave the counters of the letters open instead of
  // drowning them in glow.
  const bannerScale = bannerFs / BANNER_MAX_FS;
  const bannerHalo = Math.max(2, Math.round(6 * bannerScale));
  const bannerEdge = Math.max(0.4, +(0.75 * bannerScale).toFixed(2));

  // The soundtrack belongs to the act, not to the host (25.5): both cards mount the same
  // scene, so both play the same beats, and the flash card keeps the laser the walk found
  // missing. Each act schedules its own beats — the beam, the wall taking it, the layer
  // going, the cloud, the cell — and nothing is scheduled with the jail's tail, so the
  // card is silent under its last second. Armed once per mounted card and cleared on
  // unmount, so a chain round that unmounts early leaves no timer behind.
  useEffect(() => {
    const beats: Array<{ at: number; play: () => void }> = [
      // The attack act: the shot leaves on every path.
      { at: 0, play: () => retroAudio.playLaserBeam() },
    ];
    if (isWall) {
      // The wall taking the hit, at the star's own peak.
      beats.push({ at: PUNCTURE_PEAK_AT_MS, play: () => retroAudio.playBreachBloom(0.4) });
      if (attackerWon) {
        // One puncture per layer, then the line going on its glitch.
        for (let i = 0; i < layers; i++) {
          beats.push({
            at: IMPACT_AT_MS + i * PUNCTURE_GAP_MS,
            play: () => retroAudio.playBarrierPuncture(),
          });
        }
        beats.push({ at: SUBTRACT_AT_MS, play: () => retroAudio.playShatterTick() });
      } else {
        // The wall stood, so the reflect has an instant to be heard on.
        beats.push({ at: IMPACT_AT_MS, play: () => retroAudio.playBarrierDeflect() });
      }
    } else if (!attackerWon) {
      // A 1v1 repulse is "the attack failed", which gives the second orphan its call site.
      beats.push({ at: IMPACT_AT_MS, play: () => retroAudio.playAttackFailed() });
    }
    // The cloud act: only a total breach falls all the way, and it opens where the first
    // clear takes the frame away — at full weight, because it is the biggest sound here.
    if (isBreach) beats.push({ at: CLEAR_AT_MS, play: () => retroAudio.playBreachBloom() });
    // The jail act: the cell, heard ON the slam rather than 191 ms before it — and on a
    // breach that is 2521 ms of the card, because the whole act moved by the cloud.
    beats.push({ at: jailStartMs + CAGE_LAND_IN_JAIL_MS, play: () => retroAudio.playCageSlam() });

    const timers = beats.map(({ at, play }) => window.setTimeout(play, at));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [isWall, attackerWon, isBreach, layers, jailStartMs]);

  return (
    <svg
      aria-hidden='true'
      viewBox={viewBox}
      width='100%'
      height='100%'
      style={{ display: 'block', overflow: 'hidden', pointerEvents: 'none' }}
    >
      {/* ── the attack act, on a wall: its defenders, the shield over them, and the
             attacker drawn in the right-hand bay ─────────────────────────────────── */}

      {isWall && (
        <g style={wallGate}>
          {/* the floor the wall stands on */}
          <line
            x1={wallFloorX1}
            y1={GROUND_Y}
            x2={wallFloorX2}
            y2={GROUND_Y}
            stroke={defenderColor}
            strokeOpacity='.22'
            strokeWidth='2'
          />

          {/* the defenders: `n` glyphs on a diagonal, the front-most — lowest and
              right-most, nearest the attacker — first, each further one up and to the left,
              overlapping the one in front (25.3 rule 1). The struck defender fades as its
              line goes: one defender, one line, always together (rule 4). Every one of
              them looks right, at the attacker, because that is the seat the shot comes
              from and a wall faces the thing that hit it. */}
          {Array.from({ length: wallLayers }, (_, i) => (
            <CastPiece
              key={`defender-${i}`}
              x={WALL_FRONT_X - i * WALL_DX}
              y={GLYPH_Y - i * WALL_DY}
              color={defender}
              retro70={isRetro70}
              pose='right'
              style={attackerWon && i === 0 ? { animation: fx('fxDefenderFade') } : undefined}
            />
          ))}

          {/* the shield: `n` nested curves arcing over them, one per defender, thinning as
              they go outward, and drawn after the glyphs because it stands in front of
              them. The outermost is both the face the shot meets and the line that glitches
              out when a defender is taken (rules 3 and 4), so the count reads twice: `n`
              glyphs and `n` lines. */}
          {Array.from({ length: wallLayers }, (_, i) => (
            <path
              key={`shield-${i}`}
              d={shieldCurve(WALL_R - i * WALL_RING_STEP)}
              fill='none'
              stroke={defenderColor}
              strokeOpacity={i === 0 ? 1 : 0.55}
              strokeWidth={+(WALL_INK - (wallLayers - 1 - i) * 0.8).toFixed(1)}
              style={
                i === 0 && attackerWon
                  ? ({ ...pivot, '--g1': '5px', '--g2': '-6px', animation: fx('fxLayerOut') } as CSSProperties)
                  : undefined
              }
            />
          ))}

          {/* the attacker, in frame, on the ground and outside the shield: the reflected
              shot has to have somebody visible to strike (rule 6). */}
          <CastPiece
            x={WALL_ATTACKER_X}
            y={GLYPH_Y}
            color={attacker}
            retro70={isRetro70}
            pose='left'
          />
        </g>
      )}

      {/* ── the pair stage: every 1v1 act, and the jail act of a wall (25.3) ────────── */}

      <g style={pairGate}>
        {/* the floor the pair stands on */}
        <line
          x1={pairFloorX1}
          y1={GROUND_Y}
          x2={pairFloorX2}
          y2={GROUND_Y}
          stroke={loserColor}
          strokeOpacity='.22'
          strokeWidth='2'
        />

        {/* the cast, at the same two places whichever seat won: the defender on the left,
            the attacker on the right. On a wall this group is the jail act only — the pair
            arrives where the wall stood, one clear later, which is why the wall's prisoner
            is drawn twice and never contradicted (25.4). They face each other, which is the
            same rule the wall's row follows: the seats never swap, so neither does the
            direction each of them looks. */}
        <CastPiece
          x={DEFENDER_GLYPH_X}
          y={GLYPH_Y}
          color={defender}
          retro70={isRetro70}
          pose='right'
        />
        <CastPiece
          x={ATTACKER_GLYPH_X}
          y={GLYPH_Y}
          color={attacker}
          retro70={isRetro70}
          pose='left'
        />
      </g>

      {/* the strike lands: the field cracks under the loser. The loser itself never moves
          — it stands where it was struck until the bars close on it (25.18). A wall's
          attack cracks no field: the shield is what takes the hit (25.4). */}
      {isPieceLevel && (
        <g style={{ animation: fx('fxFieldCrack') }}>
          <path
            d={`M ${loserCx - 22} ${GROUND_Y} L ${loserCx - 8} ${GROUND_Y - 8} L ${loserCx - 2} ${GROUND_Y}`}
            fill='none'
            stroke='#e8e2ff'
            strokeOpacity='.85'
            strokeWidth='1.5'
          />
          <path
            d={`M ${loserCx + 4} ${GROUND_Y} L ${loserCx + 14} ${GROUND_Y - 6} L ${loserCx + 24} ${GROUND_Y}`}
            fill='none'
            stroke='#e8e2ff'
            strokeOpacity='.85'
            strokeWidth='1.5'
          />
        </g>
      )}

      {/* the strike: the winner's beam, entering from the winner's own side, on every act's
          one line at `STRIKE_Y` */}
      <g style={{ animation: fx('fxBeam'), '--beamFrom': beamEntry } as CSSProperties}>
        <rect x={beamX} y={STRIKE_Y - 3} width={Math.max(10, beamW)} height='6' rx='3' fill={winnerColor} />
        <rect x={hotX} y={STRIKE_Y - 5} width='14' height='10' rx='4' fill='#ffffff' opacity='.7' />
      </g>

      {/* where it lands: the puncture star blooms on the piece the shot met — the defender's
          flank on a 1v1 capture, the shield's outer face on a wall, the attacker himself on
          a repulse — always in the winner's colour */}
      <path
        d={starAt(impactX, STRIKE_Y)}
        fill='#ffffff'
        stroke={winnerColor}
        strokeWidth='1.5'
        style={{ ...pivot, animation: fx('fxPuncture') }}
      />

      {/* the cloud act, on the total breach only: the wall left at 700 (the first clear), so
          the blast stands on the ground where it stood, and the second clear takes it at
          2100 as the jail's pair arrives. Two marks, both in the winner's colour: the
          ground ring (flat, because the frame is a side view) and the mushroom itself —
          stem and head in one group, which is what lets a single scale about its bottom
          edge be "it grows upward from the ground" (25.4). */}
      {isBreach && (
        <g transform={`translate(${CLOUD_CX} ${GROUND_Y})`} style={cloudGate}>
          <ellipse
            rx={CLOUD_RING_R}
            ry={CLOUD_RING_RY}
            fill='none'
            stroke={winnerColor}
            strokeWidth='3'
            style={{ ...pivot, animation: cloudFx('fxCloudRing') }}
          />
          <g style={{ ...growsUp, animation: cloudFx('fxCloudBody') }}>
            {/* the stem, veiled so the head reads in front of it */}
            <path
              d={
                `M ${-CLOUD_STEM_BASE_HALF} 0 L ${-CLOUD_STEM_TOP_HALF} ${-CLOUD_STEM_TOP_UP} ` +
                `L ${CLOUD_STEM_TOP_HALF} ${-CLOUD_STEM_TOP_UP} L ${CLOUD_STEM_BASE_HALF} 0 Z`
              }
              fill={winnerColor}
              opacity='.55'
            />
            {/* the head: a belly bar joining three puffs to the stem */}
            <rect
              x={-CLOUD_BELLY_HALF}
              y={-CLOUD_BELLY_UP}
              width={CLOUD_BELLY_HALF * 2}
              height={CLOUD_BELLY_UP - CLOUD_STEM_TOP_UP + 2}
              rx={(CLOUD_BELLY_UP - CLOUD_STEM_TOP_UP) / 2}
              fill={winnerColor}
            />
            <circle cx={-CLOUD_HEAD_X} cy={-CLOUD_HEAD_UP} r={CLOUD_HEAD_R} fill={winnerColor} />
            <circle cx={CLOUD_HEAD_X} cy={-CLOUD_HEAD_UP} r={CLOUD_HEAD_R} fill={winnerColor} />
            <circle cx={0} cy={-CLOUD_CROWN_UP} r={CLOUD_CROWN_R} fill={winnerColor} />
          </g>
        </g>
      )}


      {/* the cell slams closed on the loser — on the pair stage, whichever seat lost, and on
          a wall after the clear has re-presented that same piece as the prisoner (25.4) — and
          then holds. The bars are the WINNER's colour, which is also why the prisoner can
          never be lost in them: the prisoner is the loser, so bars and prisoner are always
          two different seats. Two rects per bar, a core and a glow; no filter, because a
          filter is the one thing that costs frames here. */}
      <g style={{ animation: jailFx('fxCage'), '--cageFrom': cageFrom } as CSSProperties}>
        <g style={{ animation: jailFx('fxArc') }}>
          <rect x={cageCx - CAGE_HALF} y={cageTopY} width={CAGE_HALF * 2} height='4' rx='2' fill={winnerColor} />
          {Array.from({ length: cageBars }, (_, i) => {
            const bx = cageCx - CAGE_HALF + ((CAGE_HALF * 2) / (cageBars - 1)) * i;
            return (
              <g key={`bar-${i}`}>
                <rect x={bx - 3.5} y={cageTopY} width='7' height={cageH} fill={winnerColor} opacity='.2' />
                <rect x={bx - 1.5} y={cageTopY} width='3' height={cageH} fill={winnerColor} opacity='.95' />
              </g>
            );
          })}
        </g>
      </g>

      {/* the sentence reads only on the total breach, and INSIDE the cloud act: it joins the
          cloud 400 ms in and finishes exactly with the act, so it reads over a blast still
          moving rather than after it (25.4, D34) */}
      {isBreach && banner && (
        <>
          <text
            x={VB_W / 2}
            y={BANNER_Y}
            textAnchor='middle'
            fontSize={bannerFs}
            fontWeight={900}
            fontFamily='var(--font-display)'
            fill='none'
            stroke={winnerColor}
            strokeWidth={bannerHalo}
            strokeOpacity='.35'
            style={{ animation: readFx('fxBannerPulse', sentenceAtMs) }}
            {...bannerSqueeze}
          >
            {banner}
          </text>
          <text
            x={VB_W / 2}
            y={BANNER_Y}
            textAnchor='middle'
            fontSize={bannerFs}
            fontWeight={900}
            fontFamily='var(--font-display)'
            fill={winnerColor}
            stroke='#0b0118'
            strokeWidth={bannerEdge}
            paintOrder='stroke'
            style={{ animation: readFx('fxBannerPulse', sentenceAtMs) }}
            {...bannerSqueeze}
          >
            {banner}
          </text>
        </>
      )}
    </svg>
  );
}

