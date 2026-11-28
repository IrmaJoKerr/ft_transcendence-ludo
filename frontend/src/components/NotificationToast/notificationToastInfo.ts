import type { Notification } from '../../hooks/useNotifications';
import {
  offerMechanism,
  offerMechanismLabel,
  parseNotificationPayload,
} from '../notificationParts';

// One autoclose window for every card: the shared 8 s clock. The 30 ms entrance and
// 350 ms exit are transitions, not autoclose timers, and are not controlled here.
export const TOAST_AUTOCLOSE_MS = 8_000;

export function getToastInfo(
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
        badgeColor: 'var(--accent-pink)',
        badgeBg: 'rgb(var(--accent-pink-rgb) / 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendReq'),
      };
    case 'friend_accepted':
      return {
        tag: t('notifications.linkEstablishedTag'),
        badgeLabel: 'SYNC',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendAccepted'),
      };
    case 'game_invite':
      // Challenge and room invite share `game_invite`; `offerMechanism` selects the
      // label, tag and action so the row never guesses at a headcount.
      return offerMechanism(payload) === 'room'
        ? {
            tag: t('notifications.matchInviteTag'),
            badgeLabel: offerMechanismLabel('room'),
            badgeColor: 'var(--accent-cyan)',
            badgeBg: 'rgb(var(--accent-cyan-rgb) / 0.18)',
            fromUser: from,
            actionMessage: t('notifications.actionMatchInvite'),
          }
        : {
            tag: t('notifications.matchChallengeTag'),
            badgeLabel: offerMechanismLabel('challenge'),
            badgeColor: 'var(--accent-cyan)',
            badgeBg: 'rgb(var(--accent-cyan-rgb) / 0.18)',
            fromUser: from,
            actionMessage: t('notifications.actionMatchChallenge'),
          };
    case 'achievement': {
      const nameKey = payload.nameKey as string | undefined;
      const name = nameKey ? t(nameKey) : '';
      return {
        tag: t('notifications.achievementTag'),
        badgeLabel: 'ACHV',
        badgeColor: 'var(--state-on)',
        badgeBg: 'rgb(var(--state-on-rgb) / 0.18)',
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
        badgeColor: 'var(--state-on)',
        badgeBg: 'rgb(var(--state-on-rgb) / 0.18)',
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
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionMatchCancelled'),
      };
    case 'challenge_accepted':
      // The challenger's half of an accept (19.6): the room exists now, and they are
      // already seated in it, so the toast's one press goes to the table.
      return {
        tag: t('notifications.matchAcceptedTag'),
        badgeLabel: 'DUEL',
        badgeColor: 'var(--accent-cyan)',
        badgeBg: 'rgb(var(--accent-cyan-rgb) / 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionMatchAccepted'),
      };
    case 'match_abandoned':
      return {
        tag: t('notifications.matchAbandonedTag'),
        badgeLabel: 'LEFT',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: null,
        actionMessage: t('notifications.matchAbandonedText'),
      };
    case 'friend_removed':
      return {
        tag: t('notifications.friendRemovedTag'),
        badgeLabel: 'LINK',
        badgeColor: 'var(--accent-pink)',
        badgeBg: 'rgb(var(--accent-pink-rgb) / 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendRemoved'),
      };
    case 'friend_declined':
      return {
        tag: t('notifications.friendDeclinedTag'),
        badgeLabel: 'LINK',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendDeclined'),
      };
    case 'friend_online':
      return {
        tag: t('notifications.friendOnlineTag'),
        badgeLabel: 'ON',
        badgeColor: 'var(--state-on)',
        badgeBg: 'rgb(var(--state-on-rgb) / 0.18)',
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
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: String(payload.displayName ?? from),
        actionMessage: t('notifications.actionFriendOffline', {
          displayName: payload.displayName ?? from,
        }),
      };
    // A friend entered a match (M3's playing edge): the same transient toast shape as
    // the two above, saying what the dot now says.
    case 'friend_playing':
      return {
        tag: t('notifications.friendPlayingTag'),
        badgeLabel: 'INGAME',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: String(payload.displayName ?? from),
        actionMessage: t('notifications.actionFriendPlaying', {
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
        badgeColor: 'var(--accent-cyan)',
        badgeBg: 'rgb(var(--accent-cyan-rgb) / 0.18)',
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
        badgeColor: 'var(--accent-cyan)',
        badgeBg: 'rgb(var(--accent-cyan-rgb) / 0.18)',
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
        badgeColor: 'var(--accent-cyan)',
        badgeBg: 'rgb(var(--accent-cyan-rgb) / 0.18)',
        fromUser: null,
        actionMessage: t('notifications.actionSysBroadcast'),
      };
  }
}
