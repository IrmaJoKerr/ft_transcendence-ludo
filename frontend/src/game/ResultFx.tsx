import { useEffect, useId } from 'react';
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
  SCENE_WALL_ATTACK_MS,
} from '../__shared__/timing.constants';
import { retroAudio } from '../utils/audio';

// The clash card's scene: one fixed 240 x 180 stage, two acts back to back, on both hosts.
export type ResultFxKind = 'capture' | 'repulse';

// The cell's two beats, in the JAIL act's own clock.
const CAGE_START_IN_JAIL_MS = 136;
const CAGE_LAND_IN_JAIL_MS = 421;
// The cell's half-width: 26 x 36 / 33, the old half-width carried along with the box it
// encloses, so the cell still closes on the piece with the margin it had.
const CAGE_HALF = 28.4;
// How far the cell travels: its own width, so it starts clear of the piece it closes on.
const CAGE_TRAVEL_PX = CAGE_HALF * 2;
// The beam starts a full stage clear of its own tail, on the shooter's side.
const BEAM_TRAVEL_PX = 150;

// The attack act's beats, in ms from its own start, shared by the keyframes below and by 25.5's
// soundtrack so the sound cannot drift from the drawing: the beam lands at 247, the star blooms
// where it lands and peaks at 323, and the line starts glitching at 418.
const BEAM_LAND_AT_MS = 247;
const PUNCTURE_PEAK_AT_MS = 323;
const SUBTRACT_AT_MS = 418;
const IMPACT_AT_MS = 260; // the puncture, a beat after the beam arrives
// One puncture per layer, 40 ms apart, so a three-line wall is heard as three.
const PUNCTURE_GAP_MS = 40;

// The wall beat's instants, in ms from the attack act's own start (32.4).
const BLOB_PEAK_AT_MS = SCENE_ATTACK_MS; // 700: the old last frame is the swell's peak
const BLOB_DONE_AT_MS = 880; // the blob resolves and the fade completes
const RING_OUT_AT_MS = 1000; // the face ring's glitch has finished
// The glitch's own four flickers, the shape the ring had at 475/532/589/646 of 700 — twice
// out and back, then out — re-spaced inside its 120 ms.
const GLITCH_OUT_1_AT_MS = 910;
const GLITCH_BACK_1_AT_MS = 940;
const GLITCH_OUT_2_AT_MS = 970;
const GLITCH_BACK_2_AT_MS = 985;

// The cloud act's two beats, in ms from its own start: the cloud is up at 500 and holds, and the
// sentence joins it 400 ms later so it reads over a cloud already moving and finishes exactly with
// the act (25.4, D34).
const CLOUD_GROW_AT_MS = 500;
const CLOUD_TEXT_LEAD_MS = 400;

// The keyframes are written in milliseconds and converted here, so a beat reads as its instant
// instead of a percentage somebody has to divide by 19 in their head.
const aPct = (ms: number) => +((ms / SCENE_ATTACK_MS) * 100).toFixed(2);
const wPct = (ms: number) => +((ms / SCENE_WALL_ATTACK_MS) * 100).toFixed(2);
const jPct = (ms: number) => +((ms / SCENE_JAIL_MS) * 100).toFixed(2);
const cPct = (ms: number) => +((ms / SCENE_CLOUD_MS) * 100).toFixed(2);

