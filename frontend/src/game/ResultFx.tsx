import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { COL } from '../theme';
import { useApp } from '../store';
import { PieceFigure } from '../components/PieceFigure';
import type { PlayerColor } from './types';
import { PIECE_GLYPH } from './boardGeometry';
import {
  RESULT_FX_MS,
  RESULT_HEADLINE_READ_MS,
  SCENE_ATTACK_MS,
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
 * `kind` chooses only whose colour is on the ink. `n` is the wall's defender count, and
 * `totalRounds > 1` says the square is a wall at all.
 *
 * The clock is per act, not per scene (25.8): an element is budgeted in the act it plays
 * in — the attack's 700 ms or the jail's 1200 ms — so an act can be re-timed without
 * touching the other, and every instant a player sees stayed the instant the card played
 * before the split.
 */
export type ResultFxKind = 'capture' | 'repulse';

// The cell's two beats, in the JAIL act's own clock. They were 44 % and 59 % of the one
// 1900 ms gesture, i.e. 836 and 1121 ms of the card: the jail opens at 700, so they are
// 136 and 421 ms into its 1200, and its first 136 ms are the stillness the old card
// already had before the bars move. The sound's landing is derived from the same pair, so
// the slam can never drift from the drawing.
const CAGE_START_IN_JAIL_MS = 136;
const CAGE_LAND_IN_JAIL_MS = 421;
const CAGE_LAND_AT_MS = SCENE_ATTACK_MS + CAGE_LAND_IN_JAIL_MS; // 1121 ms of the card
// How far the cell travels: its own width, so it starts clear of the piece it closes on.
const CAGE_TRAVEL_PX = 52;
// The beam starts a full stage clear of its own tail, on the shooter's side.
const BEAM_TRAVEL_PX = 150;

// The attack act's beats, in ms from its own start, shared by the keyframes below and by
// 25.5's soundtrack so the sound cannot drift from the drawing: the beam lands at 247, the
// star blooms where it lands and peaks at 323, and the line starts glitching at 418. The
// wall's flare peaks at the star's own peak, and the clear — the one cast change — is the
// act's last instant.
const BEAM_LAND_AT_MS = 247;
const PUNCTURE_PEAK_AT_MS = 323;
const SUBTRACT_AT_MS = 418;
const IMPACT_AT_MS = 260; // the puncture, a beat after the beam arrives
const CLEAR_AT_MS = SCENE_ATTACK_MS; // the attack's last frame: the jail's first
// One puncture per layer, 40 ms apart, so a three-line wall is heard as three.
const PUNCTURE_GAP_MS = 40;

// The keyframes are written in milliseconds and converted here, so a beat reads as its
// instant instead of a percentage somebody has to divide by 19 in their head. Each act's
// percentages are of that act: the attack's 700 and the jail's 1200.
const aPct = (ms: number) => +((ms / SCENE_ATTACK_MS) * 100).toFixed(2);
const jPct = (ms: number) => +((ms / SCENE_JAIL_MS) * 100).toFixed(2);

// The keyframes, injected once for however many cards render them. No duration is written
// in here: `fx()`, `jailFx()` and `afterAttack()` build each `animation` string from the act
// that owns the element, so nothing can play past the act it belongs to. The read window is
// the one exception: it follows the scene and is built by `readFx()`, which takes its start.
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
      /* the bloom: two rings + a cap, fill-opacity steps, no SVG filters (700-1120 ms).
         It is the breach's swell, and the act that owns it is the cloud — 1400 ms, a
         separate commit; until that act lands these stay percentages of the SCENE, which
         is where 37-58 % comes from, so no pixel of the wall moves in the passing. */
      @keyframes fxBloomRing {
        0%, 37%  { transform: scale(.15); opacity: 0; }
        43%      { opacity: .85; }
        58%      { transform: scale(1); opacity: 0; }
        100%     { transform: scale(1); opacity: 0; }
      }
      @keyframes fxBloomRing2 {
        0%, 42%  { transform: scale(.15); opacity: 0; }
        47%      { opacity: .7; }
        58%      { transform: scale(1); opacity: 0; }
        100%     { transform: scale(1); opacity: 0; }
      }
      @keyframes fxBloomCap {
        0%, 40%  { transform: scale(.4); opacity: 0; }
        50%      { transform: scale(1); opacity: .85; }
        58%,100% { transform: scale(1); opacity: .72; }
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
// continuous shot. `PIECE_W` is the glyph's own 11 units at the scale the card draws it,
// and the box is the contract: every strike is measured from its edge.
const PAIR_CX = 150;
const GLYPH_SCALE = 3;
const PIECE_W = 11 * GLYPH_SCALE; // 33
const STRIKE_Y = 84; // the line both pieces are struck on: the middle of the box
const GLYPH_Y = STRIKE_Y - 12; // 72
const DEFENDER_GLYPH_X = 8;
const ATTACKER_GLYPH_X = PAIR_CX - 16; // 134, the defender's old place
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
// 3 x 20 + 33 = 93 units of run, from x 48 (the rear-most box's left edge) to 141 (the
// front-most's right edge), so the shield is centred on x 118 with its outermost curve at
// 64 — x 54 to 182 — and the attacker takes the right-hand bay at x 196 to 229 at the same
// 33 units, on the same ground line. The shield's own face at the strike height is x 171,
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
const WALL_ATTACKER_X = 196; // the attacker's own 33-unit bay, outside the shield
const BEAM_INSET = 6; // the shot leaves its shooter 6 units inside the glyph's edge
// The shield's outer face: the outermost curve's own right flank **at the strike height**,
// because every shot in the game travels on `STRIKE_Y` — so a wall's punch and its return
// are one line at one height, the line the pair is struck on, and the beam meets the shield
// instead of the ground beside it.
const SHIELD_FACE_X = Math.round(
  WALL_CX + Math.sqrt(WALL_R ** 2 - (GROUND_Y - STRIKE_Y) ** 2),
); // 171

// The bloom is capped inside the shield's own width, so it reads as a burst over the wall
// and never as a second wall. Its act is the cloud's — a separate commit (25.4).
const BLOOM_R = Math.round(0.94 * WALL_R); // 60

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
 * One piece of the cast, at the box both renderings share: the invader glyph stamped to
 * `PIECE_W`, or the 70s figure from `game/pieceParts.ts` filling the same 33 units. The box
 * is the contract — every strike is measured from its edge — so neither drawing can move
 * the shot, and a wall's defenders are drawn by the same call as the pair (25.17 item 2).
 */
function CastPiece({
  x,
  y,
  color,
  retro70,
  style,
}: {
  x: number;
  y: number;
  color: PlayerColor;
  retro70: boolean;
  style?: CSSProperties;
}) {
  return retro70 ? (
    <g transform={`translate(${x} ${y}) scale(${PIECE_W / 100})`} style={style}>
      <PieceFigure ck={color} />
    </g>
  ) : (
    <g
      transform={`translate(${x} ${y}) scale(${GLYPH_SCALE})`}
      shapeRendering='crispEdges'
      style={style}
    >
      <path d={PIECE_GLYPH[color]} fill='none' stroke='#000' strokeWidth='1' strokeLinejoin='miter' />
      <path d={PIECE_GLYPH[color]} fill={COL[color].base} />
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

  // One clock per act (25.8): an element is budgeted in the act it plays in, so nothing can
  // outlive that act and re-timing one act leaves the other's instants alone. The read
  // window is not an act: it follows the scene, and it is the only caller of `readFx`.
  const fx = (name: string) => `${name} ${SCENE_ATTACK_MS}ms ease-out both`;
  const jailFx = (name: string) =>
    `${name} ${SCENE_JAIL_MS}ms ease-out ${SCENE_ATTACK_MS}ms both`;
  // The jail act's clock, held OPEN by its delay rather than by `both`: an element that must
  // not exist during the attack act keeps its base style until its own act starts.
  const afterAttack = (name: string) =>
    `${name} ${SCENE_JAIL_MS}ms ease-out ${SCENE_ATTACK_MS}ms forwards`;
  // The bloom is the one mark whose act (the cloud) is still a separate commit; it keeps
  // the scene's clock until that act lands, so no pixel of the wall moves in the passing.
  const sceneFx = (name: string) => `${name} ${RESULT_FX_MS}ms ease-out both`;
  const readFx = (name: string, startMs: number) =>
    `${name} ${RESULT_HEADLINE_READ_MS}ms ease-out ${startMs}ms both`;
  // SVG shapes need their own box for `transform-origin` to mean anything.
  const pivot: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };

  const total = Math.max(1, Math.trunc(totalRounds) || 1);
  const isWall = total > 1;
  const layers = Math.min(Math.max(1, Math.trunc(n) || 1), WALL_MAX);
  // A single-defender round is piece-level in EITHER direction: two glyphs, no shield.
  const isPieceLevel = !isWall;
  const isBreach = attackerWon && isWall && layers === 1;
  // A capture subtracts one defender, so the wall is drawn one layer fuller than it is
  // left; a repulse subtracts nothing, and there `n` is the whole set plus the one that
  // would have gone, which is why the total is the ceiling.
  const wallLayers = attackerWon ? layers : Math.min(total, WALL_MAX);

  // The strike: from the winner's front face to whatever takes it. The tail sits 6 units
  // inside the shooter's glyph, so the beam leaves a piece instead of crossing an empty
  // lane (25.17 item 2). The front face is the attacker's LEFT and the defender's RIGHT,
  // now that the defender holds the left seat. On a wall the shield's outer face is what
  // the shot meets: a capture punches through it, and a 1v1 frame has no shield to bounce
  // from, so the reflect is a wall beat only (25.3 rule 2, 25.4 path C).
  const beamFrom = attackerWon
    ? isWall
      ? WALL_ATTACKER_X + BEAM_INSET // 202: the attacker's front face, in the wall's bay
      : ATTACKER_GLYPH_X + BEAM_INSET // 140
    : isWall
      ? SHIELD_FACE_X // 171: the shot returns off the face it struck
      : DEFENDER_GLYPH_X + PIECE_W - BEAM_INSET; // 35
  const impactX = attackerWon
    ? isWall
      ? SHIELD_FACE_X // 171: the shield's outer face takes the hit
      : DEFENDER_GLYPH_X + PIECE_W // 41: the defender's right flank
    : isWall
      ? WALL_ATTACKER_X // 196: the reflected shot strikes the attacker's flank
      : ATTACKER_GLYPH_X; // 134: the attacker's left flank
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
  const cageHalf = 26;
  // Both edges are clamped into the window the two cards share: the left one, because the
  // defender's cell (centre 24.5, half-width 26) would otherwise start at -1.5 and be cut
  // by the stage's edge, and the right one against `SHARED_X_MAX` 192, so the flash card
  // can never crop a cell the clash card keeps (D35).
  const cageCx = Math.min(SHARED_X_MAX - cageHalf, Math.max(cageHalf, loserCx));
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
  const pairFloorX1 = Math.max(0, cageCx - cageHalf - 16);
  const pairFloorX2 = Math.min(SHARED_X_MAX, cageCx + cageHalf + 16);
  const wallFloorX1 = Math.max(4, WALL_FRONT_X - (wallLayers - 1) * WALL_DX - 12);
  const wallFloorX2 = Math.min(VB_W - 4, WALL_ATTACKER_X + PIECE_W + 8); // 237

  // The two compositions' gates. The frame is cleared exactly once (25.3 rule 4): the wall
  // leaves at the attack's last instant and the jail's pair arrives on the pair stage, so
  // the wall's group holds no pixel of the jail act and the pair holds none of the attack.
  const wallGate: CSSProperties = { animation: fx('fxWallClear') };
  const pairGate: CSSProperties = isWall
    ? { opacity: 0, animation: afterAttack('fxCastIn') }
    : {};

  // The soundtrack belongs to the act, not to the host (25.5): both cards mount the same
  // scene, so both play the same beats, and the flash card keeps the laser the walk found
  // missing. Each act schedules its own beats — the beam, the wall taking it, the layer
  // going, the bloom, the cell — and nothing is scheduled after the cell, so the read
  // window stays silent under the banner. Armed once per mounted card and cleared on
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
    // The cloud act: only a total breach falls all the way, and it opens where the clear
    // first takes the frame away — before the second clear hands it to the jail.
    if (isBreach) beats.push({ at: CLEAR_AT_MS, play: () => retroAudio.playBreachBloom() });
    // The jail act: the cell, heard ON the slam rather than 191 ms before it.
    beats.push({ at: CAGE_LAND_AT_MS, play: () => retroAudio.playCageSlam() });

    const timers = beats.map(({ at, play }) => window.setTimeout(play, at));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [isWall, attackerWon, isBreach, layers]);

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
              line goes: one defender, one line, always together (rule 4). */}
          {Array.from({ length: wallLayers }, (_, i) => (
            <CastPiece
              key={`defender-${i}`}
              x={WALL_FRONT_X - i * WALL_DX}
              y={GLYPH_Y - i * WALL_DY}
              color={defender}
              retro70={isRetro70}
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
          <CastPiece x={WALL_ATTACKER_X} y={GLYPH_Y} color={attacker} retro70={isRetro70} />
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
            is drawn twice and never contradicted (25.4). */}
        <CastPiece x={DEFENDER_GLYPH_X} y={GLYPH_Y} color={defender} retro70={isRetro70} />
        <CastPiece x={ATTACKER_GLYPH_X} y={GLYPH_Y} color={attacker} retro70={isRetro70} />
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

      {/* the bloom: the total breach only, two rings + a cap in the winner's colour */}
      {isBreach && (
        <g transform={`translate(${impactX} ${STRIKE_Y})`}>
          <circle r={BLOOM_R} fill='none' stroke={winnerColor} strokeWidth='3' style={{ ...pivot, animation: sceneFx('fxBloomRing') }} />
          <circle r={Math.round(BLOOM_R * 0.62)} fill='none' stroke='#ffffff' strokeWidth='2' style={{ ...pivot, animation: sceneFx('fxBloomRing2') }} />
          <circle r={Math.round(BLOOM_R * 0.5)} fill={winnerColor} style={{ ...pivot, animation: sceneFx('fxBloomCap') }} />
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
          <rect x={cageCx - cageHalf} y={cageTopY} width={cageHalf * 2} height='4' rx='2' fill={winnerColor} />
          {Array.from({ length: cageBars }, (_, i) => {
            const bx = cageCx - cageHalf + ((cageHalf * 2) / (cageBars - 1)) * i;
            return (
              <g key={`bar-${i}`}>
                <rect x={bx - 3.5} y={cageTopY} width='7' height={cageH} fill={winnerColor} opacity='.2' />
                <rect x={bx - 1.5} y={cageTopY} width='3' height={cageH} fill={winnerColor} opacity='.95' />
              </g>
            );
          })}
        </g>
      </g>

      {/* WALL BROKEN reads only on the total breach, in the read window (1900-2900) */}
      {isBreach && banner && (
        <>
          <text
            x={VB_W / 2}
            y={BANNER_Y}
            textAnchor='middle'
            fontSize='27'
            fontWeight={900}
            fontFamily='var(--font-display)'
            fill='none'
            stroke={winnerColor}
            strokeWidth='6'
            strokeOpacity='.35'
            style={{ animation: readFx('fxBannerPulse', RESULT_FX_MS) }}
          >
            {banner}
          </text>
          <text
            x={VB_W / 2}
            y={BANNER_Y}
            textAnchor='middle'
            fontSize='27'
            fontWeight={900}
            fontFamily='var(--font-display)'
            fill={winnerColor}
            stroke='#0b0118'
            strokeWidth='0.75'
            paintOrder='stroke'
            style={{ animation: readFx('fxBannerPulse', RESULT_FX_MS) }}
          >
            {banner}
          </text>
        </>
      )}
    </svg>
  );
}

