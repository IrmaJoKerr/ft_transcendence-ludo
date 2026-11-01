import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { COL, type ColorKey } from '../theme';
import { retroAudio } from '../utils/audio';
import { RETRO_WINDOW, WINDOW_HEADER, WINDOW_BODY, RETRO_BTN } from '../styles/tw';

/** The localised colour word, shared with the Lobby card badges. */
const COLOR_KEYS: Record<ColorKey, string> = {
  red: 'lobby.colorRed',
  green: 'lobby.colorGreen',
  yellow: 'lobby.colorYellow',
  blue: 'lobby.colorBlue',
};

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
        className={`${RETRO_WINDOW} flex w-full max-w-lg flex-col overflow-hidden rounded-xl border-[1.5px] border-[rgba(0,240,255,0.4)] shadow-[0_25px_70px_rgba(0,0,0,0.95),0_0_35px_rgba(0,240,255,0.25)]`}
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
          className={`${WINDOW_BODY} flex flex-col gap-3 bg-[rgba(12,4,28,0.92)] p-5`}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: colors.length > 2 ? '1fr 1fr' : '1fr',
              gap: 10,
            }}
          >
            {colors.map((color) => {
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
    </div>,
    document.body,
  );
}
