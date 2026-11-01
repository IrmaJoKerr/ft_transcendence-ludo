import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { apiFetch } from '../api';
import type { Notification } from '../hooks/useNotifications';
import { useNotifications } from '../hooks/useNotifications';
import { navigate } from '../router';
import { useApp } from '../store';
import { retroAudio } from '../utils/audio';
import { RETRO_BTN, THEME_TRIGGER_BTN_BASE } from '../styles/tw';
import { railButtonStyle, railHoverHandlers } from './railButton';

// **Helpers**

function getNotificationTypeBadge(type: string): {
  tagKey: string;
  defaultTag: string;
  color: string;
} {
  switch (type) {
    case 'game_invite':
      return {
        tagKey: 'notifications.matchChallengeTag',
        defaultTag: '[MATCH_INVITE]',
        color: 'var(--accent-cyan, #00f0ff)',
      };
    case 'friend_request':
      return {
        tagKey: 'notifications.linkReqTag',
        defaultTag: '[FRIEND_REQ]',
        color: 'var(--accent-pink, #ff007f)',
      };
    case 'friend_accepted':
      return {
        tagKey: 'notifications.linkEstablishedTag',
        defaultTag: '[FRIEND_ACK]',
        color: 'var(--accent-yellow, #ffe600)',
      };
    case 'achievement':
      return {
        tagKey: 'notifications.achievementTag',
        defaultTag: '[ACHIEVEMENT]',
        color: '#00ff88',
      };
    case 'match_finished':
      return {
        tagKey: 'notifications.matchEndTag',
        defaultTag: '[MATCH_COMPLETE]',
        color: '#00ff88',
      };
    case 'match_cancelled':
      return {
        tagKey: 'notifications.matchCancelledTag',
        defaultTag: '[MATCH_ABORTED]',
        color: 'var(--accent-yellow, #ffe600)',
      };
    case 'friend_removed':
      return {
        tagKey: 'notifications.friendRemovedTag',
        defaultTag: '[LINK_SEVERED]',
        color: 'var(--accent-pink, #ff007f)',
      };
    case 'friend_declined':
      return {
        tagKey: 'notifications.friendDeclinedTag',
        defaultTag: '[LINK_REJECTED]',
        color: 'var(--accent-yellow, #ffe600)',
      };
    case 'friend_online':
      return {
        tagKey: 'notifications.friendOnlineTag',
        defaultTag: '[PILOT_ONLINE]',
        color: '#00ff88',
      };
    case 'friend_offline':
      return {
        tagKey: 'notifications.friendOfflineTag',
        defaultTag: '[PILOT_OFFLINE]',
        color: 'var(--accent-yellow, #ffe600)',
      };
    case 'profile_updated':
      return {
        tagKey: 'notifications.profileUpdatedTag',
        defaultTag: '[PROFILE_UPDATED]',
        color: 'var(--accent-cyan, #00f0ff)',
      };
    case 'display_name_changed':
      return {
        tagKey: 'notifications.displayNameChangedTag',
        defaultTag: '[CALLSIGN_CHANGED]',
        color: 'var(--accent-cyan, #00f0ff)',
      };
    default:
      return {
        tagKey: 'notifications.sysBroadcastTag',
        defaultTag: '[SYS_MSG]',
        color: 'var(--accent-cyan, #00f0ff)',
      };
  }
}

