// The data half of a notification row: the tag table, the payload guard and the age.

// How a game reached this account (22.9).
export type OfferMechanism = 'challenge' | 'room';

// Read, not inferred: both senders have written `kind` into the payload since 19.6, and the
// pending record carries the same field.
export function offerMechanism(payload: Record<string, unknown>): OfferMechanism {
  return payload.kind === 'room' ? 'room' : 'challenge';
}

// The word the row prints. The strip has room for the word, the toast's badge has
// room for six characters — `DUEL`/`INVITE` fit both, and neither is a claim about
// the table that is about to be built.
export function offerMechanismLabel(mechanism: OfferMechanism): 'DUEL' | 'INVITE' {
  return mechanism === 'room' ? 'INVITE' : 'DUEL';
}

// A stored type's bracketed tag. `transient` types (presence, a display-name or avatar change)
// never reach the bell, but the default arm keeps an unknown type printable instead of blank.
export function getNotificationTypeBadge(
  type: string,
  payload: Record<string, unknown> = {},
): {
  tagKey: string;
  defaultTag: string;
  color: string;
} {
  switch (type) {
    case 'game_invite':
      return offerMechanism(payload) === 'room'
        ? {
            tagKey: 'notifications.matchInviteTag',
            defaultTag: '[MATCH_INVITE]',
            color: 'var(--accent-cyan)',
          }
        : {
            tagKey: 'notifications.matchChallengeTag',
            defaultTag: '[MATCH_CHALLENGE]',
            color: 'var(--accent-cyan)',
          };
    case 'challenge_accepted':
      return {
        tagKey: 'notifications.matchAcceptedTag',
        defaultTag: '[CHALLENGE_ACCEPTED]',
        color: 'var(--accent-cyan)',
      };
    case 'friend_request':
      return {
        tagKey: 'notifications.linkReqTag',
        defaultTag: '[FRIEND_REQ]',
        color: 'var(--accent-pink)',
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
        color: 'var(--state-on)',
      };
    case 'match_finished':
      return {
        tagKey: 'notifications.matchEndTag',
        defaultTag: '[MATCH_COMPLETE]',
        color: 'var(--state-on)',
      };
    case 'match_cancelled':
      return {
        tagKey: 'notifications.matchCancelledTag',
        defaultTag: '[MATCH_ABORTED]',
        color: 'var(--accent-yellow, #ffe600)',
      };
    case 'match_abandoned':
      return {
        tagKey: 'notifications.matchAbandonedTag',
        defaultTag: '[MATCH_LEFT]',
        color: 'var(--accent-yellow, #ffe600)',
      };
    case 'friend_removed':
      return {
        tagKey: 'notifications.friendRemovedTag',
        defaultTag: '[LINK_SEVERED]',
        color: 'var(--accent-pink)',
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
        defaultTag: '[SQUAD_LEADER_ONLINE]',
        color: 'var(--state-on)',
      };
    case 'friend_offline':
      return {
        tagKey: 'notifications.friendOfflineTag',
        defaultTag: '[SQUAD_LEADER_OFFLINE]',
        color: 'var(--accent-yellow, #ffe600)',
      };
    case 'profile_updated':
      return {
        tagKey: 'notifications.profileUpdatedTag',
        defaultTag: '[PROFILE_UPDATED]',
        color: 'var(--accent-cyan)',
      };
    case 'display_name_changed':
      return {
        tagKey: 'notifications.displayNameChangedTag',
        defaultTag: '[CALLSIGN_CHANGED]',
        color: 'var(--accent-cyan)',
      };
    default:
      return {
        tagKey: 'notifications.sysBroadcastTag',
        defaultTag: '[SYS_MSG]',
        color: 'var(--accent-cyan)',
      };
  }
}

// Notification.payload is typed as an object, but the backend historically sent
// a JSON string for some rows. Keep the defensive parse for old/streamed rows.
export function parseNotificationPayload(raw: Record<string, unknown>): Record<string, unknown> {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return raw;
}

// The row's own clock: a live list with no age is a list with no urgency.
export function notificationAge(
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

// An offer's own life rides its notification (`expiresAt`, 22.6 item 6), so a row can
// say it has lapsed without asking the server anything.
export function isOfferExpired(notification: { payload: Record<string, unknown> }): boolean {
  const expiresAt = parseNotificationPayload(notification.payload).expiresAt;
  return typeof expiresAt === 'number' && Date.now() > expiresAt;
}

// A pending offer is lapsed for either of two reasons (22.9): its own stamp has gone by, or the
// room it points at started or ended under it — which the server already judged when it answered
// `expired`, because only the match hash knows.
export function isPendingOfferLapsed(offer: { expiresAt?: number; expired?: boolean }): boolean {
  if (offer.expired === true) return true;
  return typeof offer.expiresAt === 'number' && Date.now() > offer.expiresAt;
}
