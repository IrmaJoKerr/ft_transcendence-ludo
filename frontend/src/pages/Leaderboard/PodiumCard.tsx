import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../../components/UserAvatar';
import { navigate } from '../../router';
import { retroAudio } from '../../utils/audio';
import { APEX_CHAMPION_CARD, DISPLAY_MEDIUM, DISPLAY_STAT, STAT_FOOTER } from '../../styles/tw';
import type { LeaderboardEntry } from './leaderboardTypes';

export function PodiumCard({ entry, rank }: { entry: LeaderboardEntry; rank: 1 | 2 | 3 }) {
  const { t } = useTranslation();
  const isApex = rank === 1;
  const accent = isApex
    ? 'var(--accent-yellow)'
    : rank === 2
      ? 'var(--accent-cyan)'
      : 'var(--accent-pink)';
  const accentRgb = rank === 2 ? 'accent-cyan' : 'accent-pink';
  const avatarSize = isApex ? 62 : 52;

  return (
    <div
      className={isApex ? APEX_CHAMPION_CARD : undefined}
      style={
        isApex
          ? {
              background: 'linear-gradient(180deg, rgba(48, 12, 38, 0.95), rgba(20, 5, 28, 0.98))',
              border: '2px solid #ff1744',
              borderRadius: 8,
              padding: '24px 26px',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }
          : {
              background: 'rgb(var(--bg-card-rgb) / 0.85)',
              border: `1.5px solid rgb(var(--${accentRgb}-rgb) / 0.45)`,
              borderRadius: 8,
              boxShadow: `0 0 18px rgb(var(--${accentRgb}-rgb) / 0.22)`,
              padding: '20px 22px',
              cursor: 'pointer',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }
      }
      onClick={() => {
        retroAudio.playUiBeep(isApex ? 750 : 600, 0.05);
        navigate(`/profile?u=${entry.username}`);
      }}
      onMouseEnter={
        isApex ? undefined : (e) => (e.currentTarget.style.transform = 'translateY(-3px)')
      }
      onMouseLeave={isApex ? undefined : (e) => (e.currentTarget.style.transform = 'translateY(0)')}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: isApex ? 18 : 16,
        }}
      >
        <div style={isApex ? { display: 'flex', alignItems: 'center', gap: 8 } : undefined}>
          <span
            style={{
              fontSize: isApex ? '1.5rem' : '1.35rem',
              fontFamily: 'var(--font-display)',
              fontWeight: 900,
              color: accent,
              ...(isApex ? { textShadow: '0 0 10px rgb(var(--accent-yellow-rgb) / 0.6)' } : {}),
            }}
          >
            #{rank}
          </span>
          {isApex && (
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--accent-yellow)',
                fontFamily: 'var(--font-display)',
                fontWeight: 900,
                letterSpacing: '0.5px',
              }}
            >
              {t('leaderboard.apexChampion')}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          style={
            isApex
              ? {
                  padding: 2.5,
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #ff1744, var(--accent-yellow))',
                  boxShadow: '0 0 16px rgba(255, 23, 68, 0.55)',
                }
              : undefined
          }
        >
          <UserAvatar
            username={entry.username}
            userId={entry.id}
            hasAvatarPhoto={entry.hasAvatarPhoto}
            size={avatarSize}
            fallbackStyle={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: isApex ? 6 : 8,
              background: isApex
                ? 'rgb(var(--bg-panel-rgb) / 0.95)'
                : 'rgb(var(--bg-panel-rgb) / 0.9)',
              color: accent,
              display: 'grid',
              placeItems: 'center',
              fontWeight: 'bold',
              fontSize: isApex ? '1.4rem' : '1.05rem',
            }}
          />
        </div>
        <div>
          {isApex ? (
            <div
              style={{
                fontSize: '1.3rem',
                fontWeight: 900,
                color: 'var(--text-main)',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.04em',
              }}
            >
              {entry.displayName ?? entry.username}
            </div>
          ) : (
            <div className={DISPLAY_MEDIUM}>{entry.displayName ?? entry.username}</div>
          )}
          {isApex ? (
            <div
              style={{
                fontSize: '1.7rem',
                fontWeight: 900,
                color: 'var(--text-main)',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.04em',
                marginTop: 2,
              }}
            >
              ♛ {entry.rating}
            </div>
          ) : (
            <div className={DISPLAY_STAT}>♛ {entry.rating}</div>
          )}
        </div>
      </div>

      <div
        className={isApex ? undefined : STAT_FOOTER}
        style={
          isApex
            ? {
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 18,
                paddingTop: 12,
                borderTop: '1px solid rgba(255, 23, 68, 0.3)',
                fontSize: '0.8rem',
                color: '#ffcad4',
                fontFamily: 'var(--font-display)',
                letterSpacing: '0.03em',
              }
            : undefined
        }
      >
        <span>
          {t('leaderboard.matchesLabel')}{' '}
          <strong
            style={isApex ? { color: 'var(--text-main)', fontSize: '0.88rem' } : undefined}
            className={isApex ? undefined : 'text-(--text-main)'}
          >
            {entry.gamesPlayed}
          </strong>
        </span>
        <span>
          {t('leaderboard.winRateLabel')}{' '}
          <strong
            style={isApex ? { color: 'var(--state-on)', fontSize: '0.88rem' } : undefined}
            className={isApex ? undefined : 'text-(--text-main)'}
          >
            {entry.winRate}%
          </strong>
        </span>
      </div>
    </div>
  );
}
