import { useTranslation } from 'react-i18next';
import { RulePage } from './RulePage';

export function RulesBoardPages({ page }: { page: number }) {
  const { t } = useTranslation();

  if (page === 3) {
    return (
      <RulePage
        headerKey="gameExtra.rulesPage3Header"
        tone="accent-cyan"
        titleKey="gameExtra.rulesPage3Title"
        bodyKeys={['gameExtra.rulesPage3Body']}
        borderLeft
      />
    );
  }

  if (page === 4) {
    return (
      <RulePage
        headerKey="gameExtra.rulesPage4Header"
        tone="state-on"
        titleKey="gameExtra.rulesPage4Title"
        bodyKeys={['gameExtra.rulesPage4Body']}
        borderLeft
      />
    );
  }

  if (page === 5) {
    return (
      <RulePage headerKey="gameExtra.rulesPage5Header" tone="accent-purple" bodyGap={12}>
        <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
          {t('gameExtra.rulesPage5Line1')}
        </p>
        <p
          style={{
            margin: 0,
            color: 'var(--accent-yellow)',
            fontWeight: 'bold',
            fontSize: '1.05rem',
            letterSpacing: '0.5px',
          }}
        >
          {t('gameExtra.rulesPage5Line2')}
        </p>
      </RulePage>
    );
  }

  return null;
}
