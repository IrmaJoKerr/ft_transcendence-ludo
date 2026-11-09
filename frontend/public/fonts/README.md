# Self-hosted fonts

Every typeface the SPA renders is served from this directory. Nothing is fetched
from `fonts.googleapis.com` / `fonts.gstatic.com` / `cdnjs.cloudflare.com` at
runtime, which is what lets `nginx/conf/app.inc` keep `font-src 'self'`.

| Family | Weights | Subsets | Files |
|--------|---------|---------|-------|
| Atkinson Hyperlegible Next | 400, 700, 800 | latin, latin-ext | `atkinson-next-<subset>-<weight>.woff2` |
| Atkinson Hyperlegible Mono | 400, 500, 700 | latin, latin-ext | `atkinson-mono-<subset>-<weight>.woff2` |
| Comfortaa | 400, 700 | latin, latin-ext | `comfortaa-<subset>-<weight>.woff2` |

Why those weights and no italics: they are the only ones the app asks for
(`font-weight: 900` is everywhere in `tw.ts`, but Atkinson tops out at 800, so
the browser synthesises it from the 800 face — same rendering as when the faces
came from Google). Italic is never used. A new weight or an italic means adding
it to `FAMILIES` in `frontend/scripts/vendor-fonts.mjs` and re-running it.

Comfortaa is the `retro70` theme's heading face and nothing else: `--font-heading`
and `--font-display` point at it inside that theme's token block, while the UI and
its tabular readouts keep Atkinson in both themes. It is the face the approved
1970s stills (`/tmp/theme-mockups`, `DISPLAY`) are set in, and it is the only
family here with a subset allowlist — Google also answers with cyrillic, greek and
vietnamese, none of which the three shipped locales can render.

Regenerate (`frontend/` as cwd):

```sh
node scripts/vendor-fonts.mjs
```

The script rewrites both the `.woff2` files here and `src/styles/fonts.css`, so a
family update on Google Fonts is one command. Only that stylesheet is generated;
`OFL.txt` is the licence the faces ship under.

FontAwesome was removed in the same pass: `index.html` loaded its stylesheet
from cdnjs, but no component ever used an `fa-*` class.

Licence: SIL Open Font License 1.1 — see `OFL.txt` (Atkinson) and
`OFL-comfortaa.txt` (Comfortaa).
