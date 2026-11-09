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
 * The cast never changes: both pieces are drawn whichever way the round went, because a
 * clip stops being one clip if the cast changes. The winner always fires and the bars
 * always follow the winning blow's vector, which is why no card can turn its cell the
 * wrong way, and why a capture reads as one sweep repeated: a shot, then a cell.
 *
 * `kind` chooses only whose colour is on the ink. `n` is a wall's layer count, and a wall's
 * defender is its shield rather than a single piece, so a wall draws the attacker with the
 * curves over the defenders.
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
// wall's flare peaks at the star's own peak, and a breach's cloud opens where the act ends.
const BEAM_LAND_AT_MS = 247;
const PUNCTURE_PEAK_AT_MS = 323;
const SUBTRACT_AT_MS = 418;
const IMPACT_AT_MS = 260; // the puncture, a beat after the beam arrives
const FALL_AT_MS = SCENE_ATTACK_MS; // the attack's last frame: the cloud's first
// One puncture per layer, 40 ms apart, so a three-line wall is heard as three.
const PUNCTURE_GAP_MS = 40;

// The keyframes are written in milliseconds and converted here, so a beat reads as its
// instant instead of a percentage somebody has to divide by 19 in their head. Each act's
// percentages are of that act: the attack's 700 and the jail's 1200.
const aPct = (ms: number) => +((ms / SCENE_ATTACK_MS) * 100).toFixed(2);
const jPct = (ms: number) => +((ms / SCENE_JAIL_MS) * 100).toFixed(2);

