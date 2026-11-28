// The 1980s theme: its palette, its plate and its own piece set, in one folder.

import { SYNTHWAVE_80S_CFG } from '../../../heroScenes';
import type { ThemeDefinition } from '../types';
import { RETRO_80_PIECES } from './pieces';

export const RETRO_80_THEME: ThemeDefinition = {
  id: 'retro80',
  label: "RETRO 80'S",
  swatch: ['#ff007f', '#00f0ff'],
  pieces: RETRO_80_PIECES,
  heroScene: SYNTHWAVE_80S_CFG,
  diceEra: 'retro80',
  themeColor: '#070114',
  beepHz: 880,
  era: '80',
  shell: 'synthwave',
};
