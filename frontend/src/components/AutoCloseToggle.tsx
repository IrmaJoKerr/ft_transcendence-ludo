import { useTranslation } from 'react-i18next';
import { useApp } from '../store';
import { retroAudio } from '../utils/audio';
import { DISPLAY_LABEL } from '../styles/tw';

/**
 * The auto-close switch, one row, two homes (22.5): the dock's account popover and
 * the game's controls modal. It reads and writes `notifAutoClose` in the store, so
 * the two panels cannot disagree — no prop drilling and no second copy.
 *
 * Its anatomy is the master-audio block's: label left, the badge pair right,
 * `10px 12px` padding, radius 8, green when on and white on `0.04` when off. It is
 * a `<button>` rather than that block's `div` with an onClick, because a control
 * that can be reached by keyboard is the point of adding one.
 */
export function AutoCloseToggle() {
  const { t } = useTranslation();
  const { notifAutoClose, setNotifAutoClose } = useApp();

  return (
    <button
      type="button"
      onClick={() => {
        retroAudio.playUiBeep(520, 0.05);
        setNotifAutoClose(!notifAutoClose);
      }}
      title={t('notifications.autoCloseToggle')}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: '10px 12px',
        borderRadius: 8,
        background: notifAutoClose ? 'rgb(var(--state-on-rgb) / 0.12)' : 'rgb(var(--ink-rgb) / 0.04)',
        border: notifAutoClose ? '1px solid var(--state-on)' : '1px solid rgb(var(--ink-rgb) / 0.1)',
        boxShadow: notifAutoClose ? '0 0 10px rgb(var(--state-on-rgb) / 0.2)' : 'none',
        cursor: 'pointer',
        transition: 'all 0.18s ease',
        // A button, so the row's own type styles have to be reset from the UA sheet.
        font: 'inherit',
        textAlign: 'left',
        color: 'inherit',
      }}
    >
      <span
        className={DISPLAY_LABEL}
      >
        {t('notifications.autoCloseToggle')}
      </span>
      <span
        style={{
          fontSize: '0.68rem',
          fontFamily: 'var(--font-mono)',
          fontWeight: 900,
          padding: '3px 8px',
          borderRadius: 4,
          background: notifAutoClose ? 'var(--state-on)' : 'rgb(var(--ink-rgb) / 0.12)',
          color: notifAutoClose ? 'var(--state-on-ink)' : 'var(--text-muted)',
          border: notifAutoClose ? '1px solid var(--state-on)' : '1px solid rgb(var(--ink-rgb) / 0.18)',
        }}
      >
        {notifAutoClose ? t('navbar.enabledBadge') : t('navbar.disabledBadge')}
      </span>
    </button>
  );
}
