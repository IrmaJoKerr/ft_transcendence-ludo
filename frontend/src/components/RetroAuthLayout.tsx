import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Unconditional pre-game notice. Mounted by the auth shell only: the table
 *  screen and the PvP waiting room carry no strip, so the warning appears once,
 *  before sign-in. */
export function LandscapeNotice() {
  const { t } = useTranslation();
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 'calc(620px + 2vw)',
        marginBottom: 14,
        padding: '10px 14px',
        border: '1px solid rgb(var(--accent-cyan-rgb) / 0.35)',
        borderRadius: 8,
        background: 'rgb(var(--bg-primary-rgb) / 0.6)',
        color: 'var(--text-soft)',
        fontFamily: 'var(--font-mono)',
        // Its own small bordered strip, normal case: a three-clause sentence
        // cannot wear the tracked uppercase treatment of the tag line below.
        fontSize: '0.72rem',
        lineHeight: 1.55,
        letterSpacing: '0.02em',
        textAlign: 'center',
        boxSizing: 'border-box',
      }}
    >
      {t('common.landscapeNotice')}
    </div>
  );
}

/** Full-bleed retrowave auth shell: the era's plate plus a glass card.
 *
 *  The plate belongs to the shell, not to this component: `html, body` paints
 *  `--shell-image` (todo.md section 33, step 3), so everything mounted here is
 *  transparent on purpose. A full-bleed `--bg-primary` fill used to sit on this
 *  element and cover that plate - it was left from when the cityscape was
 *  mounted *inside* the layout, and it made sign-in the one route that did not
 *  show its era's ground. Nothing here may paint a ground again. */
export function RetroAuthLayout({
  tag,
  topRight,
  children,
}: {
  tag?: string;
  topRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: 'relative',
        minHeight: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-main)',
        overflowX: 'hidden',
      }}
    >
      {/* Centered glassmorphism card wrapper */}
      <div
        className="max-h-screen overflow-y-auto"
        style={{
          position: 'relative',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 0,
          padding: '24px 20px',
          width: '100%',
          maxWidth: 'calc(620px + 2vw)',
          boxSizing: 'border-box',
        }}
      >
        {/* Pre-game notice: keyboard or touch, landscape only. */}
        <LandscapeNotice />

        {/* Glass card */}
        <div
          className="w-full max-w-155 rounded-[22px] bg-[rgb(var(--bg-primary-rgb)/0.78)] px-13 py-12 shadow-[0_0_45px_rgb(var(--accent-cyan-rgb)/0.18),0_0_90px_rgb(var(--accent-pink-rgb)/0.12),0_28px_70px_rgb(var(--shade-rgb)/0.65),inset_0_1px_0_rgb(var(--ink-rgb)/0.08)] backdrop-blur-xl backdrop-saturate-[1.8] [border:1.5px_solid_rgb(var(--accent-cyan-rgb)/0.35)]"
          style={{
            position: 'relative',
            width: '100%',
            maxWidth: 'calc(620px + 2vw)',
            padding: 'calc(3rem + 1vh) 3.25rem',
            boxSizing: 'border-box',
          }}
        >
          {/* Language switch (login): 12px inside the card's top-right corner. */}
          {topRight && (
            <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1 }}>{topRight}</div>
          )}

          {children}
        </div>

        {/* Tag line below the card. It floats on the plate rather than on glass,
           so it wears the card's own fill: bare at 50% cyan it measured 1.0-1.5:1
           against the cityscape, and it sank into the colony's teal (todo.md
           section 33, step 3). On the card's 0.78 glass it reads 10.5:1 under
           synthwave and 3.3:1 under the 70s, the same floor as the card's own
           cyan labels, so it is no less legible than the surface it sits beside. */}
        {tag && (
          <div className="mt-5 rounded-full border border-[rgb(var(--accent-cyan-rgb)/0.35)] bg-[rgb(var(--bg-primary-rgb)/0.78)] px-4 py-1.5 [font-family:var(--font-mono)] text-[11.5px] tracking-[0.34em] text-(--accent-cyan) uppercase backdrop-blur-md">
            {tag}
          </div>
        )}
      </div>
    </div>
  );
}

// Decorative neon checkbox glyph. Signup pairs it with a hidden real input, so
// it takes `checked` plus any focus classes the caller needs.
export function NeonCheck({
  offsetTop,
  checked,
  className,
}: {
  offsetTop?: boolean;
  checked?: boolean;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{
        width: 16,
        height: 16,
        marginTop: offsetTop ? 1 : undefined,
        flex: 'none',
        borderRadius: 4,
        background: checked
          ? 'linear-gradient(135deg, rgb(var(--accent-cyan-rgb) / 0.5), rgb(var(--accent-pink-rgb) / 0.4))'
          : 'transparent',
        border: '1px solid rgb(var(--accent-cyan-rgb) / 0.6)',
        display: 'inline-grid',
        placeItems: 'center',
        color: 'var(--text-main)',
        fontSize: 10,
        fontWeight: 900,
        boxShadow: checked ? '0 0 8px rgb(var(--accent-cyan-rgb) / 0.4)' : 'none',
      }}
    >
      {checked ? '✓' : ''}
    </span>
  );
}
