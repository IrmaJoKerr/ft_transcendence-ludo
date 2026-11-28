import { useTranslation } from 'react-i18next';
import { RulePage } from './RulePage';

export function RulesModePages({ page }: { page: number }) {
  const { t } = useTranslation();

  if (page === 6) {
    return (
      <RulePage
        headerKey="gameExtra.rulesPage6Header"
        tone="accent-yellow"
        titleKey="gameExtra.rulesPage6Title"
        bodyKeys={['gameExtra.rulesPage6Body']}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            borderLeft: '3px solid rgb(var(--accent-yellow-rgb) / 0.35)',
            paddingLeft: 10,
          }}
        >
          {[1, 2, 3, 4].map((step) => (
            <div key={step} style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>
              {t(`gameExtra.rulesPage6Step${step}`)}
            </div>
          ))}
        </div>
        {['rulesPage6Chain', 'rulesPage6KeyShift'].map((key) => (
          <p key={key} style={{ margin: 0, color: '#f0f0f0', fontSize: '0.9rem' }}>
            {t(`gameExtra.${key}`)}
          </p>
        ))}
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          {t('gameExtra.rulesPage6Touch')}
        </p>
      </RulePage>
    );
  }

  if (page === 7) {
    return (
      <RulePage
        headerKey="gameExtra.rulesPage7Header"
        tone="state-off"
        titleKey="gameExtra.rulesPage7Title"
        bodyKeys={['gameExtra.rulesPage7Body', 'gameExtra.rulesPage7Body2']}
        borderAlpha="0.25"
      />
    );
  }

  if (page === 8) {
    return (
      <RulePage
        headerKey="gameExtra.rulesPage8Header"
        tone="accent-cyan"
        titleKey="gameExtra.rulesPage8Title"
        bodyKeys={['gameExtra.rulesPage8Body', 'gameExtra.rulesPage8Body2']}
        borderAlpha="0.25"
      />
    );
  }

  if (page === 9) {
    return (
      <RulePage
        headerKey="gameExtra.rulesPage9Header"
        tone="accent-cyan"
        titleKey="gameExtra.rulesPage9Title"
        bodyKeys={['gameExtra.rulesPage9Body', 'gameExtra.rulesPage9Body2']}
        borderAlpha="0.25"
      />
    );
  }

  return null;
}
