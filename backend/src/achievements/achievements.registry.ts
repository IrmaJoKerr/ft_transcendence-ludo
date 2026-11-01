// The authoritative list of the 16 achievements.
// Adding one means adding a row here. Uses structural types because the generated
// Prisma client may not exist at type-check time.

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
  | 'achMercilessAttacker'
  | 'achTearDownThisWall';

// Minimal structural shape of a MatchHistory row (the fields the rules read). One
// row already belongs to one seat, so a per-game rule never has to find "my
// participation" in a list: the row is it.
export interface MatchRowLike {
  rank: number;
  totalCaptures: number;
  piecesInGoal: number;
  clashDefends: number;
  clashAttacksWon: number;
  clashWallBattlesWon: number;
  gameType: 'PVP' | 'PVE';
  durationMs: number;
}

export interface LifecycleCounts {
  wins: number; // rank-1 in PVP + PVE
  botWins: number; // rank-1 in PVE
  humanWins: number; // rank-1 in PVP
  totalGames: number; // games played, PVP + PVE
  winStreak: number; // PlayerStats.winStreak
  pveGameStreak: number; // PlayerStats.pveGameStreak (consecutive PvE games, any outcome)
}

export interface AchievementRule {
  key: AchKey;
  nameKey: string; // i18n key, e.g. 'dashboard.achDiceMaster'
  type: 'lifetime' | 'per-game';
  target?: number; // lifetime threshold (per-game uses perGameTarget)
  source?: (ctx: LifecycleCounts) => number; // lifetime: count
  perGameSource?: (row: MatchRowLike) => number; // per-game: value
  perGameTarget?: number;
}

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
  'achTearDownThisWall',
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
    perGameSource: (row) => {
      // Win in < 30 min. The row stores the duration it took, so the answer never
      // changes: a row with no duration (0) has no unlock to give.
      if (row.rank !== 1 || row.durationMs <= 0) return 0;
      return row.durationMs < 30 * 60 * 1000 ? 1 : 0;
    },
  },
  {
    key: 'achUnstoppable',
    nameKey: 'dashboard.achUnstoppable',
    type: 'per-game',
    perGameTarget: 3,
    perGameSource: (row) => row.totalCaptures,
  },
  // The two clash achievements match the source's numbers: two rounds won on
  // either side of one clash-mode game.
  {
    key: 'achSteadyDefender',
    nameKey: 'dashboard.achSteadyDefender',
    type: 'per-game',
    perGameTarget: 2,
    perGameSource: (row) => row.clashDefends,
  },
  {
    key: 'achMercilessAttacker',
    nameKey: 'dashboard.achMercilessAttacker',
    type: 'per-game',
    perGameTarget: 2,
    perGameSource: (row) => row.clashAttacksWon,
  },
  // The Wall Breaker: two clash chains won on a wall in one game
  // (achTearDownThisWall). A wall stood 2 or more defenders, banked by an armed exit
  // that crossed it and won, or a later landing on a 2-stack that did. Two are
  // reachable in one clash-mode game.
  {
    key: 'achTearDownThisWall',
    nameKey: 'dashboard.achTearDownThisWall',
    type: 'per-game',
    perGameTarget: 2,
    perGameSource: (row) => row.clashWallBattlesWon,
  },
];
