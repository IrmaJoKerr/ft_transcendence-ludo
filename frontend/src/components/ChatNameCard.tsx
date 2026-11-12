import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { postApi } from '../api';
import type { FriendRequestRow, FriendRow } from '../friendshipFeed';
import { RETRO_BTN } from '../styles/tw';
import { retroAudio } from '../utils/audio';
import { ConfirmActionModal } from './ConfirmActionModal';
import type { ChatCardStatus } from './chatCardTypes';

// The card a name opens (M3/19.7): what this viewer can do about that pilot. It is one
// component for both channels, because the name card used to exist twice and did not
// do the same thing twice: the room offered BLOCK alone, so a player who met somebody
// across the board could not add them without leaving the game. What a surface offers
// is now a property of the pilot in front of it, not of the channel it was pressed in.
//
// Two acts are gated, because neither can be taken back. ADD FRIEND asks first (the
// same button, relabelled: a request cannot be withdrawn once it is sent, and the card
// sits over a live board where a stray press is easy), and BLOCK confirms through
// `ConfirmActionModal`, the app's one destructive shell, which is also what keeps the
// dialog above this card instead of under it (it portals at 10006; this card is 10005
// and the transcript 10004).
//
// The one optional action is CHALLENGE, and it is the host's: a room invites from its
// occupancy panel rather than from a name, so the room passes nothing and the card
// offers no duel there. Every outcome is reported to the host's band, and the card
// closes with it: two surfaces saying the same thing is what this design avoids.

/** The card's width, its upper bound for the clamp, and the gap it keeps from the
 *  window edges. The height is an estimate, not a size: it counts the tallest stack
 *  the card can build (title, the friend state, CHALLENGE, BLOCK under its rule and
 *  CLOSE), and the card itself is as tall as what it offers. */
const NAME_CARD_WIDTH = 220;
const NAME_CARD_HEIGHT = 244;
const NAME_CARD_MARGIN = 12;

/** The pilot whose name was pressed, and where that name was in the window. */
export type ChatNameCardTarget = { id: string; name: string; anchor: DOMRect };

export interface ChatNameCardProps {
  /** Who was pressed, and the rectangle the press came from: the transcript scrolls
   *  under the pointer, so the card is placed once, off that rectangle. */
  target: ChatNameCardTarget;
  /** The friendship snapshot, read by the host so opening a card refetches nothing. */
  friends: FriendRow[];
  requests: { sent: FriendRequestRow[]; received: FriendRequestRow[] };
  loading: boolean;
  /** CHALLENGE, when the host has one to offer. `onPress` rejects with the sentence
   *  the band should carry, because the host owns the refusal's wording. */
  challenge?: { sent: boolean; onPress: () => Promise<void> };
  onClose: () => void;
  /** The band the outcome lands in: the host's, so a room reports into the room. */
  onStatus: (status: ChatCardStatus | null) => void;
  /** Re-read the friendship snapshot: a block is a mutation, and a host whose feed
   *  filters blocked senders builds its filter from that snapshot. */
  onBlocked: () => void;
}

