import { useEffect, useRef } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RETRO_BTN } from '../../styles/tw';
import { CHAT_MAX_CHARS, chatLength } from '../../__shared__/chat.constants';
import type { ChatCardStatus } from '../chatCardTypes';
import { ChatStatusBand } from './ChatStatusBand';
import { COMPOSER_MAX_HEIGHT } from './chatCardMetrics';

// The composer: one message box, one send, a counter, and the band under it. The band is always
// mounted, so a refusal never resizes the card.
export function ChatCardComposer({
  draft,
  onDraft,
  onSubmit,
  status,
  onStatus,
  connected,
  inert,
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
  placeholderKey?: string;
  inputLabelKey?: string;
  offlineKey?: string;
  sendKey?: string;
}) {
  const { t } = useTranslation();
  const count = chatLength(draft);
  const over = count > CHAT_MAX_CHARS;
  const disabled = !connected || inert === true;
  const boxRef = useRef<HTMLTextAreaElement>(null);

    // Grown from the rendered text rather than from a row count: the browser is the only thing that
  // knows how many rows a 200-character line wraps to.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = `${Math.min(box.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, [draft]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
      {/* `flex-end`, not `center`: the counter and SEND belong to the box's last
          line, and a six-row draft must not float them in its middle. */}
      <form onSubmit={onSubmit} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        <textarea
          ref={boxRef}
          rows={1}
          value={draft}
          onChange={(event) => {
            onDraft(event.target.value);
            // A refusal clears as soon as the sender starts fixing it; a server error
            // must not sit under the box while a new line is being typed.
            if (status?.tone === 'error') onStatus(null);
          }}
          onKeyDown={(event) => {
            // A key that arrives mid-composition belongs to the IME: Enter there picks
            // a candidate, and sending on it would cut the word in half (fr and ms both
            // have users typing through one).
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          disabled={disabled}
          placeholder={connected ? t(placeholderKey) : t(offlineKey)}
          aria-label={t(inputLabelKey)}
          // Which key does which: the same sentence the send button carries, so the
          // rule is readable from either end of the row and there is one key to fix.
          title={t('chat.sendHint')}
          aria-invalid={over}
          // One character over the cap, so the band can say why rather than the box
          // silently refusing the keystroke.
          maxLength={CHAT_MAX_CHARS + 1}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 32,
            maxHeight: COMPOSER_MAX_HEIGHT,
            boxSizing: 'border-box',
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgb(var(--shade-rgb) / 0.5)',
            color: 'var(--text-main)',
            border: `1px solid ${over ? 'rgba(255, 82, 120, 0.6)' : 'var(--border-color)'}`,
            outline: 'none',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.74rem',
            lineHeight: '20px',
            // The box grows only by the height the script gives it; a drag handle
            // would let a player take the transcript's rows away for good.
            resize: 'none',
            overflowY: 'auto',
            opacity: connected ? 1 : 0.7,
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.58rem',
            color: over ? '#ff5278' : 'var(--text-muted)',
            whiteSpace: 'nowrap',
            // Its own line height so it sits level with a one-row box.
            lineHeight: '32px',
          }}
        >
          {count} / {CHAT_MAX_CHARS}
        </span>
        <button
          type="submit"
          disabled={disabled}
          title={t('chat.sendHint')}
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
      <ChatStatusBand status={status} />
    </div>
  );
}
