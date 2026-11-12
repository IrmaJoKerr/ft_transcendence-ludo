#!/usr/bin/env node
// The sweep, kept swept (todo.md section 27): fails on a theme colour spelled as a
// literal anywhere under `src` outside the inventory below. A literal survives only
// where it IS the thing — a seat hue, a mode's ticket or badge, the hero art, the
// theme swatch, the token block itself — never where it paints a surface.
//
// It also gates table parity (section 33): the two era tables must declare the same
// token names in the same order, because a name one table has and the other lacks
// paints as `unset` under that era and no screenshot catches it. Values are never
// compared; the eras disagree on every value on purpose.
//
// `prebuild` and `lint` both run it, so `npm run build` cannot regress the sweep.
// Modes: no flags for both gates; `--list` prints the inventory without checking.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(treeRoot, 'src');
const EXTS = new Set(['.ts', '.tsx', '.css']);
// Generated from `common/src` by `sync-shared.mjs`: never audited, never edited here.
const SKIP_DIRS = new Set(['__shared__']);

// One row per swept colour. The array exists because the guard is meant to grow: yellow,
// the ink and its shadow, and the cyan and pink accents are swept, and the purple the pink
// gradients run into plus the state pair join them as their own passes land. Until then
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
  {
    // The first family of section 33 step 2. `--ink-rgb` is the neutral every surface
    // tints with, `--shade-rgb` is the shadow under it, and `--text-main` is the ink
    // as text. A literal here is a reader that stayed cold in the 70s.
    token: '--ink-rgb / --shade-rgb / --text-main',
    forms: [
      /#(?:ffffff|fff)(?![\da-f])/gi,
      /#(?:000000|000)(?![\da-f])/gi,
      /rgba?\(\s*255\s*,\s*255\s*,\s*255\s*[,)]/gi,
      /rgba?\(\s*0\s*,\s*0\s*,\s*0\s*[,)]/gi,
      /rgb\(\s*255\s+255\s+255\b/gi,
      /rgb\(\s*0\s+0\s+0\b/gi,
      // Tailwind's own palette utilities bypass the tokens entirely, so they count.
      /\b(?:text|bg|border|divide|ring|placeholder|from|to|via)-(?:white|black)(?![-a-z])/gi,
    ],
  },
  {
    // Family 3 of section 33 step 2: the accent. The 80s value is also the blue seat,
    // so a literal here is sometimes identity rather than paint — the inventory says
    // which is which. The 70s value (`#5fb3b0`) is deliberately not a swept form: it
    // exists only as a declaration in that table, nothing in the tree spells it, and
    // sweeping it would inventory the table's own prose.
    token: '--accent-cyan / --accent-cyan-rgb',
    forms: [
      /#00f0ff/gi,
      /rgba?\(\s*0\s*,\s*240\s*,\s*255\s*[,)]/gi,
      /rgb\(\s*0\s+240\s+255\b/gi,
    ],
  },
  {
    // Family 4 of section 33 step 2: the pink accent. Its 80s value is `#ff007f`, which
    // is also the red seat, so the inventory again says which literals are identity.
    // The drifted Material pink `#ff4081` is deliberately not a form: it is how the auth
    // error and `FieldError` spell a *failure*, and the state pair owns both. `#ff3399`,
    // the ticket's hover border, is not a form either, for the same reason cyan's 70s
    // value is not: nothing outside a kept ticket spells it.
    token: '--accent-pink / --accent-pink-rgb',
    forms: [
      /#ff007f/gi,
      /rgba?\(\s*255\s*,\s*0\s*,\s*127\s*[,)]/gi,
      /rgb\(\s*255\s+0\s+127\b/gi,
    ],
  },
];

// The inventory: every literal the sweep keeps on purpose, one entry per file and
// trimmed line, with the count that file carries. `why` is the reason a reader gets
// when the entry goes stale, so the fix is obvious without reading this file's history.
const INVENTORY = {
  // Canvas and SVG painters: the colour is drawn, not read, on the line 26.6 drew for
  // the hero. A sprite's specular dot is white because it is a specular dot, and a
  // piece's shadow is black because it is a shadow on a board that is not the page.
  'game/pieceParts.ts': [
    { line: "blue: '#ffb000',", count: 1, why: 'the 70s piece accent, art not paint' },
    { line: "const WHITE = '#ffffff';", count: 1, why: 'the sprite palette, art' },
    { line: "shd: mix(base, '#000000', 0.22),", count: 1, why: 'a sprite shade, art' },
    { line: "lo: mix(base, '#000000', 0.52),", count: 1, why: 'a sprite shade, art' },
    { line: "deep: mix(base, '#000000', 0.74),", count: 1, why: 'a sprite shade, art' },
    { line: "return { ...piecePalette(color), lo: mix(base, '#000000', LO_80) };", count: 1, why: 'a sprite shade, art' },
  ],
  'heroBackdrops.ts': [
    { line: "amber: '#ffb000',", count: 1, why: 'the 70s backdrop palette' },
    { line: "star: '#ffffff',", count: 1, why: 'a star is white in both eras: the hero is art' },
    { line: "sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');", count: 1, why: 'a fade to nothing, not a shade' },
  ],
  'game/ResultFx.tsx': [
    { line: "<rect x={hotX} y={STRIKE_Y - 5} width='14' height='10' rx='4' fill='#ffffff' opacity='.7' />", count: 1, why: 'the strike spark, art' },
    { line: "fill='#ffffff'", count: 1, why: 'the strike spark, art' },
  ],
  'components/GoalBurst.tsx': [
    { line: "background: `linear-gradient(to top, ${i % 4 === 2 ? '#ffffff' : color}, #ffffff)`,", count: 2, why: 'a spark core, art' },
    { line: "background: `radial-gradient(circle, #ffffff 22%, ${color} 62%, transparent 72%)`,", count: 1, why: 'a spark core, art' },
  ],
  'components/GoalConfetti.tsx': [{ line: "background: p.white ? '#ffffff' : color,", count: 1, why: 'a confetti spark, art' }],
  'components/CaptureBurst.tsx': [{ line: "background: s.white ? '#ffffff' : color,", count: 1, why: 'a burst spark, art' }],
  'components/Die.tsx': [
    {
      line: "'inset 0 2px 4px rgba(255,255,255,.8),inset 0 -6px 10px rgba(140,120,80,.35),0 14px 24px -10px rgba(0,0,0,.7)',",
      count: 2,
      why: 'the die is drawn in perspective: its specular edge and the shadow it casts, art',
    },
    { line: "boxShadow: 'inset 0 1px 1px rgba(0,0,0,.5)',", count: 1, why: 'the pip well on the die face, art' },
  ],
  'components/GoalCard.tsx': [{ line: 'stroke="#ffffff"', count: 1, why: 'the trophy glyph, art' }],
  // `#1a1009`-type warm blacks and the two scrims sit on a surface another step owns,
  // so this pass leaves them and names the step rather than moving someone's pixels.
  'components/Board.tsx': [
    { line: ": 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.95))',", count: 1, why: "the board's own drawing, step 6 owns the fringes" },
    { line: "color: goalCount > 0 ? 'var(--state-on)' : '#ffffff',", count: 1, why: 'a board counter, step 6 owns the fringes' },
    { line: "const SAFE_STAR_COLOR = '#ffffff';", count: 1, why: 'the safe star, board art' },
    { line: "const SAFE_STAR_OUTLINE = '#000000';", count: 1, why: 'the safe star, board art' },
    { line: "boxShadow: '0 0 18px rgba(33, 33, 255, 0.6), inset 0 0 12px rgba(0,0,0,.7)',", count: 1, why: 'a cell ground, step 6 owns the fringes' },
    { line: "const LINE = '#00f0ff';", count: 1, why: "the board's grid line: measured against the board's own colours (see the note above it), and the board is furniture, not the page" },
  ],
  'game/ClashOverlay.tsx': [
    { line: "background: 'rgba(0,0,0,.72)',", count: 1, why: 'a scrim under the clash card, section 25 owns that surface' },
    { line: "background: 'rgba(0, 0, 0, 0.94)',", count: 1, why: 'a scrim under the clash card, section 25 owns that surface' },
  ],
  'components/NotificationBell.tsx': [
    {
      line: "boxShadow: count > 0 ? '0 0 8px #ff007f' : '0 0 6px #33ff88',",
      count: 1,
      why: 'a lit/unlit LED pair whose green is the drifted #33ff88: the state pair owns that reading, and its pink half stays with it',
    },
  ],
  'heroScenes.ts': [
    { line: "c1: 'rgba(255, 230, 0, 0.72)',", count: 1, why: 'the hero art, a painted scene' },
    { line: "c2: 'rgba(255, 0, 127, 0.38)',", count: 1, why: 'the hero art, a painted scene' },
    { line: "{ label: 'YELLOW', color: '#ffe600', x: 490, y: 360 },", count: 1, why: 'the hero art' },
    { line: "{ label: 'RED', color: '#ff007f', x: 128 },", count: 1, why: 'the hero art' },
    { line: "{ label: 'YELLOW', color: '#ffe600', x: 470 },", count: 1, why: 'the hero art' },
    { line: "marqueeColor: '#ffb000',", count: 1, why: 'the hero art' },
    { line: "gridColor: 'rgba(0, 240, 255, 0.45)',", count: 1, why: 'the hero art, a painted scene' },
    { line: "{ label: 'BLUE', color: '#00f0ff', x: 635, y: 350 },", count: 1, why: 'the hero art' },
    { line: "marqueeColor: '#00f0ff',", count: 1, why: 'the hero art' },
    { line: "{ label: 'BLUE', color: '#00f0ff', x: 606 },", count: 1, why: 'the hero art' },
  ],
  'pages/Game.tsx': [
    { line: "red: '#ff007f',", count: 1, why: 'SEAT_HUES: colour is the seat' },
    { line: "yellow: '#ffe600',", count: 1, why: 'SEAT_HUES: colour is the seat' },
    { line: "? '#ff007f'", count: 2, why: 'the two seat-hue maps, colorAccent and dotColor' },
    { line: "? '#ffe600'", count: 2, why: 'the two seat-hue maps, colorAccent and dotColor' },
    { line: "blue: '#00f0ff',", count: 1, why: 'SEAT_HUES: colour is the seat' },
    { line: ": '#00f0ff';", count: 2, why: 'the two seat-hue maps, colorAccent and dotColor' },
    { line: "view.status === 'waiting' ? 'var(--accent-cyan)' : SEAT_HUES[effectiveTurn] || '#00f0ff';", count: 1, why: 'a turn hue falling back to the blue seat' },
    { line: "const turnColorHex = SEAT_HUES[effectiveTurn] || '#00f0ff';", count: 1, why: 'a turn hue falling back to the blue seat' },
  ],
  'pages/Lobby.tsx': [
    { line: "red: '#ff007f',", count: 1, why: 'COL: colour is the seat' },
    { line: "yellow: '#ffe600',", count: 1, why: 'COL: colour is the seat' },
    { line: "blue: '#00f0ff',", count: 1, why: 'COL: colour is the seat' },
  ],
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
    { line: "border: '1.5px solid #ffe600',", count: 1, why: 'the level-2 ticket' },
    { line: "color: '#ffe600',", count: 1, why: 'the level-2 ticket' },
    { line: "boxShadow: '0 0 12px rgba(255, 230, 0, 0.3)',", count: 1, why: 'the level-2 ticket' },
    { line: "borderRight: '2px dashed rgba(255, 230, 0, 0.45)',", count: 1, why: 'the level-2 ticket divider' },
    {
      line: "{ key: 'noSafeZones', icon: '💀', label: 'game.noSafeZones', hue: '#00f0ff' },",
      count: 1,
      why: 'ROOM_MODES: a mode colour is its name',
    },
    {
      line: "? '#00f0ff'",
      count: 1,
      why: 'the room badge hues, whose yellow, pink and green siblings are literal too',
    },
    {
      line: "{ key: 'clashEnabled', icon: '⚔️', label: 'game.clashMode', hue: '#ff007f' },",
      count: 1,
      why: 'ROOM_MODES: a mode colour is its name',
    },
    {
      line: ": '#ff007f';",
      count: 1,
      why: 'the room badge hues, whose yellow, green and cyan siblings are literal too',
    },
    {
      line: "background: 'rgba(255, 0, 127, 0.28)',",
      count: 1,
      why: 'the level-1 ticket, kept whole with TICKET_PINK',
    },
    { line: "border: '1.5px solid #ff007f',", count: 1, why: 'the level-1 ticket' },
    { line: "color: '#ff007f',", count: 1, why: 'the level-1 ticket' },
    { line: "boxShadow: '0 0 12px rgba(255, 0, 127, 0.3)',", count: 1, why: 'the level-1 ticket' },
    { line: "borderRight: '2px dashed rgba(255, 0, 127, 0.45)',", count: 1, why: 'the level-1 ticket divider' },
  ],
  'pages/Profile.tsx': [{ line: "YELLOW: '#ffe600',", count: 1, why: 'SEAT_COLOR: colour is the seat' }],
  'store.tsx': [
    {
      line: "{ id: 'retro70', label: \"RETRO 70'S\", swatch: ['#e5340b', '#ffb000'] },",
      count: 1,
      why: 'the theme row swatch, a picture of the palette',
    },
    {
      line: "{ id: 'retro80', label: \"RETRO 80'S\", swatch: ['#ff007f', '#00f0ff'] },",
      count: 2,
      why: 'the theme row swatch, a picture of the palette',
    },
  ],
  // A theme table is where a colour becomes a token, so the table is the one file
  // allowed to spell its own palette. One entry per name that carries a swept form.
  'styles/themes/retro80/theme.css': [
    { line: '--accent-cyan: #00f0ff;', count: 1, why: 'the 80s token definition' },
    { line: '--accent-pink: #ff007f;', count: 1, why: 'the 80s token definition' },
    { line: '--accent-yellow: #ffe600;', count: 1, why: 'the 80s token definition' },
    { line: '--text-main: #ffffff;', count: 1, why: 'the 80s token definition' },
    { line: '--window-header-text: #ffffff;', count: 1, why: 'the 80s token definition' },
    {
      line: 'an alpha, and `rgba(#ff007f, 0.3)` is not CSS — so without these the',
      count: 1,
      why: 'a comment in the table explaining why the channel tokens exist',
    },
  ],
  'styles/themes/retro70/theme.css': [
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
      line: "'bg-[linear-gradient(90deg,rgba(255,230,0,.2)_0%,rgb(var(--bg-raise-rgb)/.96)_100%)] border-2 border-[#ffe600] shadow-[0_4px_20px_rgb(var(--shade-rgb)/.6),0_0_16px_rgba(255,230,0,.22)] hover:border-[#ffff33] hover:bg-[linear-gradient(90deg,rgba(255,230,0,.3)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgb(var(--shade-rgb)/.75),0_0_28px_rgba(255,230,0,.5),inset_0_0_16px_rgba(255,230,0,.18)]';",
      count: 6,
      why: 'TICKET_YELLOW: the amber ticket, kept whole with its siblings',
    },
    { line: "'bg-[linear-gradient(90deg,rgba(255,0,127,.22)_0%,rgb(var(--bg-raise-rgb)/.96)_100%)] border-2 border-[#ff007f] shadow-[0_4px_20px_rgb(var(--shade-rgb)/.6),0_0_16px_rgba(255,0,127,.25)] hover:border-[#ff3399] hover:bg-[linear-gradient(90deg,rgba(255,0,127,.32)_0%,rgba(30,8,55,.98)_100%)] hover:shadow-[0_8px_30px_rgb(var(--shade-rgb)/.75),0_0_28px_rgba(255,0,127,.55),inset_0_0_16px_rgba(255,0,127,.2)]';", count: 6, why: "TICKET_PINK: the pink ticket, kept whole with TICKET_YELLOW's amber sibling, so the two levels of pass look alike in both eras" },
    {
      line: "\"[--corner:12px] [--border:2px] [--clip:polygon(0_0,100%_0,100%_calc(100%_-_var(--corner)),calc(100%_-_var(--corner))_100%,0%_100%)] [--modal-accent:var(--accent-cyan)] [--modal-shadow:var(--accent-pink)] text-(--modal-accent) w-[clamp(340px,90vw,500px)] relative box-border [font-family:var(--font-display,sans-serif)] overflow-visible bg-transparent before:content-[''] before:absolute before:top-px before:bottom-px before:right-full before:w-4 before:[border:var(--border)_solid_var(--modal-accent)] before:[translate:-25%_0] before:opacity-0 before:backdrop-blur-[6px] before:backdrop-saturate-[180%] before:[transition-property:opacity,translate] before:duration-200 before:ease-out before:[transition-delay:325ms] before:[background:var(--modal-accent)] before:[mask:linear-gradient(#fff,hsl(0_0%_100%/0.6)_15%_95%,#fff)] after:content-[''] after:absolute after:top-px after:bottom-px after:right-full after:w-4 after:[border:var(--border)_solid_var(--modal-accent)] after:[translate:-25%_0] after:opacity-0 after:backdrop-blur-[6px] after:backdrop-saturate-[180%] after:[transition-property:opacity,translate] after:duration-200 after:ease-out after:[transition-delay:325ms] group-data-[modal-state=open]/modal:before:opacity-100 group-data-[modal-state=open]/modal:before:[translate:var(--border)_0] group-data-[modal-state=open]/modal:before:[animation:cyberModalFlicker_0.625s_var(--flicker)_none] group-data-[modal-state=open]/modal:before:[animation-delay:200ms] group-data-[modal-state=open]/modal:before:[transition-delay:0s] group-data-[modal-state=open]/modal:after:opacity-100 group-data-[modal-state=open]/modal:after:[translate:var(--border)_0]\";",
      count: 2,
      why: 'a mask channel: white is full coverage, not a colour, so it must not warm in the 70s',
    },
    { line: "\"text-[#ff4081] text-[13px] leading-[1.4] font-['Atkinson_Hyperlegible_Mono',monospace] py-2 px-3 rounded-lg bg-[rgba(255,0,127,.08)] border border-[rgba(255,0,127,.2)]\";", count: 2, why: "RETRO_AUTH_ERROR: the drifted Material pink reports a failure, and the state pair owns that reading" },
  ],
  'theme.ts': [
    { line: "red: { base: '#ff007f' },", count: 1, why: 'the seat palette: the accent and the red seat share one value' },
    { line: "yellow: { base: '#ffe600' },", count: 1, why: 'the seat palette' },
    { line: "blue: { base: '#00f0ff' },", count: 1, why: 'the seat palette: the accent and the blue seat share one value' },
  ],
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

// The parity gate (section 33). One table per era means the pair has to agree on
// names: a token one table declares and the other does not paints as `unset` under
// that era rather than as a wrong colour, so a screenshot is no proof. Names and
// their order only - a value is never compared, because the eras disagree on every
// value on purpose.
const TABLES = ['styles/themes/retro80/theme.css', 'styles/themes/retro70/theme.css'];

function declared(rel) {
  const full = path.join(sourceRoot, rel);
  if (!existsSync(full)) {
    console.error(`check-theme-literals: ${rel} is missing, so the parity gate cannot run`);
    process.exit(2);
  }
  // A comment names a token; only a declaration creates one. Comments go first,
  // including the multi-line prose that documents the tables.
  return readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => /^\s*(--[a-z0-9-]+)\s*:/.exec(line)?.[1])
    .filter(Boolean);
}

const tables = TABLES.map((rel) => ({ rel, names: declared(rel) }));
const [first, second] = tables;
const uniq = (list) => [...new Set(list)];
const parity = [];
for (const name of uniq(first.names).filter((n) => !second.names.includes(n)))
  parity.push(`${name}  declared in ${first.rel} only`);
for (const name of uniq(second.names).filter((n) => !first.names.includes(n)))
  parity.push(`${name}  declared in ${second.rel} only`);
for (const table of tables)
  for (const name of uniq(table.names))
    if (table.names.filter((n) => n === name).length > 1) parity.push(`${name}  declared twice in ${table.rel}`);
// A declaration that reads itself is the same failure as a missing one: `--x: var(--x)`
// is a cycle, so the name is declared on paper and `unset` on screen. A codemod
// rewriting the accent kept doing this, and no screenshot proves it wrong.
for (const rel of TABLES)
  for (const line of readFileSync(path.join(sourceRoot, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n')) {
    const self = /^\s*(--[a-z0-9-]+)\s*:\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*;?$/.exec(line);
    if (self && self[1] === self[2]) parity.push(`${self[1]}  declared as itself in ${rel}`);
  }
// The order check: the names both tables share, in each table's own order.
const seqFirst = uniq(first.names).filter((n) => second.names.includes(n));
const seqSecond = uniq(second.names).filter((n) => first.names.includes(n));
const swapped = seqFirst.findIndex((name, i) => name !== seqSecond[i]);
if (swapped !== -1)
  parity.push(
    `order differs at ${swapped + 1}: ${first.rel} has ${seqFirst[swapped]}, ${second.rel} has ${seqSecond[swapped]}`,
  );
if (parity.length > 0) {
  console.error('check-theme-literals: the two theme tables are out of parity');
  for (const problem of parity) console.error(`  ${problem}`);
  console.error(`\n${parity.length} parity problem(s) across ${TABLES.length} table(s).`);
  process.exit(1);
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

// The channel gate (section 33, action C, ruled by shape on 2026-11-12). An inline
// `style` object holding nothing but *paint*, every value a literal, is one a utility
// could carry: `{ color: 'var(--text-main)' }` is `text-(--text-main)`. An object that
// also carries typography or geometry is a style object **by rule** - the 71 single-use
// recipes the ruling left alone - so it is not flagged and needs no inventory row. An
// object with a computed value is rung 3 of the channel rule and is legal whatever it
// holds, which is why the static test comes first: it is what separates a defect from a
// declaration only JavaScript can make. A spread cannot be read, so it is never flagged.
const PAINT = new Set([
  'color', 'background', 'backgroundColor', 'backgroundImage', 'border', 'borderColor',
  'borderTop', 'borderBottom', 'borderLeft', 'borderRight', 'borderTopColor',
  'borderBottomColor', 'boxShadow', 'textShadow', 'outline', 'outlineColor', 'fill', 'stroke',
]);
const isLiteral = (v) =>
  /^'(?:[^'\\]|\\.)*'$/.test(v) || /^"(?:[^"\\]|\\.)*"$/.test(v) || /^-?\d+(?:\.\d+)?$/.test(v);

function styleObjects(src) {
  const out = [];
  const re = /style=\{\{/g;
  let m;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 2;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const body = src.slice(re.lastIndex, i - 2);
    const props = [];
    let quote = null;
    let nest = 0;
    let start = 0;
    for (let k = 0; k < body.length; k++) {
      const c = body[k];
      if (quote) {
        if (c === quote && body[k - 1] !== '\\') quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(' || c === '[' || c === '{') nest++;
      else if (c === ')' || c === ']' || c === '}') nest--;
      else if (c === ',' && nest === 0) {
        props.push(body.slice(start, k));
        start = k + 1;
      }
    }
    props.push(body.slice(start));
    const parsed = props
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const c = p.indexOf(':');
        return c < 0 ? { spread: true } : { key: p.slice(0, c).trim(), val: p.slice(c + 1).trim() };
      });
    out.push({
      line: src.slice(0, m.index).split('\n').length,
      text: src.slice(m.index, i).replace(/\s+/g, ' '),
      parsed,
    });
  }
  return out;
}

const paintOnly = [];
for (const full of files) {
  if (!/\.(ts|tsx)$/.test(full)) continue;
  const rel = path.relative(sourceRoot, full).split(path.sep).join('/');
  for (const obj of styleObjects(readFileSync(full, 'utf8'))) {
    const { parsed } = obj;
    if (!parsed.length || parsed.some((p) => p.spread)) continue;
    if (!parsed.every((p) => PAINT.has(p.key) && isLiteral(p.val))) continue;
    paintOnly.push({ file: rel, ...obj });
  }
}

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

// `--propose` prints the inventory rows the current tree would need, ready to paste:
// a kept literal is a decision, and the tool writes the shape of the decision, not
// the reason for it.
if (process.argv.includes('--propose')) {
  const byFile = new Map();
  for (const hit of unexpected) {
    const rows = byFile.get(hit.file) ?? new Map();
    const row = rows.get(hit.text) ?? { count: 0, literal: hit.literal };
    row.count += 1;
    rows.set(hit.text, row);
    byFile.set(hit.file, rows);
  }
  for (const [file, rows] of byFile) {
    console.log(`'${file}': [`);
    for (const [text, row] of rows) console.log(`  { line: ${JSON.stringify(text)}, count: ${row.count}, why: '' },`);
    console.log('],');
  }
  if (byFile.size === 0) console.log('(nothing to propose: every swept literal is already on the inventory)');
  process.exit(0);
}

const forms = new Set(found.map((hit) => hit.literal)).size;
if (unexpected.length === 0 && stale.length === 0 && paintOnly.length === 0) {
  console.log(
    `check-theme-literals: ${SWEPT.length} swept colour(s), ${found.length} kept literals all on the inventory, ` +
      `${seqFirst.length} token names in parity across ${TABLES.length} tables, ` +
      `0 paint-only inline object(s)`,
  );
  process.exit(0);
}

if (paintOnly.length > 0) {
  console.error('check-theme-literals: an inline `style` a utility could carry (section 33, the channel rule)');
  for (const hit of paintOnly) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.text.slice(0, 110)}`);
    console.error(`    every value is a literal and every property is paint: write the class instead`);
  }
  console.error(
    '\nAn object that also carries typography or geometry is a style object by rule, and so is one with a\n' +
      'computed value - neither is flagged. Only the paint-only static object is a defect.\n',
  );
}

if (unexpected.length > 0 || stale.length > 0) {
  console.error('check-theme-literals: the sweep regressed');
  for (const hit of unexpected) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.literal}  read ${hit.token} instead`);
    console.error(`    ${hit.text.slice(0, 100)}`);
  }
  for (const s of stale) {
    console.error(`  ${s.file}  inventory expects ${s.entry.count}, found ${s.actual}  ${s.entry.why}`);
    console.error(`    ${s.entry.line.slice(0, 100)}`);
  }
}
console.error(
  `\n${unexpected.length} unexpected literal(s), ${stale.length} stale inventor(ies), ` +
    `${paintOnly.length} paint-only object(s), ${forms} distinct literal form(s) in play.`,
);
process.exit(1);

