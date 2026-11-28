import cityscapeArt from './styles/themes/retro80/80s-Synthwave-Cityscape.jpg';
import colonyArt from './styles/themes/retro70/1970s-Orbital-Colony.jpg';

// A circle on the still: `cx` and `r` as fractions of the art's own width, `cy` as a fraction of
// its height.
export type PlateCircle = { cx: number; cy: number; r: number };

// The still a card is painted on.
export type HeroPlate = {
  src: string;
    // The art row, as a fraction of its height, that is put on the card row `at`.
  horizon: number;
    // The card row that row lands on.
  at: number;
    // Two stops over the plate, top first. A plate is dimmed under the chrome that
  //  reads on it, and this is the era's own ink.
  dim: readonly [string, string];
};

// The synthwave attract mode: a sunset, a strafing starfield and a horizon grid.
export type Synthwave80sScene = {
  kind: '80s-Synthwave';
  bgTop: string;
  bgMid: string;
  bgBot: string;
        // The card's own still: the cityscape the shell wears as its ground, which is the same shot the
    // drawn sunset below approximates.
  plate: HeroPlate;
    // The disc: its centre is the card's midline (360 of 720) and its rim is `r`.
  sun: { y: number; r: number; c1: string; c2: string; scanline: string };
    // The perspective grid's stroke, drawn below `horizonY`.
  gridColor: string;
    // Where the ground starts: the grid's vanishing line and the starfield's floor.
  horizonY: number;
    // How many stars drift across the sky.
  starCount: number;
  starfield: string;
  marqueeColor: string;
};

// The 80s card. Values verbatim from `Home.tsx` before the split.
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
  marqueeColor: '#00f0ff',
};

// The 70s attract mode: the orbital colony itself, full bleed, with a few rocks tumbling across
// its sky.
export type Colony70sScene = {
  kind: '70s-Colony';
    // The ground the card shows before its still decodes, and forever if it never
  // does: the retired room's sky, which is the darkest ground this era has. Three
  // stops, top first, so a failed still is a night sky rather than a blank card.
  bgTop: string;
  bgMid: string;
  bgBot: string;
    // The colony still: its top edge on the card's top edge (decision 7).
  plate: HeroPlate;
    // The porthole the colony looks out through, in the still's own fractions: the
  // circle the traffic is confined to. Measured off the artwork (centre 633, 453 of
  // 1264×848, radius 390), where the cream ring's inner edge closes the window.
  porthole: PlateCircle;
        // The gas giant hung in that porthole, same units (centre 642, 242, radius 141). The traffic
    // passes in front of it, so the frame mask is cleared over this disc: the planet is sky, not
    // frame, and rock in front of it is the one place a stone may cross something bright.
  planet: PlateCircle;
    // How many pinpricks the fallback sky is seeded with. They do not drift: they
  //  stand in for the still's own stars rather than animate.
  starCount: number;
  starfield: string;
    // How many streaks cross the sky, and how many stones tumble across it.
  meteorCount: number;
  rockCount: number;
    // The cream both are drawn in, as the channels an `rgba()` needs.
  meteorColor: string;
  marqueeColor: string;
};

// The 70s card. Geometry is the painter's; see `seedMeteor` and `seedRock` for the
//  band both streaks and stones drift in.
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
  // Measured off the poster: the window's inner rim, and the planet inside it. Both
  // are quoted in the type's own doc; the fractions are those pixels over 1264×848.
  porthole: { cx: 0.5008, cy: 0.5342, r: 0.3085 },
  planet: { cx: 0.5079, cy: 0.2854, r: 0.1116 },
  starCount: 68,
  starfield: '255, 255, 255',
  meteorCount: 4,
  // Matched to the 80s starfield's 65, so the two cards carry the same traffic density.
  rockCount: 65,
  meteorColor: '255, 231, 189',
  marqueeColor: '#ffb000',
};

// Every card: one scene per theme, discriminated on `kind`.
export type HeroScene = Synthwave80sScene | Colony70sScene;

// The still a scene is made of: the colony, the city's skyline.
export function sceneArt(scene: HeroScene): string {
  return scene.plate.src;
}
