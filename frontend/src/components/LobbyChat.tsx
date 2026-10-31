import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RETRO_BTN } from '../styles/tw';
import { retroAudio } from '../utils/audio';

// The dock's chat slot. Nothing here is wired: it is the shape the transport
// pass fills in, so the copy is hardcoded English on purpose (decision D5 in
// `todo.md`). Half a translation is worse than none, and the real strings arrive
// with the socket, where "one public channel, filtered by blocks" has to be
// sayable. No locale keys, no socket, no store.
const CHAT_TITLE = '# HYPERSPACE COMMS';
const UNDER_CONSTRUCTION = 'CHAT UNDER CONSTRUCTION';
const CLICK_TO_OPEN = 'PUBLIC LOBBY CHANNEL — CLICK TO OPEN';
const CARD_EMPTY_TITLE = 'NO TRANSMISSIONS YET';
const CARD_EMPTY_DESC = 'THE TRANSCRIPT FILLS WHEN THE CHAT TRANSPORT LANDS';
const CARD_OFFLINE = '// TRANSMITTER OFFLINE — SENDS WITH THE CHAT TRANSPORT';

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
  // Whether the switch has ever been thrown. Until it has, the screen is drawn at
  // rest, so entering a page does not replay the power-on; after that the class
  // alternates between the two animations, and each throw replays its own.
  const [thrown, setThrown] = useState(false);

  // The expanded card. It is anchored to the plate and grows upward out of the
  // dock, page visible around it: dimming the room list would make it a modal,
  // and this is a channel you read while doing something else.
  const [cardOpen, setCardOpen] = useState(false);
  const [box, setBox] = useState<CardBox | null>(null);
  const plateRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

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
          {CHAT_TITLE}
        </span>
        <button
          type="button"
          aria-pressed={open}
          aria-label={open ? 'Hide the lobby channel' : 'Show the lobby channel'}
          title={open ? 'Hide the lobby channel' : 'Show the lobby channel'}
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
          // The placeholder plate: what the transcript will occupy.
          <div className="chat-picture">
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.72rem',
                fontWeight: 900,
                letterSpacing: '1px',
                color: 'var(--accent-cyan)',
                whiteSpace: 'nowrap',
              }}
            >
              {UNDER_CONSTRUCTION}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.56rem',
                letterSpacing: '0.5px',
                lineHeight: 1.5,
                color: 'var(--text-muted)',
              }}
            >
              {CLICK_TO_OPEN}
            </span>
            <span
              style={{
                marginTop: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.6rem',
                fontWeight: 900,
                letterSpacing: '1.2px',
                color: 'var(--accent-cyan)',
                opacity: 0.75,
              }}
            >
              OPEN ⤢
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
            <ChatCardFeed />
            <ChatCardComposer />
          </div>,
          document.body,
        )}
    </section>
  );
}

/** The card's title row: the channel, its scope, and the way out. */
function ChatCardHead({ onClose }: { onClose: () => void }) {
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
          {CHAT_TITLE}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.56rem',
            letterSpacing: '0.6px',
            color: 'var(--text-muted)',
          }}
        >
          PUBLIC LOBBY CHANNEL
        </span>
      </div>
      <button
        type="button"
        className={RETRO_BTN}
        onClick={onClose}
        style={{ padding: '3px 9px', fontSize: '0.66rem', color: 'var(--text-muted)' }}
      >
        CLOSE
      </button>
    </div>
  );
}

/** The transcript's slot. Empty until the transport lands; a live region, so the
 *  first message is announced when it arrives rather than only painted. */
function ChatCardFeed() {
  return (
    <div
      aria-live="polite"
      className="chat-card-feed"
      style={{
        flex: '1 1 0',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 10,
        overflowY: 'auto',
        borderRadius: 8,
        background: 'rgba(0, 0, 0, 0.45)',
        border: '1px solid rgba(0, 240, 255, 0.16)',
        textAlign: 'center',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.78rem',
          fontWeight: 900,
          letterSpacing: '1px',
          color: 'var(--text-main)',
        }}
      >
        {CARD_EMPTY_TITLE}
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
        {CARD_EMPTY_DESC}
      </span>
    </div>
  );
}

/** The composer's shape, disabled with its reason on it: a box that accepted a
 *  message and dropped it would be worse than one that says it cannot send yet. */
function ChatCardComposer() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: '0.56rem',
          letterSpacing: '0.5px',
          color: 'var(--text-muted)',
        }}
      >
        {CARD_OFFLINE}
      </span>
      <form onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="text"
          disabled
          placeholder="TRANSMITTER OFFLINE"
          aria-label="Message the lobby channel"
          maxLength={300}
          style={{
            flex: 1,
            minWidth: 0,
            height: 32,
            boxSizing: 'border-box',
            padding: '0 10px',
            borderRadius: 6,
            background: 'rgba(0, 0, 0, 0.5)',
            color: 'var(--text-main)',
            border: '1px solid var(--border-color)',
            outline: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.74rem',
            opacity: 0.7,
          }}
        />
        <button
          type="submit"
          disabled
          className={RETRO_BTN}
          style={{
            height: 32,
            padding: '0 12px',
            fontSize: '0.66rem',
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            color: 'var(--accent-cyan)',
            opacity: 0.55,
          }}
        >
          SEND ▶
        </button>
      </form>
    </div>
  );
}

