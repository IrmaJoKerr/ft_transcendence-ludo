import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { translateErrorCode } from '../api';
import { useApp } from '../store';
import { RETRO_BTN, RETRO_WINDOW, WINDOW_HEADER, WINDOW_BODY, GAME_WINDOW_HEADER_EXTRA } from '../styles/tw';
import { retroAudio } from '../utils/audio';
import { CHAT_MAX_CHARS, chatLength } from '../__shared__/chat.constants';
import { systemLineText } from './chatCardTypes';
import type { ChatBandGlyph, ChatCardLine, ChatCardStatus } from './chatCardTypes';

// The chat card, in one place (M3/R8). The lobby dock and the board's left column
// both render this: the lobby anchors it to its plate as an overlay, the board mounts
// the compact feed in the slot and opens the same card on click. Nothing here knows
// which channel it is showing — the host owns the transport and the text of the
// channel's own lines. The wire-side types and the cap live in `chatCardTypes.ts`, so
// this file exports components only.
//
// Since 19.8 the band under the composer is this file's too (`ChatStatusBand`), with a
// glyph column in which the room mounts the INVITE COMMS switch, and a host with a
// panel to offer passes it as `sidePanel`: portaled beside the open card rather than
// laid out next to it, so the card's width is the card's business and the board's
// column never reflows when the panel appears.

/** The card's width, and the ceiling the overlay clamps to. */
const CARD_WIDTH = 440;
const CARD_MAX_HEIGHT = 560;
const CARD_MARGIN = 16;

/** How many lines the collapsed board card previews. */
const PREVIEW_LINES = 3;

/** The panel a host can mount beside the open card (INVITE COMMS, 19.8). It is
 *  portaled, so it costs the card no width: the card is placed first and the panel
 *  reads `left` off its right edge (or its left one, when the right will not fit),
 *  8 px away and clamped inside the viewport. 240 holds a six-row friend list and a
 *  truncated name beside its INVITE press. */
const PANEL_WIDTH = 240;
const PANEL_GAP = 8;

/** Every line the band can show, in one list, so its height is reserved for the
 *  longest of them in every language (`PassActionPill`'s trick, kept from the
 *  lobby's band, which is where this component comes from — 19.8 moved it here so
 *  both channels reserve one height). */
const STATUS_KEYS = [
  'error.CHAT_EMPTY',
  'error.CHAT_TOO_LONG',
  'error.CHAT_COOLDOWN',
  'error.CHAT_UNAVAILABLE',
  'status.friendSent',
  'status.friendAdded',
  'status.challengeSent',
  'status.blocked',
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

/** The glyph the room puts in the band's second column: the INVITE COMMS panel's
 *  switch. One constant, so the two surfaces that name it (the band and the panel)
 *  cannot drift. */
const INVITE_GLYPH = '👥';

export interface ChatCardProps {
  /** Oldest first, the order this component paints. */
  lines: ChatCardLine[];
  /** One line out. The ack is the host's own transport answer. */
  send: (text: string, ack: (reply: { ok: true } | { ok: false; error: string }) => void) => void;
  /** Whether the transport is open. A closed one leaves the composer disabled. */
  connected: boolean;
  /** The panel a host can mount beside the open card (the room's INVITE COMMS,
   *  waiting room only). Portaled, so it never changes the card's width or the
   *  board's, and behind the band's glyph: the glyph exists exactly while there is a
   *  panel to open, so a room never shows a switch that does nothing. */
  sidePanel?: ReactNode;
  /** The name pressed in the transcript: the host owns the card it opens and the
   *  calls that card makes, and takes the pressed rectangle so the card can be placed
   *  against the name (the feed scrolls under the pointer). */
  onOpenName?: (userId: string, displayName: string, anchor: DOMRect) => void;
  /** A clash is up: the card stays mounted and readable but takes no keys (E7). */
  inert?: boolean;
  titleKey?: string;
  scopeKey?: string;
  emptyTitleKey?: string;
  emptyDescKey?: string;
  /** The collapsed title, for the board's slot. */
  slotTitleKey?: string;
  /** The composer's status, owned by the host when it reports friend actions too. */
  status?: ChatCardStatus | null;
  onStatus?: (status: ChatCardStatus | null) => void;
}

/** The card's title row: the channel, its scope, and the way out. */
export function ChatCardHead({
  onClose,
  titleKey = 'chat.title',
  scopeKey = 'chat.scope',
}: {
  onClose?: () => void;
  titleKey?: string;
  scopeKey?: string;
}) {
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
          {t(titleKey)}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.56rem',
            letterSpacing: '0.6px',
            color: 'var(--text-muted)',
          }}
        >
          {t(scopeKey)}
        </span>
      </div>
      {onClose && (
        <button
          type="button"
          className={RETRO_BTN}
          onClick={onClose}
          style={{ padding: '3px 9px', fontSize: '0.66rem', color: 'var(--text-muted)' }}
        >
          {t('chat.close')}
        </button>
      )}
    </div>
  );
}

