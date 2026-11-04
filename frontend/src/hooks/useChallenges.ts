// **The one challenge** — the friends page's button, the lobby's name card and the
// waiting room's INVITE COMMS column all call this, and it posts the one route
// (POST /api/friends/:friendId/invite). The route takes either a `hostColor` (the
// caller's corner: no room yet, so one is created for them) or a `gameId` (the
// waiting room the caller already sits in), which is the whole difference between
// the three screens; the friendship gate, the invite record and the notification
// behind it are the same writes.
//
// **Where "already sent" comes from.** Only the server decides. This module keeps no
// TTL and no copy of the backend's window: the grey state is the server's own list
// (`GET /api/friends/challenges/sent`) plus the echo of the last press, and every
// press still asks the server. A stale grey therefore cannot invent a refusal — it
// either lapses into a real send or is answered by the server's 409, which is the
// same sentence the button would have printed anyway.
//
// The button stays pressable while greyed, because a disabled button cannot say why.
// The press answers in the screen's own band: "A challenge to X has already been
// sent".

/** One challenge this account has out, as the server reports it. */
export type SentChallenge = { userId: string; gameId: string; inviteCode?: string; sentAt: number };

/** The room a challenge points at. Only the creating shape carries credentials. */
export type ChallengeRoom = {
  gameId: string;
  inviteCode?: string;
  playerCount?: number;
  token?: string;
  engineUrl?: string;
  color?: string;
  mode?: string;
};

export type ChallengeTarget = { id: string; name: string };

export type ChallengeOptions = {
  /** The waiting room the caller sits in. Omit to create one. */
  gameId?: string;
  /** The caller's own corner when a room has to be created. */
  hostColor?: string;
};

export type ChallengesFeed = {
  /** Is this friend's challenge out, as far as the server last said? */
  isSent: (friendId: string) => boolean;
  /** The friend whose challenge is in flight, or null. */
  busy: string | null;
  /** Send it. Returns the room, or null when the band already carries the reason. */
  challenge: (friend: ChallengeTarget, options?: ChallengeOptions) => Promise<ChallengeRoom | null>;
};
