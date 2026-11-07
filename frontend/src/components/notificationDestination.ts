import type { Notification } from '../hooks/useNotifications';
import { isOfferExpired, parseNotificationPayload } from './notificationParts';

/**
 * Where a stored row sends the reader, or `null` when the row is a stamp (22.7).
 *
 * A router takes you where the state lives and clears whatever that page can
 * re-derive; a stamp is a receipt, it clears itself and goes nowhere. The string is
 * also the prune key: rows that share it are one family, so reading an achievement no
 * longer burns a match result, and a lobby offer stays one room because the code is in
 * the query.
 *
 * `display_name_changed` is absent on purpose: it is transient and never stored, so it
 * never becomes a row.
 */
export function destinationFor(n: Notification): string | null {
  switch (n.type) {
    case 'friend_request':
    case 'friend_accepted':
      return '/friends?tab=friends';
    case 'game_invite': {
      // A lapsed offer is a stamp even though its type is a router: nothing is offered
      // that cannot be accepted, and a refusal has nowhere to be printed because there
      // is nothing to refuse.
      if (isOfferExpired(n)) return null;
      const p = parseNotificationPayload(n.payload);
      // A challenge names no room until it is accepted: the page that answers offers is
      // where it is chosen deliberately.
      if (p.kind === 'challenge') return '/friends?tab=friends';
      const code = typeof p.inviteCode === 'string' ? p.inviteCode : '';
      return code ? `/gamelobby?join=${encodeURIComponent(code)}` : '/gamelobby';
    }
    case 'challenge_accepted': {
      const p = parseNotificationPayload(n.payload);
      const code = typeof p.inviteCode === 'string' ? p.inviteCode : '';
      return code ? `/gamelobby?join=${encodeURIComponent(code)}` : '/gamelobby';
    }
    case 'achievement':
      return '/profile?tab=achievements';
    case 'match_finished':
    case 'match_abandoned':
    case 'match_cancelled':
      return '/profile?tab=history';
    // Stamps: the link is severed and no page shows it; a profile receipt names its
    // detail in the row body itself.
    case 'friend_removed':
    case 'friend_declined':
    case 'profile_updated':
    default:
      return null;
  }
}
