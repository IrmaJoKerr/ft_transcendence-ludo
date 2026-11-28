import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ColorPaletteModal } from '../../components/ColorPaletteModal';
import { ConfirmActionModal } from '../../components/ConfirmActionModal';
import { NavDock } from '../../components/NavDock';
import { useRoute } from '../../router';
import { useChallenges } from '../../hooks/useChallenges';
import { useFriendships } from '../../hooks/useFriendships';
import { SEAT_COLORS } from '../../theme';
import { CRT_SCREEN } from '../../styles/tw';
import { FriendsHeader } from './FriendsHeader';
import { FriendsWindow } from './FriendsWindow';
import type { ConfirmRow, FriendMessage } from './friendTypes';
import { useFriendActions } from './useFriendActions';

export function Friends() {
  const { t } = useTranslation();

  // **CRT CONTROLS**
  // Read once at mount: the CRT look is a page-level choice, not a dock control.
  const [crtEnabled] = useState(() => localStorage.getItem('retro_crt') !== 'false');

    // STATE MANAGEMENT: one initial read, then `friendship:changed` drives all three lists
  // (socket D2).
  const {
    friends: friendRows,
    requests: requestRows,
    blocked,
    loading,
    refresh,
  } = useFriendships();
  const requests = requestRows.received;
  const friends = useMemo(
    () =>
      [...friendRows].sort((a, b) => {
        // Sort online/in-game first, then by rating descending
        const isOnlineA = a.status === 'online' || a.status === 'playing' ? 1 : 0;
        const isOnlineB = b.status === 'online' || b.status === 'playing' ? 1 : 0;
        if (isOnlineA !== isOnlineB) return isOnlineB - isOnlineA;
        return (b.rating || 0) - (a.rating || 0);
      }),
    [friendRows],
  );
    // The bell's destinations name the tab (22.7 item 3): `? tab=friends` is the initial value, and a
  // later change is adjusted during render because the bell is a portal — a second click while
  // already here changes only the query, not the page.
  const { query } = useRoute();
  const tabParam = query.get('tab');
  const wantedTab = tabParam === 'friends' || tabParam === 'blocked' ? tabParam : null;
  const [activeTab, setActiveTab] = useState<'friends' | 'blocked'>(wantedTab ?? 'friends');
  const [seenTab, setSeenTab] = useState(wantedTab);
  if (wantedTab !== seenTab) {
    setSeenTab(wantedTab);
    if (wantedTab) setActiveTab(wantedTab);
  }
  const [filterQuery, setFilterQuery] = useState('');
  const [searchUsername, setSearchUsername] = useState('');
  const [msg, setMsg] = useState<FriendMessage | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  // The friend being challenged, while the inviter picks the corner they will host
  // in. The room does not exist until a colour is picked, so the pick comes first.
  const [paletteFriendId, setPaletteFriendId] = useState<string | null>(null);
  // The one challenge route and the server's own list behind the grey state: an invite
  // this account already has out reads grey here after a reload, with no client window.
  const { isSent, challenge } = useChallenges();
  // The row waiting on a confirm. BLOCK and REMOVE are the two presses on this screen
  // that cannot be undone from it, so neither fires on the first press.
  const [confirmRow, setConfirmRow] = useState<ConfirmRow | null>(null);

  const {
    handleAddFriend,
    handleAccept,
    handleDecline,
    handleInvite,
    handleRemove,
    handleBlock,
    handleUnblock,
  } = useFriendActions({
    friends,
    refresh,
    setMsg,
    setSearchUsername,
    setInvitingId,
    challenge,
  });

  const onlineFriendsCount = friends.filter(
    (f) => f.status === 'online' || f.status === 'playing',
  ).length;
  const filteredFriends = friends.filter((f) =>
    f.username.toLowerCase().includes(filterQuery.toLowerCase().trim()),
  );

  return (
    <>
      {/* CRT Monitor Overlay FX Container */}
      <div
        className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''}`}
        id="crtScreen"
        style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Dynamic Full-Width Seated Sidebar & Content Layout Container */}
        <div className="page-fit-shell relative z-10 box-border flex min-h-screen w-full flex-row items-start justify-center gap-7 px-6 py-8">
          {/* Left-Seated Navigation Dock */}
          <NavDock activeRoute="/friends" />

          {/* Main Content Flow */}
          <div
            className="page-fit-column sticky top-8 w-full min-w-0 flex-1"
            style={{ margin: 0, padding: 0 }}
          >
            {/* Top Hero Banner */}
            <FriendsHeader
              onlineFriendsCount={onlineFriendsCount}
              friendsCount={friends.length}
              requestsCount={requests.length}
              blockedCount={blocked.length}
            />

            <FriendsWindow
              friends={friends}
              filteredFriends={filteredFriends}
              blocked={blocked}
              loading={loading}
              activeTab={activeTab}
              onTab={setActiveTab}
              filterQuery={filterQuery}
              onFilter={setFilterQuery}
              requests={requests}
              searchUsername={searchUsername}
              onSearch={setSearchUsername}
              onAdd={() => void handleAddFriend(searchUsername)}
              msg={msg}
              invitingId={invitingId}
              isSent={isSent}
              onChallenge={(friend) => {
                setMsg(null);
                setPaletteFriendId(friend.id);
              }}
              onConfirm={(kind, friend) => {
                setConfirmRow({
                  kind,
                  id: friend.id,
                  name: friend.displayName ?? friend.username,
                });
              }}
              onUnblock={(id) => void handleUnblock(id)}
              onAcceptRequest={(id) => void handleAccept(id)}
              onDeclineRequest={(id) => void handleDecline(id)}
            />
          </div>
        </div>
      </div>

      {/* The corner picker. A duel seats this caller first when the friend accepts, so
          they claim the corner they will host in before anything is sent; the friend
          takes the first free one at that accept (19.6). */}

      {paletteFriendId !== null && (
        <ColorPaletteModal
          isOpen
          title={t('lobby.pickColorTitle')}
          colors={SEAT_COLORS}
          onPick={(color) => {
            const friendId = paletteFriendId;
            setPaletteFriendId(null);
            void handleInvite(friendId, color);
          }}
          onCancel={() => setPaletteFriendId(null)}
        />
      )}

      {/* One gate for the two presses on a row that cannot be undone from here: the
          same `ConfirmActionModal` the chat's name card blocks through, so the
          question, the keyboard shortcuts and the danger styling are one component. */}
      {confirmRow && (
        <ConfirmActionModal
          isOpen
          title={t(confirmRow.kind === 'block' ? 'friends.blockTitle' : 'friends.removeTitle')}
          message={t(
            confirmRow.kind === 'block' ? 'friends.blockConfirm' : 'friends.removeConfirm',
            { name: confirmRow.name },
          )}
          subMessage={t(
            confirmRow.kind === 'block' ? 'friends.blockSubMessage' : 'friends.removeSubMessage',
          )}
          proceedLabel={t(
            confirmRow.kind === 'block' ? 'friends.blockProceed' : 'friends.removeProceed',
          )}
          cancelLabel={t('common.cancel')}
          onCancel={() => setConfirmRow(null)}
          onProceed={() => {
            const action = confirmRow;
            setConfirmRow(null);
            void (action.kind === 'block' ? handleBlock(action.id) : handleRemove(action.id));
          }}
        />
      )}
    </>
  );
}