// The keyframes, injected once for however many cards render them. No duration is written in here:
// `fx()`, `jailFx()`, `atJailStart()` and `cloudFx()` build each `animation` string from the act
// that owns the element, so nothing can play past the act it belongs to.
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
      /* a line glitches TWICE and goes out — no fade-through, no hard cut (D1). The ring holds
         until the defenders' fade ends (880), then flickers out in its own 120 ms, after the blow. */
      @keyframes fxLayerOut {
        0%, ${wPct(BLOB_DONE_AT_MS)}%  { transform: translateX(0); opacity: 1; }
        ${wPct(GLITCH_OUT_1_AT_MS)}%   { transform: translateX(var(--g1)); opacity: .25; }
        ${wPct(GLITCH_BACK_1_AT_MS)}%  { transform: translateX(0); opacity: 1; }
        ${wPct(GLITCH_OUT_2_AT_MS)}%   { transform: translateX(var(--g2)); opacity: .25; }
        ${wPct(GLITCH_BACK_2_AT_MS)}%  { transform: translateX(0); opacity: .55; }
        ${wPct(RING_OUT_AT_MS)}%, 100% { transform: translateX(0); opacity: 0; }
      }
      /* the dome takes the blow: it swells, settles by 880 and scales about the ground under its
         centre, so the rim moves while the column's feet stay put. */
      @keyframes fxDomeBeat {
        0%, ${wPct(IMPACT_AT_MS)}%    { transform: scale(1, 1); }
        ${wPct(BLOB_PEAK_AT_MS)}%     { transform: scale(1.04, .97); }
        ${wPct(BLOB_DONE_AT_MS)}%, 100% { transform: scale(1, 1); }
      }
      /* the struck defender fades with its wall lines, one defender and one line always together
         (25.4). The fade is stretched to end at 880, where the blob resolves. */
      @keyframes fxDefenderFade {
        0%, ${wPct(SUBTRACT_AT_MS)}%      { opacity: 1; }
        ${wPct(BLOB_DONE_AT_MS)}%, 100%   { opacity: 0; }
      }
      /* the clear: the wall and its remaining defenders leave at the attack's last instant, and
         the jail pair takes over. It is a softened cut because the cast changes (25.3 rule 4). */
      @keyframes fxWallClear {
        0%, ${wPct(SCENE_WALL_ATTACK_MS - 28)}% { opacity: 1; }
        100%                                   { opacity: 0; }
      }
      /* the jail re-presents the pair where the wall stood: the second and last cast change. It
         starts at 0, before the pair arrives, and lands 96 ms in, before the bars move at 136 ms. */
      @keyframes fxCastIn {
        0%   { opacity: 0; }
        8%, 100% { opacity: 1; }
      }
      /* the cloud: two marks and one clear on the cloud act's own clock (25.4). The ring opens
         where the wall stood and fades within 500 ms; the mushroom body grows and stays up. */
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
         (13.6-42.1 % of the jail act, i.e. 136-421 ms into its 1000, 836-1121 ms of the
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
      /* WALL BROKEN reads in the read window (1700-2700): two pulses at most. */
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

// The pair stage: defender left, attacker right on one line, never swapped, so a chain's
// rounds read as one shot. `PIECE_W` is the 36-unit cast box every strike is measured
// from; the seats stay at centres 24.5 and 150.5.
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

// The wall stage: `n` defenders on the cast's diagonal under a dome of `n` rings, one
// ring removed per success. Boxes taper from x 108 up-left; the attacker takes the right
// bay at x 196-232, outside the dome.
const WALL_MAX = 4;
const WALL_TAPER = 0.82; // each further defender's width, against the one in front
const WALL_OVERLAP = 1 / 3; // ...and the share of that box the piece in front covers
const WALL_DY = 8.4; // the rise of every rung
// The front-most box: lowest and right-most, because the shot arrives from the right. A
// literal now, since the column no longer orbits a curve's centre.
const WALL_FRONT_X = 108;
const WALL_ATTACKER_X = 196; // the attacker's own 36-unit bay, outside the dome
const BEAM_INSET = 6; // the shot leaves its shooter 6 units inside the glyph's edge

// The dome (25.3 rule 5): four frozen rings, measured and fitted rather than drawn by eye, so a
// later redraw re-runs the sum instead of re-guessing it.
const DOME_CX = 85;
const DOME_STROKE = 3.0; // the outermost ring's weight, and the half-stroke in the fit
const DOME_PAD = 4 / 1.75; // 4 px of breathing room, at the stage's own pixels per unit
const DOME_R_INK = 74.88; // the minimal semicircle about the sampled ink
const DOME_R_IN = +(DOME_R_INK + DOME_PAD + DOME_STROKE / 2).toFixed(1); // 78.7
const DOME_GAP = 5.5; // the pitch to the next ring outward
// To a tenth, because the fitted numbers are tenths and 78.7 + 3 x 5.5 is 95.199... in
// floating point: 78.7, 84.2, 89.7 and 95.2, the last the line the shot meets.
const DOME_RADII = [0, 1, 2, 3].map((i) => +(DOME_R_IN + i * DOME_GAP).toFixed(1));
// The strokes invert the old ladder, 2.2 at the innermost out to 3.2 at the outermost, so the face
// the shot meets and the line that glitches out is the heaviest of the four. A 5-unit stroke
// cannot live on a 5.5-unit pitch either: it would leave half a unit of ground between two rings.
const DOME_STROKES = [2.2, 2.4, 2.8, 3.2]; // the same four, innermost first

// The cloud stage: the breach's own act, drawn on the shield's centre line because the
// mushroom stands where the wall stood. Its ring marks the blast footprint, inside the
// dome's innermost 78.7.
const CLOUD_RING_R = 46;
const CLOUD_RING_RY = 9; // a ring lying on the ground is seen edge-on, so it is flat
// The mushroom: a stem that widens as it reaches the ground and a head of three puffs (two side,
// one crown) joined by a belly bar.
const CLOUD_STEM_BASE_HALF = 15; // ...at the ground
const CLOUD_STEM_TOP_HALF = 7; // ...where it meets the head
const CLOUD_STEM_TOP_UP = 41; // above the ground line; also the belly's underside
const CLOUD_HEAD_UP = 50; // the side puffs' centres, above the ground line
const CLOUD_HEAD_R = 17;
const CLOUD_HEAD_X = 18; // their centres' offset from `DOME_CX`
const CLOUD_CROWN_UP = 64; // the crown puff, one step higher and wider
const CLOUD_CROWN_R = 22;
const CLOUD_BELLY_UP = 56; // the bar that joins the three puffs to the stem
const CLOUD_BELLY_HALF = 21;

// The sentence's fit, because it carries a player's name and 27 was sized for an eleven character
// word (25.4). The estimate is the display face's average advance at weight 900, and the floor is
// the smallest size that still reads at the small card's scale.
const BANNER_MAX_FS = 27;
const BANNER_MIN_FS = 11;
const BANNER_ADVANCE = 0.62; // per character, at `--font-display` weight 900
const BANNER_PAD = 8; // each side of the stage

// The clash stage's own cap, read by `ClashOverlay` so the two cards cannot drift apart.
export const CLASH_STAGE_MAX_PX = 420;
// The flash card is the clash stage at 0.8: same 4:3 and pixels per unit, showing the
// side both pieces stand on. Its 192 x 144 window centres the cell box; it never shows
// a wall.
export const FLASH_CARD_STAGE_MAX_PX = 336;
export const FLASH_CARD_VIEWBOX = '0 15 192 144';
export const FLASH_CARD_ASPECT = 192 / 144;

// An eight-point star, centred on the impact, for the puncture flash.
const starAt = (cx: number, cy: number, r = 9) =>
  `M ${cx} ${cy - r} L ${cx + r * 0.28} ${cy - r * 0.28} L ${cx + r} ${cy} ` +
  `L ${cx + r * 0.28} ${cy + r * 0.28} L ${cx} ${cy + r} L ${cx - r * 0.28} ${cy + r * 0.28} ` +
  `L ${cx - r} ${cy} L ${cx - r * 0.28} ${cy - r * 0.28} Z`;

// One ring of the dome, r units out from its centre: a half circle standing on the ground
// line, which is as much curvature as a card of this size can read. Gentler or flatter is
// allowed — it is a fitting value and not a shape ruling (25.3 rule 5).
const shieldCurve = (r: number) =>
  `M ${DOME_CX - r} ${GROUND_Y} A ${r} ${r} 0 0 1 ${DOME_CX + r} ${GROUND_Y}`;

// One cast piece, filled by the 70s or 80s art in the same box: 36 units for the pair,
// smaller for each wall rung. `pose` changes only the face plate; the seat and box stay
// fixed across every act.
function CastPiece({
  x,
  y,
  size = PIECE_W,
  color,
  retro70,
  pose = 'front',
  style,
}: {
  x: number;
  y: number;
  size?: number;
  color: PlayerColor;
  retro70: boolean;
  pose?: PiecePose;
  style?: CSSProperties;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 100})`} style={style}>
      <PieceFigure ck={color} set={retro70 ? 'retro70' : 'retro80'} pose={pose} />
    </g>
  );
}


// The result card's animation stage, played alongside the text. The winner's colour marks
// beam, strike and bars; the loser stays in the cell. `n` is the defender count, and
// `totalRounds > 1` marks a wall. Cosmetics only; the room's `captureFx` gates it.
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
  // path with a cloud and a sentence, and the longest card there is.
  const isBreach = attackerWon && isWall && layers === 1;
  // A capture subtracts one defender, so the wall is drawn one layer fuller than it is
  // left; a repulse subtracts nothing, and there `n` is the whole set plus the one that
  // would have gone, which is why the total is the ceiling.
  const wallLayers = attackerWon ? layers : Math.min(total, WALL_MAX);
    // The wall's column and the ring the shot meets, both read off `n`. The column: the front box at
  // `WALL_FRONT_X`, and each further defender `WALL_TAPER` of the width, one rung up and left by the
  // rest of its own box — 36, 29.5, 24.2 and 19.8 wide, x 144 back to 59.
  const wallBoxes: { x: number; y: number; size: number }[] = [];
  for (let i = 0; i < wallLayers; i++) {
    const size = +(PIECE_W * WALL_TAPER ** i).toFixed(1);
    const step = i === 0 ? 0 : +((1 - WALL_OVERLAP) * size).toFixed(1);
    const prev = i === 0 ? WALL_FRONT_X : wallBoxes[i - 1].x;
    wallBoxes.push({
      x: +(prev - step).toFixed(1),
      y: +(GLYPH_Y - i * WALL_DY).toFixed(1),
      size,
    });
  }
  const shieldFaceX = +(
    DOME_CX +
    Math.sqrt(DOME_RADII[wallLayers - 1] ** 2 - (GROUND_Y - STRIKE_Y) ** 2)
  ).toFixed(1);

    // One clock per act (25.8): an element is budgeted in the act it plays in, so nothing can outlive
  // that act and re-timing one act leaves the others' instants alone.
  const attackMs = isWall ? SCENE_WALL_ATTACK_MS : SCENE_ATTACK_MS;
  const fx = (name: string) => `${name} ${SCENE_ATTACK_MS}ms ease-out both`;
  const wallFx = (name: string) => `${name} ${SCENE_WALL_ATTACK_MS}ms ease-out both`;
  const cloudFx = (name: string) => `${name} ${SCENE_CLOUD_MS}ms ease-out ${attackMs}ms both`;
    // The jail is the second act everywhere and the THIRD on a breach, where the cloud sits between
  // the two clears.
  const jailStartMs = attackMs + (isBreach ? SCENE_CLOUD_MS : 0); // 700, 1600 or 3000
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

    // The strike: from the winner's front face to whatever takes it. The tail sits 6 units inside the
  // shooter's glyph, so the beam leaves a piece instead of crossing an empty lane (25.17 item 2).
  const beamFrom = attackerWon
    ? isWall
      ? WALL_ATTACKER_X + BEAM_INSET // 202: the attacker's front face, in the wall's bay
      : ATTACKER_GLYPH_X + BEAM_INSET // 138.5
    : isWall
      ? shieldFaceX // the shot returns off the face it struck
      : DEFENDER_GLYPH_X + PIECE_W - BEAM_INSET; // 36.5
  const impactX = attackerWon
    ? isWall
      ? shieldFaceX // the dome's face takes the hit
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

  // The cell closes on the loser: the defender on a capture (left), the attacker on a
  // repulse (right). Its centre is that piece's, so the bars follow the blow. A wall
  // re-presents prisoner and jailer after the clear.
  const cageBars = 5;
  const defenderCx = DEFENDER_GLYPH_X + PIECE_W / 2; // 24.5
  const attackerCx = ATTACKER_GLYPH_X + PIECE_W / 2; // 150.5
  const loserCx = attackerWon ? defenderCx : attackerCx;
  // Both cell edges are clamped to the window both cards share: the left so the defender's
  // cell is not cut at -3.9, the right against `SHARED_X_MAX` 192 so the flash card never
  // crops what the clash card keeps.
  const cageCx = Math.min(SHARED_X_MAX - CAGE_HALF, Math.max(CAGE_HALF, loserCx));
  const cageTopY = STRIKE_Y - 30; // 54, the top of the cell's box
  const cageH = GROUND_Y - cageTopY; // 66
  // The bars start on the winner's side and travel away from it: right to left on a
  // capture (the attacker is on the right), left to right on a repulse — the same vector
  // as the beam, so the card reads as one sweep repeated.
  const cageFrom = `${attackerWon ? CAGE_TRAVEL_PX : -CAGE_TRAVEL_PX}px`;
    // The beam travels a full stage clear on the pair, and its own width on a wall: the attacker
  // stands beside the dome there, so the shot is a punch at close range rather than a lance across
  // the frame (25.3).
  const beamTravel = isWall ? beamW : BEAM_TRAVEL_PX;
  const beamEntry = `${attackerWon ? beamTravel : -beamTravel}px`;
    // The strike may only exist inside the lane it crosses.
  const beamClipId = useId();
  const beamClipX = Math.min(beamFrom, impactX);
  const beamClipW = Math.abs(impactX - beamFrom) + (attackerWon ? 0 : 16);
    // The floor each composition stands on. The wall's runs from behind the rear-most defender to past
  // the attacker's own bay; the pair's follows the cell and stops at x 192, the widest both cards
  // can show, so the flash card never cuts a mark the clash card keeps.
  const pairFloorX1 = Math.max(0, cageCx - CAGE_HALF - 16);
  const pairFloorX2 = Math.min(SHARED_X_MAX, cageCx + CAGE_HALF + 16);
  const wallFloorX1 = Math.max(4, wallBoxes[wallLayers - 1].x - 12);
  const wallFloorX2 = Math.min(VB_W - 4, WALL_ATTACKER_X + PIECE_W + 8); // 236: the stage's edge

    // The three compositions' gates.
  const wallGate: CSSProperties = { animation: wallFx('fxWallClear') };
  // The dome scales about the ground under its centre, so its rim travels while the
  // column's feet stay put. `view-box` makes that floor point the origin instead of a
  // bounding box that moves with the ring count.
  const domeBeat: CSSProperties = {
    animation: wallFx('fxDomeBeat'),
    transformBox: 'view-box',
    transformOrigin: `${DOME_CX}px ${GROUND_Y}px`,
  };
  const pairGate: CSSProperties = isWall
    ? { opacity: 0, animation: atJailStart('fxCastIn') }
    : {};
  const cloudGate: CSSProperties = { animation: cloudFx('fxCloudClear') };

    // The sentence's own numbers, from the string it draws (25.4): the same key carries a player's
  // name now, so 27 — sized for an eleven-character word — is a ceiling and not a constant.
  const sentenceAtMs = attackMs + CLOUD_TEXT_LEAD_MS; // 2000: 400 ms into a breach's cloud
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
    // The halo and the hairline are the two widths that were tuned against a 27 px word, so they
  // follow the size: at the ceiling they land on exactly 6 and 0.75 units, and at the floor they are
  // thin enough to leave the counters of the letters open instead of drowning them in glow.
  const bannerScale = bannerFs / BANNER_MAX_FS;
  const bannerHalo = Math.max(2, Math.round(6 * bannerScale));
  const bannerEdge = Math.max(0.4, +(0.75 * bannerScale).toFixed(2));

    // The soundtrack belongs to the act, not to the host (25.5): both cards mount the same scene, so
  // both play the same beats, and the flash card keeps the laser the walk found missing.
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
    // clear takes the frame away — the end of the wall's act, at full weight, because it is
    // the biggest sound here.
    if (isBreach) beats.push({ at: attackMs, play: () => retroAudio.playBreachBloom() });
        // The jail act: the cell, heard ON the slam rather than 191 ms before it. That is 1121 ms of a
    // pair card, 2021 of a wall's (its act is 900 longer) and 3421 of a breach (the cloud on top of
    // the beat); `jailStartMs` carries all three, so the slam cannot drift from the bars.
    beats.push({ at: jailStartMs + CAGE_LAND_IN_JAIL_MS, play: () => retroAudio.playCageSlam() });

    const timers = beats.map(({ at, play }) => window.setTimeout(play, at));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [attackMs, isWall, attackerWon, isBreach, layers, jailStartMs]);

  return (
    <svg
      aria-hidden='true'
      viewBox={viewBox}
      width='100%'
      height='100%'
      style={{ display: 'block', overflow: 'hidden', pointerEvents: 'none' }}
    >
      {/* ── the attack act, on a wall: its defenders, the dome over them, and the
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

          {/* the defenders: `n` glyphs on the cast's own diagonal, the front-most — lowest
              and right-most, nearest the attacker — first, each further one up, left and
              smaller, overlapping the one in front (25.3 rule 1). The struck defender fades
              as its line goes: one defender, one line, always together (rule 4). Every one
              of them looks right, at the attacker, because that is the seat the shot comes
              from and a wall faces the thing that hit it. */}
          {wallBoxes.map(({ x, y, size }, i) => (
            <CastPiece
              key={`defender-${i}`}
              x={x}
              y={y}
              size={size}
              color={defender}
              retro70={isRetro70}
              pose='right'
              style={
                attackerWon && i === 0
                  ? { animation: wallFx('fxDefenderFade') }
                  : undefined
              }
            />
          ))}

          {/* the dome: `n` of the four frozen rings, the innermost `n`, so the one fitted
              to the ink is always drawn and the shield hugs the group it protects. The
              strokes run the other way from the old curves, 2.2 inside to 3.2 out, so the
              outermost ring — both the face the shot meets and the line that glitches out
              when a defender is taken (rules 3 and 4) — is the heaviest of them. All of them
              paint in front of the glyphs, because an enclosing curve never crosses one; the
              count reads twice: `n` glyphs and `n` rings. The group carries the beat: the
              whole dome takes the blow and settles, because the blow is the shield's, and the
              face's own glitch (a transform on the path) travels with it (32.4). */}
          <g style={domeBeat}>
            {DOME_RADII.slice(0, wallLayers).map((r, i) => {
              const isFace = i === wallLayers - 1;
              return (
                <path
                  key={`dome-${i}`}
                  d={shieldCurve(r)}
                  fill='none'
                  stroke={defenderColor}
                  strokeOpacity={isFace ? 1 : 0.55}
                  strokeWidth={DOME_STROKES[i]}
                  style={
                    isFace && attackerWon
                      ? ({
                          ...pivot,
                          '--g1': '5px',
                          '--g2': '-6px',
                          animation: wallFx('fxLayerOut'),
                        } as CSSProperties)
                      : undefined
                  }
                />
              );
            })}
          </g>

          {/* the attacker, in frame, on the ground and outside the dome: the reflected
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
          one line at `STRIKE_Y`. It is clipped to the lane between the two pieces, so the
          slide is revealed at the shooter's front face instead of painted behind him. */}
      <defs>
        <clipPath id={beamClipId}>
          <rect x={beamClipX} y={STRIKE_Y - 12} width={Math.max(10, beamClipW)} height='24' />
        </clipPath>
      </defs>
      <g
        clipPath={`url(#${beamClipId})`}
        style={{ animation: fx('fxBeam'), '--beamFrom': beamEntry } as CSSProperties}
      >
        <rect x={beamX} y={STRIKE_Y - 3} width={Math.max(10, beamW)} height='6' rx='3' fill={winnerColor} />
        <rect x={hotX} y={STRIKE_Y - 5} width='14' height='10' rx='4' fill='#ffffff' opacity='.7' />
      </g>

      {/* where it lands: the puncture star blooms on the piece the shot met — the defender's
          flank on a 1v1 capture, the dome's face on a wall, the attacker himself on
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
        <g transform={`translate(${DOME_CX} ${GROUND_Y})`} style={cloudGate}>
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

