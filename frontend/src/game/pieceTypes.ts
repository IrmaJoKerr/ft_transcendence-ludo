// Shared vocabulary for both piece sets: the paint roles, the five part shapes,
// the resolved palette record, and the pose and layer types the renderer walks.

import type { ColorKey } from '../theme';

export type PieceRole =
  | 'base'
  | 'hi'
  | 'lit'
  | 'shd'
  | 'lo'
  | 'deep'
  | 'deepink'
  | 'pop'
  | 'ink'
  | 'cream'
  | 'white'
  // The 80s set's one face paint. Hue-independent, like the creams: a face is a
  //  face on every seat, and the four teams are four characters, not four hues.
  | 'skin'
  // Linear body gradient, hi → base → lo: the torso.
  | 'lid'
  // The hero's torso: the same ramp lit flatter, for a figure 47 px tall.
  | 'lidCrew'
  // Radial body gradient, hi → base → lo: the helmet globe.
  | 'gid';
// A paint slot, or `none` for a stroke-only part.
type Paint = PieceRole | 'none';
type Linecap = 'butt' | 'round';
// One part of the figure. Five shapes rather than one path string, because the source is
// rect/circle/ellipse/line/path and both renderers have a native call for each — a rotated ellipse
// baked into path arcs by hand is where a port like this goes wrong silently.
export type PiecePart =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      rx?: number;
      fill: Paint;
      stroke?: Paint;
      strokeW?: number;
      opacity?: number;
    }
  | {
      kind: 'circle';
      cx: number;
      cy: number;
      r: number;
      fill: Paint;
      stroke?: Paint;
      strokeW?: number;
      opacity?: number;
    }
  | {
      kind: 'ellipse';
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      // Degrees about the ellipse's own centre.
      rotate?: number;
      fill: Paint;
      stroke?: Paint;
      strokeW?: number;
      opacity?: number;
    }
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      stroke: Paint;
      strokeW?: number;
      opacity?: number;
      linecap?: Linecap;
    }
  | {
      kind: 'path';
      d: string;
      fill: Paint;
      stroke?: Paint;
      strokeW?: number;
      opacity?: number;
      linecap?: Linecap;
    };
// Every colour role resolved for one seat. The three gradient roles are built from
//  these stops, not from a colour of their own.
export type PiecePalette = Record<Exclude<PieceRole, 'lid' | 'lidCrew' | 'gid'>, string>;
// A helmet splits into `visor` (turns with the face) and `outside` (pods and aerials
// stay upright), so the crew can turn its head. On the board both groups are drawn
// untransformed.
export type HelmetSet = { visor: PiecePart[]; outside: PiecePart[] };
// The three poses a fight needs, and the board does not.
export type PiecePose = 'front' | 'left' | 'right';
// Which decade's drawing to lay down: the 70s bobbleheads or the 80s set.
export type PieceSet = 'retro70' | 'retro80';
// One run of a figure's parts, drawn together: `turn` marks the run a pose moves.
export type PieceLayer = { parts: PiecePart[]; turn: boolean };
// A figure cut at the neck, in the order it has to be drawn.
export type PieceLayers = PieceLayer[];

// One theme's complete piece set: the id it is drawn from, and the two functions
// the renderer calls for a seat. The theme row owns this object, so adding a set
// is a theme folder, not a second registry.
export type PieceSetDefinition = {
  id: PieceSet;
  layers: (ck: ColorKey) => PieceLayers;
  palette: (ck: ColorKey) => PiecePalette;
};
