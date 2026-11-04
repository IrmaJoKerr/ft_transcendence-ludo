import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BOARD_QUADRANTS, COL, COLOR_KEYS, SEAT_COLORS, type ColorKey } from '../theme';
import { retroAudio } from '../utils/audio';
import { RETRO_WINDOW, WINDOW_HEADER, WINDOW_BODY, RETRO_BTN } from '../styles/tw';

/** Where each corner sits in the picker's 2×2 (viewBox units, row-major): the
 *  board draws red/green on top and blue/yellow below. */
const CORNER_XY: Record<ColorKey, [number, number]> = {
  red: [18, 18],
  green: [82, 18],
  blue: [18, 82],
  yellow: [82, 82],
};

/** The turn-order ring: `SEAT_COLORS` is the rotation, so the numerals and the
 *  arcs are both derived from it and a rule change moves the diagram with it. */
const RING = SEAT_COLORS.map((color) => CORNER_XY[color]);
const RING_CENTRE = 50;
const NODE_RADIUS = 9;

/** One arrow of the ring: bowed towards the middle and stopping short of both
 *  nodes, so it never runs under a coloured ring. */
function ringSegment(from: [number, number], to: [number, number], hue: string, key: string) {
  const midX = (from[0] + to[0]) / 2;
  const midY = (from[1] + to[1]) / 2;
  const control: [number, number] = [
    midX + (RING_CENTRE - midX) * 0.35,
    midY + (RING_CENTRE - midY) * 0.35,
  ];
  const angle = Math.atan2(to[1] - control[1], to[0] - control[0]);
  const gap = NODE_RADIUS + 3;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const start: [number, number] = [from[0] + cos * gap, from[1] + sin * gap];
  const end: [number, number] = [to[0] - cos * gap, to[1] - sin * gap];
  const head = 5;
  const wing = 0.5;
  const p1: [number, number] = [
    end[0] - head * Math.cos(angle - wing),
    end[1] - head * Math.sin(angle - wing),
  ];
  const p2: [number, number] = [
    end[0] - head * Math.cos(angle + wing),
    end[1] - head * Math.sin(angle + wing),
  ];
  return (
    <g key={key}>
      <path
        d={`M${start[0]},${start[1]} Q${control[0]},${control[1]} ${end[0]},${end[1]}`}
        fill="none"
        stroke={hue}
        strokeOpacity={0.45}
        strokeWidth={1.6}
        strokeLinecap="round"
      />
      <polygon
        points={`${end[0]},${end[1]} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`}
        fill={hue}
        fillOpacity={0.55}
      />
    </g>
  );
}

interface ColorPaletteModalProps {
  isOpen: boolean;
  title: string;
  /** The colours still free, already filtered: a taken colour is never offered. */
  colors: ColorKey[];
  onPick: (color: ColorKey) => void;
  onCancel: () => void;
}

/**
 * The colour picker for one seat. It lists the free corners only, so the picker
 * cannot produce a duplicate, and a pick is final: it closes on the first click,
 * with no confirm step and no swap afterwards (`select_color` is gone).
 *
 * The grid is the board's own 2×2 — `BOARD_QUADRANTS`, with a corner that is not
 * on offer drawn as an inert slot so a colour keeps its position. The left column
 * carries the turn-order diagram, ringed and numbered from `SEAT_COLORS`, so the
 * order is visible instead of implied.
 *
 * Layout follows `LegalModal` (portal over the page, `RETRO_WINDOW` shell, Escape
 * and a backdrop click cancel), because this is opened from a screen whose own
 * windows use that chrome.
 */
