import { useTranslation } from 'react-i18next';
import { HERO_SECTION, HERO_TITLE } from '../../styles/tw';

export function LobbyHeader({ guest }: { guest: boolean }) {
  const { t } = useTranslation();
  return (
    <header className={HERO_SECTION} style={{ padding: '16px 0 14px', textAlign: 'center' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        }}
      >
        <h1
          className={HERO_TITLE}
          style={{ fontSize: '1.75rem', marginBottom: 4, textAlign: 'center' }}
        >
          {guest ? t('guest.setupTitle') : t('lobby.arenaMatchConfig')}
        </h1>

        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 22px',
            borderRadius: 4,
            background: 'rgb(var(--accent-cyan-rgb) / 0.15)',
            border: '1px solid var(--accent-cyan)',
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--accent-cyan)',
              boxShadow: '0 0 6px var(--accent-cyan)',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '0.82rem',
              color: 'var(--text-main)',
              letterSpacing: '0.5px',
            }}
          >
            {t('lobby.arenaLobbyReady')}
          </span>
        </div>

        <div
          style={{
            width: '100%',
            maxWidth: 740,
            padding: '10px 16px',
            background: 'rgb(var(--shade-rgb) / 0.6)',
            border: '1px solid rgb(var(--accent-cyan-rgb) / 0.35)',
            borderRadius: 4,
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.9rem',
            color: 'var(--accent-cyan)',
          }}
        >
          {t('lobby.arenaSubtitle')}
        </div>
      </div>
    </header>
  );
}
