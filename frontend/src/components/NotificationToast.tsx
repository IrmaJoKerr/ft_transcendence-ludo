import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Notification } from '../hooks/useNotifications';
import { useApp } from '../store';
import { navigate } from '../router';
import { apiFetch } from '../api';
import type { PlayerColor } from '../game/types';
import { retroAudio } from '../utils/audio';
import { RETRO_BTN } from '../styles/tw';

// **Helpers**

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

function getToastInfo(
  n: Notification,
  t: (key: string, options?: Record<string, unknown>) => string,
): {
  tag: string;
  badgeLabel: string;
  badgeColor: string;
  badgeBg: string;
  fromUser: string | null;
  actionMessage: string;
} {
  const payload = parseNotificationPayload(n.payload);
  const from = payload.fromUsername ? String(payload.fromUsername) : null;

  switch (n.type) {
    case 'friend_request':
      return {
        tag: t('notifications.linkReqTag'),
        badgeLabel: 'LINK',
        badgeColor: 'var(--accent-pink, #ff007f)',
        badgeBg: 'rgba(255, 0, 127, 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendReq'),
      };
    case 'friend_accepted':
      return {
        tag: t('notifications.linkEstablishedTag'),
        badgeLabel: 'SYNC',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgba(255, 230, 0, 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendAccepted'),
      };
    case 'game_invite':
      return {
        tag: t('notifications.matchChallengeTag'),
        badgeLabel: payload.playerCount === 4 ? '4P' : '1v1',
        badgeColor: 'var(--accent-cyan, #00f0ff)',
        badgeBg: 'rgba(0, 240, 255, 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionMatchChallenge'),
      };
    case 'achievement': {
      const nameKey = payload.nameKey as string | undefined;
      const name = nameKey ? t(nameKey) : '';
      return {
        tag: t('notifications.achievementTag'),
        badgeLabel: 'ACHV',
        badgeColor: '#00ff88',
        badgeBg: 'rgba(0, 255, 136, 0.18)',
        fromUser: null,
        actionMessage: name ? `${name}!` : t('notifications.achievementUnlocked'),
      };
    }
    case 'match_finished': {
      const rank = payload.rank;
      const winner = payload.winnerUsername ? String(payload.winnerUsername) : 'A rival';
      return {
        tag: t('notifications.matchEndTag'),
        badgeLabel: 'END',
        badgeColor: '#00ff88',
        badgeBg: 'rgba(0, 255, 136, 0.18)',
        fromUser: null,
        actionMessage:
          rank === 1
            ? t('notifications.matchEndWonText')
            : t('notifications.matchEndLostText', { winner }),
      };
    }
    case 'match_cancelled':
      return {
        tag: t('notifications.matchCancelledTag'),
        badgeLabel: 'ABRT',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgba(255, 230, 0, 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionMatchCancelled'),
      };
    case 'friend_removed':
      return {
        tag: t('notifications.friendRemovedTag'),
        badgeLabel: 'LINK',
        badgeColor: 'var(--accent-pink, #ff007f)',
        badgeBg: 'rgba(255, 0, 127, 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendRemoved'),
      };
    case 'friend_declined':
      return {
        tag: t('notifications.friendDeclinedTag'),
        badgeLabel: 'LINK',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgba(255, 230, 0, 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendDeclined'),
      };
    case 'friend_online':
      return {
        tag: t('notifications.friendOnlineTag'),
        badgeLabel: 'ON',
        badgeColor: '#00ff88',
        badgeBg: 'rgba(0, 255, 136, 0.18)',
        fromUser: String(payload.displayName ?? from),
        actionMessage: t('notifications.actionFriendOnline', {
          displayName: payload.displayName ?? from,
        }),
      };
    case 'friend_offline':
      return {
        tag: t('notifications.friendOfflineTag'),
        badgeLabel: 'OFF',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgba(255, 230, 0, 0.18)',
        fromUser: String(payload.displayName ?? from),
        actionMessage: t('notifications.actionFriendOffline', {
          displayName: payload.displayName ?? from,
        }),
      };
    case 'profile_updated': {
      const items = Array.isArray(payload.items) ? (payload.items as string[]) : [];
      const labels = items
        .map((i) => t(`notifications.profileItem${i.charAt(0).toUpperCase()}${i.slice(1)}`))
        .join(', ');
      return {
        tag: t('notifications.profileUpdatedTag'),
        badgeLabel: 'PROF',
        badgeColor: 'var(--accent-cyan, #00f0ff)',
        badgeBg: 'rgba(0, 240, 255, 0.18)',
        fromUser: null,
        actionMessage: t('notifications.profileUpdatedText', {
          item: labels || t('notifications.unknown'),
        }),
      };
    }
    case 'display_name_changed': {
      const oldName = payload.oldDisplayName ? String(payload.oldDisplayName) : from;
      const newName = payload.displayName
        ? String(payload.displayName)
        : t('notifications.unknown');
      return {
        tag: t('notifications.displayNameChangedTag'),
        badgeLabel: 'CALL',
        badgeColor: 'var(--accent-cyan, #00f0ff)',
        badgeBg: 'rgba(0, 240, 255, 0.18)',
        fromUser: null,
        actionMessage: t('notifications.displayNameChangedText', {
          displayName: oldName,
          newDisplayName: newName,
        }),
      };
    }
    default:
      return {
        tag: t('notifications.sysBroadcastTag'),
        badgeLabel: 'SYS',
        badgeColor: 'var(--accent-cyan, #00f0ff)',
        badgeBg: 'rgba(0, 240, 255, 0.18)',
        fromUser: null,
        actionMessage: t('notifications.actionSysBroadcast'),
      };
  }
}

