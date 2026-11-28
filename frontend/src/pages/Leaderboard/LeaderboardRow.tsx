import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../../components/UserAvatar';
import { navigate } from '../../router';
import { retroAudio } from '../../utils/audio';
import type { LeaderboardEntry } from './leaderboardTypes';

export function LeaderboardRow({ entry, isYou }: { entry: LeaderboardEntry; isYou: boolean }) {
  const { t } = useTranslation();
  const isRankOne = entry.rank === 1;
  const isTopThree = entry.rank <= 3;
  const rankMedal = `#${entry.rank}`;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '0.8fr 2.5fr 1.2fr 1.2fr 1fr',
        gap: 20,
        padding: isRankOne ? '20px 28px' : isTopThree ? '16px 28px' : '14px 28px',
        borderBottom: isRankOne
          ? '2.5px solid rgba(255, 23, 68, 0.6)'
          : '1px solid rgb(var(--ink-rgb) / 0.08)',
        alignItems: 'center',
        background: isRankOne
          ? isYou
            ? 'linear-gradient(90deg, rgb(var(--accent-pink-rgb) / 0.3), rgba(255, 23, 68, 0.2))'
            : 'linear-gradient(90deg, rgba(255, 23, 68, 0.18), rgba(255, 215, 0, 0.08))'
          : isYou
            ? 'rgb(var(--accent-pink-rgb) / 0.18)'
            : 'transparent',
        boxShadow: isRankOne
          ? '0 0 22px rgba(255, 23, 68, 0.25)'
          : isYou
            ? 'inset 0 0 15px rgb(var(--accent-pink-rgb) / 0.15)'
            : 'none',
        transition: 'all 0.2s ease',
        cursor: 'pointer',
      }}
      onClick={() => {
        retroAudio.playUiBeep(640, 0.04);
        navigate(`/profile?u=${entry.username}`);
      }}
      onMouseEnter={(e) => {
        if (!isYou && !isRankOne)
          e.currentTarget.style.background = 'rgb(var(--accent-cyan-rgb) / 0.1)';
      }}
      onMouseLeave={(e) => {
        if (!isYou && !isRankOne) e.currentTarget.style.background = 'transparent';
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span
          style={{
            fontWeight: 900,
            fontSize: isRankOne ? '1.8rem' : entry.rank <= 3 ? '1.35rem' : '1rem',
            color: isRankOne
              ? 'var(--accent-yellow)'
              : entry.rank === 2
                ? 'var(--accent-cyan)'
                : entry.rank === 3
                  ? 'var(--accent-pink)'
                  : 'var(--text-main)',
            fontFamily: 'var(--font-display)',
            letterSpacing: '0.03em',
            textAlign: 'left',
          }}
        >
          {rankMedal}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: isRankOne ? 16 : 14 }}>
        <UserAvatar
          username={entry.username}
          userId={entry.id}
          hasAvatarPhoto={entry.hasAvatarPhoto}
          size={isRankOne ? 50 : isTopThree ? 40 : 36}
          fallbackStyle={{
            width: isRankOne ? 50 : isTopThree ? 40 : 36,
            height: isRankOne ? 50 : isTopThree ? 40 : 36,
            borderRadius: 6,
            background: 'rgb(var(--bg-panel-rgb) / 0.9)',
            color: 'var(--accent-cyan)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 'bold',
            fontSize: isRankOne ? '1.1rem' : '0.85rem',
          }}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: isRankOne ? 900 : 700,
              fontSize: isRankOne ? '1.15rem' : isTopThree ? '1.02rem' : '0.95rem',
              color: 'var(--text-main)',
              fontFamily: 'var(--font-display)',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {entry.displayName ?? entry.username}{' '}
            {isYou && (
              <span
                style={{
                  color: 'var(--accent-pink)',
                  fontSize: '0.78rem',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t('leaderboard.youBadge')}
              </span>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          fontWeight: 900,
          fontSize: isRankOne ? '1.45rem' : isTopThree ? '1.2rem' : '1.05rem',
          color: 'var(--text-main)',
          fontFamily: 'var(--font-display)',
          letterSpacing: '0.04em',
        }}
      >
        ♛ {entry.rating}
      </div>

      <div
        style={{
          color: 'var(--text-main)',
          fontSize: isRankOne ? '0.98rem' : '0.88rem',
          fontFamily: 'var(--font-display)',
          letterSpacing: '0.03em',
        }}
      >
        {t('leaderboard.matchesCount', { count: entry.gamesPlayed })}
      </div>

      <div
        style={{
          textAlign: 'right',
          fontWeight: 900,
          fontSize: isRankOne ? '1.15rem' : '0.98rem',
          color: 'var(--text-main)',
          fontFamily: 'var(--font-display)',
          letterSpacing: '0.03em',
        }}
      >
        {entry.winRate}%
      </div>
    </div>
  );
}
