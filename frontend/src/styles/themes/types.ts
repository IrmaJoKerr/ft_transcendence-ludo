// One theme's definition. The registry lists these rows; a renderer reads a row and
// never tests a theme id. A new era is one folder plus one row here.

import type { PieceSetDefinition } from '../../game/pieceTypes';
import type { HeroScene } from '../../heroScenes';
import type { DiceEra } from '../../utils/audio/dice';

export type ThemeType = 'retro80' | 'retro70';

export type ThemeDefinition = {
  id: ThemeType;
  label: string;
  swatch: [string, string];
  // The theme's own piece set, passed straight to `PieceFigure`.
  pieces: PieceSetDefinition;
  heroScene: HeroScene;
  diceEra: DiceEra;
  // The `<meta name="theme-color">` value and the switcher's cue.
  themeColor: string;
  beepHz: number;
  // The locale suffix the Squads page appends (`nickRed70` / `nickRed80`), and the
  // dock's shell flavour. Both are data, not a branch on `id`.
  era: '70' | '80';
  shell: 'walnut' | 'synthwave';
};