// **Single Toast**

function Toast({
  notification,
  onDismiss,
  index,
}: {
  notification: Notification;
  onDismiss: (id: string) => void;
  index: number;
}) {
  const { t } = useTranslation();
  const { activeMatch, setActiveMatch } = useApp();
  const [visible, setVisible] = useState(false);

  // Play audio alert and slide in on mount.
  useEffect(() => {
    try {
      retroAudio.playUiBeep(1200, 0.04);
      setTimeout(() => {
        retroAudio.playUiBeep(1760, 0.08);
      }, 60);
    } catch {
      // Audio safety fallback
    }

    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss after 9 seconds.
  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(notification.id), 350);
    }, 9000);
    return () => clearTimeout(t);
  }, [notification.id, onDismiss]);

  const dismiss = () => {
    try {
      retroAudio.playUiBeep(400, 0.04);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    setVisible(false);
    setTimeout(() => onDismiss(notification.id), 350);
  };

  // Accept a game invite
  const acceptInvite = () => {
    try {
      retroAudio.playUiBeep(880, 0.08);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    // Strict state lock, mirrored from the backend: one live game at a time.
    // Accepting the challenge aborts a live game first, so the switch never hits
    // MATCH_ACTIVE_GAME. The abort is fire-and-forget; the room is dropped locally.
    const currentGameId = activeMatch?.gameId;
    if (currentGameId && currentGameId !== p.gameId) {
      void apiFetch(`/api/game/${currentGameId}/abort`, { method: 'POST' }).catch(() => {
        // Non-fatal: the switch below still happens.
      });
    }
    setActiveMatch({
      gameId: p.gameId as string,
      token: p.token as string,
      color: p.color as PlayerColor,
      inviteCode: p.inviteCode as string | undefined,
      mode: 'pvp',
      playerCount: 4,
    });
    onDismiss(notification.id);
    if (p.gameId) {
      navigate(`/game?gameId=${p.gameId}`);
    }
  };

  // Accept a friend request directly from toast
  const acceptFriend = async () => {
    try {
      retroAudio.playUiBeep(880, 0.08);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    if (p.requestId) {
      try {
        await apiFetch(`/api/friends/accept/${p.requestId}`, { method: 'POST' });
      } catch {
        // Ignore: non-critical action; the toast still dismisses.
      }
    }
    dismiss();
  };

  // Decline a friend request directly from toast
  const declineFriend = async () => {
    try {
      retroAudio.playUiBeep(400, 0.05);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    if (p.requestId) {
      try {
        await apiFetch(`/api/friends/decline/${p.requestId}`, { method: 'POST' });
      } catch {
        // Ignore: non-critical action; the toast still dismisses.
      }
    }
    dismiss();
  };

  const { tag, badgeLabel, badgeColor, badgeBg, fromUser, actionMessage } = getToastInfo(
    notification,
    t,
  );
  const isInvite = notification.type === 'game_invite';

  const toastStyle: CSSProperties = {
    position: 'fixed',
    right: 28,
    bottom: 28 + index * 150,
    zIndex: 99999,
    width: 430,
    background: 'rgba(10, 4, 24, 0.97)',
    border: '2px solid var(--accent-pink, #ff007f)',
    boxShadow: '0 0 24px rgba(255, 0, 127, 0.4), 0 20px 48px rgba(0, 0, 0, 0.95)',
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backdropFilter: 'blur(12px)',
    transform: visible ? 'translateX(0)' : 'translateX(120%)',
    opacity: visible ? 1 : 0,
    transition: 'transform 0.35s cubic-bezier(.22,1,.36,1), opacity 0.35s ease',
    pointerEvents: 'auto',
  };

  return (
    <div style={toastStyle}>
      {/* Toast Titlebar Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'rgba(255, 0, 127, 0.22)',
          borderBottom: '1.5px solid rgba(255, 0, 127, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#ff007f',
              boxShadow: '0 0 8px #ff007f',
              animation: 'pulse 1s infinite',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-heading, monospace)',
              fontSize: '0.8rem',
              color: 'var(--accent-pink, #ff007f)',
              letterSpacing: 1,
              fontWeight: 'bold',
            }}
          >
            {t('notifications.incomingTransmission')} {tag}
          </span>
        </div>

        <button
          onClick={dismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent-pink, #ff007f)',
            cursor: 'pointer',
            fontSize: '1.1rem',
            padding: '0 4px',
            lineHeight: 1,
            fontWeight: 'bold',
          }}
          title={t('notifications.dismissAlert')}
        >
          &times;
        </button>
      </div>

      {/* Toast Content Body with Type Identifier Badge */}
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Notification Type Identifier Badge (e.g. "1v1", "LINK", "ACHV") */}
          <div
            style={{
              width: 48,
              height: 38,
              borderRadius: 4,
              background: badgeBg,
              border: `1.5px solid ${badgeColor}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-heading, monospace)',
              fontSize: '0.78rem',
              fontWeight: 'bold',
              color: badgeColor,
              boxShadow: `0 0 12px ${badgeColor}35`,
              letterSpacing: 1,
              flexShrink: 0,
            }}
          >
            {badgeLabel}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
            {fromUser ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-heading, monospace)',
                    fontSize: '0.82rem',
                    color: 'var(--accent-yellow, #ffe600)',
                    textShadow: '0 0 8px rgba(255, 230, 0, 0.6)',
                    letterSpacing: 1,
                    fontWeight: 'bold',
                  }}
                >
                  @{fromUser.toUpperCase()}
                </span>
                <span
                  style={{
                    fontSize: '0.62rem',
                    background: 'rgba(0, 240, 255, 0.18)',
                    border: '1px solid var(--accent-cyan, #00f0ff)',
                    color: 'var(--accent-cyan, #00f0ff)',
                    padding: '1px 6px',
                    borderRadius: 2,
                    fontFamily: 'var(--font-mono, monospace)',
                    fontWeight: 'bold',
                    letterSpacing: 0.5,
                  }}
                >
                  {t('notifications.pilotLabel')}
                </span>
              </div>
            ) : (
              <span
                style={{
                  fontFamily: 'var(--font-heading, monospace)',
                  fontSize: '0.82rem',
                  color: 'var(--accent-cyan, #00f0ff)',
                  letterSpacing: 1,
                  fontWeight: 'bold',
                }}
              >
                {t('notifications.systemAlert')}
              </span>
            )}

            <div
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.82rem',
                color: '#e4e4e4',
                lineHeight: 1.35,
              }}
            >
              {actionMessage}
            </div>
          </div>
        </div>

        {/* Action Buttons for Game Invites */}
        {isInvite && (
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              onClick={acceptInvite}
              className={RETRO_BTN}
              style={{
                flex: 1,
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgba(0, 240, 255, 0.18)',
                border: '2px solid var(--accent-cyan, #00f0ff)',
                color: 'var(--accent-cyan, #00f0ff)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('nav.acceptInvite').toUpperCase()}
            </button>
            <button
              onClick={dismiss}
              className={RETRO_BTN}
              style={{
                flex: 1,
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgba(255, 0, 127, 0.15)',
                border: '2px solid rgba(255, 0, 127, 0.5)',
                color: 'var(--accent-pink, #ff007f)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('nav.declineInvite').toUpperCase()}
            </button>
          </div>
        )}

        {/* Action Buttons for Friend Requests */}
        {notification.type === 'friend_request' && (
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              onClick={() => {
                void acceptFriend();
              }}
              className={RETRO_BTN}
              style={{
                flex: 1,
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgba(0, 240, 255, 0.18)',
                border: '2px solid var(--accent-cyan, #00f0ff)',
                color: 'var(--accent-cyan, #00f0ff)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('nav.acceptInvite').toUpperCase()}
            </button>
            <button
              onClick={() => {
                void declineFriend();
              }}
              className={RETRO_BTN}
              style={{
                flex: 1,
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgba(255, 0, 127, 0.15)',
                border: '2px solid rgba(255, 0, 127, 0.5)',
                color: 'var(--accent-pink, #ff007f)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('nav.declineInvite').toUpperCase()}
            </button>
          </div>
        )}

        {/* Action Button for Friend Accepted */}
        {notification.type === 'friend_accepted' && (
          <div style={{ display: 'flex', marginTop: 4 }}>
            <button
              onClick={dismiss}
              className={RETRO_BTN}
              style={{
                width: '100%',
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgba(255, 230, 0, 0.12)',
                border: '2px solid var(--accent-yellow, #ffe600)',
                color: 'var(--accent-yellow, #ffe600)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('notifications.dismiss')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// **Toast Container**

export function NotificationToasts({
  toasts,
  onDismiss,
}: {
  toasts: Notification[];
  onDismiss: (id: string) => void;
}) {
  // Show at most 3 toasts at once: oldest ones get pushed off.
  const visible = toasts.slice(0, 3);

  return (
    <>
      {visible.map((n, i) => (
        <Toast key={n.id} notification={n} onDismiss={onDismiss} index={i} />
      ))}
    </>
  );
}

// **Digest Toast**

// A burst of stored notifications is announced once instead of one toast each
// (Phase 4). Clicking it opens the bell panel, which holds the detail; transient
// types (presence, display name, avatar) never enter this count.
export function NotificationDigest({
  count,
  bottom,
  onOpen,
  onDismiss,
}: {
  count: number;
  /** Clearance from the viewport bottom, so it stacks above any live toasts. */
  bottom: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (count <= 0) {
      setVisible(false);
      return;
    }
    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 8000);
    return () => window.clearTimeout(timer);
  }, [count]);

  if (count <= 0) return null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      style={{
        position: 'fixed',
        right: 28,
        bottom,
        zIndex: 99999,
        width: 380,
        background: 'rgba(10, 4, 24, 0.97)',
        border: '2px solid var(--accent-cyan, #00f0ff)',
        boxShadow: '0 0 24px rgba(0, 240, 255, 0.35), 0 20px 48px rgba(0, 0, 0, 0.95)',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 14px',
        cursor: 'pointer',
        backdropFilter: 'blur(12px)',
        transform: visible ? 'translateX(0)' : 'translateX(120%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.35s cubic-bezier(.22,1,.36,1), opacity 0.35s ease',
        pointerEvents: 'auto',
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.78rem',
          fontWeight: 'bold',
          color: '#ffffff',
          letterSpacing: 0.5,
        }}
      >
        {t('notifications.digestToast', { count })}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        aria-label={t('notifications.dismiss')}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          color: 'var(--text-muted, #8a7a64)',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.7rem',
          lineHeight: 1,
          padding: '3px 6px',
          cursor: 'pointer',
          borderRadius: 2,
        }}
      >
        ×
      </button>
    </div>
  );
}

