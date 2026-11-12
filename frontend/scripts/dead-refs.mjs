#!/usr/bin/env node
// Dead references, both directions (todo.md section 33, actions D and E). The sheet's
// one failure mode is a block that outlives the component that mounted it - the
// `#color-scheme` fieldset shipped 160 lines and 15 rules for a fieldset no component
// ever rendered - and the constants file's is the mirror image: `theme.ts` carried eleven
// `CSSProperties` exports nothing imported. This finds the next of either.
//
// It reads `styles/app.css` for selectors (the only hand-kept sheet: `index.css` is an
// `@import` list, `theme-base.css` and the era tables are token declarations) and
// `styles/tw.ts` for exported constants.
//
// Modes: no flags for the gate; `--report` prints without failing.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(treeRoot, 'src');
const SHEET = path.join(srcRoot, 'styles/app.css');
const CONSTANTS = path.join(srcRoot, 'styles/tw.ts');
const EXTS = new Set(['.ts', '.tsx', '.css', '.html']);
const SKIP_DIRS = new Set(['__shared__']);
const REPORT_ONLY = process.argv.includes('--report');

// Where a name can be read from: everything under `src` except the file that declares it,
// plus the document shell.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), out);
    } else if (EXTS.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const sources = walk(srcRoot);
const readAll = (skip) =>
  [
    ...sources.filter((f) => f !== skip).map((f) => readFileSync(f, 'utf8')),
    readFileSync(path.join(treeRoot, 'index.html'), 'utf8'),
  ].join('\n');

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (haystack, name) => new RegExp(`(?<![\\w-])${escape(name)}(?![\\w-])`).test(haystack);

// 1. The sheet's selectors.
const sheet = readFileSync(SHEET, 'utf8');
const sheetHaystack = readAll(SHEET);
const stripped = sheet.replace(/\/\*[\s\S]*?\*\//g, '');
const preludes = [...stripped.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim());
const names = new Map();
for (const prelude of preludes) {
  if (/^@/.test(prelude) || !prelude) continue;
  for (const m of prelude.matchAll(/[#.]([A-Za-z_][\w-]*)/g)) {
    if (!names.has(m[1])) names.set(m[1], []);
    names.get(m[1]).push(prelude.replace(/\s+/g, ' '));
  }
}
const deadSelectors = [...names].filter(([name]) => !mentions(sheetHaystack, name));

// 2. The constants file's exports.
const tw = readFileSync(CONSTANTS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const twHaystack = readAll(CONSTANTS);
const exported = [...new Set([...tw.matchAll(/export const ([A-Za-z_][\w]*)/g)].map((m) => m[1]))];
const deadConstants = exported.filter((name) => !mentions(twHaystack, name));

// 3. Arbitrary values a space silently kills. Tailwind ends a class at whitespace, so
// `bg-[rgb(var(--bg-panel-rgb) / 0.92)]` is not a class the sheet has: it is a class
// Tailwind reads as `bg-[rgb(var(--bg-panel-rgb)` and drops. Family 2 shipped thirteen of
// those (three modal backdrops, a panel, three ticket gradients) and they painted nothing
// until family 3's compactor found them, so they are checked here: a class that names a
// value and emits no rule is a dead reference like any other.
const ARBITRARY = /(?:[a-z-]+-)?\[[^\]'"`]*\]/g;
const spaced = [];
for (const file of sources.filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))) {
  for (const match of readFileSync(file, 'utf8').matchAll(ARBITRARY)) {
    const [whole] = match;
    const content = whole.slice(whole.indexOf('[') + 1, -1);
    if (!/\s/.test(content)) continue;
    // A utility-prefixed value (`bg-[...]`), a custom property (`[--corner:...]`) or a
    // property utility (`[border:1px_solid...]`) is a class. `[HOST / PILOT]` in a
    // locale string is not: it has no prefix and no declaration.
    const prefixed = whole.startsWith('-') ? false : whole.indexOf('[') > 0;
    const isClass = prefixed || /^(?:--[a-z0-9-]+|[a-z-]+:)/i.test(content.trim());
    if (isClass) spaced.push(`${path.relative(treeRoot, file)}  ${whole.slice(0, 90)}`);
  }
}

console.log(
  `app.css: ${names.size} selectors named, ${names.size - deadSelectors.length} reachable, ` +
    `${deadSelectors.length} dead`,
);
console.log(
  `tw.ts:   ${exported.length} constants exported, ${exported.length - deadConstants.length} read, ` +
    `${deadConstants.length} dead`,
);
console.log(`classes: ${spaced.length} arbitrary value(s) carrying a space`);
for (const [name, preludesForName] of deadSelectors)
  console.error(`  dead selector: ${name}   (styled by ${[...new Set(preludesForName)].join(' | ')})`);
for (const name of deadConstants) console.error(`  dead constant: ${name}`);
for (const line of spaced) console.error(`  dead class: ${line}`);

if ((deadSelectors.length || deadConstants.length || spaced.length) && !REPORT_ONLY) {
  console.error('\nA selector no component mounts, or a constant nothing imports, is a block that');
  console.error('outlived its use. Delete it - git holds the shape - or read it.');
  console.error('An arbitrary value with a space in it is a class Tailwind drops in silence:');
  console.error('write the space as `_`, or close it up if it is inside `rgb(...)`.');
  process.exit(1);
}

