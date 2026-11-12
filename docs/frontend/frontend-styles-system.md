# Frontend — Styles & Theming

## Table of Contents

- [Overview](#overview) — The stylesheets and how theming works
- [Files](#files) — Source file inventory
- [Key Types / Interfaces](#key-types--interfaces) — Theme tokens
- [Core Logic / Flow](#core-logic--flow) — How the theme reaches the screen on boot
- [Dependencies](#dependencies) — Internal and external dependencies


---
---


## Overview

Styling is split between CSS files and TypeScript constants, with a clear rule for what belongs where:

1. **`styles/themes/retro80/theme.css`** and **`styles/themes/retro70/theme.css`** — one palette table per era, each beside the plate it paints (the 80s cityscape, the 70s orbital colony). `retro80` also carries `:root`, so a document with no `data-theme` yet reads the default palette. Every name one table declares, the other declares too, in the same order: `scripts/check-theme-literals.mjs` fails the build otherwise, because a name declared in one table and not the other renders as `unset` under that era and no screenshot catches it.
2. **`styles/theme-base.css`** — the two tables imported in order, then nothing else: the order is load-bearing, since both selectors are specificity 0-1-0 and only source order decides which wins for an `<html>` that matches both.
3. **`styles/app.css`** — the shell rule (`html, body` paints `--shell-image`, the one layer both eras differ in), the component sheet proper: the scrollbar, `@keyframes`, and the few rules that must stay in CSS, all reading the tokens. Since 2026-11-12 it is only that list. The `#color-scheme` fieldset's sheet (160 lines, 15 rules) that no component mounted, the fifteen banner blocks that introduced no rules and the one selector (`canvas#snakeCanvas`) no file names were removed, which took the file from 709 lines to 500; `scripts/dead-refs.mjs` now fails `npm run lint` and `npm run build` when a selector or a `tw.ts` constant loses its last reader, or when an arbitrary value carries a space and so names a class Tailwind drops in silence (recommendation E in the [styling audit](todo.md#rv33-audit), [the ruling](todo.md#rv33-ruled)).
4. **`index.css`** — imports Tailwind, sets base element styles (`body`, `input`, `a`), and holds the Home page's layout rules with two responsive `@media (max-height: …)` breakpoints.
5. **`styles/tw.ts`** — long Tailwind utility-class strings shared by several components. Each constant replaces one `app.css` rule one-for-one; where a rule cannot be expressed as utilities (`@keyframes`, custom easing curves such as `--flicker`), it stays in `app.css` and is referenced with `var()` or an arbitrary `animation:` value.

**Theme switching is CSS-only.** No JavaScript reads a theme name to pick colors — a component never checks "which theme is active". `theme.ts` holds only what is *data* rather than style: the Ludo palette (`COL`), the turn order (`SEAT_COLORS`), the picker's quadrant order (`BOARD_QUADRANTS`), the colour-word map (`COLOR_KEYS`), the bot pool and the presence colours (`STATUS_STYLE`). Its twelve `CSSProperties` exports went on 2026-11-12: eleven had no importer at all, and the one that had a reader, `btnOutline`, became `OAUTH_BTN` in `styles/tw.ts`.

`src/styles/fonts.css` is generated, never hand-edited: `node scripts/vendor-fonts.mjs` downloads the Atkinson Hyperlegible Next/Mono woff2 files into `public/fonts/` and writes the twelve `@font-face` rules for them. It is imported first in `main.tsx`, so every `--font-heading`/`--font-display`/`--font-mono` reference resolves to a face that ships with the app instead of one fetched from Google.

### Cascade and CSS-only rules

`index.css` imports Tailwind, whose preflight supplies the base reset, so neither the theme tables nor `app.css` define a reset of their own. Both are imported unlayered, so a rule written there outranks every Tailwind utility class.

These rules stay in CSS because no utility expresses them:

| Rule | Why it stays in CSS |
|------|---------------------|
| `.crt-screen` | `body:has(.game-page)` targets the class by name, so it also has to stay on the element in the JSX. |
| `.field-error` | Reserves the error slot's height per breakpoint; an inline `style` cannot express a `@media` query. |
| `@keyframes arcade-start-pulse` | Applied the same way. It animates `scale` only: Tailwind's `-translate-x-1/2` sets the standalone `translate` property, which composes with `transform`, so a keyframe `translateX` would add a second -50 percent shift. |

**Where colour is declared, measured.** An audit on 2026-11-12 (`todo.md` [33](todo.md#rv33-audit)) sorted every occurrence of the ink family by the form that carries it: 23.6 per cent arrived as a utility class, 52.9 per cent as an inline `style` holding nothing but the token, 21.6 per cent as an inline `style` computed at render, and 1.9 per cent as a stylesheet rule. Across the whole tree the ratio repeated — 1074 `style={{` regions against 442 `className` attributes and 97 `tw.ts` constants — so inline styles, not utilities, were where most colour was written, and the majority of those were static values a utility could have carried. The remediation was ruled and run the same day (`todo.md` [the ruling](todo.md#rv33-ruled)): the 30 objects that came from the twelve shared recipes became eleven `tw.ts` constants plus one utility (`text-(--text-main)`), the 71 single-use recipes stayed style objects **by rule**, and the 18 paint-only static objects the tree held beyond that group became utilities too, so `check-theme-literals.mjs` gates the shape — *an inline object holding nothing but paint, every value a literal* — and opens with zero rows. `app.css` lost its unmounted fieldset sheet (160 lines, 15 rules) and fifteen banner blocks that introduced no rules on the way, from 709 lines to 500. The channel rule itself is policy, not a recommendation: utility → `tw.ts` constant → inline `style` only when the value is computed → `app.css` only when CSS must own it.


---
---


## Files

| File | Role |
|------|------|
| `src/styles/fonts.css` | Generated `@font-face` rules for the self-hosted Atkinson Hyperlegible Next/Mono faces (source of truth: `scripts/vendor-fonts.mjs`, files in `public/fonts/`) |
| `src/styles/themes/retro80/theme.css` | The 1980s palette table on `:root, [data-theme='retro80']`, with its cityscape plate beside it |
| `src/styles/themes/retro70/theme.css` | The 1970s palette table on `[data-theme='retro70']` — the same names, the same order, every value different — with its orbital-colony plate beside it |
| `src/styles/theme-base.css` | Imports the two tables in order; the order is what decides the default |
| `src/styles/app.css` | The shell rule (`html, body` ← `--shell-image`), the scrollbar, `@keyframes`, and the few rules that must stay in CSS |
| `src/index.css` | Tailwind import, base element styles, Home page layout rules, scrollbar fallback |
| `src/styles/tw.ts` | Shared Tailwind utility-class constants (documented in [frontend-components-system.md](frontend-components-system.md)) |
| `src/theme.ts` | Data only: `COL`, `SEAT_COLORS`, `BOARD_QUADRANTS`, `COLOR_KEYS`, `BOT_POOL`, `STATUS_STYLE` and the `PresenceStatus` type |
| `src/store.tsx` | Owns the `theme` state and applies `data-theme` to `<html>` |


---
---


## Key Types / Interfaces

### The theme

Two themes ship, and each is its own token table: **Retrowave '80**, declared on `:root, [data-theme='retro80']` (the default), and **Retro 70's**, declared on `[data-theme='retro70']` in the file after it. The store writes `data-theme` onto `<html>` and `<body>` on boot and on every switch, and the choice survives a reload in `retro_theme`. An unknown or renamed value fails validation and falls through to `retro80`.

### Theme tokens (CSS custom properties)

`:root, [data-theme='retro80']` declares the whole token set, for example:

```css
--bg-primary, --bg-secondary, --bg-card   /* backgrounds */
--accent-cyan, --accent-pink, --accent-yellow, --accent-purple
--text-main, --text-muted, --text-soft  /* white, muted lavender, paler step for captions */
--border-color, --box-shadow, --card-border-style
--font-heading, --font-display, --font-mono  /* Atkinson Hyperlegible Next (heading/display), Atkinson Hyperlegible Mono */
--crt-scanline-opacity, --crt-flicker-opacity
--window-header-bg, --window-header-text
--state-on, --state-on-ink, --state-off   /* the pass/fail pair, see below */
--accent-yellow                          /* the accent that is also the third state, see below */
--accent-*-rgb, --state-on-rgb, --state-off-rgb, --ink-rgb, --shade-rgb, --bg-primary-rgb   /* `r g b`, read as `rgb(var(--x-rgb) / a)` */
```

A component only ever references `var(--accent-cyan)` (and so on), so the colour comes from the stylesheet.

**The state pair.** `--state-on` (`#00ff88` / avocado `#82903f`) and `--state-off` (`#ff0055` / cranberry rose `#e8697d`) are the only two colours that report a condition: on/off, joined/muted, valid/refused, met/missed, in/out. They are not accents, so they are not reused for a seat, a mode or a rule, and the two halves always move together (a row reads "on" by contrast with a row that reads "off"). `--state-on-ink` is the text that sits on a lit pill. Seat hues, the hero art and the mode chrome stay literal, because colour is the seat and a mode's colour is its name. Both halves moved together on 2026-11-09, which is why the accent pink that sat beside a moved green (the profile's defeats card, a lost match, the blocked card, the down delta) moved onto `--state-off` too: `--accent-pink` is the red seat's own hue, so it cannot report a failure. The pair also replaced the two unread channel tokens `--success-rgb` and `--warn-rgb`.

**The navy grounds.** The second family (`todo.md` [33](todo.md#rv33-family2)) is the ramp behind the chrome: `--bg-primary` (the shell's ground), then `--bg-void-rgb` (`5 2 18` / `12 9 8`), `--bg-panel-rgb` (`10 2 28` / `17 14 12`), `--bg-raise-rgb` (`20 6 46` / `30 24 21`) and `--bg-card-rgb` (`25 10 56` / `43 30 21`). It is five stops because the components had spelled thirty-two: a census of the tree found the same five roles written 97 times in navy shades that differ by two or three units per channel, which is a ramp nobody chose. So the family's codemod folds each site onto the nearest stop — 38 of the 88 it converted resolve to the literal they carried, the other 50 move by at most 5/255 per channel, and a check confirms no gradient's two ends folded onto the same stop, so nothing flattened. The 70s values are not the 80s ones translated channel by channel: a cold navy reads purple over walnut, so each stop keeps its *lightness step* off that era's `--bg-primary`, which is what `--bg-start-overlay` already argues for a single card. Nine sites are left: the hover and selected lifts (`35,12,70`, `28,10,64`, `28,8,62`, `30,8,55`) and three gradient ends whose nearest stop is more than five units away. Those want a sixth stop, and the 70s value of a *lifted* surface is a design call rather than a codemod's, so they are family 2b and their literals stand until it lands.

**The accent cyan.** The third family (`todo.md` [33](todo.md#rv33-family3)) is the accent the blue seat also wears, and the one family that added nothing: `--accent-cyan` and `--accent-cyan-rgb` were already declared in both tables, so it is 221 reader lines across 33 files — `#00f0ff`, `rgba(0, 240, 255, a)` and `rgb(0 240 255 …)` all became `var(--accent-cyan)` or `rgb(var(--accent-cyan-rgb) / a)`, and the 70s table was not touched. `var(--accent-cyan, #00f0ff)` was dropped in all 30 of its appearances: a fallback that spells a value one era does not own is a bug waiting for the token to fail, which is the only moment a fallback matters. Fifteen literals stay because the accent *is* the blue seat: the four seat tables, the two seat maps, the room-mode hue, the rank badge tier, the theme row's swatch, the board's own grid line and the hero art. Two rules came out of it. **An arbitrary value cannot contain a space** — Tailwind ends the class at the whitespace, so `bg-[rgb(var(--bg-panel-rgb) / 0.92)]` is read as `bg-[rgb(var(--bg-panel-rgb)` and emits nothing, in silence: the family's compactor closed up every `rgb(var(--x-rgb) / a)` in the tree, which also repaired **thirteen classes that had been painting nothing since families 1 and 2** (three modal backdrops, a panel at `.92`, three ticket gradients), and `dead-refs.mjs` now fails on a spaced arbitrary value. And **a token may not be declared as itself** — the codemod rewrote `--accent-cyan: #00f0ff` into `--accent-cyan: var(--accent-cyan)`, a cycle that declares the name and paints `unset`, which the parity gate now rejects; values are otherwise never compared, because the eras disagree on every one of them on purpose.

**The accent pink.** The fourth family (`todo.md` [33](todo.md#rv33-family4)) is the other half of the 80s chrome, and the second family in a row that added nothing: `--accent-pink` (`#ff007f` / vermilion `#e5340b`) and `--accent-pink-rgb` (`255 0 127` / `229 52 11`) were already declared in both tables, so it is 100 reader lines across 21 files — `#ff007f`, `rgba(255, 0, 127, a)` and `rgb(255 0 127 …)` became `var(--accent-pink)` / `rgb(var(--accent-pink-rgb) / a)` — and the 70s table was not touched. Fifteen `var(--accent-pink, #ff007f)` defaults went with the cyan family's thirty: a fallback that spells the 80s value is wrong at exactly the moment it is read. Eighteen literals stay, seventeen of them rows the guard names a reason for: the four seat tables and the two seat maps (the accent *is* the red seat), the room-mode hue, the room badge's arm, the theme row's swatch, the level-1 pass ticket whole beside its amber twin, `TICKET_PINK`, the bell's lit LED kept as a pair with its drifted green, and the auth error's `#ff4081` — a failure, which reports through the state pair rather than through a seat's own hue. `#9d00ff` is not in the family: `--accent-purple` exists in both tables, so the five gradients that now read `var(--accent-pink) → #9d00ff` are half-themed on purpose until purple's own pass. The 80s table's seven pink readers moved onto the tokens they name, the way family 3 moved that table's cyan readers, so a table no longer spells a colour it declares two lines above.

**The accent purple.** The fifth family (`todo.md` [33](todo.md#rv33-family5)) is the one the pink pass deferred,
and it is 14 lines across 5 files: twelve application lines and the 80s table's own two readers. `--accent-purple`
(`#9d00ff` / deep petrol `#0c5679`) and `--accent-purple-rgb` (`157 0 255` / `12 86 121`) were already declared in
both tables, so this family added nothing either and the 70s table was not touched. Only the declaration was kept,
and that is the point: this accent is neither a seat nor a state, so no literal had identity to defend — unlike red,
blue and yellow, purple never paints a player, and it carried no fallback to delete either, which makes it the first
family that was pure rewriting. What it closed is the seam the pink pass left open: the five application gradients,
and the table's `--btn-bg` with them, that ran `var(--accent-pink) → #9d00ff` now end in `var(--accent-purple)`, so
the 70s draws vermilion into deep petrol rather than into neon violet, and `CYBER_BTN_PINK`'s shadow reads the token
too. `#0c5679` is not a swept form for the reason cyan's `#5fb3b0` is not: nothing outside that table spells it.

**The state pair.** The sixth and last family (`todo.md` [33](todo.md#rv33-family6)) is the only one whose tokens were
already themed before it started: `--state-on` (`#00ff88` / avocado `#82903f`), `--state-off` (`#ff0055` / cranberry
rose `#e8697d`), their two `-rgb` channels and `--state-on-ink` were declared in both tables on 2026-11-09, and
[section 26](todo.md#state-colour) moved 133 readers onto them in one pass. So its work is the residue that pass left
and the gate that keeps it shut — **15 lines across 5 files**, all of them literals 26.6 had listed as kept: the
`captureFx` rule chip on the create screen and on the waiting rail (whose three siblings already read accents, so the
fourth now does), the two rule pages that paint a green box for "you may" and a red one for "you may not", the bell's
lit LED and its glow, and the two auth message recipes with `FieldError`. **The two drifted hues fold onto the pair
rather than onto a third token:** `#ff4081` is a Material pink that reports a *failure*, `#33ff88` is a mint that marks
a *lit condition*, and those are 26.1's two readings, so the error reads `--state-off` (5.28:1 down to 4.53:1 on its
own pill, still AA at 13 px) and the LED and the success line read `--state-on` (12.37 → 12.36). Twenty-two literals stay,
because these two values are also identities: the four seat tables and the two seat maps, the room-mode hue and the
room badge arms, the hero's RED and two GREENs, the third lobby ticket kept whole with its siblings,
`CYBER_BTN_DANGER`, and the logout button's era-branched red, which no token can express because it is vermilion in
one era and crimson in the other. The 70s values are not swept forms, for the reason cyan's is not: nothing outside
that table spells `#82903f` or `#e8697d`.

**The ink family.** `--ink-rgb` (`255 255 255` / warm cream `255 231 189`) is the neutral every surface tints with, `--shade-rgb` (`0 0 0` / warm black `26 16 9`) is the shadow under it, and `--text-main` is the ink as text; the 70s values are warm on purpose, because a cold white or a cold black reads purple and blue-grey over walnut. The first family of the sweep (`todo.md` [33](todo.md#rv33-plan) step 2) moved 242 reader lines across 35 files onto them: `rgba(255,255,255,a)` became `rgb(var(--ink-rgb) / a)`, a bare `#ffffff` used as text became `var(--text-main)`, `#000000` became `rgb(var(--shade-rgb))`, and Tailwind's own `text-white`/`bg-black` utilities — which bypass the tokens entirely — were folded into the same forms (`text-(--text-main)`, `bg-[rgb(var(--shade-rgb))]`), compact inside the brackets so the arbitrary value stays one class — and a space left in there does not make a longer class, it makes no class at all, which is what the accent cyan's pass later found thirteen of. Under `retro80` every one of the 242 resolves back to the literal it replaced, character for character; the change is the 70s. Canvas and SVG painters keep their literals, because their palette is drawn rather than read: `pieceParts`, the hero backdrops, the goal and capture sparks, the die, the result spark. So do the mask channel (white is full coverage there, not a colour, so it must not warm) and the surfaces another step owns — the board's fringes and the clash card. Each of those is on the guard's inventory with the reason, and `--propose` prints the rows a tree would need. `scripts/colour-census.mjs --groups` sizes the next family: distinct values, counts and files, grouped by hue band.

**The third state.** `--accent-yellow` (`#ffe600` / amber `#ffb000`) is the caution: a warning, a caution or an in-progress row (an abandoned match, an empty photo slot, a room that cannot launch, a legal move). It is not a third `--state-*` token, because the accent already names the colour and a second name would drift from it, and it is never a verdict. It needed no new value: the 70s amber reads 9.05:1 on that theme's card and sits 29.0° of hue from the avocado and 50.8° from the rose, so the three conditions stay distinguishable. Seat hues, the hero art and the mode chrome stay literal (`todo.md` [27](todo.md#warn-colour)); everything that paints reads the token, and `scripts/check-theme-literals.mjs` (run by `prebuild` and `lint`) fails the build on a literal outside its named inventory.

### The shell

The era plate is one layer, and it is the page's: `app.css` paints `html, body` from `--shell-image` (`background-size: cover`, `center`, `no-repeat`, `fixed`), and the two tables supply the two photographs, each from its own folder. **No route mounts a backdrop of its own** — that is the rule, not a convention — so every page is transparent wherever it does not paint a card. The auth shell is the case that proves it: `RetroAuthLayout` is `100vw` by `100vh` and transparent, and until 2026-11-13 it painted `--bg-primary` across the whole viewport, which hid the plate on sign-in alone (`todo.md` [33](todo.md#rv33-shell)). The per-route `GRID_BACKGROUND` mounts that survived the plate's move to `html, body` went with that fill: the constant paints nothing now, and is read once — by Home — as the fixed frame `STATIC_GRID` needs for the 80s converging grid (`[[data-theme=retro70]&]:hidden`).

Two consequences are measured rather than assumed, and measured in pixels rather than modelled. Chrome that sits *outside* a card wears a ground: `LandscapeNotice` keeps its 0.6 `--bg-primary-rgb` fill (9.6:1 under the 80s, 7.7:1 under the 70s at the worst pixel), and the tag line, which used to be bare 50 per cent cyan — 1.0-1.5:1 over a plate — now wears the card's own 0.78 glass at solid cyan (9.1:1 under the 80s, 5.3:1 under the 70s, the same floor as the card's own cyan labels at 4.3:1). Card text keeps its contrast over a photograph instead of flat navy: `--text-main` 17.3:1 and `--text-muted` 7.9:1 under the 80s, 13.5:1 and 7.8:1 under the 70s, and an input's `--text-main` on its own 0.45 shade reads 19.9:1 and 14.5:1. A route that paints a full-viewport opaque `--bg-*` is therefore a bug, not a style: it covers the one layer the eras differ in.

**The value is a function, not a colour.** `app.css` reads `--shell-image` as `background-image`, so it has to stay a *valid* background: one bad layer does not degrade the plate, it drops the whole declaration and leaves a flat `--bg-primary`, with nothing logged anywhere. Two rules follow, and both were missed on the first write, invisibly to `tsc`, `oxlint` and every colour gate. The dim gradient comes **first**, because the first layer paints on top and `cover` hides anything under the plate completely. And `to bottom` is **two words**: `to_bottom` is the class-name spelling — Tailwind translates `_` inside an arbitrary value, CSS reads the token as a junk layer and throws the declaration away. From 2026-11-12 to 2026-11-13 the two tables had both mistakes, so the plate painted on no route in either era, and sign-in looked exactly like every other page only because *every* page was flat navy; a headless-browser screenshot was the first thing to see it (`todo.md` [33](todo.md#rv33-shell), step 3b). `scripts/check-shell-plate.mjs` now fails `npm run build` and `npm run lint` on a `--shell-image` carrying an `_`, a plate on top, a dim under `0.25` alpha, or a plate file that is not beside its table.

**The two dims are not the same pair.** The 70s plate is a daylight scene and the 80s one is a night scene, so the same opacity leaves the 70s twice as bright behind the same panel. Its gradient starts at `0.50` and ends at `0.80` against the 80s pair's `0.30`/`0.62`, picked by matching the composited plate's luminance envelope — 95th percentile 39 against 38 at 1440x900 — so that no label's contrast depends on which era the reader chose. Every figure above is the worst pixel of a 1440x900 render of the built bundle in Firefox headless, one profile per era with the theme seeded before the app script runs, on sign-in and on the public legal page.


---
---


## Core Logic / Flow

```mermaid
sequenceDiagram
    participant Store as store.tsx
    participant HTML as <html data-theme>
    participant CSS as styles/themes/*/theme.css

    Store->>Store: read 'retro_theme' from localStorage (default 'retro80')
    Store->>HTML: setAttribute('data-theme', 'retro80')
    HTML->>CSS: :root, [data-theme='retro80'] supplies every token
```

1. On startup the store reads `retro_theme` from `localStorage` (default `retro80`) and sets the `data-theme` attribute on both `document.documentElement` and `document.body`.
2. `themes/retro80/theme.css` declares the tokens on `:root, [data-theme='retro80']`, so the values resolve with or without the attribute; `themes/retro70/theme.css` declares the same names in the same order under `[data-theme='retro70']`.
3. Components and `tw.ts` constants only reference tokens (`var(--accent-pink)`) or plain Tailwind utilities.


---
---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `store.tsx` | `theme` / `setTheme` state; persists `retro_theme` and sets the `data-theme` attribute |
| `styles/tw.ts` | Consumes the tokens through Tailwind arbitrary values; documented separately |
| Tailwind CSS | Imported by `index.css` (`@import 'tailwindcss'`) |
| Google Fonts | `Atkinson Hyperlegible Next` (headings, UI, body) and `Atkinson Hyperlegible Mono` (tabular/mono text), requested once in `index.html` |
