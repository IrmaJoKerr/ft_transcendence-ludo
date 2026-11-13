import type { ThemeType } from './store';
import cityscapeArt from './styles/themes/retro80/80s-Synthwave-Cityscape.jpg';
import colonyArt from './styles/themes/retro70/1970s-Orbital-Colony.jpg';

/** One member of the attract-mode crew: a node at (x, y) on the 720×400 card. */
export type HeroPawn = { label: string; color: string; x: number; y: number };

/**
 * The still a card is painted on.
 *
 * Both eras wear one, and this is the whole of the artwork either card has: the
 * cityscape and the colony are each a 1264×848 file sitting beside its own theme's
 * table (todo.md 33, decision 19), and `sceneArt` reads this field rather than a
 * per-kind branch.
 *
 * The two numbers are one placement: the art row `horizon` (as a fraction of its
 * height) is put on the card row `at`. The 80s card anchors its skyline on the card's
 * own horizon, so the drawn fallback and the still agree about where the ground
 * starts; the 70s card has no horizon to align to, so it pins the art's top edge to
 * the card's (todo.md 34, decision 7).
 */
export type HeroPlate = {
  src: string;
  /** The art row, as a fraction of its height, that is put on the card row `at`. */
  horizon: number;
  /** The card row that row lands on. */
  at: number;
  /** Two stops over the plate, top first. A plate is dimmed under the chrome that
   *  reads on it, and this is the era's own ink. */
  dim: readonly [string, string];
};

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
 * sibling is `'70s-Colony'`), so the name leads with the era while the theme id is
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
  plate: HeroPlate;
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
    // The art's own horizon (measured: 0.62 of its height) on the card's horizon,
    // which is `horizonY` (260) — the skyline stays above the grid below it, so the
    // swap from the drawn fallback is invisible.
    horizon: 0.62,
    at: 260,
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

/**
 * The 70s attract mode: the orbital colony itself, full bleed, with a few rocks
 * tumbling across its sky.
 *
 * The card was a drawn walnut lounge with the colony seen through a porthole until
 * todo.md 34: the still is what the era is about, and showing it through a 572×200
 * window at 0.82 alpha showed a picture of a picture. Now it is the ground, painted
 * by the same `paintPlate` the 80s card uses, and the only things drawn over it are
 * the stones, the streaks and the marquee.
 *
 * The still is 1264×848, the cityscape's size, so on this 720×400 card it covers at
 * 720×483 and 83 of its rows cannot fit: the placement spends them on the tiled
 * floor's front edge rather than on the porthole's crown (todo.md 34, decision 7).
 *
 * Only what varies lives here: the fallback sky, the two counters, the cream the
 * stones are drawn in and the marquee's colour. Geometry is the painter's.
 */
export type Colony70sScene = {
  kind: '70s-Colony';
  /**
   * The ground the card shows before its still decodes, and forever if it never
   * does: the retired room's sky, which is the darkest ground this era has. Three
   * stops, top first, so a failed still is a night sky rather than a blank card.
   */
  bgTop: string;
  bgMid: string;
  bgBot: string;
  /** The colony still: its top edge on the card's top edge (decision 7). */
  plate: HeroPlate;
  /** How many pinpricks the fallback sky is seeded with. They do not drift: they
   *  stand in for the still's own stars rather than animate. */
  starCount: number;
  starfield: string;
  /** How many streaks cross the sky, and how many stones tumble across it. */
  meteorCount: number;
  rockCount: number;
  /** The cream both are drawn in, as the channels an `rgba()` needs. */
  meteorColor: string;
  marqueeColor: string;
};

/** The 70s card. Geometry is the painter's; see `seedMeteor` and `seedRock` for the
 *  band both streaks and stones drift in. */
export const RETRO70_CFG: Colony70sScene = {
  kind: '70s-Colony',
  bgTop: '#07060e',
  bgMid: '#150c22',
  bgBot: '#20102c',
  plate: {
    src: colonyArt,
    // The art's top edge on the card's top edge: the porthole keeps its crown and
    // the floor runs off the bottom (decision 7).
    horizon: 0,
    at: 0,
    // Nearly flat, the opposite of the 80s card's ramp: this ground is a poster
    // whose middle is its subject, and its chrome sits along the top (decision 8).
    dim: ['rgba(7, 6, 14, 0.42)', 'rgba(7, 6, 14, 0.4)'],
  },
  starCount: 68,
  starfield: '255, 255, 255',
  meteorCount: 4,
  rockCount: 3,
  meteorColor: '255, 231, 189',
  marqueeColor: '#ffb000',
};

/** Every card: one scene per theme, discriminated on `kind`. */
export type HeroScene = Synthwave80sScene | Colony70sScene;

/** The scene a theme paints. One map, so a new `ThemeType` cannot ship unpainted. */
export const HERO_SCENES: Record<ThemeType, HeroScene> = {
  retro80: SYNTHWAVE_80S_CFG,
  retro70: RETRO70_CFG,
};

/**
 * The still a scene is made of: the colony, the city's skyline. Each file sits in its
 * own theme's folder beside that theme's table (todo.md 33, decision 19), and this is
 * the one place that knows which is which — the hook preloads what this names, and
 * each painter places it its own way through `plate`. A painter importing an asset
 * itself would put the path in two modules, and swapping one era's still would then be
 * a two-file edit.
 */
export function sceneArt(scene: HeroScene): string {
  return scene.plate.src;
}
