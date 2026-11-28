import { useTranslation } from 'react-i18next';
import { fetchWithCsrf, translateErrorCode } from '../../api';
import type { FriendRow } from '../../friendshipFeed';
import type { ColorKey } from '../../theme';
import { retroAudio } from '../../utils/audio';
import type { FriendMessage } from './friendTypes';

export function useFriendActions({
  friends,
  refresh,
  setMsg,
  setSearchUsername,
  setInvitingId,
  challenge,
}: {
  friends: FriendRow[];
  refresh: () => void;
  setMsg: (message: FriendMessage | null) => void;
  setSearchUsername: (value: string) => void;
  setInvitingId: (id: string | null) => void;
  challenge: (
    friend: { id: string; name: string },
    options: { hostColor: ColorKey },
  ) => Promise<{ ok: boolean; message?: string }>;
}) {
  const { t } = useTranslation();

  const fetchData = () => {
    refresh();
  };

  const handleAddFriend = async (searchUsername: string) => {
    setMsg(null);
    const target = searchUsername.trim();
    if (!target) return;

    try {
      const userRes = await fetch(`/api/user/${target}`);
      if (!userRes.ok) {
        retroAudio.playUiBeep(320, 0.08);
        setMsg({ text: t('friends.userNotFound'), type: 'error' });
        return;
      }
      const userData = await userRes.json();

      const reqRes = await fetchWithCsrf(`/api/friends/request/${userData.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'include',
      });
      if (!reqRes.ok) {
        const errorData: { code?: string; message?: string } | null = await reqRes
          .json()
          .catch(() => null);
        const localized = translateErrorCode(errorData?.code);
        if (!localized && errorData?.message) console.error('[friends]', errorData.message);
        const errorMsg = localized ?? t('friends.couldNotSendRequest');
        retroAudio.playUiBeep(320, 0.08);
        setMsg({ text: errorMsg, type: 'error' });
        return;
      }

      retroAudio.playUiBeep(880, 0.06);
      setMsg({ text: t('friends.requestSent'), type: 'success' });
      setSearchUsername('');
      fetchData();
    } catch {
      retroAudio.playUiBeep(320, 0.08);
      setMsg({ text: t('friends.genericError'), type: 'error' });
    }
  };

  const handleAccept = async (requestId: string) => {
    retroAudio.playUiBeep(880, 0.06);
    await fetchWithCsrf(`/api/friends/accept/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });
    fetchData();
  };

  const handleDecline = async (requestId: string) => {
    retroAudio.playUiBeep(440, 0.06);
    await fetchWithCsrf(`/api/friends/decline/${requestId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });
    fetchData();
  };

  const handleInvite = async (friendId: string, hostColor: ColorKey) => {
    setInvitingId(friendId);
    setMsg(null);
    retroAudio.playUiBeep(780, 0.06);
    const friend = friends.find((row) => row.id === friendId);
    const name = friend?.displayName ?? friend?.username ?? friendId;
    const outcome = await challenge({ id: friendId, name }, { hostColor });
    if (!outcome.ok) {
      setMsg({
        text: outcome.message ?? t('friends.genericError'),
        type: 'error',
      });
      setInvitingId(null);
      return;
    }
    retroAudio.playUiBeep(880, 0.06);
    setMsg({ text: t('friends.challengeSent', { name }), type: 'success' });
    setInvitingId(null);
  };

  const handleRemove = async (friendId: string) => {
    retroAudio.playUiBeep(440, 0.06);
    await fetchWithCsrf(`/api/friends/remove/${friendId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });
    fetchData();
  };

  const handleBlock = async (friendId: string) => {
    retroAudio.playUiBeep(320, 0.08);
    await fetchWithCsrf(`/api/friends/block/${friendId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });
    fetchData();
  };

  const handleUnblock = async (targetUserId: string) => {
    retroAudio.playUiBeep(640, 0.06);
    await fetchWithCsrf(`/api/friends/unblock/${targetUserId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      credentials: 'include',
    });
    fetchData();
  };

  return {
    handleAddFriend,
    handleAccept,
    handleDecline,
    handleInvite,
    handleRemove,
    handleBlock,
    handleUnblock,
  };
}
