import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFriendships } from '../hooks/useFriendships';
import { useApp } from '../store';
import type { ChatErrorCode } from '../sessionSocket';
import {
  ChatCardComposer,
  ChatCardFeed,
  ChatCardHead,
  CHAT_CARD_MARGIN,
  CHAT_CARD_WIDTH,
  chatCardHeight,
} from './ChatCard';
import { ChatNameCard } from './ChatNameCard';
import type { ChatNameCardTarget } from './ChatNameCard';
import { CHAT_MAX_CHARS, chatLength } from '../__shared__/chat.constants';
import type { ChatCardLine, ChatCardStatus } from './chatCardTypes';
import { CHAT_SURFACE } from './chatSurface';
import { useChallenges } from '../hooks/useChallenges';
import { retroAudio } from '../utils/audio';

// The dock's chat slot, wired to the public channel (queue item 3). The plate is
// the screen: it previews the newest lines and opens the card, which carries the
// whole transcript and the composer. Every string is a locale key now, and the
// composer has one reserved status line under the input, so "message too long" and
// "NO SPAMMING" never move the card. Since M3 the head, the feed and the composer are
// `ChatCard.tsx`'s; since 19.8 the band is too (`ChatStatusBand`, the same one the
// room paints), so both channels count one `n / 300` from `chatLength` and reserve one
// height, and both draw the same head — the room's panel switch is the one thing either
// host puts in it that the other leaves out. Since 19.7 the name card is
// `ChatNameCard.tsx`'s, the same component the room mounts, so a pilot met here and a
// pilot met across the board are offered the same acts; the lobby's own contribution
// to it is CHALLENGE, which it passes because it has a duel to offer. The feed drops
// the lines of whoever this reader has blocked, which the channel's own empty state
// promises.
const SCREEN_PREVIEW_LINES = 3;

/** The screen's floor, in both states. The 720p budget is 656 px (100vh − 64)
 *  minus 40 of dock padding, 74 of profile pill, 316 of nav track (five 52 px
 *  buttons, four 10 px gaps, 16 of padding), 59 of notifications and 42 of gaps:
 *  531, which leaves 125 for the panel. 112 fits that with 13 px to spare, so the
 *  track is not the box that shrinks at 720p; below about 707 px of window height
 *  it does. */
