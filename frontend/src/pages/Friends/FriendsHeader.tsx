import { useTranslation } from 'react-i18next';
import { HERO_SECTION, HERO_TITLE, BADGE_BAR, RETRO_BADGE } from '../../styles/tw';

export function FriendsHeader({
  onlineFriendsCount,
  friendsCount,
  requestsCount,
  blockedCount,
}: {
  onlineFriendsCount: number;
  friendsCount: number;
  requestsCount: number;
  blockedCount: number;
}) {
  const { t } = useTranslation();
  return (
    <header
      className={HERO_SECTION}
      style={{ marginTop: 0, padding: '16px 0 16px', marginBottom: 12, flexShrink: 0 }}
    >
      <h1 className={HERO_TITLE} style={{ fontSize: '1.45rem', margin: 0, letterSpacing: '1.5px' }}>
        {t('friends.networkTitle')}
      </h1>

      <div
        className={BADGE_BAR}
        style={{
          marginTop: 10,
          display: 'flex',
          justifyContent: 'center',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <span
          className={RETRO_BADGE}
          style={{
            border: '1px solid var(--state-on)',
            color: 'var(--state-on)',
            background: 'rgb(var(--state-on-rgb) / 0.12)',
            boxShadow: '0 0 10px rgb(var(--state-on-rgb) / 0.25)',
            fontSize: '0.74rem',
            padding: '4px 12px',
            borderRadius: 4,
            fontFamily: 'var(--font-display)',
            fontWeight: 'bold',
          }}
        >
          {t('friends.badgeOnline', { count: onlineFriendsCount })}
        </span>
        <span
          className={RETRO_BADGE}
          style={{
            border: '1px solid var(--accent-cyan)',
            color: 'var(--accent-cyan)',
            background: 'rgb(var(--accent-cyan-rgb) / 0.12)',
            fontSize: '0.74rem',
            padding: '4px 12px',
            borderRadius: 4,
            fontFamily: 'var(--font-display)',
            fontWeight: 'bold',
          }}
        >
          {t('friends.badgeFriends', { count: friendsCount })}
        </span>
        <span
          className={RETRO_BADGE}
          style={{
            border:
              requestsCount > 0
                ? '1.5px solid var(--accent-pink)'
                : '1px dashed rgb(var(--ink-rgb) / 0.2)',
            color: requestsCount > 0 ? 'var(--accent-pink)' : 'var(--text-muted)',
            background: requestsCount > 0 ? 'rgb(var(--accent-pink-rgb) / 0.18)' : 'transparent',
            boxShadow: requestsCount > 0 ? '0 0 14px rgb(var(--accent-pink-rgb) / 0.4)' : 'none',
            fontSize: '0.74rem',
            padding: '4px 12px',
            borderRadius: 4,
            fontFamily: 'var(--font-display)',
            fontWeight: 'bold',
          }}
        >
          {t('friends.badgeRequests', { count: requestsCount })}
        </span>
        {blockedCount > 0 && (
          <span
            className={RETRO_BADGE}
            style={{
              border: '1px solid rgb(var(--state-off-rgb) / 0.4)',
              color: 'var(--state-off)',
              background: 'rgb(var(--state-off-rgb) / 0.1)',
              fontSize: '0.74rem',
              padding: '4px 12px',
              borderRadius: 4,
              fontFamily: 'var(--font-display)',
              fontWeight: 'bold',
            }}
          >
            {t('friends.badgeBlocked', { count: blockedCount })}
          </span>
        )}
      </div>
    </header>
  );
}
