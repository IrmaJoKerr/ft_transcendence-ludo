import { useTranslation } from 'react-i18next';
import { PendingOffers } from '../../components/PendingOffers';
import { UserAvatar } from '../../components/UserAvatar';
import { retroAudio } from '../../utils/audio';
import type {
  BlockedRow,
  FriendRequestRow,
  FriendRow as FriendRowData,
} from '../../friendshipFeed';
import {
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_CONTROLS,
  WINDOW_BTN_MIN,
  WINDOW_BTN_MAX,
  WINDOW_BODY,
  RETRO_BTN,
} from '../../styles/tw';
import { AddFriendPanel } from './AddFriendPanel';
import { FriendRequestsPanel } from './FriendRequestsPanel';
import { FriendRow } from './FriendRow';
import { FriendsTabs } from './FriendsTabs';
import type { FriendMessage, FriendsTab } from './friendTypes';

export function FriendsWindow({
  friends,
  filteredFriends,
  blocked,
  loading,
  activeTab,
  onTab,
  filterQuery,
  onFilter,
  requests,
  searchUsername,
  onSearch,
  onAdd,
  msg,
  invitingId,
  isSent,
  onChallenge,
  onConfirm,
  onUnblock,
  onAcceptRequest,
  onDeclineRequest,
}: {
  friends: FriendRowData[];
  filteredFriends: FriendRowData[];
  blocked: BlockedRow[];
  loading: boolean;
  activeTab: FriendsTab;
  onTab: (tab: FriendsTab) => void;
  filterQuery: string;
  onFilter: (value: string) => void;
  requests: FriendRequestRow[];
  searchUsername: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
  msg: FriendMessage | null;
  invitingId: string | null;
  isSent: (id: string) => boolean;
  onChallenge: (friend: FriendRowData) => void;
  onConfirm: (kind: 'block' | 'remove', friend: FriendRowData) => void;
  onUnblock: (id: string) => void;
  onAcceptRequest: (id: string) => void;
  onDeclineRequest: (id: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <section
      className={RETRO_WINDOW}
      style={{
        width: '100%',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        minHeight: 0,
      }}
    >
      <div
        className={WINDOW_HEADER}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 18px',
          fontSize: '0.85rem',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 'bold',
            fontFamily: 'var(--font-display)',
            letterSpacing: '0.04em',
          }}
        >
          <span>{t('friends.friendsListTitle')}</span>
        </div>
        <div className={WINDOW_CONTROLS} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={WINDOW_BTN_MIN} />
          <span className={WINDOW_BTN_MAX} />
        </div>
      </div>

      <div
        className={WINDOW_BODY}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.65fr) minmax(330px, 1fr)',
          gap: 16,
          padding: '14px 18px 16px',
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'rgb(var(--bg-panel-rgb) / 0.85)',
            border: '1.5px solid rgb(var(--accent-cyan-rgb) / 0.28)',
            boxShadow:
              '0 0 16px rgb(var(--accent-cyan-rgb) / 0.08), inset 0 0 20px rgb(var(--shade-rgb) / 0.6)',
            borderRadius: 8,
            overflow: 'hidden',
            minHeight: 0,
          }}
        >
          {activeTab === 'friends' && (
            <div style={{ padding: '10px 14px 0', flexShrink: 0 }}>
              <PendingOffers />
            </div>
          )}

          <FriendsTabs
            activeTab={activeTab}
            onTab={onTab}
            filterQuery={filterQuery}
            onFilter={onFilter}
            friendsCount={friends.length}
            blockedCount={blocked.length}
          />

          <div
            className="scroll-surface"
            style={{
              padding: '12px 16px',
              flex: 1,
              overflowY: 'auto',
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {loading ? (
              <div
                style={{
                  padding: 32,
                  textAlign: 'center',
                  color: 'var(--accent-yellow)',
                  fontSize: '0.85rem',
                  fontFamily: 'var(--font-display)',
                }}
              >
                {t('friends.scanningFrequencies')}
              </div>
            ) : activeTab === 'friends' ? (
              filteredFriends.length === 0 ? (
                <div
                  style={{
                    padding: 36,
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: '0.84rem',
                    fontFamily: 'var(--font-display)',
                  }}
                >
                  {filterQuery
                    ? t('friends.noMatchingFriends', { query: filterQuery })
                    : t('friends.noFriendsTransmitPrompt')}
                </div>
              ) : (
                filteredFriends.map((friend) => (
                  <FriendRow
                    key={friend.id}
                    friend={friend}
                    inviting={invitingId === friend.id}
                    challengeSent={isSent(friend.id)}
                    onChallenge={onChallenge}
                    onConfirm={onConfirm}
                  />
                ))
              )
            ) : blocked.length === 0 ? (
              <div
                style={{
                  padding: 36,
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: '0.84rem',
                  fontFamily: 'var(--font-display)',
                }}
              >
                {t('friends.noRestrictedPilots')}
              </div>
            ) : (
              blocked.map((b) => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: 6,
                    background: 'rgb(var(--state-off-rgb) / 0.08)',
                    border: '1.5px solid rgb(var(--state-off-rgb) / 0.28)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <UserAvatar
                      username={b.username}
                      userId={b.id}
                      hasAvatarPhoto={b.hasAvatarPhoto}
                      size={38}
                      fallbackStyle={{
                        width: 38,
                        height: 38,
                        borderRadius: 4,
                        background: 'rgb(var(--bg-panel-rgb) / 0.95)',
                        color: 'var(--state-off)',
                        display: 'grid',
                        placeItems: 'center',
                        fontWeight: 900,
                      }}
                    />
                    <div>
                      <div
                        style={{
                          fontWeight: 900,
                          fontSize: '0.9rem',
                          color: 'var(--text-main)',
                          fontFamily: 'var(--font-display)',
                        }}
                      >
                        {b.displayName ?? b.username}
                      </div>
                      <div
                        style={{
                          color: 'var(--state-off)',
                          fontSize: '0.68rem',
                          fontFamily: 'var(--font-display)',
                          marginTop: 2,
                        }}
                      >
                        {t('friends.restrictedSince', {
                          date: new Date(b.blockedSince).toLocaleDateString(),
                        })}
                      </div>
                    </div>
                  </div>

                  <button
                    className={RETRO_BTN}
                    onClick={() => {
                      retroAudio.playUiBeep(640, 0.06);
                      onUnblock(b.id);
                    }}
                    style={{
                      padding: '5px 14px',
                      fontSize: '0.72rem',
                      fontFamily: 'var(--font-display)',
                      borderRadius: 4,
                    }}
                  >
                    {t('friends.unblockActionBtn')}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <AddFriendPanel
            searchUsername={searchUsername}
            onSearch={onSearch}
            onAdd={onAdd}
            msg={msg}
          />
          <FriendRequestsPanel
            requests={requests}
            onAccept={onAcceptRequest}
            onDecline={onDeclineRequest}
          />
        </div>
      </div>
    </section>
  );
}
