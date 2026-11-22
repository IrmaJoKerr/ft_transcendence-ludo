import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { RETRO_WINDOW, WINDOW_HEADER, WINDOW_BODY, GAME_WINDOW_HEADER_EXTRA } from '../../styles/tw';
import { retroAudio } from '../../utils/audio';
import { CHAT_MAX_CHARS, chatLength } from '../../__shared__/chat.constants';
import { systemLineText } from '../chatCardTypes';
import type { ChatCardLine, ChatCardStatus } from '../chatCardTypes';
import { CHAT_SURFACE } from '../chatSurface';
import { ChatCardComposer } from './ChatCardComposer';
import { ChatCardFeed } from './ChatCardFeed';
import { ChatCardHead } from './ChatCardHead';
import {
  CHAT_CARD_MARGIN,
  CHAT_CARD_WIDTH,
  INVITE_GLYPH,
  PANEL_GAP,
  PANEL_WIDTH,
  PREVIEW_LINES,
  chatCardHeight,
} from './chatCardMetrics';

export interface ChatCardProps {
    // Oldest first, the order this component paints.
  lines: ChatCardLine[];
    // One line out. The ack is the host's own transport answer.
  send: (text: string, ack: (reply: { ok: true } | { ok: false; error: string }) => void) => void;
    // Whether the transport is open. A closed one leaves the composer disabled.
  connected: boolean;
        // The panel a host can mount beside the open card (the room's INVITE COMMS, waiting room only).
  sidePanel?: ReactNode;
    // The name pressed in the transcript: the host owns the card it opens and the
  //  calls that card makes, and takes the pressed rectangle so the card can be placed
  //  against the name (the feed scrolls under the pointer).
  onOpenName?: (userId: string, displayName: string, anchor: DOMRect) => void;
    // A clash is up: the card stays mounted and readable but takes no keys (E7).
  inert?: boolean;
  titleKey?: string;
  scopeKey?: string;
  emptyTitleKey?: string;
  emptyDescKey?: string;
    // The collapsed title, for the board's slot.
  slotTitleKey?: string;
    // The composer's status, owned by the host when it reports friend actions too.
  status?: ChatCardStatus | null;
  onStatus?: (status: ChatCardStatus | null) => void;
}

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
  // The side panel is off until the head's switch asks for it (19.8): a room never
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

    // Anchored to the slot's own rectangle: where the slot sits depends on the grid, the roster's
  // overhang and the window height, so CSS cannot say it.
  const place = useCallback(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const r = slot.getBoundingClientRect();
    const height = Math.min(chatCardHeight(), window.innerHeight - CHAT_CARD_MARGIN * 2);
    const width = Math.min(CHAT_CARD_WIDTH, window.innerWidth - CHAT_CARD_MARGIN * 2);
    const left = Math.max(
      CHAT_CARD_MARGIN,
      Math.min(r.left, window.innerWidth - width - CHAT_CARD_MARGIN),
    );
    const top = Math.max(
      CHAT_CARD_MARGIN,
      Math.min(r.top, window.innerHeight - height - CHAT_CARD_MARGIN),
    );
    const right = left + width + PANEL_GAP;
    const panelLeft =
      right + PANEL_WIDTH <= window.innerWidth - CHAT_CARD_MARGIN
        ? right
        : Math.max(CHAT_CARD_MARGIN, left - PANEL_GAP - PANEL_WIDTH);
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

    // Escape closes, and so does a press outside the card, its slot and its panel. `pointerdown`
  // rather than `click`: a drag that ends outside must not close what the user aimed at.
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
        retroAudio.playUiBeep(300, 0.07);
        setStatus({ tone: 'error', text: t('chat.error.CHAT_EMPTY') });
        return;
      }
      if (chatLength(text) > CHAT_MAX_CHARS) {
        retroAudio.playUiBeep(300, 0.07);
        setStatus({ tone: 'error', text: t('chat.error.CHAT_TOO_LONG', { max: CHAT_MAX_CHARS }) });
        return;
      }
            // The transmission (23.7), fired between the last validation and the send: one call here covers
      // all three composers, since they all submit through this. The two refusals above get `deny`
      // instead, so the press is answered before the band's words are read.
      retroAudio.playChatSend();
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
      {/* The slot is the last child of whatever column hosts it — the lobby's own, or the
          room's wrapper, which is where the room puts the roster's overhang — so the slot
          is what absorbs the slack the stretched column has (20.4): `flex: 1 1 auto` takes
          it and `minHeight: 0` lets the plate shrink with the column instead of pushing
          past the grid. The plate's own body grows inside it, which is what pins OPEN ⤢ to
          the bottom. */}
      <div
        ref={slotRef}
        style={{ display: 'flex', gap: 10, alignItems: 'stretch', flex: '1 1 auto', minHeight: 0 }}
      >
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
                    <span className="text-(--text-muted)">{systemLineText(t, line)}</span>
                  ) : (
                    <>
                      <span className="text-(--accent-cyan)">{line.senderName}</span>
                      <span className="text-(--text-muted)"> &gt; </span>
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
            <ChatCardHead
              onClose={closeCard}
              titleKey={titleKey}
              scopeKey={scopeKey}
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
            />
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
              // The card's height, not a ceiling (24.3): the panel reads as the second
              // half of one pair, so an empty room gets a card-shaped panel that says
              // so rather than a short one beside a tall card.
              height: box.height,
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
