import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChallenges } from '../hooks/useChallenges';
import type { FriendRow } from '../friendshipFeed';
import { RETRO_BTN, DISPLAY_TAG } from '../styles/tw';
import { retroAudio } from '../utils/audio';
import type { ChatCardStatus } from './chatCardTypes';
import { CHAT_SURFACE } from './chatSurface';

// INVITE COMMS (M3): the waiting room's occupancy list, mounted as the chat card's
// `sidePanel` and only while `status === 'WAITING'`.
//
// It was a 150 px column beside the compact slot until 19.8, which meant the board's
// left column reflowed when a room filled and the column left. It is a panel now:
// portaled beside the open card (240 px, clamped inside the viewport), off until the
// card head's switch asks for it, and gone when the match starts. Because it costs
// the column nothing, a full room no longer hides it — it says nobody is free, which is
// true at capacity and is the same press a half-empty room offers.
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
// The press is the app's room-invite route with the room's own id (`useChallenges`),
// so an invite already out reads grey from the server's list rather than from a
// remembered press, and it survives a reload. This column never duels: a challenge
// makes its own room at the accept, which is the lobby's business and not a seat in
// this one (19.6).
//
// Since 24 it wears the card's shell rather than the board windows' chrome. The two
// rectangles are portaled 8 px apart and read together, and the card draws no bar, no
// pink and no navy, so a panel on `RETRO_WINDOW`/`WINDOW_HEADER` looked like another
// family standing beside it. `CHAT_SURFACE` (`chatSurface.ts`, 24.1) holds the one
// recipe the card, the lobby's copy of it and this panel all spread, so the three
// cannot drift apart again; the head, the well, the rows and the band are the card's
// parts at the card's metrics for the same reason.
export function InviteComms({
  gameId,
  seatUserIds,
  playerCount,
  friends,
}: {
  gameId: string;
  /** Every account seated in this room, taken from the room's own player list. */
  seatUserIds: string[];
  /** The room's capacity. A full room lists nobody: every friend is either seated
   *  here or has no free seat to take, so the panel says so rather than vanishing. */
  playerCount: number;
  /** The friendship snapshot, read once by the page and shared with the name card, so
   *  a waiting room opens with one read rather than one per surface. */
  friends: FriendRow[];
}) {
  const { t } = useTranslation();
  const { isSent, busy, challenge } = useChallenges();
  const [message, setMessage] = useState<ChatCardStatus | null>(null);

  const full = seatUserIds.length >= playerCount;
  const listed = full
    ? []
    : friends.filter(
        (friend) => friend.status === 'online' && !seatUserIds.includes(friend.id),
      );

  const invite = async (friendId: string, name: string) => {
    setMessage(null);
    retroAudio.playUiBeep(780, 0.06);
    const outcome = await challenge({ id: friendId, name }, { gameId });
    if (!outcome.ok) {
      // The refusal is already a sentence (`errors.<CODE>`, or the generic request
      // failure), so the panel prints it rather than reading the status itself.
      setMessage({ tone: 'error', text: outcome.message || t('friends.genericError') });
      return;
    }
    setMessage({ tone: 'info', text: t('gameChat.inviteSent') });
  };

  return (
    <section
      className="chat-card"
      style={{
        ...CHAT_SURFACE,
        // The portal gives the box the card's height and this panel fills it (24.3), so
        // the well takes the slack instead of the panel shrinking to its rows.
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      {/* The card head's text block without its controls (24.2): CLOSE and this panel's
          own switch are the head beside it, so repeating them here would be a second way
          to shut one thing. The second line is the room's occupancy, the one fact the
          list cannot show: it lists the free pilots, so it says nothing about how many
          seats are gone. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexShrink: 0 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.86rem',
            fontWeight: 900,
            letterSpacing: '1px',
            color: 'var(--accent-cyan)',
            textShadow: '0 0 12px rgb(var(--accent-cyan-rgb) / 0.45)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {t('gameChat.inviteTitle')}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.56rem',
            letterSpacing: '0.6px',
            color: 'var(--text-muted)',
          }}
        >
          {t('gameChat.inviteScope', { seated: seatUserIds.length, capacity: playerCount })}
        </span>
      </div>
      {/* The card feed's well (24.2), centred while it holds no rows: the rows scroll
          inside the panel rather than growing past the card it sits beside, and a refusal
          under the well no longer scrolls out of sight with them. */}
      <div
        style={{
          flex: '1 1 0',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: listed.length === 0 ? 'center' : 'flex-start',
          alignItems: listed.length === 0 ? 'center' : 'stretch',
          gap: 6,
          padding: 10,
          overflowY: 'auto',
          borderRadius: 8,
          background: 'rgb(var(--shade-rgb) / 0.45)',
          border: '1px solid rgb(var(--accent-cyan-rgb) / 0.16)',
          textAlign: listed.length === 0 ? 'center' : 'left',
        }}
      >
        {listed.length === 0 ? (
          <>
            <span
              className={DISPLAY_TAG}
            >
              {t('gameChat.inviteEmpty')}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.58rem',
                letterSpacing: '0.5px',
                lineHeight: 1.5,
                color: 'var(--text-muted)',
                maxWidth: 300,
              }}
            >
              {t('gameChat.inviteEmptyDesc')}
            </span>
          </>
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
                  // The composer's SEND metrics, with 10 px of side padding rather
                  // than 12: a row is the same height as the press beside the card.
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  height: 32,
                  padding: '0 10px',
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
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.6rem',
                    fontWeight: 900,
                    color: 'var(--text-main)',
                  }}
                >
                  {name}
                </span>
                <span
                  style={{
                    flex: 'none',
                    fontFamily: 'var(--font-display)',
                    fontSize: '0.66rem',
                    fontWeight: 900,
                    color: sent ? 'var(--text-muted)' : 'var(--accent-cyan)',
                    opacity: sent ? 0.6 : 1,
                  }}
                >
                  {sent ? t('gameChat.inviteSentShort') : t('gameChat.inviteAction')}
                </span>
              </button>
            );
          })
        )}
      </div>
      {/* The band, shaped like the card's but reserving nothing (24.2): the card holds a
          line open because the composer sits under it, and nothing sits under this one,
          so a two-line refusal shrinks the well instead. The tones are the card's pair. */}
      <div
        style={{
          flexShrink: 0,
          minHeight: 14,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6rem',
          letterSpacing: '0.5px',
          lineHeight: 1.35,
          color: message?.tone === 'error' ? 'var(--text-main)' : 'var(--accent-cyan)',
          textShadow:
            message?.tone === 'error'
              ? '0 0 8px rgba(255, 82, 120, 0.55)'
              : '0 0 8px rgb(var(--accent-cyan-rgb) / 0.45)',
        }}
      >
        {message && (
          <span role="status" aria-live="polite">
            {message.text}
          </span>
        )}
      </div>
    </section>
  );
}