// The keyframes, injected once for however many cards render them. No duration is written
// in here: `fx()` and `jailFx()` build each `animation` string from the act that owns the
// element, so nothing can play past the act it belongs to. The read window is the one
// exception: it follows the scene and is built by `readFx()`, which takes its start.
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
      /* a layer glitches TWICE and goes out — no fade-through, no hard cut (418-700). */
      @keyframes fxLayerOut {
        0%, ${aPct(SUBTRACT_AT_MS)}%  { transform: translateX(0); opacity: 1; }
        ${aPct(475)}%    { transform: translateX(var(--g1)); opacity: .25; }
        ${aPct(532)}%    { transform: translateX(0); opacity: 1; }
        ${aPct(589)}%    { transform: translateX(var(--g2)); opacity: .25; }
        ${aPct(646)}%    { transform: translateX(0); opacity: .55; }
        ${aPct(SCENE_ATTACK_MS)}% { transform: translateX(0); opacity: 0; }
      }
      /* the last layer collapses into the cloud (total breach, 418-700). */
      @keyframes fxLayerCollapse {
        0%, ${aPct(SUBTRACT_AT_MS)}% { transform: scale(1); opacity: 1; }
        ${aPct(570)}%     { transform: scale(1.04); opacity: .7; }
        ${aPct(SCENE_ATTACK_MS)}% { transform: scale(.55); opacity: 0; }
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
// One viewBox for every round: the largest dome (four layers) plus a banner row,
// computed once so neither the bloom nor the collapse resizes the stage.
const VB_W = 240;
const VB_H = 180;
const DOME_CX = 150;
const DOME_BASE_Y = 120;
// inner → outer. A four-layer dome is the maximum drawn, so a five-defender wall
// still reads as four rings (the spec's four-layer dome).
const LAYER_R = [26, 42, 56, 70];
const MAX_LAYERS = LAYER_R.length;
const BANNER_Y = 162;
// The bloom is capped at 0.85 of the four-layer dome's width, so it reads as a burst
// over the wall and never as a second wall.
const BLOOM_R = Math.round(0.85 * LAYER_R[MAX_LAYERS - 1]); // ~60
const ONE_ON_ONE_PIECE_X = DOME_CX;
const ONE_ON_ONE_PIECE_Y = 84;
// The cast: the DEFENDER on the left and the ATTACKER on the right, one line for both,
// never swapped on any card or in any act (25.3 rule 1) — which is what makes a chain's
// rounds read as one continuous shot. `PIECE_W` is the glyph's own 11 units at the scale
// the card draws it.
const GLYPH_SCALE = 3;
const PIECE_W = 11 * GLYPH_SCALE; // 33
const DEFENDER_GLYPH_X = 8;
const ATTACKER_GLYPH_X = ONE_ON_ONE_PIECE_X - 16; // 134, the defender's old place
const GLYPH_Y = ONE_ON_ONE_PIECE_Y - 12; // 72
// The widest x BOTH cards can show: the flash window's own width. A mark drawn past it
// would be cut on the small card and kept on the big one, which is the one difference
// the two cards are not allowed to have (25.18).
const SHARED_X_MAX = 192;

// The clash stage's own cap, read by `ClashOverlay` so the two cards cannot drift apart.
export const CLASH_STAGE_MAX_PX = 420;
// The flash card is the clash stage at 0.8: the same 4:3 and the same pixels per unit
// (420 / 240 = 336 / 192 = 1.75), showing the side of the frame both pieces stand on.
// 192 x 144 is 0.8 of the stage in BOTH directions, and the cell's own box (y 54-120)
// sits dead centre in the 144 units it shows — 39 above, 39 below.
export const FLASH_CARD_STAGE_MAX_PX = 336;
export const FLASH_CARD_VIEWBOX = '0 15 192 144';
export const FLASH_CARD_ASPECT = 192 / 144;

// An eight-point star, centred on the impact, for the puncture flash.
const starAt = (cx: number, cy: number, r = 9) =>
  `M ${cx} ${cy - r} L ${cx + r * 0.28} ${cy - r * 0.28} L ${cx + r} ${cy} ` +
  `L ${cx + r * 0.28} ${cy + r * 0.28} L ${cx} ${cy + r} L ${cx - r * 0.28} ${cy + r * 0.28} ` +
  `L ${cx - r} ${cy} L ${cx - r * 0.28} ${cy - r * 0.28} Z`;


/**
 * The result card's animation stage: one fixed stage, played alongside the text rather
 * than before it. `attacker` and `defender` are the round's two seats, and the winner's
 * colour is on every mark — the beam, the strike and the bars — so the picture says who
 * won without a word, and the loser is always the piece inside the cell. `n` is the layer
 * count (remaining defenders + 1); `totalRounds > 1` says the square is a wall, and gates
 * the bloom and the `banner` to the total breach. Cosmetics only: no input, `aria-hidden`,
 * and every act is one switch — the room's `captureFx` — so nothing here reads the OS.
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
  // The bloom is the one mark whose act (the cloud) is still a separate commit; it keeps
  // the scene's clock until that act lands, so no pixel of the wall moves in the passing.
  const sceneFx = (name: string) => `${name} ${RESULT_FX_MS}ms ease-out both`;
  const readFx = (name: string, startMs: number) =>
    `${name} ${RESULT_HEADLINE_READ_MS}ms ease-out ${startMs}ms both`;
  // SVG shapes need their own box for `transform-origin` to mean anything.
  const pivot: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };

  const total = Math.max(1, Math.trunc(totalRounds) || 1);
  const isWall = total > 1;
  const layers = Math.min(Math.max(1, Math.trunc(n) || 1), MAX_LAYERS);
  // A single-defender round is piece-level in EITHER direction: two glyphs, no dome.
  const isPieceLevel = !isWall;
  const isBreach = attackerWon && isWall && layers === 1;
  // A wall's defender is its dome, so the loser is the dome on a capture (the wall is
  // being broken) and the attacker on a repulse (the wall stood).
  const loserIsDome = isWall && attackerWon;
  const domeCount = !isWall ? 0 : attackerWon ? layers : Math.min(total, MAX_LAYERS);
  const outerR = LAYER_R[Math.max(0, domeCount - 1)];
  const arc = (r: number) =>
    `M ${DOME_CX - r} ${DOME_BASE_Y} A ${r} ${r} 0 0 1 ${DOME_CX + r} ${DOME_BASE_Y}`;

  // The strike: from the winner's front face to the loser's, both pieces on one line. The
  // tail sits 6 units inside the shooter's glyph, so the beam leaves a piece instead of
  // crossing an empty lane (25.17 item 2). The front face is the attacker's LEFT and the
  // defender's RIGHT, now that the defender holds the left seat; on a wall the shot starts
  // at the shield's outer face instead, because the shield is the defender.
  const BEAM_INSET = 6;
  const domeFlankX = Math.round(DOME_CX - Math.SQRT1_2 * outerR);
  const domeFlankY = Math.round(DOME_BASE_Y - Math.SQRT1_2 * outerR);
  const beamFrom = attackerWon
    ? ATTACKER_GLYPH_X + BEAM_INSET // 140: the attacker's front face, its left
    : isWall
      ? domeFlankX
      : DEFENDER_GLYPH_X + PIECE_W - BEAM_INSET; // 35: the defender's front face, its right
  const impactX = attackerWon
    ? isWall
      ? domeFlankX
      : DEFENDER_GLYPH_X + PIECE_W // 41: the defender's right flank
    : ATTACKER_GLYPH_X; // 134: the attacker's left flank
  const impactY = loserIsDome ? domeFlankY : ONE_ON_ONE_PIECE_Y;
  const beamX = Math.min(beamFrom, impactX);
  const beamW = Math.abs(impactX - beamFrom);
  // The white-hot head sits 12 units back toward the shooter on a capture — to the right,
  // where the attacker stands — and 2 units inside the struck piece on a repulse, which is
  // the same relationship the shot had before the pair was mirrored.
  const hotX = attackerWon ? impactX + 12 : impactX + 2;

  // The cell: it closes on the LOSER, whatever the loser is — the defender's glyph on a
  // capture (left seat), the attacker's on a repulse (right seat), the shield on a wall
  // capture (the wall is being broken) — and its centre is the loser's own, so the bars
  // follow the winning blow's vector (25.3 rule 3).
  const cageBars = 5;
  const defenderCx = DEFENDER_GLYPH_X + PIECE_W / 2; // 24.5
  const attackerCx = ATTACKER_GLYPH_X + PIECE_W / 2; // 150.5
  const loserCx = loserIsDome ? DOME_CX : attackerWon ? defenderCx : attackerCx;
  const cageHalf = loserIsDome ? outerR + 6 : 26;
  // Both edges are clamped into the window the two cards share: the left one, because the
  // defender's cell (centre 24.5, half-width 26) would otherwise start at -1.5 and be cut
  // by the stage's edge, and the right one against `SHARED_X_MAX` 192, so the flash card
  // can never crop a cell the clash card keeps (D35). A wall's cell is centred on the
  // shield and only ever plays on the clash card, so it keeps its own place.
  const cageCx = loserIsDome
    ? DOME_CX
    : Math.min(SHARED_X_MAX - cageHalf, Math.max(cageHalf, loserCx));
  const cageTopY = loserIsDome ? DOME_BASE_Y - outerR - 6 : ONE_ON_ONE_PIECE_Y - 30;
  const cageH = DOME_BASE_Y - cageTopY;
  // The bars start on the winner's side and travel away from it: right to left on a
  // capture (the attacker is on the right), left to right on a repulse — the same vector
  // as the beam, so the card reads as one sweep repeated.
  const cageFrom = `${attackerWon ? CAGE_TRAVEL_PX : -CAGE_TRAVEL_PX}px`;
  const beamEntry = `${attackerWon ? BEAM_TRAVEL_PX : -BEAM_TRAVEL_PX}px`;
  // The floor. A wall's is the stage's own width (a dome is wider than any window); a
  // piece-level one is the cell's, and it stops at x 192, the widest both cards can show,
  // so the flash card never cuts a mark the clash card keeps.
  const floorX1 = isPieceLevel
    ? Math.max(0, cageCx - cageHalf - 16)
    : DOME_CX - LAYER_R[MAX_LAYERS - 1] - 18;
  const floorX2 = isPieceLevel
    ? Math.min(SHARED_X_MAX, cageCx + cageHalf + 16)
    : DOME_CX + LAYER_R[MAX_LAYERS - 1] + 18;

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
    // The cloud act: only a total breach falls all the way.
    if (isBreach) beats.push({ at: FALL_AT_MS, play: () => retroAudio.playBreachBloom() });
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
      {/* the floor the loser stands on */}
      <line
        x1={floorX1}
        y1={DOME_BASE_Y}
        x2={floorX2}
        y2={DOME_BASE_Y}
        stroke={isPieceLevel ? loserColor : defenderColor}
        strokeOpacity='.22'
        strokeWidth='2'
      />

      {/* a wall: its shrinking rings. A repulse leaves all of them standing, because the
          wall is the defender and the defender won. */}
      {isWall &&
        Array.from({ length: domeCount }, (_, i) => {
          const r = LAYER_R[i];
          const isTopLayer = attackerWon && i === domeCount - 1;
          const anim = !isTopLayer ? undefined : isBreach ? fx('fxLayerCollapse') : fx('fxLayerOut');
          return (
            <path
              key={`dome-${r}`}
              d={arc(r)}
              fill='none'
              stroke={defenderColor}
              strokeOpacity={isTopLayer ? 1 : 0.55}
              strokeWidth={isTopLayer ? 5 : 3}
              style={
                isTopLayer
                  ? ({ ...pivot, '--g1': '5px', '--g2': '-6px', animation: anim } as CSSProperties)
                  : undefined
              }
            />
          );
        })}


      {/* the cast, at the same two places whichever seat won: the defender on the left,
          the attacker on the right. A clip stops being one clip if the cast changes, so
          neither piece is gated on the outcome (25.17 item 2). A wall's defender is its
          shield, so only the curves are drawn for it above.

          Two renderings of the same cast: the invader glyph stamped to `PIECE_W`, or the
          70s figure from `game/pieceParts.ts` filling the same 33-unit box. The box is
          the contract — the beam's inset is measured from its edge, so neither drawing
          can move the strike. */}
      {isRetro70 ? (
        <>
          <g transform={`translate(${ATTACKER_GLYPH_X} ${GLYPH_Y}) scale(${PIECE_W / 100})`}>
            <PieceFigure ck={attacker} />
          </g>
          {isPieceLevel && (
            <g transform={`translate(${DEFENDER_GLYPH_X} ${GLYPH_Y}) scale(${PIECE_W / 100})`}>
              <PieceFigure ck={defender} />
            </g>
          )}
        </>
      ) : (
        <>
          <g
            transform={`translate(${ATTACKER_GLYPH_X} ${GLYPH_Y}) scale(${GLYPH_SCALE})`}
            shapeRendering='crispEdges'
          >
            <path
              d={PIECE_GLYPH[attacker]}
              fill='none'
              stroke='#000'
              strokeWidth='1'
              strokeLinejoin='miter'
            />
            <path d={PIECE_GLYPH[attacker]} fill={attackerColor} />
          </g>
          {isPieceLevel && (
            <g
              transform={`translate(${DEFENDER_GLYPH_X} ${GLYPH_Y}) scale(${GLYPH_SCALE})`}
              shapeRendering='crispEdges'
            >
              <path
                d={PIECE_GLYPH[defender]}
                fill='none'
                stroke='#000'
                strokeWidth='1'
                strokeLinejoin='miter'
              />
              <path d={PIECE_GLYPH[defender]} fill={defenderColor} />
            </g>
          )}
        </>
      )}

      {/* the strike lands: the field cracks under the loser. The loser itself never moves
          — it stands where it was struck until the bars close on it (25.18). */}
      {isPieceLevel && (
        <g style={{ animation: fx('fxFieldCrack') }}>
          <path
            d={`M ${loserCx - 22} ${DOME_BASE_Y} L ${loserCx - 8} ${DOME_BASE_Y - 8} L ${loserCx - 2} ${DOME_BASE_Y}`}
            fill='none'
            stroke='#e8e2ff'
            strokeOpacity='.85'
            strokeWidth='1.5'
          />
          <path
            d={`M ${loserCx + 4} ${DOME_BASE_Y} L ${loserCx + 14} ${DOME_BASE_Y - 6} L ${loserCx + 24} ${DOME_BASE_Y}`}
            fill='none'
            stroke='#e8e2ff'
            strokeOpacity='.85'
            strokeWidth='1.5'
          />
        </g>
      )}

      {/* the strike: the winner's beam, entering from the winner's own side */}
      <g style={{ animation: fx('fxBeam'), '--beamFrom': beamEntry } as CSSProperties}>
        <rect x={beamX} y={impactY - 3} width={Math.max(10, beamW)} height='6' rx='3' fill={winnerColor} />
        <rect x={hotX} y={impactY - 5} width='14' height='10' rx='4' fill='#ffffff' opacity='.7' />
      </g>

      {/* where it lands: the puncture star blooms on the loser, in the winner's colour */}
      <path
        d={starAt(impactX, impactY)}
        fill='#ffffff'
        stroke={winnerColor}
        strokeWidth='1.5'
        style={{ ...pivot, animation: fx('fxPuncture') }}
      />

      {/* the bloom: the total breach only, two rings + a cap in the winner's colour */}
      {isBreach && (
        <g transform={`translate(${impactX} ${impactY})`}>
          <circle r={BLOOM_R} fill='none' stroke={winnerColor} strokeWidth='3' style={{ ...pivot, animation: sceneFx('fxBloomRing') }} />
          <circle r={Math.round(BLOOM_R * 0.62)} fill='none' stroke='#ffffff' strokeWidth='2' style={{ ...pivot, animation: sceneFx('fxBloomRing2') }} />
          <circle r={Math.round(BLOOM_R * 0.5)} fill={winnerColor} style={{ ...pivot, animation: sceneFx('fxBloomCap') }} />
        </g>
      )}


      {/* the cell slams closed on the loser — whichever seat won, because this is the
          scene's ending — and then holds. The bars are the WINNER's colour, which is also
          why the prisoner can never be lost in them: the prisoner is the loser, so bars
          and prisoner are always two different seats. Two rects per bar, a core and a
          glow; no filter, because a filter is the one thing that costs frames here. */}
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

