import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Lang } from '../store';
import { retroAudio } from '../utils/audio';

/** The shipped languages, with the short code and the endonym the navbar tabs show. */
const LANGS: readonly { code: Lang; short: string; full: string }[] = [
  { code: 'en', short: 'EN', full: 'ENGLISH' },
  { code: 'ms', short: 'MS', full: 'MELAYU' },
  { code: 'fr', short: 'FR', full: 'FRANÇAIS' },
];

/**
 * Segmented EN / MS / FR switch, shared by the legal pages, the login card and the
 * navbar account popover, so all three offer the same control in the same visual
 * language. The caller owns the active language: the legal pages keep their
 * document language in local state, while the login and the navbar write straight
 * to the store.
 *
 * Two renderings: `pill` is the compact one-line control of the auth surfaces;
 * `tabs` is the taller two-line tab set of the account popover.
 */
export function LanguageSwitcher({
  value,
  onChange,
  variant = 'pill',
  style,
}: {
  value: Lang;
  onChange: (lang: Lang) => void;
  variant?: 'pill' | 'tabs';
  style?: CSSProperties;
}) {
  const { t } = useTranslation();

  const pick = (lang: Lang) => {
    retroAudio.playUiBeep(880, 0.05);
    onChange(lang);
  };

  if (variant === 'tabs') {
    return (
      <div
        role="group"
        aria-label={t('common.language')}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          background: 'rgba(0, 0, 0, 0.45)',
          padding: 4,
          borderRadius: 8,
          border: '1px solid rgba(0, 240, 255, 0.2)',
          ...style,
        }}
      >
        {LANGS.map((item) => {
          const isSelected = value === item.code;
          return (
            <button
              key={item.code}
              type="button"
              aria-pressed={isSelected}
              onClick={() => pick(item.code)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '7px 4px',
                borderRadius: 6,
                border: isSelected
                  ? '1.5px solid var(--accent-cyan)'
                  : '1px solid transparent',
                background: isSelected
                  ? 'linear-gradient(135deg, rgba(0, 240, 255, 0.25), rgba(255, 0, 127, 0.2))'
                  : 'transparent',
                color: isSelected ? '#ffffff' : 'var(--text-muted)',
                cursor: 'pointer',
                boxShadow: isSelected ? '0 0 10px rgba(0, 240, 255, 0.35)' : 'none',
                transition: 'all 0.18s ease',
                outline: 'none',
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 900,
                  fontSize: '0.88rem',
                }}
              >
                {item.short}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.62rem',
                  opacity: 0.85,
                  marginTop: 2,
                }}
              >
                {item.full}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      role="group"
      aria-label={t('common.language')}
      className="flex items-center rounded-lg border border-[rgba(0,240,255,0.25)] bg-[rgba(0,0,0,0.5)] p-0.5"
      style={style}
    >
      {LANGS.map((item) => (
        <button
          key={item.code}
          type="button"
          aria-pressed={value === item.code}
          className={`rounded px-2.5 py-1 font-mono text-xs font-bold transition-all ${
            value === item.code
              ? 'bg-[var(--accent-cyan)] text-[#0a0519] shadow-[0_0_8px_rgba(0,240,255,0.5)]'
              : 'text-[var(--text-muted)] hover:text-[#ffffff]'
          }`}
          onClick={() => pick(item.code)}
        >
          {item.short}
        </button>
      ))}
    </div>
  );
}
