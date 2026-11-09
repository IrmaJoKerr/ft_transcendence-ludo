import { useTranslation } from 'react-i18next';
import { THEMES, useApp } from '../store';
import { retroAudio } from '../utils/audio';

/**
 * The theme picker in the dock's account popover: one row per entry in `THEMES`,
 * painted as a two-tone chip of that theme's own token pair, with the active row
 * ringed in `--accent-cyan`, marked with a checked tick and carrying a 4 px inset
 * edge down its left side.
 *
 * It is a list of both themes rather than a "switch to the other one" button on
 * purpose: the row has to say what is on *and* what else exists, and a third theme
 * would arrive as a third row and no code. The chip's colours come from `THEMES`,
 * not from the live tokens, so the inactive row still shows the theme it offers
 * instead of repainting itself in the theme you are currently in.
 *
 * Writes through `setTheme`, which persists `retro_theme` and stamps both
 * `data-theme` attributes; every palette in the app reads those, so nothing here
 * sets a colour on a container.
 */
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
                retroAudio.playUiBeep(item.id === 'retro70' ? 660 : 880, 0.05);
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
                  border: '1px solid rgba(255, 255, 255, 0.18)',
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
