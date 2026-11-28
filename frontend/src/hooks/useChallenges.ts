// The two acts, one module — the friends page's button, the lobby's name card and the waiting
// room's INVITE COMMS panel all call this, and 19.6 split what they post in two.

import { useCallback, useEffect, useState } from 'react';
import { getApi, postApi } from '../api';
import type { PlayerColor } from '../game/types';

// One offer this account has out. Two kinds travel this list (19.6): a `challenge` is a duel and
// names no room until it is accepted, a `room` invite names the waiting room it offers a seat in.
export type SentChallenge = {
  userId: string;
  kind: 'challenge' | 'room';
  gameId?: string;
  inviteCode?: string;
  sentAt: number;
};

// The room a room invite points at. The route answers with the room alone, because the
//  caller is already in it. A duel answers with no room at all: the accept makes it.
export type ChallengeRoom = {
  gameId: string;
  inviteCode?: string;
  playerCount?: number;
  token?: string;
  engineUrl?: string;
  color?: PlayerColor;
  mode?: 'pvp' | 'pve' | 'hotseat';
};

// A room's answer, narrowed to what a seat needs. Only a room invite produces one;
//  a duel's handoff arrives with the accept, from the server's own frame.
export type ChallengeCredentials = ChallengeRoom & {
  token: string;
  engineUrl: string;
  color: PlayerColor;
  mode: 'pvp' | 'pve' | 'hotseat';
  playerCount: number;
};

// Narrow a room an answer named to the credentials a caller enters it with.
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

// The duel route's answer: no room, because a duel has none until it is accepted.
export type ChallengeAck = { ok: true; kind: 'challenge' };

export type ChallengeTarget = { id: string; name: string };

export type ChallengeOptions = {
    // The waiting room the caller sits in. A room invite, and the only shape that
  //  answers with a room.
  gameId?: string;
    // The caller's corner for a duel, seated when the friend accepts and the room is
  //  made. The only shape that can create anything.
  hostColor?: string;
};

// What one press answered: the room, no room at all, or the sentence for the band.
export type ChallengeOutcome =
  | { ok: true; room?: ChallengeRoom }
  | { ok: false; code?: string; message: string };

export type ChallengesFeed = {
    // Is this friend's offer out, as far as the server last said?
  isSent: (friendId: string) => boolean;
    // The friend whose offer is in flight, or null.
  busy: string | null;
    // Send it. Never refuses locally: the answer says whether it is out.
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
                // Two routes, one per act (19.6): a room id means the caller already sits in the room being
        // offered, so the press offers a seat in it; a corner means a duel, whose room is made by the
        // friend's accept.
        const roomInvite = Boolean(options?.gameId);
        const path = roomInvite
          ? `/api/friends/${friend.id}/invite`
          : `/api/friends/${friend.id}/challenge`;
        const body = roomInvite ? { gameId: options?.gameId } : { hostColor: options?.hostColor };
        const answer = await postApi<ChallengeRoom | ChallengeAck>(path, body);
        const room = 'gameId' in answer ? answer : undefined;
        remember({
          userId: friend.id,
          kind: roomInvite ? 'room' : 'challenge',
          gameId: room?.gameId,
          inviteCode: room?.inviteCode,
          sentAt: Date.now(),
        });
        return { ok: true, room };
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
                // A 409 is the server saying the offer is already out: this tab's list was behind (another tab, or
        // a press it never saw). Recording it from the answer is what keeps the next press from reading as
        // a fresh one.
        if (code === 'CHALLENGE_ALREADY_SENT')
          remember({
            userId: friend.id,
            kind: options?.gameId ? 'room' : 'challenge',
            sentAt: Date.now(),
          });
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