export function ChatNameCard({
  target,
  friends,
  requests,
  loading,
  challenge,
  onClose,
  onStatus,
  onBlocked,
}: ChatNameCardProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  // ADD FRIEND's ask: the first press arms the button, the second sends.
  const [addArmed, setAddArmed] = useState(false);
  // The block confirm. It is the card's own state rather than the host's, because the
  // card is what opened it.
  const [confirmBlock, setConfirmBlock] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Placed once, when the card mounts: below the name where that fits, held inside
  // the window otherwise, so a name at the bottom of a transcript does not put the
  // card off screen.
  const [pos] = useState(() => {
    const { anchor } = target;
    return {
      left: Math.max(
        NAME_CARD_MARGIN,
        Math.min(anchor.left, window.innerWidth - NAME_CARD_WIDTH - NAME_CARD_MARGIN),
      ),
      top: Math.max(
        NAME_CARD_MARGIN,
        Math.min(anchor.bottom + 6, window.innerHeight - NAME_CARD_HEIGHT - NAME_CARD_MARGIN),
      ),
    };
  });

  // Escape and an outside press close it, the same pair of gestures the transcript
  // card uses. `pointerdown` so a drag that ends outside does not count as a press.
  // Both stand down while the confirm is up: the modal owns Escape and answers a
  // press anywhere (`CyberModal` cancels on an overlay click), so acting on the same
  // gestures here would dismiss the card behind the confirm as well.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (confirmBlock) return;
      if (event.key === 'Escape') onClose();
    };
    const onPress = (event: PointerEvent) => {
      if (confirmBlock) return;
      const pressed = event.target as Node | null;
      if (pressed && cardRef.current?.contains(pressed)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [onClose, confirmBlock]);

  const friend = friends.find((entry) => entry.id === target.id);
  const sent = requests.sent.find((entry) => entry.userId === target.id);
  const received = requests.received.find((entry) => entry.userId === target.id);

  // The band is the only place an outcome is reported, and the card closes with it.
  const report = (tone: 'error' | 'info', text: string) => {
    onStatus({ tone, text });
    onClose();
  };

  const run = async (action: () => Promise<void>, done: () => void, failure: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      done();
      retroAudio.playUiBeep(880, 0.06);
    } catch (error) {
      retroAudio.playUiBeep(320, 0.08);
      // `postApi` already localized the server's code; `failure` covers a transport
      // error with no body to read.
      report('error', (error as Error).message || failure);
    } finally {
      setBusy(false);
    }
  };

  // The ask, then the send. Arming costs nothing and closing the card forgets it, so
  // the second press is always one the viewer meant.
  const addFriend = () => {
    if (!addArmed) {
      setAddArmed(true);
      retroAudio.playUiBeep(660, 0.05);
      return;
    }
    void run(
      () => postApi(`/api/friends/request/${target.id}`, {}),
      () => report('info', t('chat.status.friendSent', { name: target.name })),
      t('friends.couldNotSendRequest'),
    );
  };

  const accept = (requestId: string) =>
    void run(
      () => postApi(`/api/friends/accept/${requestId}`, {}),
      () => report('info', t('chat.status.friendAdded', { name: target.name })),
      t('friends.genericError'),
    );

  // Blocking is the one unilateral action here: the other pilot is not asked, the
  // friendship (and any pending request) goes with it, and this card cannot undo it.
  // Hence the confirm, and hence the same shell the friends screen's BLOCK uses.
  const block = () =>
    void run(
      () => postApi(`/api/friends/block/${target.id}`, {}),
      () => {
        // A host whose transcript filters blocked senders builds that filter from the
        // snapshot, and the block's live record lands on the next frame from the
        // socket: re-reading here means the lines are gone even if that frame is lost.
        onBlocked();
        report('info', t('chat.status.blocked', { name: target.name }));
      },
      t('friends.genericError'),
    );

  // The confirm's consequence depends on what is there to lose: a friend, or a request
  // either way, also loses the friendship, and saying so at a stranger would be a
  // sentence about something that does not exist.
  const blockNote =
    friend || sent || received ? t('chat.block.subMessage') : t('chat.block.subMessageStranger');

  const actionStyle: CSSProperties = {
    width: '100%',
    padding: '5px 8px',
    fontFamily: 'var(--font-display)',
    fontSize: '0.66rem',
    fontWeight: 900,
    letterSpacing: '0.6px',
    color: 'var(--accent-cyan)',
    cursor: busy ? 'wait' : 'pointer',
  };
  const labelStyle: CSSProperties = {
    padding: '5px 8px',
    textAlign: 'center',
    fontFamily: 'var(--font-display)',
    fontSize: '0.66rem',
    fontWeight: 900,
    letterSpacing: '0.6px',
    color: 'var(--text-muted)',
    border: '1px solid rgba(184, 166, 228, 0.28)',
    borderRadius: 6,
  };

  return createPortal(
    <div
      ref={cardRef}
      role="dialog"
      aria-label={target.name}
      // The hosts' outside-press handlers stand down for anything inside a
      // `[data-chat-overlay]`: this card is portaled outside the transcript's subtree,
      // and pressing it must not collapse the card behind it.
      data-chat-overlay="name"
      className="chat-card"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        width: NAME_CARD_WIDTH,
        zIndex: 10005,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        borderRadius: 10,
        background: 'linear-gradient(180deg, rgb(var(--bg-raise-rgb) / 0.97), rgb(var(--bg-panel-rgb) / 0.985))',
        backdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(0, 240, 255, 0.45)',
        boxShadow: '0 24px 60px rgb(var(--shade-rgb) / 0.85), 0 0 20px rgba(0, 240, 255, 0.2)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.8rem',
          fontWeight: 900,
          letterSpacing: '0.8px',
          color: 'var(--text-main)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={target.name}
      >
        {target.name}
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <span style={labelStyle}>…</span>
        ) : friend ? (
          <>
            <span style={labelStyle}>{t('chat.card.friends')}</span>
            {challenge && (
              <button
                type="button"
                className={RETRO_BTN}
                style={{ ...actionStyle, opacity: challenge.sent ? 0.6 : 1 }}
                disabled={busy}
                onClick={() => {
                  void run(
                    challenge.onPress,
                    () => report('info', t('chat.status.challengeSent')),
                    t('friends.genericError'),
                  );
                }}
              >
                {t('chat.card.challenge')}
              </button>
            )}
          </>
        ) : sent ? (
          <span style={labelStyle}>{t('chat.card.requestSent')}</span>
        ) : received ? (
          <button
            type="button"
            className={RETRO_BTN}
            style={actionStyle}
            disabled={busy}
            onClick={() => accept(received.id)}
          >
            {t('chat.card.accept')}
          </button>
        ) : (
          <button
            type="button"
            className={RETRO_BTN}
            style={{
              ...actionStyle,
              color: addArmed ? 'var(--accent-pink, #ff007f)' : 'var(--accent-cyan)',
            }}
            disabled={busy}
            aria-label={addArmed ? t('chat.card.addFriendConfirm') : t('chat.card.addFriend')}
            onClick={addFriend}
          >
            {addArmed ? t('chat.card.addFriendConfirm') : t('chat.card.addFriend')}
          </button>
        )}
        {/* BLOCK sits under a rule and last but one: a stray double press on the
            action above must not land on the one button that cannot be undone. */}
        <span
          aria-hidden="true"
          style={{ height: 1, margin: '2px 0', background: 'rgba(184, 166, 228, 0.22)' }}
        />
        <button
          type="button"
          className={RETRO_BTN}
          style={{ ...actionStyle, color: 'var(--accent-pink, #ff007f)' }}
          disabled={busy}
          aria-haspopup="dialog"
          onClick={() => {
            retroAudio.playUiBeep(320, 0.08);
            setConfirmBlock(true);
          }}
        >
          {t('chat.card.block')}
        </button>
        <button
          type="button"
          className={RETRO_BTN}
          style={{ ...actionStyle, color: 'var(--text-muted)' }}
          onClick={() => {
            retroAudio.playUiBeep(520, 0.05);
            onClose();
          }}
        >
          {t('chat.close')}
        </button>
      </div>

      <ConfirmActionModal
        isOpen={confirmBlock}
        title={t('chat.block.title')}
        message={t('chat.block.confirm', { name: target.name })}
        subMessage={blockNote}
        cancelLabel={t('chat.cancel')}
        proceedLabel={t('chat.block.proceed')}
        onCancel={() => setConfirmBlock(false)}
        onProceed={() => {
          setConfirmBlock(false);
          block();
        }}
      />
    </div>,
    document.body,
  );
}
