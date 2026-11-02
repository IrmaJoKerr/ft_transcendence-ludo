import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { postApi, translateErrorCode } from '../api';
import { useFriendships } from '../hooks/useFriendships';
import { useApp } from '../store';
import type { ChatErrorCode, ChatMessage } from '../sessionSocket';
import { RETRO_BTN } from '../styles/tw';
import { retroAudio } from '../utils/audio';

// The dock's chat slot, wired to the public channel (queue item 3). The plate is
// the screen: it previews the newest lines and opens the card, which carries the
// whole transcript and the composer. Every string is a locale key now, and the
// composer has one reserved status line under the input, so "message too long" and
// "NO SPAMMING" never move the card.
const SCREEN_PREVIEW_LINES = 3;
/** The composer's cap, mirroring the backend's `CHAT_MAX_CHARS`. */
const CHAT_MAX_CHARS = 300;

/** What the band under the composer can say. The text is already resolved, so a
 *  chat refusal and a friend action's localized error share one line. */
type ChatStatus = { tone: 'error' | 'info'; text: string };

/** Every line the band can show, in one list, so its height is reserved for the
 *  longest of them in every language (the `PassActionPill` trick below). */
const STATUS_KEYS = [
  'error.CHAT_EMPTY',
  'error.CHAT_TOO_LONG',
  'error.CHAT_COOLDOWN',
  'error.CHAT_UNAVAILABLE',
  'status.friendSent',
  'status.friendAdded',
  'status.challengeSent',
] as const;

/** The friend actions' refusals, which arrive as server codes rather than chat
 *  strings. They are part of the reservation for the same reason. */
const FRIEND_ERROR_CODES = [
  'FRIEND_REQUEST_PENDING',
  'FRIEND_REQUEST_COOLDOWN',
  'FRIEND_ALREADY',
  'RATE_LIMITED',
] as const;

/** The longest display name a profile may hold, used to size the invite line. */
const NAME_SAMPLE = 'W'.repeat(24);

/** The name card's box. It is portaled to the body, so it is not clipped by the
 *  dock's 360 px column; the height is an upper bound for the clamp, not a size. */
const NAME_CARD_WIDTH = 220;
const NAME_CARD_HEIGHT = 190;
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
  const { chatLog, sendChat, sessionConnected } = useApp();

  // Whether the switch has ever been thrown. Until it has, the screen is drawn at
  // rest, so entering a page does not replay the power-on; after that the class
  // alternates between the two animations, and each throw replays its own.
  const [thrown, setThrown] = useState(false);

  // The composer's draft and the band's one line. Both belong to the card, not to
  // the connection: closing the card drops neither, and a refusal keeps the text.
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ChatStatus | null>(null);

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
      if (text.length > CHAT_MAX_CHARS) {
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
  const openNameCard = useCallback((line: ChatMessage, anchor: DOMRect) => {
    const width = NAME_CARD_WIDTH;
    const left = Math.max(NAME_CARD_MARGIN, Math.min(anchor.left, window.innerWidth - width - NAME_CARD_MARGIN));
    const top = Math.min(anchor.bottom + 6, window.innerHeight - NAME_CARD_HEIGHT - NAME_CARD_MARGIN);
    setNameCard({ id: line.senderId, name: line.senderName, left, top });
  }, []);

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
            {chatLog.length === 0 ? (
              <ScreenEmpty />
            ) : (
              chatLog.slice(-SCREEN_PREVIEW_LINES).map((line) => (
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
            <ChatCardFeed lines={chatLog} onOpenName={openNameCard} />
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
            onClose={() => setNameCard(null)}
            onStatus={setStatus}
          />,
          document.body,
        )}
    </section>
  );
}

/** The card's title row: the channel, its scope, and the way out. */
function ChatCardHead({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: '0.86rem',
            fontWeight: 900,
            letterSpacing: '1px',
            color: 'var(--accent-cyan)',
            textShadow: '0 0 12px rgba(0, 240, 255, 0.45)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {t('chat.title')}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.56rem',
            letterSpacing: '0.6px',
            color: 'var(--text-muted)',
          }}
        >
          {t('chat.scope')}
        </span>
      </div>
      <button
        type="button"
        className={RETRO_BTN}
        onClick={onClose}
        style={{ padding: '3px 9px', fontSize: '0.66rem', color: 'var(--text-muted)' }}
      >
        {t('chat.close')}
      </button>
    </div>
  );
}

