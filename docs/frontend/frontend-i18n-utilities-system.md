# Frontend — i18n, Utilities & App Entry

## Table of Contents

- [Overview](#overview): Internationalization, audio, name and colour labels, legal pages
- [Files](#files): Source file inventory
- [Key Types / Interfaces](#key-types--interfaces): Language codes and engine shapes
- [Core Logic / Flow](#core-logic--flow): Language selection and legal documents
- [Dependencies](#dependencies): Internal and external dependencies


---
---


## Overview

Supporting modules shared by every screen:

1. **i18n**: `i18next` + `react-i18next` with three languages: English (`en`), Malay (`ms`), French (`fr`). The choice persists in `localStorage` under the key `lr.lang`. If the saved value is unknown or missing, the default language `en` is used.
2. **Audio**: `RetroAudioEngine`, a Web Audio synthesizer for UI beeps and game sounds (dice, moves, captures, ignition). The Game page calls it through `retroAudio`; muting is toggled with `toggleMute()`.
3. **Bot names and seat colours**: `localizedBotName()` maps the engine's `bot-<color>` user ids to a translated "bot-<color>" string using the `common.bot` label and the `lobby.color*` i18n keys. A trailing "(assistant)" name the lobby assigned the seat is kept as sent, so French renders "bot-red (Siri)" as "bot-rouge (Siri)". The same file exports `localizedColor(t, color)`: the bare colour word ("Red" / "Rouge" / "Merah") that the in-game labels use when a seat has no name, as in the turn label and the capture log. The file also exports `avatarSeed()`: it reduces a bot label to the assistant name the lobby assigned that seat, so the generated bot avatar is locale-independent and identical in the lobby table, the arena and the results invoice.
4. **Legal pages**: `LegalPage` renders the Privacy Policy and Terms of Service (public routes `/privacy` and `/terms`) from markdown files bundled with Vite's `?raw` imports, one variant per language.
5. **Entry point**: `main.tsx` mounts `<App />` in `StrictMode` and imports the CSS plus `./i18n` so translations are ready before the first render.

The brand name is translated instead of hardcoded: `homeExtended.brandTitle` (the Home hero title, with the `'42` suffix) and `authExtra.brandTitle` (the Login header) render `RETRO LUDO` in English, `LUDO RÉTRO` in French and `LUDO RETRO` in Malay. The browser tab title in `index.html` stays static at `RETRO LUDO '42`, since it sits outside the locale sheets.


---
---


## Files

| File | Role |
|------|------|
| `src/main.tsx` | Entry point: mounts `App` in `StrictMode`, imports CSS and `i18n` |
| `src/i18n.ts` | `i18next` setup: `en` / `ms` / `fr` resources, `lr.lang` localStorage persistence, `en` fallback |
| `src/locales/en.ts` | English translation namespace |
| `src/locales/fr.ts` | French translation namespace |
| `src/locales/ms.ts` | Malay translation namespace |
| `src/utils/audio.ts` | `RetroAudioEngine`: Web Audio UI beeps and game sounds, volume + mute |
| `src/utils/botName.ts` | `localizedBotName()`: `bot-<color>` (with an optional "(assistant)" suffix) to a translated bot name; `localizedColor()`: a `PlayerColor` to its translated colour word; `avatarSeed()`: a seat name to a locale-independent generated-avatar seed |
| `src/pages/LegalPage.tsx` | Privacy / Terms pages (`/privacy`, `/terms`): markdown viewer per language |
| `src/components/LanguageSwitcher.tsx` | Segmented EN/MS/FR switch used by `LegalPage`, the login card and the `RetroNavbar` account popover (`tabs` rendering); the caller owns the active language (`value` + `onChange`) |


---
---


## Key Types / Interfaces

```typescript
// Language handling (i18n.ts)
type Lang = 'en' | 'ms' | 'fr'          // stored in localStorage as 'lr.lang'

// Legal documents (LegalPage.tsx)
interface LegalPageProps {
  initialDoc?: 'privacy' | 'terms'      // defaults to 'privacy'; /terms overrides
}
// Markdown is bundled per language:
// content/docs/Privacy-Policy-{en,fr,my}.md
// content/docs/Terms-of-Service-{en,fr,my}.md   (?raw Vite imports)
```


---
---


## Core Logic / Flow

```mermaid
flowchart LR
    A["localStorage 'lr.lang'"] --> B{i18n init}
    B -->|known lang| C["lng = saved"]
    B -->|missing/unknown| D["lng = 'en'"]
    C --> E["react-i18next useTranslation()"]
    D --> E
```

1. On startup `i18n.ts` reads `lr.lang`, validates it against `['en', 'ms', 'fr']`, and initializes i18next with the matching resource bundle (`en` fallback).
2. Components call `useTranslation()`; the `LanguageSwitcher` (shared by `Login`, `LegalPage` and the `RetroNavbar` account popover) switches language at runtime via `setLang` from the store, which updates both i18next and `lr.lang`.
3. `LegalPage` reads the route (`/privacy` or `/terms`), picks the markdown document for the current language, and renders it through `MarkdownViewer`.
4. A string lands in all three sheets at once: `en.ts` is the reference, and `fr` plus `ms` carry every key with the same `{{placeholders}}`, so a call site may name only a key that exists in all three. A standalone developer audit, kept outside this checkout because it is tooling rather than product code, fails the run on a key missing from `fr` or `ms`, on `{{placeholders}}` that differ across the three, and on a call site naming a nonexistent key. Dead copy is reported but never fails; a key reached through a variable (`i18n.t(code)` for backend errors, `COLOR_KEYS[ck]`) cannot be proven unused from the call sites alone.


---
---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `store.tsx` | `lang` / `setLang` state shared by the language selectors |
| `router.tsx` | `useRoute()` so `/terms` opens the Terms doc |
| `components/MarkdownViewer.tsx` | Renders the legal markdown |
| `styles/tw.ts` | Retrowave style constants used by `LegalPage` |
| `i18next` / `react-i18next` | External i18n framework |
