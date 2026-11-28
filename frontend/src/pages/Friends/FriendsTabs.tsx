import { useTranslation } from 'react-i18next';
import { retroAudio } from '../../utils/audio';
import { RETRO_BTN } from '../../styles/tw';
import type { FriendsTab } from './friendTypes';

export function FriendsTabs({
  activeTab,
  onTab,
  filterQuery,
  onFilter,
  friendsCount,
  blockedCount,
}: {
  activeTab: FriendsTab;
  onTab: (tab: FriendsTab) => void;
  filterQuery: string;
  onFilter: (value: string) => void;
  friendsCount: number;
  blockedCount: number;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'linear-gradient(90deg, rgba(28, 8, 62, 0.95), rgba(16, 4, 38, 0.95))',
        borderBottom: '1px solid rgb(var(--accent-cyan-rgb) / 0.25)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 10,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <button
          className={RETRO_BTN}
          onClick={() => {
            retroAudio.playUiBeep(520, 0.04);
            onTab('friends');
          }}
          style={{
            padding: '5px 14px',
            fontSize: '0.76rem',
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            borderRadius: 4,
            color: activeTab === 'friends' ? 'var(--text-main)' : 'var(--text-muted)',
            background:
              activeTab === 'friends' ? 'rgb(var(--accent-cyan-rgb) / 0.25)' : 'transparent',
            borderColor:
              activeTab === 'friends' ? 'var(--accent-cyan)' : 'rgb(var(--ink-rgb) / 0.15)',
            boxShadow:
              activeTab === 'friends' ? '0 0 10px rgb(var(--accent-cyan-rgb) / 0.35)' : 'none',
          }}
        >
          {t('friends.tabFriendsCount', { count: friendsCount })}
        </button>
        <button
          className={RETRO_BTN}
          onClick={() => {
            retroAudio.playUiBeep(520, 0.04);
            onTab('blocked');
          }}
          style={{
            padding: '5px 14px',
            fontSize: '0.76rem',
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            borderRadius: 4,
            color: activeTab === 'blocked' ? 'var(--text-main)' : 'var(--text-muted)',
            background:
              activeTab === 'blocked' ? 'rgb(var(--state-off-rgb) / 0.22)' : 'transparent',
            borderColor:
              activeTab === 'blocked' ? 'var(--state-off)' : 'rgb(var(--ink-rgb) / 0.15)',
            boxShadow:
              activeTab === 'blocked' ? '0 0 10px rgb(var(--state-off-rgb) / 0.35)' : 'none',
          }}
        >
          {t('friends.tabBlockedCount', { count: blockedCount })}
        </button>
      </div>

      {activeTab === 'friends' && (
        <div style={{ position: 'relative' }}>
          <input
            value={filterQuery}
            onChange={(e) => onFilter(e.target.value)}
            placeholder={t('friends.searchFriendsInput')}
            style={{
              background: 'rgba(5, 2, 18, 0.85)',
              border: '1px solid rgb(var(--accent-cyan-rgb) / 0.35)',
              borderRadius: 4,
              color: 'var(--text-main)',
              padding: '4px 10px',
              fontSize: '0.72rem',
              fontFamily: 'var(--font-display)',
              width: 170,
            }}
          />
        </div>
      )}
    </div>
  );
}