/** The transcript. Newest line at the bottom, scrolled there as it arrives, and a
 *  live region so a line is announced rather than only painted. */
export function ChatCardFeed({
  lines,
  onOpenName,
  emptyTitleKey = 'chat.emptyTitle',
  emptyDescKey = 'chat.emptyDesc',
}: {
  lines: ChatCardLine[];
  onOpenName?: (line: ChatCardLine, anchor: DOMRect) => void;
  emptyTitleKey?: string;
  emptyDescKey?: string;
}) {
  const feedRef = useRef<HTMLDivElement>(null);
  // Stick to the bottom only while the reader is already there: a scrollback must not
  // be yanked away by the next line (R8).
  const atBottomRef = useRef(true);

  useEffect(() => {
    const feed = feedRef.current;
    if (feed && atBottomRef.current) feed.scrollTop = feed.scrollHeight;
  }, [lines.length]);

  return (
    <div
      ref={feedRef}
      aria-live="polite"
      className="chat-card-feed"
      onScroll={(event) => {
        const el = event.currentTarget;
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
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
        <FeedEmpty titleKey={emptyTitleKey} descKey={emptyDescKey} />
      ) : (
        lines.map((line) => (
          <FeedLine key={line.id} line={line} onOpenName={onOpenName} />
        ))
      )}
    </div>
  );
}

/** One line of the transcript. A player's line is two rows (the sender above, the
 *  text below), which is the layout that survives a 400 px card and a long name. A
 *  system line is one centred row of muted text, because nobody said it. */
