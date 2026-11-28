import {
  SCENE_ATTACK_MS,
  SCENE_CLOUD_MS,
  SCENE_JAIL_MS,
  SCENE_WALL_ATTACK_MS,
} from '../../__shared__/timing.constants';

// The cell's two beats, in the JAIL act's own clock.
export const CAGE_START_IN_JAIL_MS = 136;
export const CAGE_LAND_IN_JAIL_MS = 421;
// The cell's half-width: 26 x 36 / 33, the old half-width carried along with the box it
// encloses, so the cell still closes on the piece with the margin it had.
export const CAGE_HALF = 28.4;
// How far the cell travels: its own width, so it starts clear of the piece it closes on.
export const CAGE_TRAVEL_PX = CAGE_HALF * 2;
// The beam starts a full stage clear of its own tail, on the shooter's side.
export const BEAM_TRAVEL_PX = 150;

// The attack act's beats, in ms from its own start, shared by the keyframes below and by 25.5's
// soundtrack so the sound cannot drift from the drawing: the beam lands at 247, the star blooms
// where it lands and peaks at 323, and the line starts glitching at 418.
export const BEAM_LAND_AT_MS = 247;
export const PUNCTURE_PEAK_AT_MS = 323;
export const SUBTRACT_AT_MS = 418;
export const IMPACT_AT_MS = 260; // the puncture, a beat after the beam arrives
// One puncture per layer, 40 ms apart, so a three-line wall is heard as three.
export const PUNCTURE_GAP_MS = 40;

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
export const CLOUD_TEXT_LEAD_MS = 400;

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

export function ensureKeyframes() {
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
