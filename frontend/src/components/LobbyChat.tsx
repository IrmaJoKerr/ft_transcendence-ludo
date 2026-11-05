import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { postApi } from '../api';
import { useFriendships } from '../hooks/useFriendships';
import { useApp } from '../store';
import type { ChatErrorCode } from '../sessionSocket';
import { ChatCardComposer, ChatCardFeed, ChatCardHead } from './ChatCard';
import { ConfirmActionModal } from './ConfirmActionModal';
import { CHAT_MAX_CHARS, chatLength } from '../__shared__/chat.constants';
import type { ChatCardLine, ChatCardStatus } from './chatCardTypes';
import type { FriendRequestRow, FriendRow } from '../friendshipFeed';
import { useChallenges } from '../hooks/useChallenges';
import { RETRO_BTN } from '../styles/tw';
import { retroAudio } from '../utils/audio';

// The dock's chat slot, wired to the public channel (queue item 3). The plate is
// the screen: it previews the newest lines and opens the card, which carries the
// whole transcript and the composer. Every string is a locale key now, and the
// composer has one reserved status line under the input, so "message too long" and
// "NO SPAMMING" never move the card. Since M3 the head, the feed and the composer are
// `ChatCard.tsx`'s; since 19.8 the band is too (`ChatStatusBand`, the same one the
// room paints, with a glyph column the lobby leaves empty), so both channels count one
// `n / 300` from `chatLength` and reserve one height. The name card here is the
// public channel's only set of actions — ADD FRIEND (a request the other side
// answers), ACCEPT, and BLOCK (unilateral, so it confirms through
// `ConfirmActionModal` the same way the friends screen's row does) — and the feed
// drops the lines of whoever this reader has blocked, which the channel's own empty
// state promises.
const SCREEN_PREVIEW_LINES = 3;

/** The name card's box. It is portaled to the body, so it is not clipped by the
 *  dock's 360 px column; the height is an upper bound for the clamp, not a size, and
 *  it counts the tallest stack the card can build: title, the friend state, BLOCK
 *  under its rule, and CLOSE. */
const NAME_CARD_WIDTH = 220;
const NAME_CARD_HEIGHT = 244;
const NAME_CARD_MARGIN = 12;

/** The pilot whose name was pressed, and where the card was placed for it. */
type NameCard = { id: string; name: string; left: number; top: number };


/** The screen's floor, in both states. The 720p budget is 656 px (100vh − 64)
 *  minus 40 of dock padding, 74 of profile pill, 316 of nav track (five 52 px
 *  buttons, four 10 px gaps, 16 of padding), 59 of notifications and 42 of gaps:
 *  531, which leaves 125 for the panel. 112 fits that with 13 px to spare, so the
 *  track is not the box that shrinks at 720p; below about 707 px of window height
 *  it does. */
const SCREEN_MIN_HEIGHT = 112;

/** The expanded card: wider than the dock on purpose (the dock itself must never
 *  resize, so the room comes from the page behind it), tall enough for a
 *  transcript and a composer, and never taller than the window. */
const CARD_WIDTH = 440;
const CARD_MAX_HEIGHT = 560;
const CARD_MARGIN = 16;

interface LobbyChatProps {
  /** ON lights the screen; OFF leaves the same plate black, and inert: the card
   *  cannot be opened from a powered-down screen. */
  open: boolean;
  onToggle: () => void;
}

interface CardBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function LobbyChat({ open, onToggle }: LobbyChatProps) {
  const { t } = useTranslation();
  const { chatLog, sendChat, sessionConnected, user } = useApp();

  // The friendship snapshot lives here rather than in the name card: the card needs
  // it (friend, request sent, request received) and the feed needs the block list, so
  // one read serves both and opening a card no longer refetches it.
  const { friends, requests, blocked, loading, refresh } = useFriendships();

  // A block hides that pilot's lines from this reader — the rule the channel's own
  // empty state already promised. A room gets it server-side, per seat
  // (`filterChatForSeat` + the block ledger); here the ledger is already in hand, so
  // the filter is local, and unblocking brings the lines back with no refetch. The
  // other direction cannot be honoured: a block is not disclosed, so the blocked side
  // has no list to filter against (the room, which seats both, does cut it both ways).
  const blockedIds = useMemo(() => new Set(blocked.map((row) => row.id)), [blocked]);
  const lines = useMemo(
    () =>
      blockedIds.size === 0
        ? chatLog
        : chatLog.filter((line) => !blockedIds.has(line.senderId)),
    [chatLog, blockedIds],
  );

