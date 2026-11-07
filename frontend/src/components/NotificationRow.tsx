import { useTranslation } from 'react-i18next';
import type { Notification } from '../hooks/useNotifications';
import {
  getNotificationTypeBadge,
  isOfferExpired,
  notificationAge,
  offerMechanism,
  parseNotificationPayload,
} from './notificationParts';

// What a stored entry says, in one sentence. Moved out of NotificationBell.tsx
// with the tag table beside it (22.2 item 5): the bell panel and the digest report
// draw the same sentence for the same type, so the two surfaces cannot drift.
function NotificationSentence({ notification }: { notification: Notification }) {
  const { t } = useTranslation();
  const payload = parseNotificationPayload(notification.payload);
  const from = payload.fromUsername ? String(payload.fromUsername) : 'UNKNOWN';

  switch (notification.type) {
    case 'friend_request':
      return <span>{t('notifications.friendRequestText', { username: from })}</span>;
    case 'friend_accepted':
      return <span>{t('notifications.friendAcceptedText', { username: from })}</span>;
    case 'game_invite':
      // A room invite is a seat, not a duel (22.9): the sentence names the
      // mechanism the same way the tag above it does.
      return (
        <span>
          {offerMechanism(payload) === 'room'
            ? t('notifications.matchInviteText', { username: from })
            : t('notifications.matchChallengeText', { username: from })}
        </span>
      );
    case 'challenge_accepted':
      return <span>{t('notifications.matchAcceptedText', { username: from })}</span>;
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
    case 'match_abandoned':
      return <span>{t('notifications.matchAbandonedText')}</span>;
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

// **One row**
// The bell's row and the digest's row are this component: the diamond, the tag,
// the age and the sentence. `onActivate` is what makes it a row you can press;
// without it the same row is a receipt the report only reads out (22.2 item 5).
export function NotificationRow({
  notification,
  onActivate,
}: {
  notification: Notification;
  onActivate?: () => void;
}) {
  const { t } = useTranslation();
  const payload = parseNotificationPayload(notification.payload);
  // The tag depends on the mechanism for an offer: a room invite is not a
  // challenge, and the row that announces it should not say it was (22.9).
  const badge = getNotificationTypeBadge(notification.type, payload);
  // A lapsed offer keeps its row but stops being an offer: the tag says so, and the
  // click is an acknowledgement (22.7 item 2).
  const expired = isOfferExpired(notification);
  const interactive = typeof onActivate === 'function';
  // Read rows are dimmer; every stored entry is unread by construction (the
  // store deletes on read), so this is the hover-off state as well.
  const restingBg = notification.read ? 'transparent' : 'rgba(0, 240, 255, 0.08)';

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onActivate();
              }
            }
          : undefined
      }
      onMouseEnter={
        interactive
          ? (e) => (e.currentTarget.style.background = 'rgba(0, 240, 255, 0.15)')
          : undefined
      }
      onMouseLeave={
        interactive ? (e) => (e.currentTarget.style.background = restingBg) : undefined
      }
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        cursor: interactive ? 'pointer' : 'default',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        background: restingBg,
        transition: 'background 0.15s ease',
      }}
    >
      {/* Unread diamond indicator */}
      <span
        style={{
          marginTop: 3,
          fontSize: '0.65rem',
          color: notification.read ? 'transparent' : 'var(--accent-pink, #ff007f)',
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
              color: expired ? 'var(--accent-yellow, #ffe600)' : badge.color,
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 'bold',
            }}
          >
            {expired ? t('notifications.expired', 'EXPIRED') : t(badge.tagKey, badge.defaultTag)}
          </span>
          <span
            style={{
              fontSize: '0.62rem',
              color: 'var(--text-muted, #8a7a64)',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {notificationAge(notification.createdAt, t)}
          </span>
        </div>

        <div
          style={{
            fontSize: '0.78rem',
            fontWeight: notification.read ? 'normal' : 'bold',
            color: notification.read ? 'var(--text-muted, #aaa)' : '#ffffff',
            lineHeight: 1.35,
            fontFamily: 'var(--font-mono, monospace)',
          }}
        >
          <NotificationSentence notification={notification} />
        </div>
      </div>
    </div>
  );
}
