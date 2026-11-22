import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DigestReport } from '../../hooks/useNotifications';
import { useApp } from '../../store';
import { retroAudio } from '../../utils/audio';
import { NotificationRow } from '../NotificationRow';
import { TOAST_AUTOCLOSE_MS } from './notificationToastInfo';

// **Digest Toast**

// The boot report: one card per page load, built from the unread handshake snapshot
// and then frozen. It excludes `profile_updated`; its `x` only hides the card, never
// deletes the stored notifications.
export function NotificationDigest({
  report,
  bottom,
  onOpen,
  onDismiss,
}: {
  report: DigestReport | null;
    // Clearance from the viewport bottom, so it stacks above any live toasts.
  bottom: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { notifAutoClose } = useApp();
  const [visible, setVisible] = useState(false);

  // The entrance is the live card's one tick (30 ms), awaited rather than synchronous
  // so it is a transition, not an extra render pass.
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 30);
    return () => window.clearTimeout(t);
  }, [report]);

  // The report obeys the same two rules as a live card (22.4 item 3): the shared
  // clock, or its `x`; and with the preference off it waits for the `x` alone.
  useEffect(() => {
    if (!report || !notifAutoClose) return;
    const timer = window.setTimeout(() => setVisible(false), TOAST_AUTOCLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [report, notifAutoClose]);

  // One press, two ways in: the header is a `role="button"` div, so a click and Enter
  // are the same gesture and get the same note — the one the bell plays when it opens
  // (720), because this opens that bell.
  const openPanel = () => {
    retroAudio.playUiBeep(720, 0.05);
    onOpen();
  };

  if (!report) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 28,
        bottom,
        zIndex: 99999,
        width: 380,
        background: 'rgb(var(--bg-panel-rgb) / 0.97)',
        border: '2px solid var(--accent-cyan)',
        boxShadow: '0 0 24px rgb(var(--accent-cyan-rgb) / 0.35), 0 20px 48px rgb(var(--shade-rgb) / 0.95)',
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backdropFilter: 'blur(12px)',
        transform: visible ? 'translateX(0)' : 'translateX(120%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.35s cubic-bezier(.22,1,.36,1), opacity 0.35s ease',
        pointerEvents: 'auto',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={openPanel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openPanel();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          cursor: 'pointer',
          borderBottom: '1px solid rgb(var(--accent-cyan-rgb) / 0.25)',
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.78rem',
            fontWeight: 'bold',
            color: 'var(--text-main)',
            letterSpacing: 0.5,
          }}
        >
          {t('notifications.digestToast', { count: report.total })}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            retroAudio.playUiBeep(400, 0.05);
            onDismiss();
          }}
          aria-label={t('notifications.dismiss')}
          style={{
            background: 'transparent',
            border: '1px solid rgb(var(--ink-rgb) / 0.3)',
            color: 'var(--text-muted, #8a7a64)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.7rem',
            lineHeight: 1,
            padding: '3px 6px',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          x
        </button>
      </div>

      {/* The newest first, and scrollable: the report never grows, so the list is
          as long as the load was. */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {report.rows.map((n) => (
          <NotificationRow key={n.id} notification={n} />
        ))}
      </div>
    </div>
  );
}
