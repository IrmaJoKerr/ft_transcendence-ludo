import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApi, postApi } from '../api';
import { navigate } from '../router';
import { useApp, type ActiveMatch } from '../store';
import { retroAudio } from '../utils/audio';
import { isPendingOfferLapsed, notificationAge, offerMechanismLabel } from './notificationParts';

// **The live offers strip** (22.9)
// Above the friends list, one row per offer still open. This is the assessment
// surface the bell never was: the bell indexes and routes (22.7), the toast acts
// on what just arrived, and this strip is where a duel is chosen deliberately —
// with the refusal band the bell could not have.

// One offer as `GET /api/friends/invites/pending` answers it (22.6). Every field
// is optional because the record is read back off Redis: a claim to verify, not a
// value to trust.
type PendingOffer = {
  kind?: 'challenge' | 'room';
  fromUserId: string;
  fromUsername?: string;
  gameId?: string;
  inviteCode?: string;
  /** The strip's order: newest first. */
  sentAt?: number;
  /** The offer's own life, which is what the strip schedules itself against. */
  expiresAt?: number;
  /** A room invite whose room has started or ended: the row stays, the verb goes. */
  expired?: boolean;
};

// Ten rows fit under the search field at 1280 wide and scroll past that: a list
// whose whole job is to hold every offer still open cannot hide the eleventh.
const ROW_HEIGHT = 34;
const VISIBLE_ROWS = 10;

// A row's one press. Sized for a 34px row, which is why it is not RETRO_BTN: that
// button is built for a dialog and would set the row's height by itself.
const verbStyle = {
  flexShrink: 0,
  width: 76,
  padding: '3px 0',
  background: 'rgba(0, 240, 255, 0.12)',
  border: '1px solid rgba(0, 240, 255, 0.55)',
  borderRadius: 3,
  color: 'var(--accent-cyan, #00f0ff)',
  fontSize: '0.62rem',
  fontWeight: 'bold',
  letterSpacing: 1,
  fontFamily: 'var(--font-mono, monospace)',
  cursor: 'pointer',
} as const;

