import { useTranslation } from 'react-i18next';
import { LeaderboardRow } from './LeaderboardRow';
import type { LeaderboardEntry } from './leaderboardTypes';

export function LadderTable({
  entries,
  loading,
  username,
}: {
  entries: LeaderboardEntry[] | null;
  loading: boolean;
  username?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        border: '1.5px solid rgb(var(--accent-cyan-rgb) / 0.3)',
        borderRadius: 6,
        background: 'rgba(5, 2, 18, 0.9)',
        overflow: 'hidden',
        boxShadow: 'inset 0 0 20px rgb(var(--shade-rgb) / 0.5)',
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
      }}
    >
      <div className="scroll-surface" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {/* The header is the scroller's first sticky child, so it reserves the
            same stable gutter as the rows and cannot drift off their columns. */}
        <div
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            display: 'grid',
            gridTemplateColumns: '0.8fr 2.5fr 1.2fr 1.2fr 1fr',
            gap: 20,
            padding: '14px 28px',
            background: 'rgb(var(--bg-card-rgb) / 0.98)',
            borderBottom: '1.5px solid rgb(var(--accent-cyan-rgb) / 0.3)',
            fontSize: '0.82rem',
            fontWeight: 900,
            color: 'var(--accent-cyan)',
            fontFamily: 'var(--font-display)',
            textTransform: 'uppercase',
            letterSpacing: '1.2px',
          }}
        >
          <div>{t('leaderboard.colRank')}</div>
          <div>{t('leaderboard.colPlayer')}</div>
          <div>{t('leaderboard.colRating')}</div>
          <div>{t('leaderboard.colMatches')}</div>
          <div style={{ textAlign: 'right' }}>{t('leaderboard.colWinRate')}</div>
        </div>
        {loading ? (
          <div
            style={{
              padding: '48px 0',
              textAlign: 'center',
              color: 'var(--accent-yellow)',
              fontSize: '0.95rem',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {t('leaderboard.accessingTelemetry')}
          </div>
        ) : !entries || entries.length === 0 ? (
          <div
            style={{
              padding: '48px 0',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.95rem',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {t('leaderboard.noRecords')}
          </div>
        ) : (
          entries.map((entry) => (
            <LeaderboardRow
              key={entry.rank}
              entry={entry}
              isYou={entry.username === username}
            />
          ))
        )}
      </div>
    </div>
  );
}
