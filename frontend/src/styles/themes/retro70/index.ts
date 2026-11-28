// The 1970s theme: its palette, its plate and its own piece set, in one folder.

import { RETRO70_CFG } from '../../../heroScenes';
import type { ThemeDefinition } from '../types';
import { RETRO_70_PIECES } from './pieces';

export const RETRO_70_THEME: ThemeDefinition = {
  id: 'retro70',
  label: "RETRO 70'S",
  swatch: ['#e5340b', '#ffb000'],
  pieces: RETRO_70_PIECES,
  heroScene: RETRO70_CFG,
  diceEra: 'retro70',
  themeColor: '#14100e',
  beepHz: 660,
  era: '70',
  shell: 'walnut',
};
