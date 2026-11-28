import { useTranslation } from 'react-i18next';
import { THEMES, useApp } from '../store';
import { retroAudio } from '../utils/audio';

// The theme picker in the dock's account popover: one row per `THEMES` entry, with a
// two-tone chip from that theme's own swatch and a cyan inset edge when active. Writing
// through `setTheme` persists `retro_theme` and updates both `data-theme` attributes.
export function ThemeSwitcher() {
  const { t } = useTranslation();
  const { theme, setTheme } = useApp();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: '0.76rem',
          fontWeight: 900,
          color: 'var(--text-muted)',
          letterSpacing: '0.5px',
        }}
      >
        🎨 {t('navbar.themeLabel')}
      </span>
      <div
        role="group"
        aria-label={t('navbar.themeAria')}
        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        {THEMES.map((item) => {
          const isActive = theme === item.id;
          return (
            <button
              key={item.id}
              type="button"
              aria-pressed={isActive}
              title={item.label}
              onClick={() => {
                retroAudio.playUiBeep(item.beepHz, 0.05);
                setTheme(item.id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '7px 10px',
                borderRadius: 6,
                background: isActive
                  ? 'color-mix(in srgb, var(--accent-cyan) 18%, transparent)'
                  : 'transparent',
                border: isActive
                  ? '1.5px solid var(--accent-cyan)'
                  : '1px solid color-mix(in srgb, var(--border-color) 45%, transparent)',
                // The mockup's 4 px active edge, drawn inside the row so a switch
                // cannot move the list.
                boxShadow: isActive ? 'inset 4px 0 0 var(--accent-cyan)' : 'none',
                color: 'inherit',
                font: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                transition: 'all 0.18s ease',
              }}
            >
              {/* Two halves of one chip: the theme's primary and secondary token. */}
              <span
                aria-hidden="true"
                style={{
                  display: 'flex',
                  width: 20,
                  height: 20,
                  borderRadius: 3,
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1px solid rgb(var(--ink-rgb) / 0.18)',
                  opacity: isActive ? 1 : 0.55,
                }}
              >
                <span style={{ flex: 1, background: item.swatch[0] }} />
                <span style={{ flex: 1, background: item.swatch[1] }} />
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '0.8rem',
                  fontWeight: 900,
                  letterSpacing: '0.6px',
                  color: isActive ? 'var(--accent-cyan)' : 'var(--text-muted)',
                }}
              >
                {item.label}
              </span>
              {isActive && (
                <span
                  aria-hidden="true"
                  style={{ marginLeft: 'auto', color: 'var(--accent-cyan)', fontSize: '0.78rem' }}
                >
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
