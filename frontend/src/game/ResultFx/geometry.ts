// ── Geometry ─────────────────────────────────────────────────────────────────
// One fixed stage for every act and both cards (D28): the box never changes size, only
// what is drawn in it and where each act's centre falls.
export const VB_W = 240;
export const VB_H = 180;
// The ground line every act stands on, and the row under it the sentence reads in.
export const GROUND_Y = 120;
export const BANNER_Y = 162;

// The pair stage: defender left, attacker right on one line, never swapped, so a chain's
// rounds read as one shot. `PIECE_W` is the 36-unit cast box every strike is measured
// from; the seats stay at centres 24.5 and 150.5.
export const PAIR_CX = 150;
export const PIECE_W = 36;
export const STRIKE_Y = 84; // the strike line: 13 under the box's top, 23 over its floor
export const GLYPH_Y = STRIKE_Y - 13; // 71: the box is y 71 to 107, 13 units of ground under it
export const DEFENDER_GLYPH_X = 6.5; // 24.5, the seat's own centre, less half the box
export const ATTACKER_GLYPH_X = PAIR_CX - 17.5; // 132.5: the same seat held on the right
// The widest x BOTH cards can show: the flash window's own width. A mark drawn past it
// would be cut on the small card and kept on the big one, which is the one difference
// the two cards are not allowed to have (25.18).
export const SHARED_X_MAX = 192;

// The wall stage: `n` defenders on the cast's diagonal under a dome of `n` rings, one
// ring removed per success. Boxes taper from x 108 up-left; the attacker takes the right
// bay at x 196-232, outside the dome.
export const WALL_MAX = 4;
export const WALL_TAPER = 0.82; // each further defender's width, against the one in front
export const WALL_OVERLAP = 1 / 3; // ...and the share of that box the piece in front covers
export const WALL_DY = 8.4; // the rise of every rung
// The front-most box: lowest and right-most, because the shot arrives from the right. A
// literal now, since the column no longer orbits a curve's centre.
export const WALL_FRONT_X = 108;
export const WALL_ATTACKER_X = 196; // the attacker's own 36-unit bay, outside the dome
export const BEAM_INSET = 6; // the shot leaves its shooter 6 units inside the glyph's edge

// The dome (25.3 rule 5): four frozen rings, measured and fitted rather than drawn by eye, so a
// later redraw re-runs the sum instead of re-guessing it.
export const DOME_CX = 85;
export const DOME_STROKE = 3.0; // the outermost ring's weight, and the half-stroke in the fit
export const DOME_PAD = 4 / 1.75; // 4 px of breathing room, at the stage's own pixels per unit
export const DOME_R_INK = 74.88; // the minimal semicircle about the sampled ink
export const DOME_R_IN = +(DOME_R_INK + DOME_PAD + DOME_STROKE / 2).toFixed(1); // 78.7
export const DOME_GAP = 5.5; // the pitch to the next ring outward
// To a tenth, because the fitted numbers are tenths and 78.7 + 3 x 5.5 is 95.199... in
// floating point: 78.7, 84.2, 89.7 and 95.2, the last the line the shot meets.
export const DOME_RADII = [0, 1, 2, 3].map((i) => +(DOME_R_IN + i * DOME_GAP).toFixed(1));
// The strokes invert the old ladder, 2.2 at the innermost out to 3.2 at the outermost, so the face
// the shot meets and the line that glitches out is the heaviest of the four. A 5-unit stroke
// cannot live on a 5.5-unit pitch either: it would leave half a unit of ground between two rings.
export const DOME_STROKES = [2.2, 2.4, 2.8, 3.2]; // the same four, innermost first

// The cloud stage: the breach's own act, drawn on the shield's centre line because the
// mushroom stands where the wall stood. Its ring marks the blast footprint, inside the
// dome's innermost 78.7.
export const CLOUD_RING_R = 46;
export const CLOUD_RING_RY = 9; // a ring lying on the ground is seen edge-on, so it is flat
// The mushroom: a stem that widens as it reaches the ground and a head of three puffs (two side,
// one crown) joined by a belly bar.
export const CLOUD_STEM_BASE_HALF = 15; // ...at the ground
export const CLOUD_STEM_TOP_HALF = 7; // ...where it meets the head
export const CLOUD_STEM_TOP_UP = 41; // above the ground line; also the belly's underside
export const CLOUD_HEAD_UP = 50; // the side puffs' centres, above the ground line
export const CLOUD_HEAD_R = 17;
export const CLOUD_HEAD_X = 18; // their centres' offset from `DOME_CX`
export const CLOUD_CROWN_UP = 64; // the crown puff, one step higher and wider
export const CLOUD_CROWN_R = 22;
export const CLOUD_BELLY_UP = 56; // the bar that joins the three puffs to the stem
export const CLOUD_BELLY_HALF = 21;

// The sentence's fit, because it carries a player's name and 27 was sized for an eleven character
// word (25.4). The estimate is the display face's average advance at weight 900, and the floor is
// the smallest size that still reads at the small card's scale.
export const BANNER_MAX_FS = 27;
export const BANNER_MIN_FS = 11;
export const BANNER_ADVANCE = 0.62; // per character, at `--font-display` weight 900
export const BANNER_PAD = 8; // each side of the stage

// The clash stage's own cap, read by `ClashOverlay` so the two cards cannot drift apart.
export const CLASH_STAGE_MAX_PX = 420;
// The flash card is the clash stage at 0.8: same 4:3 and pixels per unit, showing the
// side both pieces stand on. Its 192 x 144 window centres the cell box; it never shows
// a wall.
export const FLASH_CARD_STAGE_MAX_PX = 336;
export const FLASH_CARD_VIEWBOX = '0 15 192 144';
export const FLASH_CARD_ASPECT = 192 / 144;

// An eight-point star, centred on the impact, for the puncture flash.
export const starAt = (cx: number, cy: number, r = 9) =>
  `M ${cx} ${cy - r} L ${cx + r * 0.28} ${cy - r * 0.28} L ${cx + r} ${cy} ` +
  `L ${cx + r * 0.28} ${cy + r * 0.28} L ${cx} ${cy + r} L ${cx - r * 0.28} ${cy + r * 0.28} ` +
  `L ${cx - r} ${cy} L ${cx - r * 0.28} ${cy - r * 0.28} Z`;

// One ring of the dome, r units out from its centre: a half circle standing on the ground
// line, which is as much curvature as a card of this size can read. Gentler or flatter is
// allowed — it is a fitting value and not a shape ruling (25.3 rule 5).
export const shieldCurve = (r: number) =>
  `M ${DOME_CX - r} ${GROUND_Y} A ${r} ${r} 0 0 1 ${DOME_CX + r} ${GROUND_Y}`;
