import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ChatCardFeed } from '../../components/ChatCard/ChatCardFeed';
import type { ChatCardLine } from '../../components/chatCardTypes';
import { COL, type ColorKey } from '../../theme';
import { RETRO_BTN, RETRO_WINDOW, WINDOW_BODY, WINDOW_HEADER } from '../../styles/tw';
import { retroAudio } from '../../utils/audio';
import type { TranscriptLine } from './profileTypes';

// The stored stamp is a seat name, not a colour: resolving it here keeps an old row
// on today's palette. An absent or unknown stamp leaves `ChatCardFeed` its own
// fallback, which is the live card's rule for a line with no seat colour.
function seatInk(line: ChatCardLine): string | undefined {
  const key = line.senderColor?.toLowerCase();
  if (!key) return undefined;
  // An unknown stamp (or an inherited key such as `toString`) falls through to
  // `undefined`, so the feed's own fallback paints the name.
  return COL[key as ColorKey]?.base;
}

export function TranscriptRow({
  chat,
  chatTruncated,
  gameType,
}: {
  chat?: TranscriptLine[] | null;
  chatTruncated: boolean;
  gameType: 'PVP' | 'PVE';
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const lines = Array.isArray(chat) ? chat : [];
  const hasTranscript = gameType === 'PVP' && lines.length > 0;

  const close = () => {
    setOpen(false);
    retroAudio.playUiBeep(440, 0.05);
    // The trigger is still mounted behind the portal; wait for the modal to leave so
    // focus cannot be captured by a node that is about to disappear.
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {hasTranscript ? (
          <button
            ref={triggerRef}
            type="button"
            className={RETRO_BTN}
            aria-haspopup="dialog"
            onClick={() => {
              retroAudio.playUiBeep(700, 0.05);
              setOpen(true);
            }}
            style={{ fontSize: '0.66rem', padding: '3px 10px' }}
          >
            {t('profile.transcriptShow', { count: lines.length })}
          </button>
        ) : (
          <span
            style={{
              fontSize: '0.66rem',
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.04em',
              color: 'var(--text-muted)',
            }}
          >
            {t('profile.transcriptLabel')} {t('profile.transcriptNa')}
          </span>
        )}
      </div>
      {open && hasTranscript && (
        <CommsLogsModal lines={lines} truncated={chatTruncated} onClose={close} />
      )}
    </div>
  );
}

// One archived transcript, in the same retro window every other modal uses. The
// header and the feed are separate flex children, so a long log scrolls inside the
// panel instead of making the profile taller.
function CommsLogsModal({
  lines,
  truncated,
  onClose,
}: {
  lines: TranscriptLine[];
  truncated: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 flex items-center justify-center bg-[rgba(5,2,14,0.82)] p-4 backdrop-blur-[12px] sm:p-6"
      style={{ zIndex: 10010 }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`${RETRO_WINDOW} w-full overflow-hidden rounded-xl border-[1.5px] border-[rgb(var(--accent-cyan-rgb)/0.4)] shadow-[0_25px_70px_rgb(var(--shade-rgb)/0.95),0_0_35px_rgb(var(--accent-cyan-rgb)/0.25)]`}
        style={{ width: 'min(680px, calc(100vw - 2rem))', maxHeight: 'min(80vh, 720px)' }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className={WINDOW_HEADER}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '10px 16px',
          }}
        >
          <span
            id={titleId}
            className="font-display text-sm font-black tracking-wider text-(--text-main)"
          >
            {t('profile.transcriptTitle', { count: lines.length })}
          </span>
          <button
            type="button"
            className={`${RETRO_BTN} px-2 py-0.5 text-xs text-(--accent-pink) hover:bg-[rgb(var(--accent-pink-rgb)/0.2)]`}
            aria-label={t('common.close')}
            title={t('common.close')}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className={`${WINDOW_BODY} flex min-h-0 flex-1 flex-col gap-2`}>
          {truncated && (
            <span
              style={{
                flex: '0 0 auto',
                fontSize: '0.62rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--accent-yellow)',
              }}
            >
              {t('profile.transcriptTruncated')}
            </span>
          )}
          <ChatCardFeed lines={lines} senderColor={seatInk} autoScroll={false} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
