#!/usr/bin/env node
/**
 * dice-model.mjs — Randomness model for the fixbugs ludo-engine dice roll.
 *
 * Production formula (engine.ts rollDice):
 *
 *   rand = seededRand(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
 *   roll = Math.floor(rand() * 6) + 1
 *
 * Each roll = f(u) where u is a single ~U[0,1) draw from a mulberry32 PRNG
 * freshly seeded by Math.random() (scaled to a large integer range).
 *
 * Mathematical model
 * ------------------
 *   u is uniform on [0,1). roll = floor(6u) + 1, so:
 *
 *     P(face v) = P((v−1)/6 ≤ u < v/6) = width of interval = 1/6   ∀ v ∈ {1..6}
 *
 *   i.e. a perfectly uniform (fair) die: P(v) = 1/6 for every face,
 *   entropy H = log2(6) ≈ 2.585 bits — the maximum possible for a d6.
 *
 * For reference, the previous formula averaged two draws:
 *     floor(((rand() + rand()) / 2) * 6) + 1
 *   which produced a triangular distribution
 *   (P = 1/18, 1/6, 5/18, 5/18, 1/6, 1/18) with H ≈ 2.352 bits (−9% entropy).
 *   It is kept below as "previous formula" for comparison.
 *
 * Run:  node test/dice-model.mjs   (from backend/app/ludo-engine)
 */

// ── Production PRNG + rolls (must mirror engine.ts exactly) ───────────────
function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Current production roll: single draw → uniform 1..6. */
function roll() {
  const rand = seededRand(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  return Math.floor(rand() * 6) + 1;
}

/** Previous formula: two draws averaged → triangular distribution. */
function rollOldAveraging() {
  const rand = seededRand(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  return Math.floor(((rand() + rand()) / 2) * 6) + 1;
}

// ── Analytical model ───────────────────────────────────────────────────────
const faces = [1, 2, 3, 4, 5, 6];
const FAIR = 1 / 6;
const theoryOld = { 1: 1 / 18, 2: 1 / 6, 3: 5 / 18, 4: 5 / 18, 5: 1 / 6, 6: 1 / 18 };

// Entropy H = −Σ p·log2(p): "how much randomness is actually in the die".
const entropy = (probs) => -probs.reduce((sum, p) => sum + p * Math.log2(p), 0);
const H_FAIR = entropy(faces.map(() => FAIR));
const H_OLD = entropy(faces.map((v) => theoryOld[v]));

// ── Empirical simulation of the production formula ─────────────────────────
const N = 1_000_000;
const counts = Object.fromEntries(faces.map((v) => [v, 0]));
const countsOld = Object.fromEntries(faces.map((v) => [v, 0]));
for (let i = 0; i < N; i++) counts[roll()]++;
for (let i = 0; i < N; i++) countsOld[rollOldAveraging()]++;

const chi2 = faces.reduce((sum, v) => sum + ((counts[v] - N * FAIR) ** 2) / (N * FAIR), 0);
const chi2Old = faces.reduce((sum, v) => sum + ((countsOld[v] - N * theoryOld[v]) ** 2) / (N * theoryOld[v]), 0);

// ── Report ─────────────────────────────────────────────────────────────────
console.log('DICE ROLL RANDOMNESS MODEL — fixbugs ludo-engine');
console.log('─────────────────────────────────────────────────────────────');
console.log('formula (current) : floor(rand() * 6) + 1             (single draw)');
console.log('formula (previous): floor(((rand()+rand())/2)*6)+1    (two draws averaged)\n');

console.log(' face |  theory  | empirical | deviation | previous formula |');
console.log('------+----------+-----------+-----------+------------------+');
for (const v of faces) {
  const obs = counts[v] / N;
  const obsOld = countsOld[v] / N;
  const dev = ((obs - FAIR) / FAIR) * 100;
  console.log(
    `   ${v}  | 1/6 = ${FAIR.toFixed(4)} |  ${obs.toFixed(4)}  | ${dev >= 0 ? '+' : ''}${dev.toFixed(2)}% | ${obsOld.toFixed(4)} (theory ${theoryOld[v].toFixed(4)}) |`,
  );
}

console.log('\nChi-square (current,  5 dof):', chi2.toFixed(2), '(99% critical value = 15.086)');
console.log('  →', chi2 < 15.086 ? 'CONSISTENT ✅  fair die' : 'MISMATCH ❌');
console.log('Chi-square (previous, 5 dof):', chi2Old.toFixed(2), '(99% critical value = 15.086)');
console.log('  →', chi2Old < 15.086 ? 'CONSISTENT ✅  triangular' : 'MISMATCH ❌');

console.log('\nEntropy comparison');
console.log('  current  : H =', H_FAIR.toFixed(4), 'bits  (theoretical maximum log2(6) =', H_FAIR.toFixed(4), ')');
console.log('  previous : H =', H_OLD.toFixed(4), 'bits  (−' + ((1 - H_OLD / H_FAIR) * 100).toFixed(1) + '% vs fair)');

console.log('\nVerdict: the single-draw formula restores a perfectly fair die.');
