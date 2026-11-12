#!/usr/bin/env node
// The shell's plate, as CSS rather than as Tailwind (todo.md section 33, step 3b).
//
// `--shell-image` is the one token whose value is a *function*: `app.css` reads it as
// `background-image`, so an invalid layer does not fall back to a missing layer, it
// drops the whole declaration and leaves `--bg-primary` behind. On 2026-11-13 the two
// tables spelled the dim `to_bottom` (the class-name form, which Tailwind translates and
// CSS does not) and put it *behind* the photograph, so `cover` hid it: the plate never
// painted, on any route, in either era, for three commits - and nothing failed, because
// a background that is missing looks exactly like a page designed without one. Only a
// screenshot caught it. This is the gate that would have.
//
// Four rules, one per way it breaks:
//   1. `to bottom`, two words. An `_` anywhere in the value is the class spelling.
//   2. The dim comes first: the first layer paints on top.
//   3. The plate comes last: a bottom layer under an opaque dim is a black page.
//   4. The file exists beside the table, so a renamed plate is caught here.
//
// Modes: no flags for the gate; `--report` prints without failing.
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES = path.join(treeRoot, 'src/styles/themes');
const REPORT_ONLY = process.argv.includes('--report');
// A dim worth the name: the 80s pair starts at .30, the 70s at .50.
const MIN_DIM = 0.25;

/** Split a value on the commas that are not inside parentheses. */
function layers(value) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

const problems = [];
const tables = readdirSync(THEMES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(THEMES, entry.name, 'theme.css'))
  .filter((file) => existsSync(file));

for (const file of tables) {
  const label = path.relative(treeRoot, file);
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [...source.matchAll(/(?<![\w-])--shell-image:\s*([^;]+);/g)];
  if (found.length !== 1) {
    problems.push(`${label}: ${found.length} --shell-image declaration(s), expected 1`);
    continue;
  }
  const value = found[0][1].trim();
  const parts = layers(value);

  // 1. The class spelling of a CSS value.
  if (value.includes('_')) {
    problems.push(`${label}: \`_\` in the value - CSS spells \`to bottom\`, Tailwind's \`_\` is for class names`);
  }
  // 2. The dim on top.
  if (parts.length < 2 || !parts[0].startsWith('linear-gradient(')) {
    problems.push(`${label}: the first layer must be the dim - the first layer paints on top, and \`cover\` hides anything under the plate`);
  } else {
    const alphas = [...parts[0].matchAll(/rgba\(([^)]*)\)/g)]
      .map((m) => Number(m[1].split(',')[3]))
      .filter((a) => Number.isFinite(a));
    if (!/(to bottom|180deg)/.test(parts[0])) {
      problems.push(`${label}: the dim should run \`to bottom\`, the way the shell reads top to bottom`);
    }
    if (alphas.length < 2 || Math.min(...alphas) < MIN_DIM) {
      problems.push(`${label}: the dim needs two stops at or above ${MIN_DIM} alpha (read ${alphas.join(', ') || 'none'})`);
    }
  }
  // 3 and 4. The plate, last, on disk.
  const plate = parts.at(-1)?.match(/^url\(['"]?\.\/([^'")]+)['"]?\)$/);
  if (!plate) {
    problems.push(`${label}: the last layer must be url('./<plate>') from the theme's own folder`);
  } else if (!existsSync(path.join(path.dirname(file), plate[1]))) {
    problems.push(`${label}: no ${plate[1]} beside the table`);
  }
}

console.log(
  `plate:   ${tables.length} theme table(s), ${tables.length - new Set(problems.map((p) => p.split(':')[0])).size} clean, ` +
    `${problems.length} problem(s)`,
);
for (const problem of problems) console.error(`  ${problem}`);

if (problems.length && !REPORT_ONLY) {
  console.error('\n`--shell-image` is read as `background-image`: one invalid layer and the whole');
  console.error('declaration is dropped, which leaves a flat `--bg-primary` and no error anywhere.');
  console.error('Keep the dim first and spelled `to bottom`, and the plate last, beside its table.');
  process.exit(1);
}
