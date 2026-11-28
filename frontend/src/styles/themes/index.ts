// The one list of eras. Every renderer reads a row from here; nothing else spells a
// theme id. A third theme is one folder plus one row and its `ThemeType` member.

import { RETRO_70_THEME } from './retro70';
import { RETRO_80_THEME } from './retro80';
import type { ThemeDefinition, ThemeType } from './types';

export type { ThemeDefinition, ThemeType } from './types';

export const THEMES: readonly ThemeDefinition[] = [RETRO_80_THEME, RETRO_70_THEME];

export const THEME_BY_ID: Record<ThemeType, ThemeDefinition> = {
  retro80: RETRO_80_THEME,
  retro70: RETRO_70_THEME,
};

export const DEFAULT_THEME: ThemeType = 'retro80';

// Kept for the hero hook and any caller that wants the scene alone; derived from the
// same rows, so it cannot list an era the registry does not.
export const HERO_SCENES = THEMES.reduce(
  (scenes, theme) => {
    scenes[theme.id] = theme.heroScene;
    return scenes;
  },
  {} as Record<ThemeType, ThemeDefinition['heroScene']>,
);
