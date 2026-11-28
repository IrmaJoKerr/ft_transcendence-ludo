// The two eras the die is voiced for: the molded plastic die and the LED one.
export type DiceEra = 'retro70' | 'retro80';

// Everything the die's three cues are made of, so a walk can re-voice the rattle without reading a
// method (38).
export type DiceVoicing = {
  // The rattle's tick: one per quarter turn, so the interval is the plan's, not a number.
  tickType: OscillatorType;
  tickHz: number;
  tickSeconds: number;
  // A flop: the body thump (falling `flopHz` → `flopDropHz`) and the edge's noise.
  flopType: OscillatorType;
  flopHz: number;
  flopDropHz: number;
  flopSeconds: number;
  flopNoiseHz: number;
  // The settle: the face's own note, held, plus a fifth above it.
  settleType: OscillatorType;
  settleHz: number;
  settleSeconds: number;
};

export const DICE_SFX: Record<DiceEra, DiceVoicing> = {
  retro70: {
    tickType: 'triangle',
    tickHz: 1180,
    tickSeconds: 0.036,
    flopType: 'sine',
    flopHz: 900,
    flopDropHz: 240,
    flopSeconds: 0.16,
    flopNoiseHz: 1500,
    settleType: 'triangle',
    settleHz: 320,
    settleSeconds: 0.32,
  },
  retro80: {
    tickType: 'square',
    tickHz: 2100,
    tickSeconds: 0.028,
    flopType: 'square',
    flopHz: 1500,
    flopDropHz: 420,
    flopSeconds: 0.13,
    flopNoiseHz: 3200,
    settleType: 'square',
    settleHz: 620,
    settleSeconds: 0.26,
  },
};
