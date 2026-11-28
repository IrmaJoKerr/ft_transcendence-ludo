import type { PresenceStatus } from '../../theme';

// What the backend allows this viewer to see: `full`, or one of the two blocked
// states. A blocked payload is the identity and avatar only.
export type ProfileVisibility = 'full' | 'blocked-by-you' | 'blocked-by-them';

export interface UserProfile {
  id: string;
  username: string;
  displayName?: string;
  avatarStyle: string | null;
  hasAvatarPhoto: boolean;
  // The avatar-meta stamp, echoed into `?v=` so a stale photo is never reused.
  avatarV?: number;
  // Absent only from a pre-gate payload; read as full.
  visibility?: ProfileVisibility;
  // The career row (PlayerStats), not the account: rating, record and streaks all
  // live together there. Absent on a blocked payload, which carries identity only.
  stats?: {
    rating: number;
    highestRating: number;
    gamesPlayed: number;
    wins: number;
    losses: number;
    winStreak: number;
    bestWinStreak: number;
    botWins: number;
    humanWins: number;
    lastRatingDelta: number;
  } | null;
  createdAt: string;
  status: PresenceStatus;
}

// One seat of a finished room, as the row's snapshot keeps it: a bot seat is in
// here too (a bot has no account, so `isBot` is the only marker it ever gets).
export type MatchParticipant = {
  username: string;
  displayName: string;
  avatarStyle: string | null;
  hasAvatarPhoto: boolean;
  color: string; // 'RED' | 'GREEN' | 'YELLOW' | 'BLUE'
  rank: number | null;
  isBot: boolean;
};

// The room a match was played in, recorded with the row (room-rules.ts on the
// backend). `{}` means the standard room.
export type RoomRules = {
  clashEnabled?: boolean;
  noSafeZones?: boolean;
  freeExit?: boolean;
  clashKeyShift?: number;
  captureFx?: boolean;
  playerCount?: number;
};

// One finished match. Every counter is the one the match recorded: `ratingDelta`
// is the clamped delta that was applied, never recomputed here.
export type MatchHistoryRow = {
  gameId: string;
  playedAt: string;
  durationMs: number;
  gameType: 'PVP' | 'PVE';
  gameModes: RoomRules | null;
  color: string;
  // 1 on the winning row, 2 on every other: the engine records no placement, so this is a win/loss
  // bit and never a podium. A `rank` that is not 1 on a completed row is a loss — not "second" —
  // because the only seat that finished is the one that brought its fourth piece home.
  rank: number | null;
  // COMPLETED or ABANDONED (M5). A win is `rank === 1` on a completed row; an
  // abandoned row is neither a win nor a loss, and shows as its own third state.
  status: 'COMPLETED' | 'ABANDONED';
  ratingDelta: number;
  totalTurns: number;
  totalCaptures: number;
  piecesInGoal: number;
  piecesLost: number;
  // Three-six forfeits: the only sixes number a row keeps (faces rolled are not
  // stored, so there is no "rolls" or "sixes" counter any more).
  threeSixes: number;
  // Clash rounds, split by the side the seat stood on. The profile prints the two
  // sums ("clash won/lost"), never a single number: the same seat attacks one
  // round and defends the next.
  clashAttacksWon: number;
  clashDefendsWon: number;
  clashAttacksLost: number;
  clashDefendsLost: number;
  clashWallBattlesWon: number;
  clashWallsAttacked: number;
  clashWallsDefended: number;
  participants: MatchParticipant[];
  // The room's channel (M3), owner-only: the API ships this field to the row's own
  // account and omits it entirely for a friend, so its absence is the permission.
  chat?: TranscriptLine[] | null;
  // True when the engine had to cut the payload: a cut transcript says so.
  chatTruncated?: boolean;
};

// One line of a stored transcript. Same shape the room stores, so a system line keeps
// its code and is rendered in whatever language the reader holds.
export type TranscriptLine = {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  at: number;
  // The backend's semantic seat stamp (`RED` and so on). Absent on a system line,
  // an old row and a row whose sender left no mapped seat.
  senderColor?: string;
  kind?: 'system';
  code?: 'left' | 'started';
};

// The page fields are nested under `pagination`, which is what the API returns.
export type MatchHistory = {
  games: MatchHistoryRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

// How many rows a history page asks for. The backend keeps the newest 50, so three
// pages have somewhere to go.
export const HISTORY_PAGE_SIZE = 20;

export type Friend = {
  id: string;
  username: string;
  displayName?: string;
  avatarStyle: string | null;
  hasAvatarPhoto?: boolean;
  rating: number;
  friendsSince: string;
  status: PresenceStatus;
};

export const STATUS_KEYS: Record<PresenceStatus, string> = {
  online: 'friends.online',
  playing: 'friends.inGame',
  offline: 'friends.offline',
};
