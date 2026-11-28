import { useTranslation } from 'react-i18next';
import { HERO_SECTION, HERO_TITLE, HERO_SUBTITLE, BADGE_BAR, RETRO_BADGE } from '../../styles/tw';

export function LudoLobbyHeader({
  roomsCount,
  userName,
  lockedByActiveGame,
}: {
  roomsCount: number;
  userName?: string;
  lockedByActiveGame: boolean;
}) {
  const { t } = useTranslation();
  return (
    <header className={HERO_SECTION} style={{ marginTop: 0, padding: '16px 0 14px' }}>
      <h1 className={HERO_TITLE} style={{ fontSize: '1.45rem', marginBottom: 4 }}>
        {t('ludoLobbyExtra.heroTitle')}
      </h1>
      <p className={HERO_SUBTITLE} style={{ fontSize: '0.75rem', marginBottom: 0 }}>
        {t('ludoLobbyExtra.heroSubtitle')}
      </p>

      <div className={BADGE_BAR} style={{ marginTop: 12 }}>
        <span
          className={RETRO_BADGE}
          style={{
            border: '1px solid var(--accent-cyan)',
            color: 'var(--accent-cyan)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {t('ludoLobbyExtra.activeSectors', { count: roomsCount })}
        </span>
        <span className={`${RETRO_BADGE} border border-(--state-on) text-(--state-on)`}>
          {t('ludoLobbyExtra.pilotLabel', {
            name: userName?.toUpperCase() ?? t('ludoLobbyExtra.guestFallback'),
          })}
        </span>
        <span
          className={RETRO_BADGE}
          style={{
            border: lockedByActiveGame
              ? '1px solid var(--accent-yellow)'
              : '1px dashed rgb(var(--ink-rgb) / 0.2)',
            color: lockedByActiveGame ? 'var(--accent-yellow)' : 'var(--text-soft)',
          }}
        >
          {t('ludoLobbyExtra.activeRoomLabel', {
            status: lockedByActiveGame
              ? t('ludoLobbyExtra.activeRoomYes')
              : t('ludoLobbyExtra.activeRoomNone'),
          })}
        </span>
      </div>
    </header>
  );
}