// Notification.payload is typed as an object, but the backend historically sent
// a JSON string for some rows. Keep the defensive parse for old/streamed rows.
function parseNotificationPayload(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

function renderNotificationBody(
  n: Notification,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const payload = parseNotificationPayload(n.payload);
  const from = payload.fromUsername ? String(payload.fromUsername) : 'UNKNOWN';

  switch (n.type) {
    case 'friend_request':
      return <span>{t('notifications.friendRequestText', { username: from })}</span>;
    case 'friend_accepted':
      return <span>{t('notifications.friendAcceptedText', { username: from })}</span>;
    case 'game_invite':
      return <span>{t('notifications.matchChallengeText', { username: from })}</span>;
    case 'achievement': {
      const nameKey = payload.nameKey as string | undefined;
      const name = nameKey ? t(nameKey) : '';
      return name ? <span>{name}!</span> : <span>{t('notifications.achievementUnlocked')}</span>;
    }
    case 'friend_removed':
      return <span>{t('notifications.friendRemovedText', { username: from })}</span>;
    case 'friend_declined':
      return <span>{t('notifications.friendDeclinedText', { username: from })}</span>;
    case 'friend_online':
      return (
        <span>
          {t('notifications.friendOnlineText', { displayName: payload.displayName ?? from })}
        </span>
      );
    case 'friend_offline':
      return (
        <span>
          {t('notifications.friendOfflineText', { displayName: payload.displayName ?? from })}
        </span>
      );
    case 'match_cancelled':
      return <span>{t('notifications.matchCancelledText', { username: from })}</span>;
    case 'match_finished': {
      const rank = payload.rank;
      const winner = payload.winnerUsername ? String(payload.winnerUsername) : 'A rival';
      return rank === 1 ? (
        <span>{t('notifications.matchEndWonText')}</span>
      ) : (
        <span>{t('notifications.matchEndLostText', { winner })}</span>
      );
    }
    case 'profile_updated': {
      const items = Array.isArray(payload.items) ? (payload.items as string[]) : [];
      const labels = items
        .map((i) => t(`notifications.profileItem${i.charAt(0).toUpperCase()}${i.slice(1)}`))
        .join(', ');
      return (
        <span>
          {t('notifications.profileUpdatedText', { item: labels || t('notifications.unknown') })}
        </span>
      );
    }
    case 'display_name_changed': {
      const oldName = payload.oldDisplayName ? String(payload.oldDisplayName) : from;
      const newName = payload.displayName ? String(payload.displayName) : 'UNKNOWN';
      return (
        <span>
          {t('notifications.displayNameChangedText', {
            displayName: oldName,
            newDisplayName: newName,
          })}
        </span>
      );
    }
    default:
      return <span>{t('notifications.systemTransmissionText')}</span>;
  }
}

function timeAgo(
  iso: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('notifications.justNow');
  if (mins < 60) return t('notifications.minsAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('notifications.hoursAgo', { count: hrs });
  return t('notifications.daysAgo', { count: Math.floor(hrs / 24) });
}

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
  const { bellOpen, setBellOpen, unavailable } = useNotifications();
  const open = bellOpen;
  const setOpen = setBellOpen;
  const ref = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { activeMatch, setActiveMatch } = useApp();

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

  // Same contract as the toast's accept: abort, then hand the code to the lobby.
  const acceptInvite = async (p: Record<string, unknown>) => {
    const currentGameId = activeMatch?.gameId;
    if (currentGameId && currentGameId !== p.gameId) {
      await apiFetch(`/api/game/${currentGameId}/abort`, { method: 'POST' }).catch(() => {
        // Non-fatal: the navigation below still happens.
      });
      setActiveMatch(null);
    }
    const code = typeof p.inviteCode === 'string' ? p.inviteCode : '';
    navigate(code ? `/gamelobby?join=${encodeURIComponent(code)}` : '/gamelobby');
  };

  const handleItemClick = (n: Notification) => {
    if (n.id) {
      onMarkRead(n.id);
    }
    try {
      retroAudio.playUiBeep(640, 0.05);
    } catch {
      // Audio can be blocked before a user gesture: never fail the UI for it.
    }

    const p = parseNotificationPayload(n.payload);

    if (n.type === 'game_invite') {
      // The invite carries the room, not a seat: accepting lands in the lobby with
      // the code filled in, where the invitee claims one of the room's free corners.
      // A live game is dropped first (awaited, so the lobby's own "active game" check
      // agrees), or the backend would answer MATCH_ACTIVE_GAME at the claim.
      void acceptInvite(p);
      setOpen(false);
    } else if (n.type === 'friend_request' || n.type === 'friend_accepted') {
      navigate('/friends');
      setOpen(false);
    }
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
        background: 'linear-gradient(180deg, rgba(20, 6, 46, 0.96), rgba(10, 2, 28, 0.98))',
        border: '1.5px solid var(--accent-cyan, #00f0ff)',
        boxShadow: '0 0 25px rgba(0, 240, 255, 0.25), 0 20px 60px rgba(0, 0, 0, 0.95)',
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
        background: 'rgba(10, 4, 24, 0.96)',
        border: '1.5px solid var(--accent-cyan, #00f0ff)',
        boxShadow: '0 0 25px rgba(0, 240, 255, 0.25), 0 16px 40px rgba(0, 0, 0, 0.9)',
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
                background: count > 0 ? '#ff007f' : 'rgba(255, 255, 255, 0.1)',
                color: count > 0 ? '#ffffff' : 'var(--text-muted)',
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
              background: 'rgba(0, 240, 255, 0.12)',
              borderBottom: '1px solid rgba(0, 240, 255, 0.3)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  fontFamily: 'var(--font-heading, monospace)',
                  fontSize: '0.78rem',
                  color: 'var(--accent-cyan, #00f0ff)',
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
              list.slice(0, 30).map((n) => {
                const badge = getNotificationTypeBadge(n.type);
                return (
                  <div
                    key={n.id}
                    onClick={() => handleItemClick(n)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '12px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                      background: n.read ? 'transparent' : 'rgba(0, 240, 255, 0.08)',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.15)')
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = n.read
                        ? 'transparent'
                        : 'rgba(0, 240, 255, 0.08)')
                    }
                  >
                    {/* Unread diamond indicator */}
                    <span
                      style={{
                        marginTop: 3,
                        fontSize: '0.65rem',
                        color: n.read ? 'transparent' : 'var(--accent-pink, #ff007f)',
                      }}
                    >
                      ◆
                    </span>

                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 3,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.65rem',
                            color: badge.color,
                            fontFamily: 'var(--font-mono, monospace)',
                            fontWeight: 'bold',
                          }}
                        >
                          {t(badge.tagKey, badge.defaultTag)}
                        </span>
                        <span
                          style={{
                            fontSize: '0.62rem',
                            color: 'var(--text-muted, #8a7a64)',
                            fontFamily: 'var(--font-mono, monospace)',
                          }}
                        >
                          {timeAgo(n.createdAt, t)}
                        </span>
                      </div>

                      <div
                        style={{
                          fontSize: '0.78rem',
                          fontWeight: n.read ? 'normal' : 'bold',
                          color: n.read ? 'var(--text-muted, #aaa)' : '#ffffff',
                          lineHeight: 1.35,
                          fontFamily: 'var(--font-mono, monospace)',
                        }}
                      >
                        {renderNotificationBody(n, t)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
