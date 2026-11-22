import type { CSSProperties, MouseEvent } from 'react';

// Rail colours are theme tokens: button chrome follows `--accent-*`, while seat-state
// colours stay on the board. No per-theme literals live here.
const REST_BORDER = 'rgb(var(--accent-cyan-rgb) / 0.3)';
const HOVER_BORDER = 'var(--accent-cyan)';
const HOVER_GLOW = '0 0 14px rgb(var(--accent-cyan-rgb) / 0.35)';

export function railButtonStyle(active: boolean): CSSProperties {
  return {
    boxSizing: 'border-box',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    ...(active
      ? {
          background: 'rgb(var(--accent-pink-rgb) / 0.2)',
          border: '1.5px solid var(--accent-pink)',
          boxShadow: '0 0 16px rgb(var(--accent-pink-rgb) / 0.4)',
        }
      : {
          background: 'rgb(var(--ink-rgb) / 0.04)',
          border: `1px solid ${REST_BORDER}`,
          boxShadow: 'none',
        }),
  };
}

// The 34 px frame shared by the five route marks and the compact chat glyph. `lit` is
// the row's only changing state: its background, mark colour and glow move together.
export function railGlyphFrameStyle(lit: boolean): CSSProperties {
  return {
    width: 34,
    height: 34,
    borderRadius: 7,
    background: lit ? 'rgb(var(--ink-rgb) / 0.2)' : 'rgb(var(--accent-cyan-rgb) / 0.08)',
    display: 'grid',
    placeItems: 'center',
    // No font rules: the mark is an SVG stroke, and `currentColor` is what makes it
    // follow the theme and the active state.
    color: lit ? 'var(--text-main)' : 'var(--accent-cyan)',
    flexShrink: 0,
    filter: lit ? 'drop-shadow(0 0 6px rgb(var(--ink-rgb)))' : 'none',
  };
}

type RestEdge = { borderColor: string; boxShadow: string };

export function railHoverHandlers(
  active: boolean,
  rest: RestEdge = { borderColor: REST_BORDER, boxShadow: 'none' },
) {
  return {
    onMouseEnter: (e: MouseEvent<HTMLButtonElement>) => {
      if (active) return;
      e.currentTarget.style.borderColor = HOVER_BORDER;
      e.currentTarget.style.boxShadow = HOVER_GLOW;
    },
    onMouseLeave: (e: MouseEvent<HTMLButtonElement>) => {
      if (active) return;
      e.currentTarget.style.borderColor = rest.borderColor;
      e.currentTarget.style.boxShadow = rest.boxShadow;
    },
  };
}
