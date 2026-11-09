#!/usr/bin/env node
// The sweep, kept swept (todo.md section 27): fails on a theme colour spelled as a
// literal anywhere under `src` outside the inventory below. A literal survives only
// where it IS the thing — a seat hue, a mode's ticket or badge, the hero art, the
// theme swatch, the token block itself — never where it paints a surface.
//
// `prebuild` and `lint` both run it, so `npm run build` cannot regress the sweep.
// Modes: no flags for the gate; `--list` prints the inventory without checking.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(treeRoot, 'src');
const EXTS = new Set(['.ts', '.tsx', '.css']);
// Generated from `common/src` by `sync-shared.mjs`: never audited, never edited here.
const SKIP_DIRS = new Set(['__shared__']);

// One row per swept colour. The array exists because the guard is meant to grow: the
// three accents and the state pair join it as their own passes land, and until then
// their literals are out of scope rather than silently allowed.
const SWEPT = [
  {
    token: '--accent-yellow',
    // The 80s value, the 70s value, the rgba form at both themes' numbers, and the
    // space-separated channel form, which is the shape a components-level tint takes.
    forms: [
      /#ffe600/gi,
      /#ffb000/gi,
      /rgba\(\s*255\s*,\s*(?:230|176)\s*,\s*0\s*,/gi,
      /rgb\(\s*255\s+(?:230|176)\s+0\b/gi,
    ],
  },
];

// The inventory: every literal the sweep keeps on purpose, one entry per file and
// trimmed line, with the count that file carries. `why` is the reason a reader gets
// when the entry goes stale, so the fix is obvious without reading this file's history.
const INVENTORY = {
  'game/pieceParts.ts': [
    { line: "blue: '#ffb000',", count: 1, why: 'the 70s piece accent, art not paint' },
  ],
  'heroBackdrops.ts': [{ line: "amber: '#ffb000',", count: 1, why: 'the 70s backdrop palette' }],
  'heroScenes.ts': [
    { line: "c1: 'rgba(255, 230, 0, 0.72)',", count: 1, why: 'the hero art, a painted scene' },
    { line: "{ label: 'YELLOW', color: '#ffe600', x: 490, y: 360 },", count: 1, why: 'the hero art' },
    { line: "{ label: 'YELLOW', color: '#ffe600', x: 470 },", count: 1, why: 'the hero art' },
    { line: "marqueeColor: '#ffb000',", count: 1, why: 'the hero art' },
  ],
  'pages/Game.tsx': [
    { line: "yellow: '#ffe600',", count: 1, why: 'SEAT_HUES: colour is the seat' },
    { line: "? '#ffe600'", count: 2, why: 'the two seat-hue maps, colorAccent and dotColor' },
  ],
  'pages/Lobby.tsx': [{ line: "yellow: '#ffe600',", count: 1, why: 'COL: colour is the seat' }],
  'pages/LudoLobby.tsx': [
    {
      line: "{ key: 'freeExit', icon: '🚪', label: 'game.freeExit', hue: '#ffe600' },",
      count: 1,
      why: 'ROOM_MODES: a mode colour is its name',
    },
    {
      line: "? '#ffe600'",
      count: 1,
      why: 'the room badge hues, whose pink, green and cyan siblings are literal too',
    },
    { line: "background: 'rgba(255, 230, 0, 0.24)',", count: 1, why: 'the level-2 ticket, kept whole with TICKET_YELLOW' },
    { line: "border: '1.5px solid #ffe600',", count: 2, why: 'the level-2 ticket and its launch pill' },
    { line: "color: '#ffe600',", count: 2, why: 'the level-2 ticket and its launch pill' },
    { line: "boxShadow: '0 0 12px rgba(255, 230, 0, 0.3)',", count: 1, why: 'the level-2 ticket' },
    { line: "borderRight: '2px dashed rgba(255, 230, 0, 0.45)',", count: 1, why: 'the level-2 ticket divider' },
    { line: "background: 'rgba(255, 230, 0, 0.22)',", count: 1, why: 'the level-2 launch pill' },
    { line: "boxShadow: '0 0 16px rgba(255, 230, 0, 0.4)',", count: 1, why: 'the level-2 launch pill' },
  ],
  'pages/Profile.tsx': [{ line: "YELLOW: '#ffe600',", count: 1, why: 'SEAT_COLOR: colour is the seat' }],
  'store.tsx': [
    {
      line: "{ id: 'retro70', label: \"RETRO 70'S\", swatch: ['#e5340b', '#ffb000'] },",
      count: 1,
      why: 'the theme row swatch, a picture of the palette',
    },
  ],
  'styles/retrowave.css': [
    { line: '--accent-yellow: #ffe600;', count: 1, why: 'the 80s token definition' },
    { line: '--accent-yellow: #ffb000;', count: 1, why: 'the 70s token definition' },
    {
      line: '--box-shadow: 0 0 15px rgba(229, 52, 11, 0.45), inset 0 0 15px rgba(255, 176, 0, 0.2);',
      count: 1,
      why: 'the 70s token block',
    },
    { line: '--grid-line-color: rgba(255, 176, 0, 0.28);', count: 1, why: 'the 70s token block' },
    { line: '--btn-hover-shadow: 0 0 20px #ffb000, 0 0 35px #e5340b;', count: 1, why: 'the 70s token block' },
    { line: '--window-header-bg: linear-gradient(90deg, #e5340b, #ffb000);', count: 1, why: 'the 70s token block' },
    { line: '--start-overlay-glow: rgba(255, 176, 0, 0.35);', count: 1, why: 'the 70s token block' },
  ],
  'styles/tw.ts': [
    {
      line: "'bg-[linear-gradient(90deg,rgba(255,230,0,.2)_0%,rgba(20,6,42,.96)_100%)] border-2 border-[#ffe600] shadow-[0_4px_20px_rgba(0,0,0,.6),0_0_16px_rgba(255,230,0,.22)] hover:border-[#ffff33] hover:bg-[linear-gradient(90deg,rgba(255,230,0,.3)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgba(0,0,0,.75),0_0_28px_rgba(255,230,0,.5),inset_0_0_16px_rgba(255,230,0,.18)]';",
      count: 6,
      why: 'TICKET_YELLOW: the amber ticket, kept whole with its siblings',
    },
  ],
  'theme.ts': [{ line: "yellow: { base: '#ffe600' },", count: 1, why: 'the seat palette' }],
};

if (!readdirSync(treeRoot).includes('src')) {
  console.error('check-theme-literals: no src beside scripts/, run it from the frontend tree');
  process.exit(2);
}

if (process.argv.includes('--list')) {
  for (const [file, entries] of Object.entries(INVENTORY)) {
    for (const entry of entries) console.log(`${file} x${entry.count}  ${entry.why}\n  ${entry.line}`);
  }
  process.exit(0);
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
    } else if (EXTS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
})(sourceRoot);

const found = [];
for (const full of files.sort()) {
  const rel = path.relative(sourceRoot, full).split(path.sep).join('/');
  readFileSync(full, 'utf8')
    .split('\n')
    .forEach((raw, i) => {
      // A comment that names a colour is documentation, not a reader of it.
      if (/^\s*(\/\/|\*|\/\*)/.test(raw)) return;
      const line = raw.trim();
      for (const swept of SWEPT) {
        for (const form of swept.forms) {
          form.lastIndex = 0;
          let match;
          while ((match = form.exec(line))) {
            const before = line.slice(0, match.index);
            // `var(--accent-yellow, #ffe600)` is the sanctioned form: a token read
            // with a fallback, not a literal standing in for one.
            if (/var\(--[a-z-]+,\s*$/.test(before)) continue;
            found.push({ file: rel, line: i + 1, text: line, token: swept.token, literal: match[0] });
          }
        }
      }
    });
}

const counts = new Map();
for (const hit of found) {
  const key = `${hit.file}\u0000${hit.text}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

const unexpected = found.filter(
  (hit) => !(INVENTORY[hit.file] ?? []).some((entry) => entry.line === hit.text),
);

const stale = [];
for (const [file, entries] of Object.entries(INVENTORY)) {
  for (const entry of entries) {
    const actual = counts.get(`${file}\u0000${entry.line}`) ?? 0;
    if (actual !== entry.count) stale.push({ file, entry, actual });
  }
}

const forms = new Set(found.map((hit) => hit.literal)).size;
if (unexpected.length === 0 && stale.length === 0) {
  console.log(
    `check-theme-literals: ${SWEPT.length} swept colour(s), ${found.length} kept literals, all on the inventory`,
  );
  process.exit(0);
}

console.error('check-theme-literals: the sweep regressed');
for (const hit of unexpected) {
  console.error(`  ${hit.file}:${hit.line}  ${hit.literal}  read ${hit.token} instead`);
  console.error(`    ${hit.text.slice(0, 100)}`);
}
for (const s of stale) {
  console.error(`  ${s.file}  inventory expects ${s.entry.count}, found ${s.actual}  ${s.entry.why}`);
  console.error(`    ${s.entry.line.slice(0, 100)}`);
}
console.error(
  `\n${unexpected.length} unexpected literal(s), ${stale.length} stale inventor(ies), ${forms} distinct literal form(s) in play.`,
);
process.exit(1);

