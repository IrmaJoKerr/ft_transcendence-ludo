/** The rail's marks, drawn rather than typed (decision 1.4, 2026-11-09).
 *
 *  The rail used to hold one string per route — `⌂ ♛ @/ ♟ >_` — which is three
 *  systems of drawing in one column: `⌂` and `♛` are glyphs whose shape came from
 *  whatever font won the fallback, `♟` is a chess piece in a set the rest of the
 *  app never uses, and `@/` and `>_` are ASCII art pretending to be icons. At 34 px
 *  they read as five unrelated marks at three different weights, which is exactly
 *  what an icon set exists to stop.
 *
 *  One set, one grid, one weight: every path is drawn on a 24-unit grid, stroked
 *  with `currentColor` at 1.75 with round caps, and sized by the caller. Because
 *  the stroke is the inherited colour, a glyph follows the theme and the active
 *  state for free — the rail only sets `color`, never per-icon fills. No icon
 *  package: six shapes is not a dependency, and an SVG sprite would be a second
 *  build step for the same six strings.
 *
 *  Shapes, in the order the rail shows them: a house (home), a cup (the
 *  leaderboard — `♛` said "best", a trophy says "ranking"), a person (profile), two
 *  people (friends), and a console with a prompt and a cursor (the lobby channel —
 *  `>_` was already that idea, so the drawing keeps it and drops the ASCII). The
 *  sixth is `chat`: a speech bubble, which is the compact rail's only way into
 *  Hyperspace Comms (decided 2026-11-09). It is not a route and not in `navItems`;
 *  the bubble is a different idea from the channel's console, because one is a mark
 *  for a destination and the other opens a card over the page. */

export type NavGlyphName = 'home' | 'board' | 'profile' | 'friends' | 'channel' | 'chat';

/** One entry per shape, each a list of `d` attributes on the same grid. Paths are
 *  stroked, never filled: an outline at 34 px keeps its weight when the rail's
 *  active state changes colour, and a fill would need one value per state. */
const GLYPH_PATHS: Record<NavGlyphName, string[]> = {
  home: [
    // Roof, then the walls down to the ground, then the door.
    'M3.5 11.5 L12 4 L20.5 11.5',
    'M6 10.6 V20 H18 V10.6',
    'M10 20 V15.2 H14 V20',
  ],
  board: [
    // The cup with its two handles, the stem, and the base.
    'M7.75 3.75 H16.25 V9.25 A4.25 4.25 0 0 1 7.75 9.25 Z',
    'M7.75 5 H5 V6.9 A3.1 3.1 0 0 0 7.6 10',
    'M16.25 5 H19 V6.9 A3.1 3.1 0 0 1 16.4 10',
    'M12 13.5 V17',
    'M10.6 17 H13.4',
    'M9 20 H15',
  ],
  profile: [
    // Head, then shoulders: two arcs for the circle so it needs no `circle` node.
    'M15.4 8.4 A3.4 3.4 0 1 1 8.6 8.4 A3.4 3.4 0 1 1 15.4 8.4',
    'M4.5 20 C4.5 15.9 7.9 13.6 12 13.6 S19.5 15.9 19.5 20',
  ],
  friends: [
    // The near figure full, the far one as a head and a shoulder behind it.
    'M14.6 10.2 A2.9 2.9 0 1 1 8.8 10.2 A2.9 2.9 0 1 1 14.6 10.2',
    'M4 20 C4 16.6 6.4 14.4 9 14.4 S14 16.6 14 20',
    'M18.6 5.2 A2.2 2.2 0 0 1 18.6 10',
    'M16.4 14.6 C19.2 15.1 20.5 17.2 20.5 20',
  ],
  channel: [
    // A console frame, the `>` prompt inside it, and the cursor line after it.
    'M3 4.5 H21 V19.5 H3 Z',
    'M7 10 L10 13 L7 16',
    'M12.5 16 H17',
  ],
  chat: [
    // A speech bubble with its tail, then the two lines of what it carries.
    'M3.5 5 H20.5 V16 H12.5 L8 20 V16 H3.5 Z',
    'M7.5 9 H16.5',
    'M7.5 12.5 H13.5',
  ],
};

export function NavGlyph({ name, size = 20 }: { name: NavGlyphName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      // The button carries the name (label or `aria-label`); a second one here
      // would make a screen reader say it twice.
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      {GLYPH_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
