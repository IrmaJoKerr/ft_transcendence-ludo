import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { retroAudio } from '../utils/audio';
import { AutoCloseToggle } from './AutoCloseToggle';
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

/**
 * The keys and the audio switch, in a popover under the board.
 *
 * This is the old `#sectorControlWindow` moved and slimmed, not a new panel: the
 * same three rows and the same audio toggle, minus the rules button, which now
 * stands beside it as GAME RULES. The room's rule switches are not here either —
 * they stay in the waiting-room window, so nothing in this popover is host-only.
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
          style={{ gap: 8, padding: '10px 12px' }}
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
              <span style={{ color: '#ffe600', fontFamily: 'var(--font-mono)' }}>
                {t('gameExtra.goalValue')}
              </span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '2px 0' }} />

          {/* The second home of the auto-close preference (22.5): the same row as the
              dock's, reading and writing the same store field. It sits directly above
              the full-width audio button, which is the stack this popover inherited
              from #sectorControlWindow: divider, audio, rules, one under another. */}
          <AutoCloseToggle />

          <button
            className={RETRO_BADGE}
            style={{
              cursor: 'pointer',
              padding: '8px 10px',
              background: muted ? 'rgba(255, 0, 85, 0.12)' : 'rgba(0, 255, 136, 0.12)',
              border: muted ? '1.5px solid #ff0055' : '1.5px solid #00ff88',
              color: muted ? '#ff0055' : '#00ff88',
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
              boxShadow: muted ? 'none' : '0 0 8px rgba(0, 255, 136, 0.25)',
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
