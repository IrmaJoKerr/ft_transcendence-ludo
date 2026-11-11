import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useApp } from '../store';
import { retroAudio } from '../utils/audio';
import { AutoCloseToggle } from './AutoCloseToggle';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';
import {
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_BODY,
  GAME_WINDOW_HEADER_EXTRA,
  RETRO_BADGE,
  RETRO_BTN,
} from '../styles/tw';

interface ControlsSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Mirrors the `retroAudio` singleton: the flag lives there, not in here. */
  muted: boolean;
  onToggleSound: () => void;
}

/** One label/key line: the label left, its key right. */
const ROW = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
} as const;

/** The key cap, sized for a popover rather than a column-wide box. */
const KEY_CHIP = {
  color: '#fff',
  fontFamily: 'var(--font-mono)',
  padding: '2px 6px',
  borderRadius: 3,
  border: '1px solid var(--accent-cyan)',
} as const;

/** A preference group's heading, the row the dock's popover draws above its own. */
const GROUP_LABEL = {
  fontFamily: 'var(--font-display)',
  fontSize: '0.76rem',
  fontWeight: 900,
  color: 'var(--text-muted)',
  letterSpacing: '0.5px',
} as const;

/**
 * A group's layout: its heading over the switch it names. The theme switch draws
 * its own heading inside itself; the language one is wrapped here, the way the
 * dock's popover wraps it.
 */
const GROUP = { display: 'flex', flexDirection: 'column', gap: 6 } as const;

/**
 * The keys, the audio switch and the two preference switches, in a popover under
 * the board.
 *
 * This is the old `#sectorControlWindow` moved and slimmed, not a new panel: the
 * same three rows and the same audio toggle, minus the rules button, which now
 * stands beside it as GAME RULES. The room's rule switches are not here either —
 * they stay in the waiting-room window, so nothing in this popover is host-only.
 *
 * The language and theme switches (32.1) are the navbar's own components, mounted
 * here as a fourth host. They make the popover taller than a phone, so **only the
 * rows scroll**: the body caps itself at the viewport and takes the header and the
 * audio switch out of that budget, because the switch that unmutes a silent game
 * must not be scrolled for — a row below the fold reads as a dead button.
 *
 * Layout follows `LegalModal` (portal over the page, `RETRO_WINDOW` shell, Escape
 * and a backdrop click close), because the windows it is opened from use that
 * chrome. It is a popover rather than a column, so it takes a fixed comfortable
 * width instead of matching the roster box's overhang, and the rows tighten.
 */
export function ControlsSettingsModal({
  isOpen,
  onClose,
  muted,
  onToggleSound,
}: ControlsSettingsModalProps) {
  const { t } = useTranslation();
  // The language switch is the navbar's, so its state comes from the same place.
  const { lang, setLang } = useApp();

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        retroAudio.playUiBeep(440, 0.05);
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const title = t('gameExtra.controlsSettings');

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[10010] flex items-center justify-center bg-[rgba(5,2,14,0.82)] p-4 backdrop-blur-[12px] sm:p-6"
      onClick={() => {
        retroAudio.playUiBeep(440, 0.05);
        onClose();
      }}
    >
      <div
        className={`${RETRO_WINDOW} flex w-full max-w-[340px] flex-col overflow-hidden rounded-xl border-[1.5px] border-[rgba(0,240,255,0.4)] shadow-[0_25px_70px_rgba(0,0,0,0.95),0_0_35px_rgba(0,240,255,0.25)]`}
        // The window never grows past the viewport either: the header, the rows and
        // the audio switch are one column, and the rows are the only part that yields.
        style={{ maxHeight: 'calc(100dvh - 2rem)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '8px 12px',
            // The chrome does not yield: only the rows between here and the footer do.
            flexShrink: 0,
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
              onClose();
            }}
            title={t('common.close')}
          >
            ✕
          </button>
        </div>

        <div
          className={`${WINDOW_BODY} flex flex-col bg-[rgba(12,4,28,0.92)]`}
          // Only these rows scroll (32.1). The cap is the viewport itself, because the
          // header and the audio switch are chrome and take their height first.
          style={{
            gap: 8,
            padding: '10px 12px',
            minHeight: 0,
            overflowY: 'auto',
            maxHeight: 'calc(100dvh - 2rem)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              fontSize: '0.75rem',
              color: 'var(--text-muted)',
            }}
          >
            <div style={ROW}>
              <span>{t('gameExtra.diceRollLabel')}</span>
              <span
                style={{
                  ...KEY_CHIP,
                  background: 'rgba(0, 240, 255, 0.15)',
                  borderColor: 'var(--accent-cyan)',
                }}
              >
                {t('gameExtra.spacebarKey')}
              </span>
            </div>
            <div style={ROW}>
              <span>{t('gameExtra.selectPieceLabel')}</span>
              <span
                style={{
                  ...KEY_CHIP,
                  background: 'rgba(255, 0, 127, 0.15)',
                  borderColor: 'var(--accent-pink)',
                }}
              >
                {t('gameExtra.leftClickKey')}
              </span>
            </div>
            {/* The goal is a count, not a key, so it stays plain text as it was. */}
            <div style={ROW}>
              <span>{t('gameExtra.goalColonLabel')}</span>
              <span style={{ color: 'var(--accent-yellow)', fontFamily: 'var(--font-mono)' }}>
                {t('gameExtra.goalValue')}
              </span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '2px 0' }} />

          {/* The second home of the auto-close preference (22.5): the same row as the
              dock's, reading and writing the same store field. The two switches that
              follow it (32.1) come above the full-width audio button, which is the
              stack this popover inherited from #sectorControlWindow: divider, audio,
              rules, one under another, with the preferences in front of the audio. */}
          <AutoCloseToggle />

          {/* Language and theme, in the dock's own running order (1 language, 4 theme)
              and above the audio row. Both are that popover's components mounted a
              fourth time, not forked: the theme switch takes no props and this one
              takes the store's pair. The theme row is last because it repaints the
              shell under it. */}
          <div style={GROUP}>
            <span style={GROUP_LABEL}>🌐 {t('navbar.languageLabel')}</span>
            <LanguageSwitcher variant="tabs" value={lang} onChange={setLang} />
          </div>

          <ThemeSwitcher />
        </div>

        {/* The footer, outside the scrolling body (32.1): the switch that unmutes a
            silent game is the one control that must never be scrolled for, and its
            beep is played by the press itself, so a row below the fold reads as a
            dead button. */}
        <div
          style={{
            flexShrink: 0,
            padding: '10px 12px',
            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
            background: 'rgba(12, 4, 28, 0.92)',
          }}
        >
          <button
            className={RETRO_BADGE}
            style={{
              cursor: 'pointer',
              padding: '8px 10px',
              background: muted ? 'rgb(var(--state-off-rgb) / 0.12)' : 'rgb(var(--state-on-rgb) / 0.12)',
              border: muted ? '1.5px solid var(--state-off)' : '1.5px solid var(--state-on)',
              color: muted ? 'var(--state-off)' : 'var(--state-on)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              fontWeight: 'bold',
              letterSpacing: '0.8px',
              textAlign: 'center',
              justifyContent: 'center',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderRadius: 4,
              boxShadow: muted ? 'none' : '0 0 8px rgb(var(--state-on-rgb) / 0.25)',
              transition: 'all 0.2s ease',
              width: '100%',
              boxSizing: 'border-box',
            }}
            onClick={onToggleSound}
            title={t('gameExtra.toggleAudio')}
          >
            <span>{muted ? '🔇' : '🔊'}</span>
            <span>{muted ? t('game.audioOff') : t('game.audioOn')}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