export function ColorPaletteModal({
  isOpen,
  title,
  colors,
  onPick,
  onCancel,
}: ColorPaletteModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        retroAudio.playUiBeep(440, 0.05);
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[10010] flex items-center justify-center bg-[rgba(5,2,14,0.82)] p-4 backdrop-blur-[12px] sm:p-6"
      onClick={() => {
        retroAudio.playUiBeep(440, 0.05);
        onCancel();
      }}
    >
      <div
        className={`${RETRO_WINDOW} flex w-full max-w-lg flex-col overflow-hidden rounded-xl border-[1.5px] border-[rgba(0,240,255,0.4)] shadow-[0_25px_70px_rgba(0,0,0,0.95),0_0_35px_rgba(0,240,255,0.25)] sm:max-w-2xl`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
          <span className="font-display text-sm font-black tracking-wider text-[#ffffff]">
            {title}
          </span>
          <button
            type="button"
            className={`${RETRO_BTN} px-2 py-0.5 text-xs text-[var(--accent-pink)] hover:bg-[rgba(255,0,127,0.2)]`}
            onClick={() => {
              retroAudio.playUiBeep(440, 0.05);
              onCancel();
            }}
            title={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div
          className={`${WINDOW_BODY} flex max-h-[90vh] flex-col gap-3 overflow-y-auto bg-[rgba(12,4,28,0.92)] p-5 sm:flex-row sm:gap-4`}
        >
          {/* The rotation, left of the picker. Geometry comes from SEAT_COLORS and the
              words from the shared colour keys, so it is never colour-only. */}
          <div
            role="img"
            aria-label={`${t('lobby.turnOrderByColor')}: ${SEAT_COLORS.map(
              (color, i) => `${i + 1} ${t(COLOR_KEYS[color])}`,
            ).join(', ')}`}
            style={{
              flex: '0 0 150px',
              maxWidth: 140,
              margin: '0 auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <svg viewBox="0 0 100 100" width="100%" aria-hidden="true">
              {RING.map((xy, i) =>
                ringSegment(
                  xy,
                  RING[(i + 1) % RING.length],
                  COL[SEAT_COLORS[i]].base,
                  `arc-${SEAT_COLORS[i]}`,
                ),
              )}
              {BOARD_QUADRANTS.map((color) => {
                const [cx, cy] = CORNER_XY[color];
                const hue = COL[color].base;
                return (
                  <g key={color} opacity={colors.includes(color) ? 1 : 0.35}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={NODE_RADIUS}
                      fill={`${hue}33`}
                      stroke={hue}
                      strokeWidth={2.5}
                    />
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#ffffff"
                      fontSize={10}
                      fontWeight={900}
                    >
                      {SEAT_COLORS.indexOf(color) + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.66rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
                textAlign: 'center',
                lineHeight: 1.25,
              }}
            >
              {t('lobby.turnOrderByColor')}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
              }}
            >
              {BOARD_QUADRANTS.map((color) => {
                // A corner nobody can take keeps its place as a hole: a spatial legend
                // only reads if a colour never moves, and the roster already announces
                // which colours are taken.
                if (!colors.includes(color)) {
                  return (
                    <div
                      key={color}
                      aria-hidden="true"
                      style={{
                        border: '1.5px dashed rgba(255, 255, 255, 0.12)',
                        borderRadius: 6,
                        padding: '12px 14px',
                      }}
                    />
                  );
                }
                const hue = COL[color].base;
                return (
                  <button
                    key={color}
                    type="button"
                    onClick={() => {
                      retroAudio.playUiBeep(720, 0.06);
                      onPick(color);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '12px 14px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: `${hue}18`,
                      border: `1.5px solid ${hue}`,
                      boxShadow: `0 0 12px ${hue}33`,
                      color: hue,
                      fontFamily: 'var(--font-heading)',
                      fontSize: '0.9rem',
                      fontWeight: 800,
                      letterSpacing: '0.6px',
                      textTransform: 'uppercase',
                    }}
                  >
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        flex: 'none',
                        borderRadius: 4,
                        background: hue,
                        boxShadow: `0 0 8px ${hue}`,
                      }}
                    />
                    {t(COLOR_KEYS[color])}
                  </button>
                );
              })}
            </div>

            {colors.length === 0 && (
              <div
                style={{
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.78rem',
                  color: 'var(--text-muted)',
                }}
              >
                {t('lobby.noFreeColors')}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
              <button
                type="button"
                className={`${RETRO_BTN} font-display rounded-lg border border-[var(--accent-cyan)] px-4 py-1.5 text-xs font-black text-[#ffffff]`}
                onClick={() => {
                  retroAudio.playUiBeep(440, 0.05);
                  onCancel();
                }}
              >
                {t('lobby.cancelPick')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