function FeedLine({
  line,
  onOpenName,
}: {
  line: ChatCardLine;
  onOpenName?: (line: ChatCardLine, anchor: DOMRect) => void;
}) {
  const { t } = useTranslation();
  const { user } = useApp();

  if (line.kind === 'system') {
    return (
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6rem',
          letterSpacing: '0.4px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {systemLineText(t, line)}
      </span>
    );
  }

  const mine = user?.id === line.senderId;
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
    cursor: mine || !onOpenName ? 'default' : 'pointer',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        {mine || !onOpenName ? (
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
function FeedEmpty({ titleKey, descKey }: { titleKey: string; descKey: string }) {
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
        {t(titleKey)}
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
        {t(descKey)}
      </span>
    </>
  );
}

/** The reserved line under the composer: one grid, a text column that takes the
 *  width and a glyph column that does not. Every string the band can show is mounted
 *  in the text cell, hidden, so the cell is as tall as the longest of them in the
 *  current language (`PassActionPill`'s trick) — a chat refusal, a friend action's
 *  error and a "friend invite sent" confirmation all appear and clear without moving
 *  the composer or the transcript by a pixel.
 *
 *  One shape for both channels (19.8 moved it here from the lobby): the lobby passes
 *  no glyph, the room passes the INVITE COMMS switch, and because the glyph is a
 *  grid column it costs width and no height either way. */
export function ChatStatusBand({
  status,
  glyph,
}: {
  status: ChatCardStatus | null;
  /** The second column's switch: a glyph, its label, and whether the panel it owns
   *  is up. Absent leaves the column empty. */
  glyph?: ChatBandGlyph;
}) {
  const { t } = useTranslation();

  // The sizing rows. The chat strings are keyed; a friend refusal is a localized
  // error code, so those four are resolved through the same helper the API uses.
  const sized = [
    ...STATUS_KEYS.map((key) => ({
      key,
      text: t(`chat.${key}`, { max: CHAT_MAX_CHARS, name: NAME_SAMPLE }),
    })),
    ...FRIEND_ERROR_CODES.map((code) => ({
      key: code,
      text: translateErrorCode(code) ?? t('chat.error.CHAT_UNAVAILABLE', { max: CHAT_MAX_CHARS }),
    })),
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 6,
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
      <div role="status" style={{ display: 'grid', minWidth: 0 }}>
        {sized.map((row) => (
          <span key={row.key} aria-hidden style={{ gridArea: '1 / 1', visibility: 'hidden' }}>
            {row.text}
          </span>
        ))}
        {status && (
          <span key="live" title={status.text} style={{ gridArea: '1 / 1', overflow: 'hidden' }}>
            {status.text}
          </span>
        )}
      </div>
      {glyph && (
        <button
          type="button"
          aria-label={glyph.label}
          title={glyph.label}
          aria-pressed={glyph.pressed}
          onClick={glyph.onPress}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 22,
            height: 18,
            padding: 0,
            flexShrink: 0,
            cursor: 'pointer',
            borderRadius: 4,
            outline: 'none',
            fontSize: '0.72rem',
            lineHeight: 1,
            color: glyph.pressed ? 'var(--accent-cyan)' : 'var(--text-muted)',
            background: glyph.pressed ? 'rgba(0, 240, 255, 0.14)' : 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${glyph.pressed ? 'rgba(0, 240, 255, 0.55)' : 'rgba(184, 166, 228, 0.28)'}`,
            transition: 'all 0.18s ease',
          }}
        >
          <span aria-hidden="true">{glyph.glyph}</span>
        </button>
      )}
    </div>
  );
}

/** The composer: one input, one send, a counter, and the band under it. The band is
 *  always mounted, so a refusal never resizes the card. Both channels render this one
 *  component and one band; what differs between them is a host's business, so the
 *  only slot left is the band's glyph, which the room uses for its invite panel. */
export function ChatCardComposer({
  draft,
  onDraft,
  onSubmit,
  status,
  onStatus,
  connected,
  inert,
  glyph,
  placeholderKey = 'chat.placeholder',
  inputLabelKey = 'chat.inputLabel',
  offlineKey = 'chat.offline',
  sendKey = 'chat.send',
}: {
  draft: string;
  onDraft: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  status: ChatCardStatus | null;
  onStatus: (status: ChatCardStatus | null) => void;
  connected: boolean;
  inert?: boolean;
  /** The band's second column, when the host has a panel to open. */
  glyph?: ChatBandGlyph;
  placeholderKey?: string;
  inputLabelKey?: string;
  offlineKey?: string;
  sendKey?: string;
}) {
  const { t } = useTranslation();
  const count = chatLength(draft);
  const over = count > CHAT_MAX_CHARS;
  const disabled = !connected || inert === true;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
      <form onSubmit={onSubmit} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          value={draft}
          onChange={(event) => {
            onDraft(event.target.value);
            // A refusal clears as soon as the sender starts fixing it; a server error
            // must not sit under the box while a new line is being typed.
            if (status?.tone === 'error') onStatus(null);
          }}
          disabled={disabled}
          placeholder={connected ? t(placeholderKey) : t(offlineKey)}
          aria-label={t(inputLabelKey)}
          aria-invalid={over}
          // One character over the cap, so the band can say why rather than the input
          // silently refusing the keystroke.
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
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.58rem',
            color: over ? '#ff5278' : 'var(--text-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          {count} / {CHAT_MAX_CHARS}
        </span>
        <button
          type="submit"
          disabled={disabled}
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
          {t(sendKey)}
        </button>
      </form>
      <ChatStatusBand status={status} glyph={glyph} />
    </div>
  );
}

/** The card a room renders in the board's left column: a compact feed in the slot,
 *  and the full card as an overlay on click. One component for both states, so a
 *  re-render of the board cannot re-key the composer (E7) and the transcript stays
 *  mounted across every `game_state` frame.
 *
 *  A clash takes absolute precedence (E7): the card stays open and readable, but the
 *  composer is disabled and nothing takes focus until the clash resolves. */
export function ChatCard({
  lines,
  send,
  connected,
  sidePanel,
  onOpenName,
  inert,
  titleKey = 'gameChat.title',
  scopeKey = 'gameChat.scope',
  emptyTitleKey = 'gameChat.emptyTitle',
  emptyDescKey = 'gameChat.emptyDesc',
  slotTitleKey = 'gameChat.slotTitle',
  status: hostStatus,
  onStatus: hostStatusSetter,
}: ChatCardProps) {
  const { t } = useTranslation();
  // The draft and the band belong to this card, never to the page: `Game.tsx`
  // re-renders on every engine frame, and a draft held there would drop characters.
  const [draft, setDraft] = useState('');
  const [localStatus, setLocalStatus] = useState<ChatCardStatus | null>(null);
  const status = hostStatus !== undefined ? hostStatus : localStatus;
  const setStatus = hostStatusSetter ?? setLocalStatus;
  const [open, setOpen] = useState(false);
  // The side panel is off until the band's glyph asks for it (19.8): a room never
  // opens with a friend list nobody asked for, and closing the card puts it away.
  const [panelOpen, setPanelOpen] = useState(false);
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    panelLeft: number;
  } | null>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Anchored to the slot's own rectangle: where the slot sits depends on the grid,
  // the roster's overhang and the window height, so CSS cannot say it. The panel's
  // left edge is measured from the card's, not from the slot's: it sits 8 px off the
  // card's right edge, and flips to the left one when the right will not fit
  // (19.9 item 5). Both boxes are clamped inside the viewport, so the pair never
  // leaves the screen; on a narrow window the clamped panel covers the card, which is
  // the recorded trade rather than a second layout.
  const place = useCallback(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    const height = Math.min(CARD_MAX_HEIGHT, window.innerHeight - CARD_MARGIN * 2);
    const width = Math.min(CARD_WIDTH, window.innerWidth - CARD_MARGIN * 2);
    const left = Math.max(CARD_MARGIN, Math.min(r.left, window.innerWidth - width - CARD_MARGIN));
    const top = Math.max(CARD_MARGIN, Math.min(r.top, window.innerHeight - height - CARD_MARGIN));
    const right = left + width + PANEL_GAP;
    const panelLeft =
      right + PANEL_WIDTH <= window.innerWidth - CARD_MARGIN
        ? right
        : Math.max(CARD_MARGIN, left - PANEL_GAP - PANEL_WIDTH);
    setBox({ left, top, width, height, panelLeft });
  }, []);

  const openCard = useCallback(() => {
    place();
    setOpen(true);
    retroAudio.playUiBeep(990, 0.05);
  }, [place]);

  const closeCard = useCallback(() => {
    setOpen(false);
    setPanelOpen(false);
    retroAudio.playUiBeep(520, 0.05);
    slotRef.current?.focus();
  }, []);

  const togglePanel = useCallback(() => {
    if (!sidePanel) return;
    retroAudio.playUiBeep(panelOpen ? 660 : 880, 0.05);
    setPanelOpen((was) => !was);
  }, [panelOpen, sidePanel]);

  // Escape closes, and so does a press outside the card, its slot and its panel.
  // `pointerdown` rather than `click`: a drag that ends outside must not close what
  // the user aimed at. Escape takes the panel first when it is up, so one key press
  // puts away the thing the last press brought in.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A key typed into a field is never a command (E7's check, the one the page
      // makes for its own hotkeys).
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable === true);
      if (e.key !== 'Escape' || typing) return;
      // An overlay above this one owns the key: the name card (10005) and the confirm
      // it opens (10006) each handle Escape themselves, so one press dismisses the top
      // of the stack rather than the whole stack.
      if (document.querySelector('[data-chat-overlay]')) return;
      if (panelOpen) setPanelOpen(false);
      else closeCard();
    };
    const onPress = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (cardRef.current?.contains(target)) return;
      if (slotRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      // The name card and its confirm are further overlays, portaled outside this
      // one's subtree: a press inside them must not collapse the transcript they were
      // opened from, because the outcome of their actions lands in this card's band.
      if (target instanceof Element && target.closest('[data-chat-overlay], [data-modal-state]'))
        return;
      setOpen(false);
      setPanelOpen(false);
    };
    const onViewport = () => place();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
    };
  }, [open, panelOpen, closeCard, place]);

  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const text = draft.trim();
      if (!text) {
        setStatus({ tone: 'error', text: t('chat.error.CHAT_EMPTY') });
        return;
      }
      if (chatLength(text) > CHAT_MAX_CHARS) {
        setStatus({ tone: 'error', text: t('chat.error.CHAT_TOO_LONG', { max: CHAT_MAX_CHARS }) });
        return;
      }
      setStatus(null);
      send(text, (reply) => {
        if (reply.ok) {
          setDraft('');
          setStatus(null);
          return;
        }
        setStatus({ tone: 'error', text: t(`chat.error.${reply.error}`) });
      });
    },
    [draft, send, setStatus, t],
  );

  const preview = lines.slice(-PREVIEW_LINES);

  return (
    <>
      <div ref={slotRef} style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
        <section
          className={RETRO_WINDOW}
          style={{ flex: '1 1 auto', minWidth: 0, cursor: 'pointer' }}
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t(slotTitleKey)}
          onClick={openCard}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              openCard();
            }
          }}
        >
          <div className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}>
            <span>{t(slotTitleKey)}</span>
          </div>
          <div
            className={WINDOW_BODY}
            style={{ display: 'flex', flexDirection: 'column', gap: 3, minHeight: 64 }}
          >
            {preview.length === 0 ? (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.6rem',
                  color: 'var(--text-muted)',
                }}
              >
                {t(emptyTitleKey)}
              </span>
            ) : (
              preview.map((line) => (
                <p
                  key={line.id}
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.6rem',
                    lineHeight: 1.4,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    color: 'var(--text-main)',
                  }}
                >
                  {line.kind === 'system' ? (
                    <span style={{ color: 'var(--text-muted)' }}>{systemLineText(t, line)}</span>
                  ) : (
                    <>
                      <span style={{ color: 'var(--accent-cyan)' }}>{line.senderName}</span>
                      <span style={{ color: 'var(--text-muted)' }}> &gt; </span>
                      <span>{line.text}</span>
                    </>
                  )}
                </p>
              ))
            )}
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.56rem',
                fontWeight: 900,
                letterSpacing: '1.2px',
                color: 'var(--accent-cyan)',
                opacity: 0.75,
                marginTop: 'auto',
              }}
            >
              {t('gameChat.openHint')}
            </span>
          </div>
        </section>
      </div>

      {open &&
        box &&
        createPortal(
          <div
            ref={cardRef}
            role="dialog"
            aria-label={t(titleKey)}
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
              background: 'linear-gradient(180deg, rgba(20, 6, 46, 0.97), rgba(10, 2, 28, 0.985))',
              backdropFilter: 'blur(24px) saturate(180%)',
              border: '1px solid rgba(0, 240, 255, 0.45)',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85), 0 0 24px rgba(0, 240, 255, 0.22)',
            }}
          >
            <ChatCardHead onClose={closeCard} titleKey={titleKey} scopeKey={scopeKey} />
            <ChatCardFeed
              lines={lines}
              onOpenName={
                onOpenName
                  ? (line, anchor) => {
                      onOpenName(line.senderId, line.senderName, anchor);
                    }
                  : undefined
              }
              emptyTitleKey={emptyTitleKey}
              emptyDescKey={emptyDescKey}
            />
            <ChatCardComposer
              draft={draft}
              onDraft={setDraft}
              onSubmit={submit}
              status={status}
              onStatus={setStatus}
              connected={connected}
              inert={inert}
              glyph={
                sidePanel
                  ? {
                      glyph: INVITE_GLYPH,
                      label: t('gameChat.inviteToggle'),
                      pressed: panelOpen,
                      onPress: togglePanel,
                    }
                  : undefined
              }
              placeholderKey="gameChat.placeholder"
              inputLabelKey="gameChat.inputLabel"
            />
          </div>,
          document.body,
        )}

      {/* The side panel (INVITE COMMS, 19.8). Portaled beside the open card and never
          inside the slot, so the card keeps its width, the board keeps its column, and
          the panel cannot push either: it is placed off the card's measured edge, which
          is why it can flip sides at a narrow width without a second layout. It unmounts
          with the card, and the host unmounts it at the start of a match by passing no
          `sidePanel` at all. */}
      {open &&
        panelOpen &&
        sidePanel &&
        box &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              left: box.panelLeft,
              top: box.top,
              width: PANEL_WIDTH,
              maxHeight: box.height,
              zIndex: 10004,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {sidePanel}
          </div>,
          document.body,
        )}
    </>
  );
}
