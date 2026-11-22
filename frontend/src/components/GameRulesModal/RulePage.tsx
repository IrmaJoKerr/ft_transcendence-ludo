import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

// One header and body card for the pages that differ only by tone, title and copy.
// The custom pages pass their rows as children rather than copying the card styles.
export function RulePage({
  headerKey,
  tone,
  titleKey,
  bodyKeys,
  introKey,
  borderLeft = false,
  borderAlpha = '0.2',
  bodyGap = 10,
  children,
}: {
  headerKey: string;
  tone: string;
  titleKey?: string;
  bodyKeys?: string[];
  introKey?: string;
  borderLeft?: boolean;
  borderAlpha?: string;
  bodyGap?: number;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        fontSize: '0.95rem',
        lineHeight: 1.6,
      }}
    >
      <div
        style={{
          color: `var(--${tone})`,
          fontWeight: 'bold',
          fontFamily: 'var(--font-mono)',
          fontSize: '1.05rem',
          letterSpacing: '0.5px',
        }}
      >
        {t(headerKey)}
      </div>
      {introKey && (
        <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>{t(introKey)}</p>
      )}
      <div
        style={{
          background: 'rgba(5, 2, 18, 0.65)',
          padding: 16,
          borderRadius: 6,
          ...(borderLeft ? { borderLeft: `4px solid var(--${tone})` } : {}),
          border: `1px solid rgb(var(--${tone}-rgb) / ${borderAlpha})`,
          display: 'flex',
          flexDirection: 'column',
          gap: bodyGap,
        }}
      >
        {titleKey && (
          <div style={{ color: `var(--${tone})`, fontWeight: 'bold', fontSize: '1.1rem' }}>
            {t(titleKey)}
          </div>
        )}
        {bodyKeys?.map((key) => (
          <p key={key} style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
            {t(key)}
          </p>
        ))}
        {children}
      </div>
    </div>
  );
}
