import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Notification } from '../hooks/useNotifications';
import { useNotifications } from '../hooks/useNotifications';
import { navigate } from '../router';
import { retroAudio } from '../utils/audio';
import { RETRO_BTN, THEME_TRIGGER_BTN_BASE } from '../styles/tw';
import { railButtonStyle, railHoverHandlers } from './railButton';
import { destinationFor } from './notificationDestination';
import { NotificationRow } from './NotificationRow';

// **Component**

export function NotificationBell({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  placement = 'bottom-right',
  fullWidth = false,
  compact = false,
  containerStyle,
  buttonStyle,
}: {
  notifications: Notification[];
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  placement?: 'bottom-right' | 'right';
  fullWidth?: boolean;
  /** Icon-only trigger (no text pill): used by RetroNavbar's collapsed sidebar rail. */
  compact?: boolean;
  containerStyle?: CSSProperties;
  buttonStyle?: CSSProperties;
}) {
  const { t } = useTranslation();
  // The panel's open state lives in the notification context: the digest toast at
  // the app root has to be able to open it (Phase 4).
  const { bellOpen, setBellOpen, unavailable, markReadMany } = useNotifications();
  const open = bellOpen;
  const setOpen = setBellOpen;
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const list = Array.isArray(notifications) ? notifications : [];
  const count = typeof unreadCount === 'number' ? unreadCount : list.filter((n) => !n.read).length;

  // Close the dropdown on an outside click, on either the trigger or the
  // portaled dropdown (the portal renders outside `ref`).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (dropdownRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, setOpen]);

  // Portalled to <body> so no ancestor stacking context can trap it; position
  // comes from the trigger's bounding box (see component docs, Implementation
  // Notes).
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    right: number;
    bottom: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const updateCoords = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setCoords({
        top: rect.bottom,
        bottom: window.innerHeight - rect.bottom,
        left: rect.right,
        right: window.innerWidth - rect.right,
      });
    };
    updateCoords();
    window.addEventListener('scroll', updateCoords, true);
    window.addEventListener('resize', updateCoords);
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [open]);

  const toggleOpen = () => {
    try {
      retroAudio.playUiBeep(open ? 480 : 720, 0.05);
    } catch {
      // Audio can be blocked before a user gesture: never fail the UI for it.
    }
    setOpen(!open);
  };

  // A row routes or acknowledges (22.7). A router takes the reader to the page that
  // holds the state and clears every row that would land them in the same place; a
  // stamp clears itself and stays where it is, because no page shows it.
  const handleItemClick = (n: Notification) => {
    try {
      retroAudio.playUiBeep(640, 0.05);
    } catch {
      // Audio can be blocked before a user gesture: never fail the UI for it.
    }

    const to = destinationFor(n);
    if (!to) {
      onMarkRead(n.id);
      return;
    }

    const ids = list.filter((row) => destinationFor(row) === to).map((row) => row.id);
    if (ids.length > 1) markReadMany(ids);
    else onMarkRead(n.id);
    setOpen(false);
    navigate(to);
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    retroAudio.playUiBeep(380, 0.06);
    onMarkAllRead();
  };

  const isRight = placement === 'right';

  const bellContainerStyle: CSSProperties = {
    position: 'relative',
    userSelect: 'none',
    display: fullWidth ? 'flex' : 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: fullWidth ? '100%' : 'auto',
    height: fullWidth ? 44 : 38,
    ...containerStyle,
  };

  const dropdownStyle: CSSProperties = isRight
    ? {
        position: 'fixed',
        left: coords ? coords.left + 14 : -9999,
        bottom: coords ? coords.bottom : -9999,
        top: 'auto',
        right: 'auto',
        width: 350,
        maxHeight: 460,
        background: 'linear-gradient(180deg, rgb(var(--bg-raise-rgb) / 0.96), rgb(var(--bg-panel-rgb) / 0.98))',
        border: '1.5px solid var(--accent-cyan)',
        boxShadow: '0 0 25px rgb(var(--accent-cyan-rgb) / 0.25), 0 20px 60px rgb(var(--shade-rgb) / 0.95)',
        borderRadius: 14,
        // Portaled to <body> (see useLayoutEffect above), so this z-index
        // only has to beat other <body>-level layers (modals at 10002).
        zIndex: 100000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backdropFilter: 'blur(32px) saturate(220%)',
        opacity: open ? 1 : 0,
        transform: open ? 'translateX(0)' : 'translateX(-8px)',
        pointerEvents: open ? 'auto' : 'none',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
      }
    : {
        position: 'fixed',
        top: coords ? coords.top + 8 : -9999,
        right: coords ? coords.right : -9999,
        width: 380,
        maxHeight: 460,
        background: 'rgb(var(--bg-panel-rgb) / 0.96)',
        border: '1.5px solid var(--accent-cyan)',
        boxShadow: '0 0 25px rgb(var(--accent-cyan-rgb) / 0.25), 0 16px 40px rgb(var(--shade-rgb) / 0.9)',
        borderRadius: 4,
        // Portaled to <body> (see useLayoutEffect above) so this always
        // renders above every other element, regardless of which stacking
        // context (e.g. a sticky sidebar) the bell trigger itself lives in.
        zIndex: 100000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backdropFilter: 'blur(10px)',
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0)' : 'translateY(-8px)',
        pointerEvents: open ? 'auto' : 'none',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
      };

  return (
    <div ref={ref} style={bellContainerStyle}>
      {/* Old-School Tactical Receiver Button */}
      {fullWidth && compact ? (
        <button
          className={`${RETRO_BTN} ${THEME_TRIGGER_BTN_BASE} ${open ? 'active' : ''}`}
          onClick={toggleOpen}
          title={t('notifications.title')}
          {...railHoverHandlers(open)}
          style={{
            ...railButtonStyle(open),
            width: '100%',
            height: 44,
            justifyContent: 'center',
            padding: 0,
            borderRadius: 10,
            color: 'var(--text-main)',
            ...buttonStyle,
          }}
        >
          <span style={{ fontSize: '1.1rem', position: 'relative' }}>
            🔔
            {count > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -6,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#ff007f',
                  boxShadow: '0 0 6px #ff007f',
                }}
              />
            )}
          </span>
        </button>
      ) : fullWidth ? (
        <button
          className={`${RETRO_BTN} ${THEME_TRIGGER_BTN_BASE} ${open ? 'active' : ''}`}
          onClick={toggleOpen}
          title={t('notifications.title')}
          {...railHoverHandlers(open)}
          style={{
            ...railButtonStyle(open),
            width: '100%',
            height: 44,
            justifyContent: 'space-between',
            padding: '0 14px',
            fontSize: '0.94rem',
            borderRadius: 10,
            color: 'var(--text-main)',
            ...buttonStyle,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                letterSpacing: '1px',
                fontWeight: 900,
                fontSize: '0.94rem',
              }}
            >
              {t('notifications.title')}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                fontSize: '0.7rem',
                fontFamily: 'var(--font-mono)',
                fontWeight: 900,
                padding: '2px 7px',
                borderRadius: 4,
                background: count > 0 ? '#ff007f' : 'rgb(var(--ink-rgb) / 0.1)',
                color: count > 0 ? 'var(--text-main)' : 'var(--text-muted)',
                boxShadow: count > 0 ? '0 0 8px #ff007f' : 'none',
              }}
            >
              {count > 0 ? count : '0'}
            </span>
            <span style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)', fontWeight: 'bold' }}>
              {open ? '▼' : '►'}
            </span>
          </div>
        </button>
      ) : (
        <button
          className={`${RETRO_BTN} ${THEME_TRIGGER_BTN_BASE} ${open ? 'active' : ''}`}
          onClick={toggleOpen}
          title={t('notifications.title')}
          style={{
            justifyContent: 'center',
            gap: 8,
            height: 38,
            width: 140,
            margin: 0,
            ...buttonStyle,
          }}
        >
          {/* Retro hardware strobe LED dot */}
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: count > 0 ? 'var(--accent-pink, #ff007f)' : '#33ff88',
              boxShadow: count > 0 ? '0 0 8px #ff007f' : '0 0 6px #33ff88',
              animation: count > 0 ? 'pulse 1.2s infinite' : 'none',
              flexShrink: 0,
              display: 'inline-block',
            }}
          />

          <span
            className="text-[0.62rem] leading-none tracking-[0.5px] whitespace-nowrap"
            style={{ fontSize: '0.62rem' }}
          >
            {t('notifications.title')}
            {count > 0 ? ` [${count < 10 ? `0${count}` : count}]` : ''}
          </span>
        </button>
      )}

      {/* Retro Dropdown Window Frame: portaled to <body>, see useLayoutEffect above */}
      {createPortal(
        <div ref={dropdownRef} style={dropdownStyle}>
          {/* Window Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 14px',
              background: 'rgb(var(--accent-cyan-rgb) / 0.12)',
              borderBottom: '1px solid rgb(var(--accent-cyan-rgb) / 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontFamily: 'var(--font-heading, monospace)',
                  fontSize: '0.78rem',
                  color: 'var(--accent-cyan)',
                  letterSpacing: 1,
                  fontWeight: 'bold',
                }}
              >
                {t('notifications.transmissionLogTitle')}
              </span>
            </div>

            {count > 0 && (
              <button
                onClick={handleClearAll}
                style={{
                  background: 'transparent',
                  border: '1px dashed var(--accent-yellow, #ffe600)',
                  color: 'var(--accent-yellow, #ffe600)',
                  fontSize: '0.62rem',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontWeight: 'bold',
                  padding: '3px 8px',
                  cursor: 'pointer',
                  borderRadius: 2,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  lineHeight: 1,
                }}
              >
                {t('notifications.ackAllBtn')}
              </button>
            )}
          </div>

          {/* Transmission List Buffer */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              maxHeight: 380,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {list.length === 0 ? (
              <div
                style={{
                  padding: '36px 16px',
                  textAlign: 'center',
                  color: 'var(--text-muted, #8a7a64)',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: '0.78rem',
                  letterSpacing: 0.5,
                }}
              >
                {unavailable
                  ? t('notifications.unavailable')
                  : t('notifications.noTransmissions')}
              </div>
            ) : (
              // Sixty rows, sixty unread: the store's cap and the render's bound
              // are one number, so nothing a client can receive is hidden (22.8).
              list.slice(0, 60).map((n) => (
                <NotificationRow key={n.id} notification={n} onActivate={() => handleItemClick(n)} />
              ))
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