  // Whether the switch has ever been thrown. Until it has, the screen is drawn at
  // rest, so entering a page does not replay the power-on; after that the class
  // alternates between the two animations, and each throw replays its own.
  const [thrown, setThrown] = useState(false);

  // The composer's draft and the band's one line. Both belong to the card, not to
  // the connection: closing the card drops neither, and a refusal keeps the text.
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ChatCardStatus | null>(null);

  // The expanded card. It is anchored to the plate and grows upward out of the
  // dock, page visible around it: dimming the room list would make it a modal,
  // and this is a channel you read while doing something else.
  const [cardOpen, setCardOpen] = useState(false);
  const [box, setBox] = useState<CardBox | null>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // One line out. The three local refusals exist so the band answers in the same
  // tick as the press: the socket's own ack covers length, spacing and storage.
  const reportError = useCallback(
    (code: ChatErrorCode) =>
      setStatus({
        tone: 'error',
        text: t(`chat.error.${code}`, { max: CHAT_MAX_CHARS }),
      }),
    [t],
  );

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text) {
        reportError('CHAT_EMPTY');
        return;
      }
      if (chatLength(text) > CHAT_MAX_CHARS) {
        reportError('CHAT_TOO_LONG');
        return;
      }
      setStatus(null);
      sendChat(text, (reply) => {
        if (reply.ok) {
          setDraft('');
          setStatus(null);
          return;
        }
        reportError(reply.error);
      });
    },
    [draft, reportError, sendChat],
  );

  // The open name card: which pilot, and where the name was when it was pressed.
  // Anchored to that rectangle because the transcript scrolls under the pointer.
  const [nameCard, setNameCard] = useState<NameCard | null>(null);
  // The shared card paints `ChatCardLine`, whose clock is a number; the lobby's wire
  // carries an ISO string, so it is parsed here once instead of inside the card.
  const cardLines = useMemo<ChatCardLine[]>(
    () =>
      lines.map((line) => ({
        id: line.id,
        senderId: line.senderId,
        senderName: line.senderName,
        text: line.text,
        at: Date.parse(line.at) || 0,
      })),
    [lines],
  );
  const openNameCard = useCallback((line: ChatCardLine, anchor: DOMRect) => {
    // Your own name opens nothing: every action on the card is about the other pilot,
    // so the only thing a self-card could offer is a guaranteed `400`.
    if (user && line.senderId === user.id) return;
    const width = NAME_CARD_WIDTH;
    const left = Math.max(NAME_CARD_MARGIN, Math.min(anchor.left, window.innerWidth - width - NAME_CARD_MARGIN));
    const top = Math.min(anchor.bottom + 6, window.innerHeight - NAME_CARD_HEIGHT - NAME_CARD_MARGIN);
    setNameCard({ id: line.senderId, name: line.senderName, left, top });
  }, [user]);

  // Measured from the plate's own rectangle rather than from CSS: where the plate
  // sits depends on the nav track, the notifications and the window height, and
  // the card has to clear the viewport edges at every one of them.
  const place = useCallback(() => {
    const plate = plateRef.current;
    if (!plate) return;
    const r = plate.getBoundingClientRect();
    const height = Math.min(CARD_MAX_HEIGHT, window.innerHeight - CARD_MARGIN * 2);
    const width = Math.min(CARD_WIDTH, window.innerWidth - CARD_MARGIN * 2);
    // Left-aligned with the plate where that fits, held inside the right edge
    // otherwise; bottom-aligned with the plate, so the card rises out of the
    // screen rather than dropping over it.
    const left = Math.max(CARD_MARGIN, Math.min(r.left, window.innerWidth - width - CARD_MARGIN));
    const top = Math.max(
      CARD_MARGIN,
      Math.min(r.bottom - height, window.innerHeight - height - CARD_MARGIN),
    );
    setBox({ left, top, width, height });
  }, []);

  const openCard = useCallback(() => {
    place();
    setCardOpen(true);
    retroAudio.playUiBeep(990, 0.05);
  }, [place]);

  const closeCard = useCallback(() => {
    setCardOpen(false);
    retroAudio.playUiBeep(520, 0.05);
    plateRef.current?.focus();
  }, []);

  // A scrolling page and a resizing window both move the anchor: the card follows
  // it, or it would be left pointing at where the plate used to be.
  useEffect(() => {
    if (!cardOpen) return;
    const onViewport = () => place();
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    return () => {
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
    };
  }, [cardOpen, place]);

  // Escape closes, and so does a press anywhere outside the card and its plate.
  // `pointerdown` rather than `click`: a drag that ends outside would otherwise
  // close the card the user was aiming at.
  useEffect(() => {
    if (!cardOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCard();
    };
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (plateRef.current?.contains(target)) return;
      // The name card is a second overlay, portaled outside this one's subtree:
      // pressing inside it must not also collapse the transcript behind it.
      if (target instanceof Element && target.closest('[data-chat-overlay]')) return;
      setCardOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [cardOpen, closeCard]);

  // Focus moves into the card on open, so Escape and the composer are reachable
  // without a second tab stop; `closeCard` puts it back on the plate. The box is
  // not measured here: `openCard` measures it in the same tick as the click, and
  // the resize/scroll listeners below keep it on its anchor afterwards.
  useEffect(() => {
    if (cardOpen) cardRef.current?.focus();
  }, [cardOpen]);

  // A screen that is switched off cannot leave its card floating over the page.
  // Handled where the switch is thrown rather than in an effect, so turning the
  // channel off closes the card in the same render instead of one render later.

  const screenClass = `chat-screen${thrown ? (open ? ' chat-screen--on' : ' chat-screen--off') : ''}`;

  const toggleCard = useCallback(() => {
    if (cardOpen) closeCard();
    else openCard();
  }, [cardOpen, closeCard, openCard]);

  return (
    <section
      aria-label="Hyperspace Comms"
      style={{
        width: '100%',
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        // The slot takes whatever the nav track and the notifications leave
        // behind, so the screen is the dock's flex, never a fixed height (D6).
        flex: '1 1 0',
        minHeight: 0,
        boxSizing: 'border-box',
      }}
    >
      {/* Header: the channel name and the one control that owns it. */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.64rem',
            fontWeight: 900,
            letterSpacing: '1px',
            color: open ? 'var(--accent-cyan)' : 'var(--text-muted)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: open ? '0 0 10px rgba(0, 240, 255, 0.45)' : 'none',
            transition: 'color 0.18s ease',
          }}
        >
          {t('chat.title')}
        </span>
        <button
          type="button"
          aria-pressed={open}
          aria-label={open ? t('chat.hide') : t('chat.show')}
          title={open ? t('chat.hide') : t('chat.show')}
          onClick={() => {
            setThrown(true);
            // Switching the channel off also closes the card, in this render.
            if (open) setCardOpen(false);
            retroAudio.playUiBeep(open ? 440 : 880, 0.05);
            onToggle();
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            height: 20,
            padding: '0 7px',
            flexShrink: 0,
            cursor: 'pointer',
            borderRadius: 5,
            outline: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.56rem',
            fontWeight: 900,
            letterSpacing: '0.5px',
            color: open ? 'var(--accent-cyan)' : 'var(--text-muted)',
            background: open ? 'rgba(0, 240, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${open ? 'rgba(0, 240, 255, 0.55)' : 'rgba(184, 166, 228, 0.28)'}`,
            boxShadow: open ? '0 0 10px rgba(0, 240, 255, 0.28)' : 'none',
            transition: 'all 0.18s ease',
          }}
        >
          {open ? '● ON' : '○ OFF'}
        </button>
      </div>

      {/* The screen. Same plate, same size, on and off: throwing the switch lights
          the picture up inside it instead of resizing anything, so nothing outside
          the dock can move. The keyframes live in `retrowave.css`. Off is a dead
          black box with no content mounted, so it has no tab stops and no live
          region announcing into a tube that is not showing a picture (D3) — and
          no card either: the plate is only a trigger while the channel is on.

          It is a `div` with a role rather than a `<button>` for the same reason
          the lobby's entry passes are: the raster and the picture are layers
          inside it, and a button would bring its own type and padding rules. */}
      <div
        ref={plateRef}
        className={screenClass}
        role={open ? 'button' : undefined}
        tabIndex={open ? 0 : undefined}
        aria-haspopup={open ? 'dialog' : undefined}
        aria-expanded={open ? cardOpen : undefined}
        aria-label={open ? 'Open the lobby channel' : undefined}
        title={open ? 'Open the lobby channel' : undefined}
        onClick={open ? toggleCard : undefined}
        onKeyDown={
          open
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleCard();
                }
              }
            : undefined
        }
        style={{
          flex: '1 1 0',
          minHeight: SCREEN_MIN_HEIGHT,
          boxSizing: 'border-box',
          cursor: open ? 'pointer' : 'default',
          outline: 'none',
        }}
      >
        {/* The raster: the white sheet that opens from a line to the frame. */}
        <div className="chat-raster" aria-hidden="true" />

        {open && (
          // The picture: the newest lines, bottom-aligned so the last one is where
          // the eye lands. Non-interactive on purpose: the plate is the card's
          // trigger, and a scrollable feed inside a button traps the pointer.
          <div
            className="chat-picture"
            style={{
              justifyContent: 'flex-end',
              alignItems: 'stretch',
              textAlign: 'left',
              gap: 4,
              pointerEvents: 'none',
            }}
          >
            {lines.length === 0 ? (
              <ScreenEmpty />
            ) : (
              lines.slice(-SCREEN_PREVIEW_LINES).map((line) => (
                <p
                  key={line.id}
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.58rem',
                    lineHeight: 1.5,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <span style={{ color: 'var(--accent-cyan)' }}>{line.senderName}</span>
                  <span style={{ color: 'var(--text-muted)' }}> &gt; </span>
                  <span style={{ color: 'var(--text-main)' }}>{line.text}</span>
                </p>
              ))
            )}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.58rem',
                fontWeight: 900,
                letterSpacing: '1.2px',
                color: 'var(--accent-cyan)',
                opacity: 0.75,
              }}
            >
              {t('chat.openHint')}
            </span>
          </div>
        )}
      </div>

      {/* The expanded card. Portaled to `document.body` (the dock is a sticky
          column with its own stacking context, and the card is wider than it), so
          it can hang over the page without being clipped and without the dock
          changing width — the rule this whole dock is built on. */}
      {open &&
        cardOpen &&
        box &&
        createPortal(
          <div
            ref={cardRef}
            role="dialog"
            aria-label="Hyperspace Comms channel"
            tabIndex={-1}
            className="chat-card"
            style={{
              position: 'fixed',
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              zIndex: 10004,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: 14,
              borderRadius: 10,
              outline: 'none',
              // The account popover's recipe rather than `--bg-card`: this card has
              // no scrim behind it, so 85% opaque over a lit lobby pass is mush.
              background: 'linear-gradient(180deg, rgba(20, 6, 46, 0.97), rgba(10, 2, 28, 0.985))',
              backdropFilter: 'blur(24px) saturate(180%)',
              border: '1px solid rgba(0, 240, 255, 0.45)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85), 0 0 24px rgba(0, 240, 255, 0.22)',
            }}
          >
            <ChatCardHead onClose={closeCard} />
            <ChatCardFeed lines={cardLines} onOpenName={openNameCard} />
            <ChatCardComposer
              draft={draft}
              onDraft={setDraft}
              onSubmit={submit}
              status={status}
              connected={sessionConnected}
              onStatus={setStatus}
            />
          </div>,
          document.body,
        )}

      {/* The name card. Portaled for the same reason the card is, and rendered
          above it: it is opened from a name inside the card. */}
      {nameCard &&
        createPortal(
          <ChatNameCard
            card={nameCard}
            friends={friends}
            requests={requests}
            loading={loading}
            onClose={() => setNameCard(null)}
            onStatus={setStatus}
            onBlocked={refresh}
          />,
          document.body,
        )}
    </section>
  );
}

