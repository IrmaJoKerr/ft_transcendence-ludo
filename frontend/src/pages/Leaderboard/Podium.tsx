import { PodiumCard } from './PodiumCard';
import type { LeaderboardEntry } from './leaderboardTypes';

export function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const top1 = entries.find((e) => e.rank === 1);
  const top2 = entries.find((e) => e.rank === 2);
  const top3 = entries.find((e) => e.rank === 3);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns:
          entries.length === 1
            ? 'minmax(280px, 460px)'
            : entries.length === 2
              ? 'repeat(auto-fit, minmax(280px, 420px))'
              : 'repeat(auto-fit, minmax(280px, 1fr))',
        justifyContent: 'center',
        gap: 18,
        alignItems: 'end',
        padding: '18px 20px',
        borderRadius: 10,
        background: 'rgb(var(--bg-panel-rgb) / 0.65)',
        border: '1px solid rgb(var(--accent-cyan-rgb) / 0.25)',
        flexShrink: 0,
      }}
    >
      {top2 && <PodiumCard entry={top2} rank={2} />}
      {top1 && <PodiumCard entry={top1} rank={1} />}
      {top3 && <PodiumCard entry={top3} rank={3} />}
    </div>
  );
}
