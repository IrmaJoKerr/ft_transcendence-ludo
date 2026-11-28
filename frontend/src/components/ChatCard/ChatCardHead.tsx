import { useTranslation } from 'react-i18next';
import { RETRO_BTN } from '../../styles/tw';
import type { ChatHeadGlyph } from '../chatCardTypes';

// The card's title row: the channel, its scope, the host's panel switch, and the way out.
export function ChatCardHead({
  onClose,
  titleKey = 'chat.title',
  scopeKey = 'chat.scope',
  glyph,
}: {
  onClose?: () => void;
  titleKey?: string;
  scopeKey?: string;
  // The host's panel switch, when it has a panel to open (the room's INVITE COMMS).
  glyph?: ChatHeadGlyph;
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
            textShadow: '0 0 12px rgb(var(--accent-cyan-rgb) / 0.45)',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        {glyph && (
          <button
            type="button"
            title={glyph.label}
            aria-pressed={glyph.pressed}
            onClick={glyph.onPress}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '2px 8px 2px 2px',
              flexShrink: 0,
              cursor: 'pointer',
              borderRadius: 5,
              color: glyph.pressed ? 'var(--accent-cyan)' : 'var(--text-muted)',
              background: glyph.pressed
                ? 'rgb(var(--accent-cyan-rgb) / 0.14)'
                : 'rgb(var(--ink-rgb) / 0.05)',
              border: `1px solid ${glyph.pressed ? 'rgb(var(--accent-cyan-rgb) / 0.55)' : 'rgba(184, 166, 228, 0.28)'}`,
              transition: 'all 0.18s ease',
            }}
          >
            {/* Twice the box the band gave it (22 × 18, 0.72rem), centred in the larger
                one: the glyph now carries the whole press on its own, with its title
                beside it rather than only in a tooltip. */}
            <span
              aria-hidden="true"
              style={{
                display: 'grid',
                placeItems: 'center',
                width: 44,
                height: 36,
                fontSize: '1.44rem',
                lineHeight: 1,
              }}
            >
              {glyph.glyph}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.5rem',
                fontWeight: 900,
                letterSpacing: '0.6px',
                lineHeight: 1.2,
                textAlign: 'center',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              {glyph.label}
            </span>
          </button>
        )}
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
    </div>
  );
}