const SCREEN_MIN_HEIGHT = 112;

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
  const { chatLog, sendChat, sessionConnected, user, activeMatch } = useApp();

  // The friendship snapshot lives here rather than in the name card: the card needs
  // it (friend, request sent, request received) and the feed needs the block list, so
  // one read serves both and opening a card no longer refetches it.
  const { friends, requests, blocked, loading, refresh } = useFriendships();
  // The one challenge route, and the server's own list behind the grey state: the card
  // closes on a press, so the list is what a reopened card reads after a reload.
  const { isSent, challenge: sendChallenge } = useChallenges();

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
  const [nameTarget, setNameTarget] = useState<ChatNameCardTarget | null>(null);
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
  const openNameCard = useCallback(
    (line: ChatCardLine, anchor: DOMRect) => {
      // Your own name opens nothing: every action on the card is about the other pilot,
      // so the only thing a self-card could offer is a guaranteed `400`.
      if (user && line.senderId === user.id) return;
      setNameTarget({ id: line.senderId, name: line.senderName, anchor });
    },
    [user],
  );

  // CHALLENGE is this surface's to offer: the friends list's own duel, thrown at the
  // room the viewer already sits in — a seat offer, not a duel, because a duel makes
  // its own room at the accept and a seated player cannot host a second one (19.6).
  // It is thrown on refusal so the card's band carries the server's sentence, and it
  // stays optional because a name card without a duel (the room's) simply does not
  // pass it.
  const challengeName = useCallback(
    async (target: ChatNameCardTarget) => {
      if (!activeMatch) throw new Error(t('friends.genericError'));
      const outcome = await sendChallenge(
        { id: target.id, name: target.name },
        { gameId: activeMatch.gameId },
      );
      if (!outcome.ok) throw new Error(outcome.message || t('friends.genericError'));
    },
    [activeMatch, sendChallenge, t],
  );

  // Measured from the plate's own rectangle rather than from CSS: where the plate
  // sits depends on the nav track, the notifications and the window height, and
  // the card has to clear the viewport edges at every one of them. Its floor is the
  // bell row, which the bar marks `data-chat-reserve` (19.3): the card stops one
  // pixel above it, so a navbar that reflows moves the card with it and no second
  // constant has to track the nav's height. The height is `chatCardHeight()` — a
  // share of the viewport since decision 1.4 — and the window, the reserve row, or
  // the dock's own rows are the only things allowed to shorten it.
  const place = useCallback(() => {
    const plate = plateRef.current;
    if (!plate) return;
    const r = plate.getBoundingClientRect();
    const reserve = document.querySelector('[data-chat-reserve]');
    const floor = reserve ? reserve.getBoundingClientRect().top : r.bottom;
    // Left-aligned with the plate where that fits, held inside the right edge
    // otherwise; rising out of the screen from the reserve rather than dropping
    // over it.
    const bottom = Math.min(floor - 1, window.innerHeight - CHAT_CARD_MARGIN);
    const height = Math.max(0, Math.min(chatCardHeight(), bottom - CHAT_CARD_MARGIN));
    const width = Math.min(CHAT_CARD_WIDTH, window.innerWidth - CHAT_CARD_MARGIN * 2);
    const left = Math.max(
      CHAT_CARD_MARGIN,
      Math.min(r.left, window.innerWidth - width - CHAT_CARD_MARGIN),
    );
    const top = Math.max(CHAT_CARD_MARGIN, bottom - height);
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
      // An overlay above this one owns the key: the name card (10005) and the confirm
      // it opens (10006) each handle Escape themselves, so one press dismisses the top
      // of the stack rather than the whole stack.
      if (e.key === 'Escape' && !document.querySelector('[data-chat-overlay]')) closeCard();
    };
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (plateRef.current?.contains(target)) return;
      // The name card and its confirm are further overlays, portaled outside this
      // one's subtree: pressing inside them must not collapse the transcript they were
      // opened from, because the outcome of their actions lands in its band.
      if (target instanceof Element && target.closest('[data-chat-overlay], [data-modal-state]'))
        return;
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
        aria-label={open ? t('chat.openChannel') : undefined}
        title={open ? t('chat.openChannel') : undefined}
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
          changing width — the rule this whole dock is built on. Its size is
          `ChatCard.tsx`'s (`CHAT_CARD_WIDTH` × `chatCardHeight()`, 19.3), so the
          dock draws the same card the room does. */}
      {open &&
        cardOpen &&
        box &&
        createPortal(
          <div
            ref={cardRef}
            role="dialog"
            aria-label={t('chat.dialogLabel')}
            tabIndex={-1}
            className="chat-card"
            style={{
              ...CHAT_SURFACE,
              position: 'fixed',
              left: box.left,
              top: box.top,
              width: box.width,
              height: box.height,
              zIndex: 10004,
              display: 'flex',
              flexDirection: 'column',
              outline: 'none',
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

      {/* The name card. It portals itself above this one (10005 against 10004,
          because it is opened from a name inside the card), and it is the room's card
          too: the only thing this surface adds is the duel. */}
      {nameTarget && (
        <ChatNameCard
          target={nameTarget}
          friends={friends}
          requests={requests}
          loading={loading}
          challenge={
            activeMatch?.mode === 'pvp'
              ? {
                  sent: isSent(nameTarget.id),
                  onPress: () => challengeName(nameTarget),
                }
              : undefined
          }
          onClose={() => setNameTarget(null)}
          onStatus={setStatus}
          onBlocked={refresh}
        />
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
