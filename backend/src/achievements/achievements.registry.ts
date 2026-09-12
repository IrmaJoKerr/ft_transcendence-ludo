/**
 * Achievement registry : single source of truth for all 15 achievements.
 * Adding a future achievement = one registry row; no new endpoints, no
 * duplicated unlock/notify logic.
 *
 * LifecycleCounts is computed once per evaluation (PVP/PVE only : hotseat is
 * demo-and-forget and never reaches the backend).
 *
 * NOTE: The generated Prisma client is built at container start, so we use
 * minimal structural types here rather than importing from the generated
 * client (which may not exist at type-check time in some environments).
 */

export const ACHIEVEMENT_KEYS: AchKey[] = [
  'achFirstBlood',
  'achOnFire',
  'achDiceMaster',
  'achBabySteps',
  'achTheDiceLoveMe',
  'achTactician',
  'achMaster',
  'achGrandBotMaster',
  'achWorldChampion',
  'achft_Transcendence',
  'achLoveTheMachine',
  'achSpeedDemon',
  'achUnstoppable',
  'achSteadyDefender',
  'achMercilessAttacker',
];

export const ACHIEVEMENT_RULES: AchievementRule[] = [
  {
    key: 'achFirstBlood',
    nameKey: 'dashboard.achFirstBlood',
    type: 'lifetime',
    target: 1,
    source: (ctx) => ctx.wins,
  },
  {
    key: 'achOnFire',
    nameKey: 'dashboard.achOnFire',
    type: 'lifetime',
    target: 2,
    source: (ctx) => ctx.winStreak,
  },
  {
    key: 'achDiceMaster',
    nameKey: 'dashboard.achDiceMaster',
    type: 'lifetime',
    target: 3,
    source: (ctx) => ctx.wins,
  },
  {
    key: 'achBabySteps',
    nameKey: 'dashboard.achBabySteps',
    type: 'lifetime',
    target: 1,
    source: (ctx) => ctx.botWins,
  },
  {
    key: 'achTheDiceLoveMe',
    nameKey: 'dashboard.achTheDiceLoveMe',
    type: 'lifetime',
    target: 3,
    source: (ctx) => ctx.botWins,
  },
  {
    key: 'achTactician',
    nameKey: 'dashboard.achTactician',
    type: 'lifetime',
    target: 5,
    source: (ctx) => ctx.wins,
  },
  {
    key: 'achMaster',
    nameKey: 'dashboard.achMaster',
    type: 'lifetime',
    target: 8,
    source: (ctx) => ctx.wins,
  },
  {
    key: 'achGrandBotMaster',
    nameKey: 'dashboard.achGrandBotMaster',
    type: 'lifetime',
    target: 12,
    source: (ctx) => ctx.wins,
  },
  {
    key: 'achWorldChampion',
    nameKey: 'dashboard.achWorldChampion',
    type: 'lifetime',
    target: 15,
    source: (ctx) => ctx.wins,
  },
  {
    key: 'achft_Transcendence',
    nameKey: 'dashboard.achft_Transcendence',
    type: 'lifetime',
    target: 10,
    source: (ctx) => ctx.humanWins,
  },
  {
    key: 'achLoveTheMachine',
    nameKey: 'dashboard.achLoveTheMachine',
    type: 'lifetime',
    target: 3,
    source: (ctx) => ctx.pveGameStreak,
  },
  {
    key: 'achSpeedDemon',
    nameKey: 'dashboard.achSpeedDemon',
    type: 'per-game',
    perGameTarget: 1,
    perGameSource: (part, game) => {
      // Win in < 30 min. Duration unknown (no startedAt) ⇒ no unlock.
      if (part.rank !== 1) return 0;
      if (!game.startedAt || !game.endedAt) return 0;
      const durationMs = new Date(game.endedAt).getTime() - new Date(game.startedAt).getTime();
      return durationMs < 30 * 60 * 1000 ? 1 : 0;
    },
  },
  {
    key: 'achUnstoppable',
    nameKey: 'dashboard.achUnstoppable',
    type: 'per-game',
    perGameTarget: 3,
    perGameSource: (part) => part.piecesCaptured,
  },
  {
    key: 'achSteadyDefender',
    nameKey: 'dashboard.achSteadyDefender',
    type: 'per-game',
    perGameTarget: 2,
    perGameSource: (part) => part.clashDefends,
  },
  {
    key: 'achMercilessAttacker',
    nameKey: 'dashboard.achMercilessAttacker',
    type: 'per-game',
    perGameTarget: 2,
    perGameSource: (part) => part.clashAttacksWon,
  },
];

export type AchKey =
  | 'achFirstBlood'
  | 'achOnFire'
  | 'achDiceMaster'
  | 'achBabySteps'
  | 'achTheDiceLoveMe'
  | 'achTactician'
  | 'achMaster'
  | 'achGrandBotMaster'
  | 'achWorldChampion'
  | 'achft_Transcendence'
  | 'achLoveTheMachine'
  | 'achSpeedDemon'
  | 'achUnstoppable'
  | 'achSteadyDefender'
  | 'achMercilessAttacker';

/** Minimal structural shape of a GameParticipant row (fields we read). */
export interface GameParticipantLike {
  rank: number;
  piecesCaptured: number;
  piecesInGoal: number;
  clashDefends: number;
  clashAttacksWon: number;
}

/** Minimal structural shape of a Game row (fields we read). */
export interface GameLike {
  startedAt: Date | string | null;
  endedAt: Date | string | null;
}

export interface LifecycleCounts {
  wins: number;        // rank-1 in PVP + PVE
  botWins: number;     // rank-1 in PVE
  humanWins: number;   // rank-1 in PVP
  totalGames: number;  // participations in PVP + PVE
  winStreak: number;   // User.winStreak
  pveGameStreak: number; // User.pveGameStreak (consecutive PvE games, any outcome)
}

export interface AchievementRule {
  key: AchKey;
  nameKey: string; // i18n key, e.g. 'dashboard.achDiceMaster'
  type: 'lifetime' | 'per-game';
  target?: number; // lifetime threshold (per-game uses perGameTarget)
  source?: (ctx: LifecycleCounts) => number; // lifetime: count
  perGameSource?: (part: GameParticipantLike, game: GameLike) => number; // per-game: value
  perGameTarget?: number;
}

export function getRule(key: AchKey): AchievementRule | undefined {
  return ACHIEVEMENT_RULES.find((r) => r.key === key);
}