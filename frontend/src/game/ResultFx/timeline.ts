import { retroAudio } from '../../utils/audio';
import { CAGE_LAND_IN_JAIL_MS, IMPACT_AT_MS, PUNCTURE_GAP_MS, PUNCTURE_PEAK_AT_MS, SUBTRACT_AT_MS } from './keyframes';

export type ResultFxBeat = { at: number; play: () => void };

export function resultFxBeats({
  isWall,
  attackerWon,
  layers,
  isBreach,
  attackMs,
  jailStartMs,
}: {
  isWall: boolean;
  attackerWon: boolean;
  layers: number;
  isBreach: boolean;
  attackMs: number;
  jailStartMs: number;
}): ResultFxBeat[] {
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
  return beats;
}
