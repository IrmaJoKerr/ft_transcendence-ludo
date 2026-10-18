import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Visually hidden, but still in the accessibility tree: the trigger points
// aria-describedby at it so the policy is announced, not only hovered.
const SR_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/**
 * "i" badge that reveals the localised password policy on password-create fields.
 */
export function PasswordInfo() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <>
      <span
        tabIndex={0}
        role="note"
        aria-label={t('passwordInfo.label')}
        aria-describedby={id}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto',
          width: 15,
          height: 15,
          marginLeft: 8,
          borderRadius: '50%',
          border: '1px solid rgba(0, 240, 255, 0.55)',
          color: 'rgba(0, 240, 255, 0.85)',
          cursor: 'help',
          outline: 'none',
        }}
      >
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <circle cx="5" cy="2.5" r="0.95" fill="currentColor" />
          <rect x="4.1" y="4.2" width="1.8" height="4.3" rx="0.9" fill="currentColor" />
        </svg>
      </span>
      <span id={id} style={SR_ONLY}>
        {t('passwordInfo.hint')}
      </span>
      {open && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            bottom: 'calc(100% + 7px)',
            zIndex: 20,
            width: 'max-content',
            maxWidth: 'min(280px, 100%)',
            padding: '7px 10px',
            border: '1px solid rgba(0, 240, 255, 0.5)',
            borderRadius: 6,
            background: 'rgba(8, 2, 22, 0.97)',
            color: 'var(--text-soft)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.68rem',
            fontWeight: 500,
            lineHeight: 1.55,
            // The label row is tracked uppercase; the sentence is neither.
            letterSpacing: '0.02em',
            textTransform: 'none',
            textAlign: 'left',
            whiteSpace: 'normal',
            boxShadow: '0 8px 22px rgba(0, 0, 0, 0.6), 0 0 16px rgba(0, 240, 255, 0.15)',
            pointerEvents: 'none',
          }}
        >
          {t('passwordInfo.hint')}
        </span>
      )}
    </>
  );
}