/** The transcript. Newest line at the bottom, scrolled there as it arrives, and a
 *  live region so a line is announced rather than only painted. */
function ChatCardFeed({ lines, onOpenName }: { lines: ChatMessage[]; onOpenName: (line: ChatMessage, anchor: DOMRect) => void }) {
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={feedRef}
      aria-live="polite"
      className="chat-card-feed"
      style={{
        flex: '1 1 0',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: lines.length === 0 ? 'center' : 'flex-start',
        alignItems: lines.length === 0 ? 'center' : 'stretch',
        gap: 6,
        padding: 10,
        overflowY: 'auto',
        borderRadius: 8,
        background: 'rgba(0, 0, 0, 0.45)',
        border: '1px solid rgba(0, 240, 255, 0.16)',
        textAlign: lines.length === 0 ? 'center' : 'left',
      }}
    >
      {lines.length === 0 ? (
        <FeedEmpty />
      ) : (
        lines.map((line) => <FeedLine key={line.id} line={line} onOpenName={onOpenName} />)
      )}
    </div>
  );
}

/** One line of the transcript. Two rows: the sender above, the text below, which
 *  is the layout that survives a 400 px card and a long name. Another pilot's name
 *  is a button (the card asks what to do about them); your own is a label. */
function FeedLine({
  line,
  onOpenName,
}: {
  line: ChatMessage;
  onOpenName: (line: ChatMessage, anchor: DOMRect) => void;
}) {
  const { user, lang } = useApp();
  const mine = user?.id === line.senderId;
  const time = new Date(line.at).toLocaleTimeString(lang, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const nameStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.58rem',
    fontWeight: 900,
    letterSpacing: '0.5px',
    color: mine ? 'var(--accent-cyan)' : 'var(--text-main)',
    padding: 0,
    margin: 0,
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    cursor: mine ? 'default' : 'pointer',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        {mine ? (
          <span style={nameStyle}>{line.senderName}</span>
        ) : (
          <button
            type="button"
            style={nameStyle}
            title={line.senderName}
            onClick={(event) => onOpenName(line, event.currentTarget.getBoundingClientRect())}
          >
            {line.senderName}
          </button>
        )}
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.54rem', color: 'var(--text-muted)' }}>
          {time}
        </span>
      </div>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.72rem',
          lineHeight: 1.45,
          color: mine ? 'var(--accent-cyan)' : 'var(--text-main)',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {line.text}
      </span>
    </div>
  );
}

/** The transcript's empty state. It stays a live region like the feed, so the first
 *  line is announced where the placeholder was. */
function FeedEmpty() {
  const { t } = useTranslation();
  return (
    <>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.78rem',
          fontWeight: 900,
          letterSpacing: '1px',
          color: 'var(--text-main)',
        }}
      >
        {t('chat.emptyTitle')}
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
        {t('chat.emptyDesc')}
      </span>
    </>
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

/** The composer: one input, one send, and the band under it. The band comes first
 *  in the DOM order of this block only for the reader: visually it is below the
 *  form, and it is always mounted, so a refusal never resizes the card. */
function ChatCardComposer({
  draft,
  onDraft,
  onSubmit,
  status,
  onStatus,
  connected,
}: {
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  status: ChatStatus | null;
  onStatus: (status: ChatStatus | null) => void;
  connected: boolean;
}) {
  const { t } = useTranslation();
  const over = draft.trim().length > CHAT_MAX_CHARS;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
      <form onSubmit={onSubmit} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          value={draft}
          onChange={(event) => {
            onDraft(event.target.value);
            // A refusal clears as soon as the sender starts fixing it; a server
            // error must not sit under the box while a new line is being typed.
            if (status?.tone === 'error') onStatus(null);
          }}
          disabled={!connected}
          placeholder={connected ? t('chat.placeholder') : t('chat.offline')}
          aria-label={t('chat.inputLabel')}
          aria-invalid={over}
          // One character over the cap, so the band can say why rather than the
          // input silently refusing the keystroke.
          maxLength={CHAT_MAX_CHARS + 1}
          style={{
            flex: 1,
            minWidth: 0,
            height: 32,
            boxSizing: 'border-box',
            padding: '0 10px',
            borderRadius: 6,
            background: 'rgba(0, 0, 0, 0.5)',
            color: 'var(--text-main)',
            border: `1px solid ${over ? 'rgba(255, 82, 120, 0.6)' : 'var(--border-color)'}`,
            outline: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.74rem',
            opacity: connected ? 1 : 0.7,
          }}
        />
        <button
          type="submit"
          disabled={!connected}
          className={RETRO_BTN}
          style={{
            height: 32,
            padding: '0 12px',
            fontSize: '0.66rem',
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            color: 'var(--accent-cyan)',
            opacity: connected ? 1 : 0.55,
            whiteSpace: 'nowrap',
          }}
        >
          {t('chat.send')}
        </button>
      </form>
      <ChatStatusBand status={status} />
    </div>
  );
}

