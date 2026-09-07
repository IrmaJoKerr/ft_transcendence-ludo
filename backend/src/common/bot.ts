// Bot identity, in one place. Bots are persisted as real User rows
// ("bot-red", "bot-green", ...) because GameParticipant.user_id is an FK to
// User.id, so any backend module that must tell humans from bots uses
// `isBotUserId()` / `BOT_PREFIX` here instead of hard-coding "bot-".
//
//  Users:
// - Match (match.creator, match.player, match.postgame): builds bot seats as
//   BOT_PREFIX+color, excludes bots from human-facing lists (seats, invites),
//   and skips bots when rating/scoring, deciding winners, and persisting game
//   results (bots never get Elo changes, win/loss tallies, or leaderboard zadds).
// - Achievements (achievements.service): skips bot participants so bot games
//   never unlock human achievements.
// - Leaderboard (leaderboard.service): keeps bots off the board when it
//   rebuilds from Postgres (DB `startsWith BOT_PREFIX` exclusion plus the
//   in-memory `!isBotUserId()` filter).
//
// NOTE: the ludo-engine process keeps its own copy of the prefix + predicate
// in its socket/auth.ts — update both when touching bot identity.
export const BOT_PREFIX = 'bot-';

export function isBotUserId(userId: string | undefined | null): boolean {
  return !!userId && userId.startsWith(BOT_PREFIX);
}
