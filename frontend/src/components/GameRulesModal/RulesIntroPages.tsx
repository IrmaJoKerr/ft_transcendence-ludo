import { useTranslation } from 'react-i18next';
import { RulePage } from './RulePage';

const ROW = { display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' } as const;

export function RulesIntroPages({ page }: { page: number }) {
  const { t } = useTranslation();

  if (page === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          fontSize: '0.95rem',
          lineHeight: 1.6,
        }}
      >
        <div
          style={{
            color: 'var(--accent-pink)',
            fontWeight: 'bold',
            fontFamily: 'var(--font-mono)',
            fontSize: '1.05rem',
            letterSpacing: '0.5px',
          }}
        >
          {t('gameExtra.rulesPage0Header')}
        </div>
        <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
          {t('gameExtra.rulesPage0Body')}
        </p>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            background: 'rgba(5, 2, 18, 0.65)',
            padding: 14,
            borderRadius: 6,
            border: '1px solid rgb(var(--accent-pink-rgb) / 0.3)',
          }}
        >
          <div
            style={{
              color: 'var(--accent-cyan)',
              fontWeight: 'bold',
              fontSize: '0.85rem',
              letterSpacing: '0.5px',
            }}
          >
            {t('gameExtra.rulesCombatControls')}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {t('gameExtra.rulesRollDiceLabel')}
            </span>
            <span
              style={{
                color: 'var(--text-main)',
                fontFamily: 'var(--font-mono)',
                background: 'rgb(var(--accent-cyan-rgb) / 0.2)',
                padding: '3px 10px',
                borderRadius: 4,
                border: '1px solid var(--accent-cyan)',
                fontWeight: 'bold',
                fontSize: '0.85rem',
              }}
            >
              {t('gameExtra.spacebarKey')}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {t('gameExtra.rulesSelectWarpLabel')}
            </span>
            <span
              style={{
                color: 'var(--text-main)',
                fontFamily: 'var(--font-mono)',
                background: 'rgb(var(--accent-pink-rgb) / 0.2)',
                padding: '3px 10px',
                borderRadius: 4,
                border: '1px solid var(--accent-pink)',
                fontWeight: 'bold',
                fontSize: '0.85rem',
              }}
            >
              {t('gameExtra.leftClickKey')}
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (page === 1) {
    return (
      <RulePage headerKey="gameExtra.rulesPage1Header" tone="accent-yellow" borderLeft bodyGap={12}>
        <div style={ROW}>
          <span style={{ color: 'var(--accent-yellow)', fontSize: '1.2rem' }}>⚡</span>
          <span>{t('gameExtra.rulesPage1Line1')}</span>
        </div>
        <div style={ROW}>
          <span style={{ color: 'var(--accent-yellow)', fontSize: '1.2rem' }}>🚀</span>
          <span>{t('gameExtra.rulesPage1Line2')}</span>
        </div>
        <div style={ROW}>
          <span style={{ color: 'var(--state-off)', fontSize: '1.2rem' }}>⛔</span>
          <span>{t('gameExtra.rulesPage1Line3')}</span>
        </div>
      </RulePage>
    );
  }

  if (page === 2) {
    return (
      <RulePage
        headerKey="gameExtra.rulesPage2Header"
        tone="accent-pink"
        introKey="gameExtra.rulesPage2Intro"
        borderLeft
        bodyGap={12}
      >
        <div style={ROW}>
          <span style={{ color: 'var(--accent-pink)', fontSize: '1.2rem' }}>⚔</span>
          <span>{t('gameExtra.rulesPage2Line1')}</span>
        </div>
        <div style={ROW}>
          <span style={{ color: 'var(--state-on)', fontSize: '1.2rem' }}>✦</span>
          <span>{t('gameExtra.rulesPage2Line2')}</span>
        </div>
      </RulePage>
    );
  }

  return null;
}
