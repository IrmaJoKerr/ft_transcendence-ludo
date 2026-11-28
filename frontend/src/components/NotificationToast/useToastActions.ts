import { useTranslation } from 'react-i18next';
import type { Notification, ToastDismissReason } from '../../hooks/useNotifications';
import { apiFetch, postApi } from '../../api';
import { navigate } from '../../router';
import { useApp, type ActiveMatch } from '../../store';
import { retroAudio } from '../../utils/audio';
import { offerMechanism, parseNotificationPayload } from '../notificationParts';

export function useToastActions({
  notification,
  onDismiss,
  dismiss,
  setActionError,
}: {
  notification: Notification;
  onDismiss: (id: string, reason: ToastDismissReason) => void;
  dismiss: () => void;
  setActionError: (message: string | null) => void;
}) {
  const { t } = useTranslation();
  const { setActiveMatch } = useApp();

  // Accept an invitation. A room invite carries the room, so the lobby claims a corner
  // from it; a challenge carries no room at all (19.6), so the accept is the request
  // that makes one — and the answer is the seat.
  const acceptInvite = async () => {
    try {
      retroAudio.playUiBeep(880, 0.08);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    if (offerMechanism(p) === 'challenge') {
      const fromId = typeof p.fromUserId === 'string' ? p.fromUserId : '';
      if (!fromId) {
        dismiss();
        return;
      }
      try {
        const seat = await postApi<NonNullable<ActiveMatch>>(
          `/api/friends/challenges/${fromId}/accept`,
          {},
        );
        setActiveMatch(seat);
        onDismiss(notification.id, 'read');
        navigate(`/game?gameId=${seat.gameId}`);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : t('friends.genericError'));
      }
      return;
    }
    // The invite carries the room, not a seat: accepting lands in the lobby with the
    // code filled in and the corner claimed there. A seat held elsewhere is left
    // alone: the lobby's lock refuses the claim and the player aborts it themselves.
    onDismiss(notification.id, 'read');
    const code = typeof p.inviteCode === 'string' ? p.inviteCode : '';
    navigate(code ? `/gamelobby?join=${encodeURIComponent(code)}` : '/gamelobby');
  };

  // Decline a challenge. The one act the refusal ladder counts: the server answers
  // with the rung it wrote, and the toast only has to go away.
  const declineInvite = async () => {
    try {
      retroAudio.playUiBeep(400, 0.05);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    const fromId = typeof p.fromUserId === 'string' ? p.fromUserId : '';
    if (offerMechanism(p) === 'challenge' && fromId) {
      try {
        await postApi(`/api/friends/challenges/${fromId}/decline`, {});
      } catch {
        // Ignore: a refusal that cannot be recorded still hides the offer.
      }
    }
    dismiss();
  };

  // Enter the table an accepted challenge made. The challenger is already seated in
  // it, so the lobby's own rejoin path is what opens the room.
  const enterTable = () => {
    try {
      retroAudio.playUiBeep(880, 0.08);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    onDismiss(notification.id, 'read');
    const code = typeof p.inviteCode === 'string' ? p.inviteCode : '';
    navigate(code ? `/gamelobby?join=${encodeURIComponent(code)}` : '/gamelobby');
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
  return { acceptInvite, declineInvite, enterTable, acceptFriend, declineFriend };
}
