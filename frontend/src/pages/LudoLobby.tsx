import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApi, postApi } from '../api';
import { UserAvatar } from '../components/UserAvatar';
import { RetroNavbar } from '../components/RetroNavbar';
import type { PlayerColor } from '../game/types';
import { navigate } from '../router';
import { useApp } from '../store';
import { COL } from '../theme';
import { retroAudio } from '../utils/audio';
import '../styles/retrowave.css';
import {
  PAGE_SHELL,
  GRID_BACKGROUND,
  SYNTHWAVE_SUN,
  PERSPECTIVE_GRID,
  GRID_HORIZON,
  HERO_SECTION,
  HERO_TITLE,
  HERO_SUBTITLE,
  BADGE_BAR,
  RETRO_BADGE,
  DASHBOARD_GRID,
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_BODY,
  RETRO_BTN,
  RETRO_TICKET_PASS,
  TICKET_PINK,
  TICKET_YELLOW,
  TICKET_GREEN,
  TICKET_CYAN,
} from '../styles/tw';

// How often the room list and the "am I already seated?" check are polled.
// Original: 1000 ms. Recommended: 5000 ms — at 1 s those two endpoints sent
// 120 requests/min per user, close to the 300 requests/min per-IP limit.
const ROOM_POLL_MS = 5_000;

type Room = {
  id: string;
  roomCode: string;
  host: string;
  hostUsername?: string;
  /** Host's immutable id : the key the room card's avatar is looked up by. */
  hostId?: string;
  hasAvatarPhoto?: boolean;
  seats: number;
  maxSeats: number;
  mode: 'classic' | 'duel';
};

type MatchResult = {
  gameId: string;
  token: string;
  engineUrl: string;
  color: PlayerColor;
  inviteCode?: string;
  mode: 'pvp' | 'pve' | 'hotseat';
  playerCount: number;
};

const ROOM_AVATAR_HUES = [COL.red.base, COL.green.base, COL.yellow.base, COL.blue.base];

function hueForHost(host: string): string {
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
  return ROOM_AVATAR_HUES[hash % ROOM_AVATAR_HUES.length];
}

