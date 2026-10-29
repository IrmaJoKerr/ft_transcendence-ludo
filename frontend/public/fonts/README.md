# Self-hosted fonts

Every typeface the SPA renders is served from this directory. Nothing is fetched
from `fonts.googleapis.com` / `fonts.gstatic.com` / `cdnjs.cloudflare.com` at
runtime, which is what lets `nginx/conf/app.inc` keep `font-src 'self'`.

| Family | Weights | Subsets | Files |
|--------|---------|---------|-------|
| Atkinson Hyperlegible Next | 400, 700, 800 | latin, latin-ext | `atkinson-next-<subset>-<weight>.woff2` |
| Atkinson Hyperlegible Mono | 400, 500, 700 | latin, latin-ext | `atkinson-mono-<subset>-<weight>.woff2` |

Why those weights and no italics: they are the only ones the app asks for
(`font-weight: 900` is everywhere in `tw.ts`, but Atkinson tops out at 800, so
the browser synthesises it from the 800 face — same rendering as when the faces
came from Google). Italic is never used. A new weight or an italic means adding
it to `FAMILIES` in `frontend/scripts/vendor-fonts.mjs` and re-running it.

Regenerate (`frontend/` as cwd):

```sh
node scripts/vendor-fonts.mjs
```

The script rewrites both the `.woff2` files here and `src/styles/fonts.css`, so a
family update on Google Fonts is one command. Only that stylesheet is generated;
`OFL.txt` is the licence the faces ship under.

FontAwesome was removed in the same pass: `index.html` loaded its stylesheet
from cdnjs, but no component ever used an `fa-*` class.

Licence: SIL Open Font License 1.1 — see `OFL.txt`.
