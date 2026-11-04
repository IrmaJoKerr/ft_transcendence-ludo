import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChallenges } from '../hooks/useChallenges';
import { useFriendships } from '../hooks/useFriendships';
import { RETRO_BTN, RETRO_WINDOW, WINDOW_HEADER, GAME_WINDOW_HEADER_EXTRA, WINDOW_BODY } from '../styles/tw';
import { retroAudio } from '../utils/audio';

// The Invite Comms column (M3): the waiting room's occupancy list, rendered in the
// chat card's `sideSlot` and only while `status === 'WAITING'`.
//
// It is occupancy, not duelling: a friend listed here is online and not already in
// this room, so pressing invite cannot fail for the reason the duel gate exists. The
// seat half of that test reads the room's own player list and never a presence
// snapshot, which is what keeps a friend who has just joined from being listed; the
// online half is the presence feed, because that is the only live signal there is.
// A friend who is mid-match in another room still reads `online` here, and pressing
// invite is answered by the band in one press: accepted, because hiding them would
// need the live `playing` edge for a case that resolves itself (R1).
//
// The press is the app's one challenge route with the room's own id (`useChallenges`),
// so an invite already out reads grey from the server's list rather than from a
// remembered press, and it survives a reload.
export function InviteComms({
  gameId,
  seatUserIds,
  playerCount,
}: {
  gameId: string;
  /** Every account seated in this room, taken from the room's own player list. */
  seatUserIds: string[];
  /** The room's capacity: a full room hides the column entirely. */
  playerCount: number;
}) {
  const { t } = useTranslation();
  const { friends } = useFriendships();
  const { isSent, busy, challenge } = useChallenges();
  const [message, setMessage] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);

  // A full room has no occupation to offer, so the column is gone rather than empty.
  if (seatUserIds.length >= playerCount) return null;

  const listed = friends.filter(
    (friend) => friend.status === 'online' && !seatUserIds.includes(friend.id),
  );

  const invite = async (friendId: string, name: string) => {
    setMessage(null);
    retroAudio.playUiBeep(780, 0.06);
    const outcome = await challenge({ id: friendId, name }, { gameId });
    if (!outcome.ok) {
      // The refusal is already a sentence (`errors.<CODE>`, or the generic request
      // failure), so the column prints it rather than reading the status itself.
      setMessage({ tone: 'error', text: outcome.message || t('friends.genericError') });
      return;
    }
    setMessage({ tone: 'info', text: t('gameChat.inviteSent') });
  };

  return (
    <section className={RETRO_WINDOW} style={{ height: '100%' }}>
      <div className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}>
        <span>{t('gameChat.inviteTitle')}</span>
      </div>
      <div className={WINDOW_BODY} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {listed.length === 0 ? (
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--text-muted)' }}
          >
            {t('gameChat.inviteEmpty')}
          </span>
        ) : (
          listed.slice(0, 6).map((friend) => {
            const sent = isSent(friend.id);
            const name = friend.displayName ?? friend.username;
            return (
              <button
                key={friend.id}
                type="button"
                className={RETRO_BTN}
                disabled={busy === friend.id}
                onClick={() => void invite(friend.id, name)}
                title={name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  fontSize: '0.6rem',
                  opacity: sent ? 0.6 : 1,
                }}
              >
                <span
                  style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    textAlign: 'left',
                  }}
                >
                  {name}
                </span>
                <span style={{ flex: 'none', color: 'var(--accent-cyan)' }}>
                  {sent ? t('gameChat.inviteSentShort') : t('gameChat.inviteAction')}
                </span>
              </button>
            );
          })
        )}
        {message && (
          <span
            aria-live="polite"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.56rem',
              lineHeight: 1.4,
              color: message.tone === 'error' ? '#ff5278' : 'var(--accent-cyan)',
            }}
          >
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
