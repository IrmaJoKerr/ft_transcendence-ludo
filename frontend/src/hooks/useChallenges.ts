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
// The press asks, the server answers 409 `CHALLENGE_ALREADY_SENT`, and the screen's
// band prints `errors.CHALLENGE_ALREADY_SENT` through the ordinary error path. The
// list is re-read on window focus, which is the only repair a hidden tab needs.

import { useCallback, useEffect, useState } from 'react';
import { getApi, postApi } from '../api';
import type { PlayerColor } from '../game/types';

/** One challenge this account has out. The server always names the room; the echo of a
 *  refused press names the friend alone, because a 409 says the challenge is out and not
 *  where it points. `sentAt` is the server's stamp, or this tab's clock on an echo, and
 *  nothing here expires on it: that is the point of the module. */
export type SentChallenge = {
  userId: string;
  gameId?: string;
  inviteCode?: string;
  sentAt: number;
};

/** The room a challenge points at. The creating shape answers with the caller's own
 *  credentials (they are seated first, so they can enter it); the staging shape answers
 *  with the room alone, because the caller is already in it. */
export type ChallengeRoom = {
  gameId: string;
  inviteCode?: string;
  playerCount?: number;
  token?: string;
  engineUrl?: string;
  color?: PlayerColor;
  mode?: 'pvp' | 'pve' | 'hotseat';
};

/** The creating shape's answer, narrowed to what a seat needs. */
export type ChallengeCredentials = ChallengeRoom & {
  token: string;
  engineUrl: string;
  color: PlayerColor;
  mode: 'pvp' | 'pve' | 'hotseat';
  playerCount: number;
};

/** Narrow a room a caller asked to be created to the credentials they enter it with. */
export function challengeCredentials(room: ChallengeRoom): ChallengeCredentials | null {
  if (!room.token || !room.engineUrl || !room.color || !room.mode) return null;
  if (room.playerCount === undefined) return null;
  return {
    ...room,
    token: room.token,
    engineUrl: room.engineUrl,
    color: room.color,
    mode: room.mode,
    playerCount: room.playerCount,
  };
}

export type ChallengeTarget = { id: string; name: string };

export type ChallengeOptions = {
  /** The waiting room the caller sits in. Omit to create one. */
  gameId?: string;
  /** The caller's own corner when a room has to be created. */
  hostColor?: string;
};

/** What one press answered: the room, or the sentence for the screen's band. */
export type ChallengeOutcome =
  | { ok: true; room: ChallengeRoom }
  | { ok: false; code?: string; message: string };

export type ChallengesFeed = {
  /** Is this friend's challenge out, as far as the server last said? */
  isSent: (friendId: string) => boolean;
  /** The friend whose challenge is in flight, or null. */
  busy: string | null;
  /** Send it. Never refuses locally: the answer says whether it is out. */
  challenge: (friend: ChallengeTarget, options?: ChallengeOptions) => Promise<ChallengeOutcome>;
};

const SENT_PATH = '/api/friends/challenges/sent';

export function useChallenges(): ChallengesFeed {
  const [pending, setPending] = useState<SentChallenge[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  // The list carries both halves of the grey state: the server's rows and the echo of
  // this tab's own presses. One array, newest first, one row per friend.
  const remember = useCallback((row: SentChallenge) => {
    setPending((prev) => [row, ...prev.filter((entry) => entry.userId !== row.userId)]);
  }, []);

  // Read on mount and on window focus. No frame announces a challenge that was spent
  // (the friend joined, the room ended, five minutes passed), so a tab that was hidden
  // is repaired by asking again rather than by a timer of our own.
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      getApi<SentChallenge[]>(SENT_PATH)
        .then((rows) => {
          if (!cancelled && Array.isArray(rows)) setPending(rows);
        })
        .catch(() => {
          // A list this screen cannot read greys nothing: the press still asks the server.
        });
    };
    read();
    window.addEventListener('focus', read);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', read);
    };
  }, []);

  const isSent = useCallback(
    (friendId: string) => pending.some((row) => row.userId === friendId),
    [pending],
  );

  // Every press asks. There is no local window to consult and no local refusal to make,
  // so the only thing left to decide here is which button shows the in-flight label.
  const challenge = useCallback(
    async (friend: ChallengeTarget, options?: ChallengeOptions): Promise<ChallengeOutcome> => {
      setBusy(friend.id);
      try {
        // One route, two shapes: a room id when the caller already sits in one, a corner
        // when the room has to be created for them. The body names whichever was asked
        // for, so a stray press can never create a room the caller did not mean to make.
        const body = options?.gameId
          ? { gameId: options.gameId }
          : { hostColor: options?.hostColor };
        const room = await postApi<ChallengeRoom>(`/api/friends/${friend.id}/invite`, body);
        remember({
          userId: friend.id,
          gameId: room.gameId,
          inviteCode: room.inviteCode,
          sentAt: Date.now(),
        });
        return { ok: true, room };
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        // A 409 is the server saying the challenge is already out: this tab's list was
        // behind (another tab, or a press it never saw). Recording it from the answer is
        // what keeps the next press from reading as a fresh one.
        if (code === 'CHALLENGE_ALREADY_SENT') remember({ userId: friend.id, sentAt: Date.now() });
        return { ok: false, code, message: error instanceof Error ? error.message : '' };
      } finally {
        // A second press on another row can still be in flight, so this clears the
        // label it owns rather than whatever is showing.
        setBusy((current) => (current === friend.id ? null : current));
      }
    },
    [remember],
  );

  return { isSent, busy, challenge };
}
