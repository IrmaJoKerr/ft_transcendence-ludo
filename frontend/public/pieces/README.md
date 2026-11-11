# The piece stills

The 24 drawings the board and the clash card can show, as files: four figures per theme
(`70s`, `80s`), three poses each (`front`, `left`, `right`), one `.svg` per drawing.

**They are not used at runtime.** The game draws every piece live, as SVG, through
`src/components/PieceFigure.tsx` — a `<g>` per piece, scaled into whatever box the
caller owns. These files exist so that if the live path is ever swapped for sprites, the
sprites are already the component's own output: same part tables (`game/pieceParts.ts`,
`game/pieceParts80.ts`), same palettes, same two transforms.

| field | value |
| --- | --- |
| size | 116 px as the `svg`'s own `width`/`height`, i.e. 2× the clash card's 58 px glyph; the `0 0 100 100` box it carries serves any other size, so one file covers the board's 30 px piece, the card's 58 px glyph and a doc page |
| background | none — no backdrop rect, so a still drops onto the board, the card or a doc |
| naming | `{theme}-{seat}-{pose}.svg`, theme `70s`/`80s`, seat `red`/`green`/`yellow`/`blue` |
| format | `svg` only, and it is the canon: the generator writes this file and a `png` is a raster **of** it, opt-in (`STILL_PNG=1`). The 24 `svg`s come to 192 KB, the rasters they used to sit beside came to 240 KB, and the vector is the one that can be diffed against the component (`discarded.md` IK) |
| pose | `front` faces the viewer (the board's own drawing, and the flat table's own order — see `todo.md` [29.3](todo.md#rv29-jaw)); `left`/`right` are the clash card's facings, and they are the **same rule on both sets**: a face plate sliding inside a head that stays put — `CREW_TURN`'s squash 0.8 about x 50 plus a 6-unit slide, applied to the 70s helmet's `visor` and to the 80s `PIECE_FACE_80` slice of each head. Nothing is mirrored, nothing is flipped, and no head leaves its collar (`todo.md` [30](todo.md#rv30-set)) |

## Regenerating

From `frontend/`:

```
npx tsx ../tools/80s/poses.ts
```

It repaints one theme at a time: `STILL_SETS` picks them, and it defaults to `retro80`
because only the 80s art was redrawn in `todo.md` [30](todo.md#rv30-set) — the 70s files
on disk are the reviewed ones. Pass `STILL_SETS=retro70` or `STILL_SETS=retro70,retro80`
when that art changes. Add `STILL_PNG=1` in front of the command only if a raster is
actually needed: `rsvg-convert` then writes a 116 px `png` beside each `svg` it just
wrote, which is the direction the dependency runs.

That one script also writes the review sheets beside itself (`poses.png` — the whole
cast in three poses at 110/58/30 px, `poses-variants.png` — the 80s face plate against
the refused whole-head slide, `poses-wall.png` — the wall at the card's own 1.75
px/unit), and `../tools/80s/posecheck.py` measures them. Because the generator imports
the shipped tables rather than copying them, a still cannot disagree with the component:
change the art and the next run repaints both.
