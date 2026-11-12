// Census of colour literals under src, for section 33 step 2 (the sweep).
// Prints distinct values with counts and files, and groups hexes by hue so a
// "family" can be sized before a pass starts. Not a gate: a lens.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? 'src';
const skip = new Set(['__shared__', 'node_modules']);
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(tsx?|css)$/.test(entry)) files.push(full);
  }
})(root);

const agg = new Map();
const bump = (key, rel) => {
  const row = agg.get(key) ?? { n: 0, files: new Map() };
  row.n += 1;
  row.files.set(rel, (row.files.get(rel) ?? 0) + 1);
  agg.set(key, row);
};

for (const full of files) {
  const rel = path.relative(root, full);
  for (const line of readFileSync(full, 'utf8').split('\n')) {
    for (const m of line.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) bump(m[0].toLowerCase(), rel);
    for (const m of line.matchAll(/rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*[,)]/g))
      bump('rgb(' + m[0].replace(/rgba?\(\s*/, '').replace(/[\s)]/g, '').replace(/,$/, '') + ')', rel);
  }
}

const hsl = (hex) => {
  const h = hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex.slice(0, 7);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  return { h: Math.round(hue), s: Math.round(s * 100), l: Math.round(l * 100), full: h };
};

const band = ({ h, s, l }) => {
  if (l <= 12) return 'ink (l<=12)';
  if (l >= 92) return 'white (l>=92)';
  if (s <= 12) return `grey s${s} l${l}`;
  if (h < 20 || h >= 345) return s < 45 && l < 25 ? 'ink-red' : 'red';
  if (h < 45) return 'amber/yellow';
  if (h < 70) return 'lime';
  if (h < 165) return 'green/cyan';
  if (h < 200) return 'cyan';
  if (h < 260) return 'blue/indigo';
  if (h < 300) return 'purple/magenta';
  return 'pink';
};

const rows = [...agg.entries()]
  .map(([key, row]) => {
    const hex = key.startsWith('rgb(') ? null : key;
    const info = hex ? hsl(hex) : null;
    return { key, ...row, info, band: info ? band(info) : 'rgb() form' };
  })
  .sort((a, b) => b.n - a.n);

const group = process.argv.includes('--groups');
if (group) {
  const groups = new Map();
  for (const row of rows) {
    const list = groups.get(row.band) ?? [];
    list.push(row);
    groups.set(row.band, list);
  }
  for (const [name, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const distinct = list.length;
    const total = list.reduce((sum, r) => sum + r.n, 0);
    const fileCount = new Set(list.flatMap((r) => [...r.files.keys()])).size;
    console.log(`\n## ${name}: ${distinct} distinct, ${total} occurrences, ${fileCount} file(s)`);
    for (const row of list.slice(0, 14))
      console.log(
        `  ${row.key.padEnd(24)} x${String(row.n).padStart(3)}  ${[...row.files.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 4)
          .map(([f, c]) => `${f}(${c})`)
          .join(' ')}`,
      );
    if (list.length > 14) console.log(`  ... ${list.length - 14} more`);
  }
} else {
  for (const row of rows)
    console.log(
      `${row.key.padEnd(26)} ${String(row.n).padStart(4)}  ${row.band.padEnd(16)} ${[...row.files.keys()]
        .slice(0, 5)
        .join(' ')}`,
    );
  console.log(`\n${agg.size} distinct literal value(s) across ${files.length} file(s)`);
}