/** The reserved line under the composer. Every string the band can show is mounted
 *  in one grid cell, hidden, so the cell is as tall as the longest of them in the
 *  current language (`PassActionPill`'s trick): a chat refusal, a friend action's
 *  error and a "friend invite sent to X" confirmation all appear and clear without
 *  moving the composer or the transcript by a pixel. */
function ChatStatusBand({ status }: { status: ChatStatus | null }) {
  const { t } = useTranslation();

  // The sizing rows. The chat strings are keyed; a friend refusal is a localized
  // error code, so those four are resolved through the same helper the API uses.
  const sized = [
    ...STATUS_KEYS.map((key) => ({ key, text: t(`chat.${key}`, { max: CHAT_MAX_CHARS, name: NAME_SAMPLE }) })),
    ...FRIEND_ERROR_CODES.map((code) => ({
      key: code,
      text:
        translateErrorCode(code) ??
        t('chat.error.CHAT_UNAVAILABLE', { max: CHAT_MAX_CHARS }),
    })),
  ];

  return (
    <div
      role="status"
      style={{
        display: 'grid',
        flexShrink: 0,
        minHeight: 14,
        fontFamily: 'var(--font-mono)',
        fontSize: '0.6rem',
        letterSpacing: '0.5px',
        lineHeight: 1.35,
        color: status?.tone === 'error' ? 'var(--text-main)' : 'var(--accent-cyan)',
        textShadow:
          status?.tone === 'error'
            ? '0 0 8px rgba(255, 82, 120, 0.55)'
            : '0 0 8px rgba(0, 240, 255, 0.45)',
      }}
    >
      {sized.map((row) => (
        <span
          key={row.key}
          aria-hidden
          style={{ gridArea: '1 / 1', visibility: 'hidden' }}
        >
          {row.text}
        </span>
      ))}
      {status && (
        <span
          key="live"
          title={status.text}
          style={{ gridArea: '1 / 1', overflow: 'hidden' }}
        >
          {status.text}
        </span>
      )}
    </div>
  );
}

/** The card a name opens: what the viewer can do about that pilot. Its state comes
 *  from the friendship snapshot (friends, requests sent, requests received), the
 *  same source the Friends screen reads, and its confirmations go to the panel's
 *  band rather than to a toast. A refusal lands in the same line, which is what the
 *  band is reserved for. */
function ChatNameCard({
  card,
  onClose,
  onStatus,
}: {
  card: NameCard;
  onClose: () => void;
  onStatus: (status: ChatStatus | null) => void;
}) {
  const { t } = useTranslation();
  const { activeMatch } = useApp();
  const { friends, requests, loading } = useFriendships();
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Escape and an outside press close it, the same pair of gestures the transcript
  // card uses. `pointerdown` so a drag that ends outside does not count as a press.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onPress = (event: PointerEvent) => {
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
  }, [onClose]);

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

  const challenge = (gameId: string) =>
    run(
      () => postApi(`/api/game/${gameId}/invite`, { friendId: card.id }),
      () => report('info', t('chat.status.challengeSent')),
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
                style={actionStyle}
                disabled={busy}
                onClick={() => void challenge(activeMatch.gameId)}
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
        <button
          type="button"
          className={RETRO_BTN}
          style={{ ...actionStyle, color: 'var(--text-muted)' }}
          onClick={onClose}
        >
          {t('chat.close')}
        </button>
      </div>
    </div>
  );
}