export function LudoLobby() {
  const { t } = useTranslation();
  const { user, setActiveMatch } = useApp();


  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  const [hasActiveGame, setHasActiveGame] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);

  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRooms = () => {
    getApi<Room[]>('/api/games/rooms')
      .then((data) => setRooms(data))
      .catch(() => setRooms((prev) => prev ?? []));
  };

  const fetchHasActiveGame = () => {
    getApi<Array<{ id: string }>>('/api/games/mine')
      .then((data) => setHasActiveGame(data.length > 0))
      .catch(() => {});
  };

  useEffect(() => {
    fetchRooms();
    fetchHasActiveGame();
    const iv = setInterval(() => {
      fetchRooms();
      fetchHasActiveGame();
    }, ROOM_POLL_MS);
    return () => clearInterval(iv);
  }, []);

  const createRoom = async () => {
    if (hasActiveGame) {
      retroAudio.playUiBeep(300, 0.08);
      setError(t('lobbyBrowser.createRoomWhileActiveError'));
      return;
    }
    setHostBusy(true);
    setError(null);
    retroAudio.playUiBeep(920, 0.08);
    try {
      // Host's room: clash QTE is opt-in (off by default), safe zones on.
      // The host can flip either in the waiting room before the match starts.
      const res = await postApi<MatchResult>('/api/match/pvp/invite', {
        clashEnabled: false,
        safeZones: true,
      });
      setActiveMatch(res);
      navigate(`/game?gameId=${res.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to host a table');
    } finally {
      setHostBusy(false);
    }
  };

  const rejoinRoom = async (room: Room) => {
    setJoiningRoomId(room.id);
    setError(null);
    retroAudio.playUiBeep(780, 0.06);
    try {
      const res = await postApi<MatchResult>(`/api/game/${room.id}/rejoin`, {});
      setActiveMatch(res);
      navigate(`/game?gameId=${res.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rejoin table');
      setJoiningRoomId(null);
      fetchRooms();
    }
  };

  const joinByCode = async (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    const ownRoom = (rooms ?? []).find(
      (r) => r.hostUsername === user?.username && r.roomCode === trimmed,
    );
    if (ownRoom) {
      await rejoinRoom(ownRoom);
      return;
    }
    setJoiningByCode(true);
    setError(null);
    retroAudio.playUiBeep(780, 0.06);
    try {
      const res = await postApi<MatchResult>(`/api/match/join/${encodeURIComponent(trimmed)}`, {});
      setActiveMatch(res);
      navigate(`/game?gameId=${res.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
      setJoiningByCode(false);
    }
  };

  const joinRoom = async (room: Room) => {
    setJoiningRoomId(room.id);
    setError(null);
    retroAudio.playUiBeep(780, 0.06);
    try {
      const res = await postApi<MatchResult>(
        `/api/match/join/${encodeURIComponent(room.roomCode)}`,
        {},
      );
      setActiveMatch(res);
      navigate(`/game?gameId=${res.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
      setJoiningRoomId(null);
      fetchRooms();
    }
  };

  const badgeStyle = (
    badge: 'ranked' | 'semiRanked' | 'casual' | 'invite',
  ): React.CSSProperties => {
    const hue =
      badge === 'ranked'
        ? '#ffe600'
        : badge === 'semiRanked'
          ? '#00ff88'
          : badge === 'casual'
            ? '#00f0ff'
            : '#ff007f';
    return {
      fontSize: '0.65rem',
      fontWeight: 'bold',
      letterSpacing: '0.5px',
      color: hue,
      background: `${hue}22`,
      border: `1px solid ${hue}66`,
      borderRadius: 4,
      padding: '2px 8px',
      fontFamily: 'var(--font-mono)',
      textTransform: 'uppercase',
    };
  };

  const roomList = rooms ?? [];

  return (
    <>
      {/* Animated 3D Synthwave Grid & Sun Background */}
      <div className={GRID_BACKGROUND}>
        <div className={SYNTHWAVE_SUN} />
        <div className={GRID_HORIZON} />
        <div className={PERSPECTIVE_GRID} />
      </div>

      {/* Page shell (full-height wrapper) */}
      <div className={`${PAGE_SHELL} page-shell`}>
        {/* Dynamic Full-Width Seated Sidebar & Content Layout Container */}
        <div className="relative z-10 box-border flex min-h-screen w-full flex-row items-start justify-center gap-7 pl-6 pr-24 py-8 xl:pr-40">
          {/* Left-Seated Navigation Dock */}
          <aside
            className="sticky top-8 w-[88px] shrink-0 xl:w-[270px]"
            style={{ margin: 0, padding: 0 }}
          >
            <RetroNavbar activeRoute="/gamelobby" />
          </aside>

          {/* Main Content Flow */}
          <div className="sticky top-8 w-full min-w-0 flex-1" style={{ margin: 0, padding: 0 }}>
            {/* Hero Telemetry Banner */}
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
                  {t('ludoLobbyExtra.activeSectors', { count: rooms ? rooms.length : 0 })}
                </span>
                <span
                  className={RETRO_BADGE}
                  style={{
                    border: '1px solid #00ff88',
                    color: '#00ff88',
                  }}
                >
                  {t('ludoLobbyExtra.pilotLabel', {
                    name:
                      (user?.displayName ?? user?.username)?.toUpperCase() ??
                      t('ludoLobbyExtra.guestFallback'),
                  })}
                </span>
                <span
                  className={RETRO_BADGE}
                  style={{
                    border: hasActiveGame
                      ? '1px solid var(--accent-yellow)'
                      : '1px dashed rgba(255,255,255,0.2)',
                    color: hasActiveGame ? 'var(--accent-yellow)' : 'var(--text-muted)',
                  }}
                >
                  {t('ludoLobbyExtra.activeRoomLabel', {
                    status: hasActiveGame
                      ? t('ludoLobbyExtra.activeRoomYes')
                      : t('ludoLobbyExtra.activeRoomNone'),
                  })}
                </span>
              </div>
            </header>

            {/* Main Tactical Single-Column / Stacked Layout */}
            <main
              className={DASHBOARD_GRID}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 20,
                width: '100%',
                margin: '0 auto',
              }}
            >
              {/* TACTICAL COMBAT PASSES CONTAINER (BORDERLESS TICKET PASSES) */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 20,
                }}
              >
                {/* ════════════════════════════════════════════════════════════════════════════
                  LEVEL 1: HOST NEW TABLE TICKET
                 ════════════════════════════════════════════════════════════════════════════ */}
                <div
                  className={`${RETRO_TICKET_PASS} ${TICKET_PINK} ${hostBusy ? 'disabled' : ''}`}
                  onClick={
                    hostBusy
                      ? undefined
                      : () => {
                          void createRoom();
                        }
                  }
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (!hostBusy) void createRoom();
                    }
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
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
                    <div
                      style={{
                        minWidth: 0,
                        flex: 1,
                        maxWidth: 620,
                        margin: '0 auto',
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.22rem',
                          fontWeight: 900,
                          color: '#ffffff',
                          letterSpacing: '1.8px',
                          marginBottom: 6,
                        }}
                      >
                        {t('ludoLobbyPasses.hostNewTable')}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.86rem',
                          color: 'var(--text-muted)',
                          lineHeight: 1.45,
                        }}
                      >
                        {t('ludoLobbyPasses.hostNewTableDesc')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ════════════════════════════════════════════════════════════════════════════
                  LEVEL 2: HOTSEAT MODE TICKET
                 ════════════════════════════════════════════════════════════════════════════ */}
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
                      justifyContent: 'flex-start',
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
                    <div
                      style={{
                        minWidth: 0,
                        flex: 1,
                        maxWidth: 620,
                        margin: '0 auto',
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.22rem',
                          fontWeight: 900,
                          color: '#ffffff',
                          letterSpacing: '1.8px',
                          marginBottom: 6,
                        }}
                      >
                        {t('ludoLobbyPasses.hotseatMode')}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.86rem',
                          color: 'var(--text-muted)',
                          lineHeight: 1.45,
                        }}
                      >
                        {t('ludoLobbyPasses.hotseatModeDesc')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ════════════════════════════════════════════════════════════════════════════
                  LEVEL 3: BOT MODE TICKET
                 ════════════════════════════════════════════════════════════════════════════ */}
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
                      justifyContent: 'flex-start',
                      gap: 24,
                      flex: 1,
                      minWidth: 280,
                    }}
                  >
                    <div
                      style={{
                        padding: '12px 20px',
                        background: 'rgba(0, 255, 136, 0.24)',
                        border: '1.5px solid #00ff88',
                        borderRadius: 8,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 900,
                        fontSize: '0.98rem',
                        color: '#00ff88',
                        whiteSpace: 'nowrap',
                        letterSpacing: '1.2px',
                        boxShadow: '0 0 12px rgba(0, 255, 136, 0.3)',
                      }}
                    >
                      {t('ludoLobbyPasses.level3')}
                    </div>
                    <div
                      style={{
                        width: 1,
                        height: 56,
                        borderRight: '2px dashed rgba(0, 255, 136, 0.45)',
                      }}
                   />
                    <div
                      style={{
                        minWidth: 0,
                        flex: 1,
                        maxWidth: 620,
                        margin: '0 auto',
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.22rem',
                          fontWeight: 900,
                          color: '#ffffff',
                          letterSpacing: '1.8px',
                          marginBottom: 6,
                        }}
                      >
                        {t('ludoLobbyPasses.botMode')}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.86rem',
                          color: 'var(--text-muted)',
                          lineHeight: 1.45,
                        }}
                      >
                        {t('ludoLobbyPasses.botModeDesc')}
                      </div>
                    </div>
                  </div>
                </div>

                {/* ════════════════════════════════════════════════════════════════════════════
                  LEVEL 4 (LAST): ACCESS VIA ROOM CODE TICKET
                 ════════════════════════════════════════════════════════════════════════════ */}
                <div
                  className={`${RETRO_TICKET_PASS} ${TICKET_CYAN}`}
                  onClick={() => {
                    if (roomCodeInput.trim().length > 0 && !joiningByCode) {
                      void joinByCode(roomCodeInput);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && roomCodeInput.trim().length > 0 && !joiningByCode) {
                      e.preventDefault();
                      void joinByCode(roomCodeInput);
                    }
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      gap: 24,
                      flex: 1,
                      minWidth: 280,
                    }}
                  >
                    <div
                      style={{
                        padding: '12px 20px',
                        background: 'rgba(0, 240, 255, 0.24)',
                        border: '1.5px solid var(--accent-cyan)',
                        borderRadius: 8,
                        fontFamily: 'var(--font-mono)',
                        fontWeight: 900,
                        fontSize: '0.98rem',
                        color: 'var(--accent-cyan)',
                        whiteSpace: 'nowrap',
                        letterSpacing: '1.2px',
                        boxShadow: '0 0 12px rgba(0, 240, 255, 0.3)',
                      }}
                    >
                      {t('ludoLobbyPasses.level4')}
                    </div>
                    <div
                      style={{
                        width: 1,
                        height: 56,
                        borderRight: '2px dashed rgba(0, 240, 255, 0.45)',
                      }}
                   />
                    <div
                      style={{
                        minWidth: 0,
                        flex: 1,
                        maxWidth: 560,
                        margin: '0 auto',
                        textAlign: 'center',
                      }}
                    >
                      <div
                        style={{
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.22rem',
                          fontWeight: 900,
                          color: '#ffffff',
                          letterSpacing: '1.8px',
                          marginBottom: 6,
                        }}
                      >
                        {t('ludoLobbyPasses.accessViaCode')}
                      </div>
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.86rem',
                          color: 'var(--text-muted)',
                          lineHeight: 1.45,
                        }}
                      >
                        {t('ludoLobbyPasses.accessViaCodeDesc')}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      flexShrink: 0,
                      flexWrap: 'wrap',
                      // Breathing room between the form and the card's right edge.
                      marginRight: 20,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      value={roomCodeInput}
                      onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          roomCodeInput.trim().length > 0 &&
                          !joiningByCode
                        ) {
                          void joinByCode(roomCodeInput);
                        }
                      }}
                      placeholder={t('ludoLobbyPasses.enterCodePlaceholder')}
                      maxLength={8}
                      style={{
                        // Wide enough for the longest placeholder ("MASUKKAN KOD", ms)
                        // plus an 8-char code, with the 2px letter-spacing applied.
                        width: 210,
                        height: 50,
                        background: 'rgba(5, 2, 18, 0.92)',
                        border: '1.5px solid var(--accent-cyan)',
                        borderRadius: 6,
                        color: '#ffe600',
                        padding: '0 14px',
                        fontSize: '1rem',
                        fontWeight: 'bold',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '2px',
                        textAlign: 'center',
                        outline: 'none',
                        boxShadow: 'inset 0 0 10px rgba(0, 240, 255, 0.25)',
                        boxSizing: 'border-box',
                      }}
                   />
                  </div>
                </div>
              </div>

              {/* Error Alert Box */}
              {error && (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: 4,
                    background: 'rgba(255, 0, 85, 0.15)',
                    border: '1px solid #ff0055',
                    color: '#ff0055',
                    fontSize: '0.75rem',
                    textAlign: 'center',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {t('ludoLobbyExtra.errorPrefix', { message: error })}
                </div>
              )}

              {/* ════════════════════════════════════════════════════════════════════════════
                BELOW THEM: OPEN QUANTUM ROOMS
               ════════════════════════════════════════════════════════════════════════════ */}
              <section className={RETRO_WINDOW} id="roomsWindow">
                <div
                  className={WINDOW_HEADER}
                  style={{
                    background: '#190a38',
                    borderBottom: '1px solid rgba(0, 240, 255, 0.3)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>
                      {t('ludoLobbyPasses.openQuantumRooms')} ({roomList.length})
                    </span>
                  </div>
                </div>

                <div
                  className={WINDOW_BODY}
                  style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  {/* Room Table */}
                  <div
                    style={{
                      border: '1px solid rgba(0, 240, 255, 0.25)',
                      borderRadius: 6,
                      background: 'rgba(5, 2, 18, 0.8)',
                      overflow: 'hidden',
                    }}
                  >
                    {/* Header Row */}
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1.5fr 0.8fr 1fr auto',
                        gap: 8,
                        padding: '10px 14px',
                        background: 'rgba(25, 10, 56, 0.9)',
                        borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
                        fontSize: '0.68rem',
                        fontWeight: 'bold',
                        color: 'var(--accent-cyan)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <div>{t('ludoLobbyPasses.colSectorCode')}</div>
                      <div>{t('ludoLobbyPasses.colHostCallsign')}</div>
                      <div>{t('ludoLobbyPasses.colCapacity')}</div>
                      <div>{t('ludoLobbyPasses.colStakes')}</div>
                      <div>{t('ludoLobbyPasses.colAction')}</div>
                    </div>

                    {/* Room Rows */}
                    <div
                      style={{
                        maxHeight: 320,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                      }}
                    >
                      {rooms === null ? (
                        <div
                          style={{
                            padding: '28px 0',
                            textAlign: 'center',
                            color: 'var(--accent-yellow)',
                            fontSize: '0.78rem',
                          }}
                        >
                          {t('ludoLobbyExtra.scanningOpenSectors')}
                        </div>
                      ) : roomList.length === 0 ? (
                        <div
                          style={{
                            padding: '28px 0',
                            textAlign: 'center',
                            color: 'var(--text-muted)',
                            fontSize: '0.78rem',
                          }}
                        >
                          {t('ludoLobbyPasses.noOpenRooms')}
                        </div>
                      ) : (
                        roomList.map((room) => {
                          const isOwn = room.hostUsername === user?.username;
                          const full = room.seats >= room.maxSeats;
                          const hue = hueForHost(room.host);
                          return (
                            <div
                              key={room.id}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1.5fr 0.8fr 1fr auto',
                                gap: 8,
                                padding: '12px 14px',
                                borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
                                alignItems: 'center',
                                background: isOwn ? 'rgba(255, 0, 127, 0.12)' : 'transparent',
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 'bold',
                                  fontSize: '0.82rem',
                                  color: '#ffe600',
                                  fontFamily: 'var(--font-mono)',
                                  letterSpacing: '0.5px',
                                }}
                              >
                                {room.roomCode}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <UserAvatar
                                  username={room.hostUsername ?? room.host}
                                  userId={room.hostId}
                                  hasAvatarPhoto={room.hasAvatarPhoto}
                                  size={28}
                                  fallbackStyle={{
                                    width: 28,
                                    height: 28,
                                    flex: 'none',
                                    borderRadius: 4,
                                    display: 'grid',
                                    placeItems: 'center',
                                    fontWeight: 'bold',
                                    fontSize: '0.7rem',
                                    color: '#0d0221',
                                    background: hue,
                                  }}
                                  style={{ borderRadius: 4, border: `1px solid ${hue}` }}
                               />
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontWeight: 'bold',
                                      fontSize: '0.82rem',
                                      color: '#ffffff',
                                      fontFamily: 'var(--font-mono)',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {room.host}
                                  </div>
                                  <div style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>
                                    {room.maxSeats}P • {room.mode}
                                  </div>
                                </div>
                              </div>
                              <div
                                style={{
                                  fontWeight: 'bold',
                                  fontSize: '0.82rem',
                                  color: full ? '#ff0055' : '#00ff88',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {room.seats}/{room.maxSeats}
                              </div>
                              <div>
                                <span style={badgeStyle('ranked')}>{t('lobbyBrowser.ranked')}</span>
                              </div>
                              <div>
                                <button
                                  className={RETRO_BTN}
                                  onClick={() => {
                                    if (isOwn) void rejoinRoom(room);
                                    else void joinRoom(room);
                                  }}
                                  disabled={(!isOwn && full) || joiningRoomId === room.id}
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: '0.7rem',
                                    background: isOwn ? 'var(--accent-pink)' : undefined,
                                    opacity:
                                      (!isOwn && full) || joiningRoomId === room.id ? 0.4 : 1,
                                    cursor: !isOwn && full ? 'not-allowed' : 'pointer',
                                  }}
                                >
                                  {isOwn
                                    ? joiningRoomId === room.id
                                      ? '...'
                                      : t('lobbyBrowser.rejoinBtn')
                                    : full
                                      ? t('lobbyBrowser.fullBtn')
                                      : joiningRoomId === room.id
                                        ? '...'
                                        : t('lobbyBrowser.joinBtn')}
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </section>
            </main>
          </div>
        </div>
      </div>
    </>
  );
}
