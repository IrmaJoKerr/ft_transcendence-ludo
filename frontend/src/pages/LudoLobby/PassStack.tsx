import { useTranslation } from 'react-i18next';
import { navigate } from '../../router';
import { retroAudio } from '../../utils/audio';
import {
  RETRO_TICKET_PASS,
  TICKET_PINK,
  TICKET_YELLOW,
  TICKET_GREEN,
  LOBBY_SECTION_TITLE,
} from '../../styles/tw';
import { PassActionPill } from './PassActionPill';

export function PassStack({
  passActionProbes,
  hostLocked,
  hostBusy,
  lockedByActiveGame,
  onCreateRoom,
}: {
  passActionProbes: string[];
  hostLocked: boolean;
  hostBusy: boolean;
  lockedByActiveGame: boolean;
  onCreateRoom: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-[3px]">
      {/* **LEVEL 1: HOST NEW TABLE TICKET** */}
      <div
        className={`${RETRO_TICKET_PASS} ${TICKET_PINK} ${hostLocked ? 'disabled' : ''}`}
        onClick={
          hostLocked
            ? undefined
            : () => {
                onCreateRoom();
              }
        }
        role="button"
        tabIndex={0}
        title={lockedByActiveGame ? t('lobbyBrowser.activeGameLockTooltip') : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!hostLocked) onCreateRoom();
          }
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            flex: 1,
            minWidth: 280,
          }}
        >
          <div
            style={{
              padding: '12px 20px',
              background: 'rgba(255, 0, 127, 0.28)',
              border: '1.5px solid #ff007f',
              borderRadius: 8,
              fontFamily: 'var(--font-mono)',
              fontWeight: 900,
              fontSize: '0.98rem',
              color: '#ff007f',
              whiteSpace: 'nowrap',
              letterSpacing: '1.2px',
              boxShadow: '0 0 12px rgba(255, 0, 127, 0.3)',
            }}
          >
            {t('ludoLobbyPasses.level1')}
          </div>
          <div
            style={{
              width: 1,
              height: 56,
              borderRight: '2px dashed rgba(255, 0, 127, 0.45)',
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={LOBBY_SECTION_TITLE}>{t('ludoLobbyPasses.hostNewTable')}</div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'calc(0.86rem + 1pt)',
                color: 'var(--text-soft)',
                lineHeight: 1.45,
              }}
            >
              {t('ludoLobbyPasses.hostNewTableDesc')}
            </div>
          </div>
        </div>

        <PassActionPill
          label={
            hostBusy
              ? `▶ ${t('ludoLobbyPasses.creating')}`
              : `▶ ${t('ludoLobbyPasses.hostNewTable')}`
          }
          probes={passActionProbes}
          style={{
            background: 'var(--accent-pink)',
            color: 'var(--text-main)',
            boxShadow: '0 0 18px rgb(var(--accent-pink-rgb) / 0.5)',
            opacity: hostLocked ? 0.6 : 1,
          }}
        />
      </div>

      {/* **LEVEL 2: HOTSEAT MODE TICKET** */}
      <div
        className={`${RETRO_TICKET_PASS} ${TICKET_YELLOW}`}
        onClick={() => {
          retroAudio.playUiBeep(640, 0.05);
          navigate('/gamelobby/table?mode=4&bots=0&local=1');
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            retroAudio.playUiBeep(640, 0.05);
            navigate('/gamelobby/table?mode=4&bots=0&local=1');
          }
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            flex: 1,
            minWidth: 280,
          }}
        >
          <div
            style={{
              padding: '12px 20px',
              background: 'rgba(255, 230, 0, 0.24)',
              border: '1.5px solid #ffe600',
              borderRadius: 8,
              fontFamily: 'var(--font-mono)',
              fontWeight: 900,
              fontSize: '0.98rem',
              color: '#ffe600',
              whiteSpace: 'nowrap',
              letterSpacing: '1.2px',
              boxShadow: '0 0 12px rgba(255, 230, 0, 0.3)',
            }}
          >
            {t('ludoLobbyPasses.level2')}
          </div>
          <div
            style={{
              width: 1,
              height: 56,
              borderRight: '2px dashed rgba(255, 230, 0, 0.45)',
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={LOBBY_SECTION_TITLE}>{t('ludoLobbyPasses.hotseatMode')}</div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'calc(0.86rem + 1pt)',
                color: 'var(--text-soft)',
                lineHeight: 1.45,
              }}
            >
              {t('ludoLobbyPasses.hotseatModeDesc')}
            </div>
          </div>
        </div>

        <PassActionPill
          label={`▶ ${t('ludoLobbyPasses.launchHotseat')}`}
          probes={passActionProbes}
          className="bg-[rgb(var(--accent-yellow-rgb)/.22)] text-(--accent-yellow) shadow-[0_0_16px_rgb(var(--accent-yellow-rgb)/.4)] [--pill-border:var(--accent-yellow)]"
        />
      </div>

      {/* **LEVEL 3: BOT MODE TICKET** */}
      <div
        className={`${RETRO_TICKET_PASS} ${TICKET_GREEN}`}
        onClick={() => {
          retroAudio.playUiBeep(640, 0.05);
          navigate('/gamelobby/table?mode=4&bots=1');
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            retroAudio.playUiBeep(640, 0.05);
            navigate('/gamelobby/table?mode=4&bots=1');
          }
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            flex: 1,
            minWidth: 280,
          }}
        >
          <div
            style={{
              padding: '12px 20px',
              background: 'rgb(var(--state-on-rgb) / 0.24)',
              border: '1.5px solid var(--state-on)',
              borderRadius: 8,
              fontFamily: 'var(--font-mono)',
              fontWeight: 900,
              fontSize: '0.98rem',
              color: 'var(--state-on)',
              whiteSpace: 'nowrap',
              letterSpacing: '1.2px',
              boxShadow: '0 0 12px rgb(var(--state-on-rgb) / 0.3)',
            }}
          >
            {t('ludoLobbyPasses.level3')}
          </div>
          <div
            style={{
              width: 1,
              height: 56,
              borderRight: '2px dashed rgb(var(--state-on-rgb) / 0.45)',
            }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className={LOBBY_SECTION_TITLE}>{t('ludoLobbyPasses.botMode')}</div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'calc(0.86rem + 1pt)',
                color: 'var(--text-soft)',
                lineHeight: 1.45,
              }}
            >
              {t('ludoLobbyPasses.botModeDesc')}
            </div>
          </div>
        </div>

        <PassActionPill
          label={`▶ ${t('ludoLobbyPasses.playVsBots')}`}
          probes={passActionProbes}
          className="bg-[rgb(var(--state-on-rgb)/.22)] text-(--state-on) shadow-[0_0_16px_rgb(var(--state-on-rgb)/.4)] [--pill-border:var(--state-on)]"
        />
      </div>
    </div>
  );
}
