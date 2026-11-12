import type { ThemeType } from './store';
import cityscapeArt from './styles/themes/retro80/80s-Synthwave-Cityscape.jpg';
import colonyArt from './styles/themes/retro70/1970s-Orbital-Colony.jpg';

/** One member of the attract-mode crew: a node at (x, y) on the 720×400 card. */
export type HeroPawn = { label: string; color: string; x: number; y: number };

/**
 * The synthwave attract mode: a sunset, a strafing starfield, a horizon grid and
 * four hologram nodes under the marquee.
 *
 * This is the palette that used to be an inline `cfg` inside `Home.tsx`'s effect,
 * moved out unchanged so a second theme can sit beside it. Every value is the one
 * that shipped: the colours here are the only thing a painter reads from a scene —
 * geometry stays in `heroBackdrops.ts`, where the literals are still visible next
 * to the drawing calls that use them.
 *
 * Already renamed for the artwork, not the theme: `kind` names a drawing (its
 * sibling is `'room'`), so the name leads with the era while the theme id is
 * `retro80` (todo.md 33, decision 18).
 */
export type Synthwave80sScene = {
  kind: '80s-Synthwave';
  bgTop: string;
  bgMid: string;
  bgBot: string;
  /**
   * The card's own still: the cityscape the shell wears as its ground, which is
   * the same shot the drawn sunset below approximates. The painter lays it over
   * the gradient and retires the sun and the grid while it is up, because art
   * that already carries a sun, a skyline and a grid must not be given a second
   * of each. The drawn card is what shows until this decodes, and forever if it
   * never does.
   */
  plate: {
    src: string;
    /** The art's own horizon as a fraction of its height (measured: 0.62), so the
     *  card can put that row on its own horizon whatever the crop turns out to be. */
    horizon: number;
    /** Two stops over the plate, top first. A plate is dimmed under the chrome that
     *  reads on it, and this is the shell's navy — lighter alphas, because what
     *  reads over this one is a marquee and four labels rather than body text. */
    dim: readonly [string, string];
  };
  /** The disc: its centre is the card's midline (360 of 720) and its rim is `r`. */
  sun: { y: number; r: number; c1: string; c2: string; scanline: string };
  /** The perspective grid's stroke, drawn below `horizonY`. */
  gridColor: string;
  /** Where the ground starts: the grid's vanishing line and the starfield's floor. */
  horizonY: number;
  /** How many stars drift across the sky. */
  starCount: number;
  starfield: string;
  crew: HeroPawn[];
  marqueeColor: string;
};

/** The 80s card. Values verbatim from `Home.tsx` before the split. */
export const SYNTHWAVE_80S_CFG: Synthwave80sScene = {
  kind: '80s-Synthwave',
  bgTop: '#070114',
  bgMid: '#160530',
  bgBot: '#05010d',
  plate: {
    src: cityscapeArt,
    horizon: 0.62,
    dim: ['rgba(13, 2, 33, 0.16)', 'rgba(13, 2, 33, 0.55)'],
  },
  sun: {
    y: 250,
    r: 90,
    c1: 'rgba(255, 230, 0, 0.72)',
    c2: 'rgba(255, 0, 127, 0.38)',
    scanline: 'rgba(13, 2, 33, 0.6)',
  },
  gridColor: 'rgba(0, 240, 255, 0.45)',
  horizonY: 260,
  starCount: 65,
  starfield: '255, 255, 255',
  crew: [
    { label: 'RED', color: '#ff0055', x: 85, y: 350 },
    { label: 'GREEN', color: '#00ff88', x: 230, y: 360 },
    { label: 'YELLOW', color: '#ffe600', x: 490, y: 360 },
    { label: 'BLUE', color: '#00f0ff', x: 635, y: 350 },
  ],
  marqueeColor: '#00f0ff',
};

/** A crew member as the scene declares it: the art itself lives in `game/pieceParts.ts`. */
export type RoomLegend = { label: string; color: string; x: number };

/**
 * The 70s attract mode: a walnut lounge looking out of a porthole onto a ringed
 * planet, with the four seats standing in the window and the marquee above.
 *
 * The room is the approved pick (`/tmp/theme-mockups`, `dialects.py`'s
 * `bd_porthole`): the interior carries the decade and the sky is only ever seen
 * through it. The window ends at y 218 because the app's own press-start card
 * starts at 234 — the frame, the ledge and the card are three separate bands, and
 * no sky is spent where the card would hide it.
 *
 * The view through that window is the era's still (`sceneArt`), placed by the
 * painter rather than declared here: it is cover-cropped to the opening, not to
 * the card, which is a different placement from the 80s plate's.
 *
 * Only what varies lives here: the crew's placement and the two colours the canvas
 * prints. The room's own palette is fixed walnut and is not a theme knob.
 */
export type RoomScene = {
  kind: 'room';
  starCount: number;
  /** The seat legend under the card, left to right. */
  legend: RoomLegend[];
  marqueeColor: string;
};

/** The 70s card. Geometry is the pick's; see `paintRoom` for the bands. */
export const RETRO70_CFG: RoomScene = {
  kind: 'room',
  starCount: 68,
  legend: [
    { label: 'RED', color: '#ff007f', x: 128 },
    { label: 'GREEN', color: '#00ff88', x: 286 },
    { label: 'YELLOW', color: '#ffe600', x: 470 },
    { label: 'BLUE', color: '#00f0ff', x: 606 },
  ],
  marqueeColor: '#ffb000',
};

/** Every card: one scene per theme, discriminated on `kind`. */
export type HeroScene = Synthwave80sScene | RoomScene;

/** The scene a theme paints. One map, so a new `ThemeType` cannot ship unpainted. */
export const HERO_SCENES: Record<ThemeType, HeroScene> = {
  retro80: SYNTHWAVE_80S_CFG,
  retro70: RETRO70_CFG,
};

/**
 * The still a scene is made of: the room's colony, the city's skyline. Each file
 * sits in its own theme's folder beside that theme's table (todo.md 33, decision
 * 19), and this is the one place that knows which is which — the hook preloads
 * what this names, and each painter places it its own way. A painter importing an
 * asset itself would put the path in two modules, and swapping one era's still
 * would then be a two-file edit.
 */
export function sceneArt(scene: HeroScene): string {
  return scene.kind === 'room' ? colonyArt : scene.plate.src;
}