export function PendingOffers() {
  const { t } = useTranslation();
  const { setActiveMatch } = useApp();
  const [offers, setOffers] = useState<PendingOffer[]>([]);
  // Why an accept was refused. The four named failures are the reason this strip
  // exists at all, so they get a band of their own above the rows.
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // The read itself: rows in, rows out, nothing applied. Kept apart from `load` so
  // the first read can apply inside a promise callback rather than synchronously
  // in an effect — the same shape `useChallenges` uses for its out-list.
  const fetchOffers = useCallback(async (): Promise<PendingOffer[]> => {
    try {
      const rows = await getApi<PendingOffer[]>('/api/friends/invites/pending');
      // Newest first is the endpoint's order, but the sort is one line and the
      // strip's whole value is the freshest offer at the top.
      return Array.isArray(rows) ? [...rows].sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0)) : [];
    } catch {
      // A strip that cannot read holds nothing: the lists below it own the errors.
      return [];
    }
  }, []);

  const load = useCallback(async () => {
    setOffers(await fetchOffers());
  }, [fetchOffers]);

  // Mount, and every focus: an offer can arrive while the page is open. The server
  // drops the fields that have lapsed as it reads them (22.6), so a recompute is
  // also the only prune this list needs.
  useEffect(() => {
    let cancelled = false;
    void fetchOffers().then((rows) => {
      if (!cancelled) setOffers(rows);
    });
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchOffers, load]);

  // One timer, set to the nearest `expiresAt`: no poll, no Redis event, no push.
  const nextExpiry = useMemo(() => {
    const stamps = offers
      .map((offer) => offer.expiresAt)
      .filter((stamp): stamp is number => typeof stamp === 'number');
    return stamps.length > 0 ? Math.min(...stamps) : null;
  }, [offers]);

  useEffect(() => {
    if (nextExpiry === null) return;
    // A quarter second past the stamp, so the reload cannot read the field a tick
    // before the server considers it spent.
    const timer = window.setTimeout(() => void load(), Math.max(0, nextExpiry - Date.now()) + 250);
    return () => window.clearTimeout(timer);
  }, [nextExpiry, load]);

  // ACCEPT: the accept is the request that makes the room (19.6), and its answer is
  // the seat — the same path the toast takes while the offer is fresh.
  const accept = async (offer: PendingOffer) => {
    try {
      retroAudio.playUiBeep(880, 0.08);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    setRefusal(null);
    setBusyId(offer.fromUserId);
    try {
      const seat = await postApi<NonNullable<ActiveMatch>>(
        `/api/friends/challenges/${offer.fromUserId}/accept`,
        {},
      );
      setActiveMatch(seat);
      navigate(`/game?gameId=${seat.gameId}`);
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : t('friends.genericError'));
      // The refused offer may have spent itself anyway: re-read rather than leave
      // a stale verb on the screen.
      await load();
    } finally {
      setBusyId(null);
    }
  };

  // JOIN: a room invite is an address. The lobby claims the corner, because a seat
  // owns a colour and the inviter had no right to pick one for the invitee.
  const join = (offer: PendingOffer) => {
    try {
      retroAudio.playUiBeep(640, 0.05);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    setRefusal(null);
    const code = offer.inviteCode ?? '';
    navigate(code ? `/gamelobby?join=${encodeURIComponent(code)}` : '/gamelobby');
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: '10px 12px',
        border: '1px solid rgba(0, 240, 255, 0.25)',
        borderRadius: 4,
        background: 'rgba(5, 2, 18, 0.7)',
      }}
    >
      <div
        style={{
          fontSize: '0.68rem',
          fontWeight: 'bold',
          letterSpacing: 1,
          color: 'var(--accent-cyan, #00f0ff)',
          fontFamily: 'var(--font-mono, monospace)',
        }}
      >
        {t('friends.pendingOffersTitle')}
      </div>

      {refusal && (
        <div
          role="alert"
          style={{
            padding: '6px 10px',
            border: '1px solid var(--state-off)',
            borderRadius: 4,
            background: 'rgb(var(--state-off-rgb) / 0.12)',
            color: '#ff8095',
            fontSize: '0.7rem',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {refusal}
        </div>
      )}

      {offers.length === 0 ? (
        <div
          style={{
            padding: '2px 0',
            fontSize: '0.7rem',
            color: 'var(--text-muted, #8a7a64)',
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          {t('friends.pendingOffersEmpty')}
        </div>
      ) : (
        <div
          style={{
            maxHeight: ROW_HEIGHT * VISIBLE_ROWS,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {offers.map((offer) => {
            const mechanism = offer.kind === 'room' ? 'room' : 'challenge';
            // A row with no stamp is not offered an age it cannot earn: the server
            // always writes one, and a blank is honest where "56 years ago" is not.
            const age =
              typeof offer.sentAt === 'number'
                ? notificationAge(new Date(offer.sentAt).toISOString(), t)
                : '';
            // The stamp is the row's own life, `expired` the room's: either one ends
            // the verb, and the next recompute drops the row.
            const lapsed = isPendingOfferLapsed(offer);

            return (
              <div
                key={offer.fromUserId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: ROW_HEIGHT,
                  padding: '0 2px',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  opacity: lapsed ? 0.55 : 1,
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '0.74rem',
                    color: '#ffffff',
                    fontFamily: 'var(--font-mono, monospace)',
                  }}
                >
                  @{offer.fromUsername ?? 'UNKNOWN'}
                </span>
                <span
                  style={{
                    width: 58,
                    fontSize: '0.64rem',
                    fontWeight: 'bold',
                    letterSpacing: 1,
                    color:
                      mechanism === 'room'
                        ? 'var(--accent-yellow, #ffe600)'
                        : 'var(--accent-cyan, #00f0ff)',
                    fontFamily: 'var(--font-mono, monospace)',
                  }}
                >
                  {offerMechanismLabel(mechanism)}
                </span>
                <span
                  style={{
                    width: 58,
                    fontSize: '0.62rem',
                    color: 'var(--text-muted, #8a7a64)',
                    fontFamily: 'var(--font-mono, monospace)',
                  }}
                >
                  {age}
                </span>
                {lapsed ? (
                  <span
                    style={{
                      width: 76,
                      textAlign: 'center',
                      fontSize: '0.62rem',
                      fontWeight: 'bold',
                      letterSpacing: 1,
                      color: 'var(--accent-yellow, #ffe600)',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    {t('notifications.expired', 'EXPIRED')}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={busyId === offer.fromUserId}
                    onClick={() => (mechanism === 'room' ? join(offer) : void accept(offer))}
                    style={verbStyle}
                  >
                    {mechanism === 'room' ? t('friends.offerJoin') : t('friends.offerAccept')}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
