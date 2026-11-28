import type { PresenceStatus } from '../../theme';

export const STATUS_KEYS: Record<PresenceStatus, string> = {
  online: 'friends.online',
  playing: 'friends.inGame',
  offline: 'friends.offline',
};

export type FriendsTab = 'friends' | 'blocked';

export type FriendMessage = { text: string; type: 'error' | 'success' };

export type ConfirmRow = {
  kind: 'block' | 'remove';
  id: string;
  name: string;
};
