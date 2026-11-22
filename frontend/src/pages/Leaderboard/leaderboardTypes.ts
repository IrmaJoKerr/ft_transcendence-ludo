export type LeaderboardEntry = {
  rank: number;
  // Immutable user id: the key avatars are looked up by.
  id: string;
  username: string;
  displayName?: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  avatarStyle?: string | null;
  hasAvatarPhoto?: boolean;
};

export type LeaderboardResponse = {
  entries: LeaderboardEntry[];
  total: number;
  page: number;
  limit: number;
  myRank?: { rank: number; username: string; displayName?: string; rating: number } | null;
};