/** The plate's empty state: the same two lines, smaller, because the screen is the
 *  narrow one. */
function ScreenEmpty() {
  const { t } = useTranslation();
  return (
    <>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.68rem',
          fontWeight: 900,
          letterSpacing: '1px',
          color: 'var(--accent-cyan)',
        }}
      >
        {t('chat.emptyTitle')}
      </span>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.54rem',
          letterSpacing: '0.5px',
          lineHeight: 1.5,
          color: 'var(--text-muted)',
        }}
      >
        {t('chat.emptyPlate')}
      </span>
    </>
  );
}

/** The card a name opens: what the viewer can do about that pilot. Its state comes
 *  from the friendship snapshot (friends, requests sent, requests received), the
 *  same source the Friends screen reads, and its confirmations go to the panel's
 *  band rather than to a toast. A refusal lands in the same line, which is what the
 *  band is reserved for. */
function ChatNameCard({
  card,
  friends,
  requests,
  loading,
  onClose,
  onStatus,
  onBlocked,
}: {
  card: NameCard;
  friends: FriendRow[];
  requests: { sent: FriendRequestRow[]; received: FriendRequestRow[] };
  loading: boolean;
  onClose: () => void;
  onStatus: (status: ChatCardStatus | null) => void;
  /** Re-read the friendship snapshot: a block is a mutation, and the feed's filter
   *  is built from that snapshot. */
  onBlocked: () => void;
}) {
  const { t } = useTranslation();
  const { activeMatch } = useApp();
  // The one challenge route, and the server's own list behind the grey state: this
  // card closes on a press, so the list is what a reopened card reads after a reload.
  const { isSent, challenge: sendChallenge } = useChallenges();
  const challenged = isSent(card.id);
  const [busy, setBusy] = useState(false);
  // The block confirm. It is the card's own state rather than the page's, because
  // the card is what opened it.
  const [confirmBlock, setConfirmBlock] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

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
      const target = event.target as Node | null;
      if (target && cardRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [onClose, confirmBlock]);

  const friend = friends.find((entry) => entry.id === card.id);
  const sent = requests.sent.find((entry) => entry.userId === card.id);
  const received = requests.received.find((entry) => entry.userId === card.id);

  // The band is the only place an outcome is reported, and the card closes with it:
  // two surfaces saying the same thing is what this design avoids.
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
      // `postApi` already localized the server's code; `failure` covers a
      // transport error with no body to read.
      report('error', (error as Error).message || failure);
    } finally {
      setBusy(false);
    }
  };

  const addFriend = () =>
    run(
      () => postApi(`/api/friends/request/${card.id}`, {}),
      () => report('info', t('chat.status.friendSent', { name: card.name })),
      t('friends.couldNotSendRequest'),
    );

  const accept = (requestId: string) =>
    run(
      () => postApi(`/api/friends/accept/${requestId}`, {}),
      () => report('info', t('chat.status.friendAdded', { name: card.name })),
      t('friends.genericError'),
    );

  const challenge = () =>
    activeMatch &&
    run(
      async () => {
        const outcome = await sendChallenge(
          { id: card.id, name: card.name },
          { gameId: activeMatch.gameId },
        );
        // `run` reports through the catch, so a refusal is thrown as the sentence the
        // band should carry rather than returned to a caller that has no band.
        if (!outcome.ok) throw new Error(outcome.message || t('friends.genericError'));
      },
      () => report('info', t('chat.status.challengeSent')),
      t('friends.genericError'),
    );

  // Blocking is the one unilateral action here: the other pilot is not asked, the
  // friendship (and any pending request) goes with it, and this card cannot undo it.
  // Hence the confirm, and hence the same `ConfirmActionModal` the friends screen's
  // BLOCK uses.
  const block = () =>
    run(
      () => postApi(`/api/friends/block/${card.id}`, {}),
      () => {
        // The feed's filter is built from the snapshot, and the block's live record
        // lands on the next frame from the socket: re-reading here means the lines
        // are gone even if that frame is lost.
        onBlocked();
        report('info', t('chat.status.blocked', { name: card.name }));
      },
      t('friends.genericError'),
    );

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

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={card.name}
      data-chat-overlay="name"
      className="chat-card"
      style={{
        position: 'fixed',
        left: card.left,
        top: card.top,
        width: NAME_CARD_WIDTH,
        zIndex: 10005,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        borderRadius: 10,
        background: 'linear-gradient(180deg, rgba(20, 6, 46, 0.97), rgba(10, 2, 28, 0.985))',
        backdropFilter: 'blur(24px) saturate(180%)',
        border: '1px solid rgba(0, 240, 255, 0.45)',
        boxShadow: '0 18px 44px rgba(0, 0, 0, 0.8), 0 0 20px rgba(0, 240, 255, 0.2)',
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
        title={card.name}
      >
        {card.name}
      </span>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <span style={labelStyle}>…</span>
        ) : friend ? (
          <>
            <span style={labelStyle}>{t('chat.card.friends')}</span>
            {activeMatch?.mode === 'pvp' && (
              <button
                type="button"
                className={RETRO_BTN}
                style={{ ...actionStyle, opacity: challenged ? 0.6 : 1 }}
                disabled={busy}
                onClick={() => void challenge()}
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
            onClick={() => void accept(received.id)}
          >
            {t('chat.card.accept')}
          </button>
        ) : (
          <button
            type="button"
            className={RETRO_BTN}
            style={actionStyle}
            disabled={busy}
            onClick={() => void addFriend()}
          >
            {t('chat.card.addFriend')}
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
          onClick={onClose}
        >
          {t('chat.close')}
        </button>
      </div>

      {/* The confirm. `ConfirmActionModal` is the app's one gate: it lifts the whole
          overlay above this card (10005) and the transcript's (10004), which `CyberModal`
          alone cannot do from here. */}
      <ConfirmActionModal
        isOpen={confirmBlock}
        title={t('chat.block.title')}
        message={t('chat.block.confirm', { name: card.name })}
        subMessage={t('chat.block.subMessage')}
        cancelLabel={t('chat.cancel')}
        proceedLabel={t('chat.block.proceed')}
        onCancel={() => setConfirmBlock(false)}
        onProceed={() => {
          setConfirmBlock(false);
          void block();
        }}
      />
    </div>
  );
}


