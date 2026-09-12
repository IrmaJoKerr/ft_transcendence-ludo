import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { postApi } from '../api';
import { UserAvatar } from '../components/UserAvatar';
import type { PlayerColor } from '../game/types';
import { navigate, useRoute } from '../router';
import { useApp, type PlayerCount } from '../store';
import { SEAT_COLORS, type ColorKey } from '../theme';
import { retroAudio } from '../utils/audio';
import '../styles/retrowave.css';
import {
  PAGE_SHELL,
  GRID_BACKGROUND,
  SYNTHWAVE_SUN,
  PERSPECTIVE_GRID,
  GRID_HORIZON,
  APP_WRAPPER,
  HERO_SECTION,
  HERO_TITLE,
  DASHBOARD_GRID,
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_CONTROLS,
  WINDOW_BTN_MIN,
  WINDOW_BTN_MAX,
  WINDOW_BODY,
  RETRO_BTN,
} from '../styles/tw';

const COLOR_KEYS: Record<ColorKey, string> = {
  red: 'lobby.colorRed',
  green: 'lobby.colorGreen',
  yellow: 'lobby.colorYellow',
  blue: 'lobby.colorBlue',
};

const SEAT_HUES: Record<ColorKey, string> = {
  red: '#ff007f',
  green: '#00ff88',
  yellow: '#ffe600',
  blue: '#00f0ff',
};

export function Lobby() {
  const { t } = useTranslation();
  const { query } = useRoute();
  const {
    user,
    seats,
    addBot,
    removeBot,
    addPlayer,
    removePlayer,
    renamePlayer,
    resetSeats,
    setActiveMatch,
  } = useApp();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [editingSeat, setEditingSeat] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  // Room rules for this arena match: clash QTE + safe zones. Both default to
  // safe Zones ON, clash OFF (opt-in extra minigame). Sent with the create
  // payload so every mode (PvP/PvE/hotseat) gets the host's choice.
  const [clashOn, setClashOn] = useState(false);
  const [safeZonesOn, setSafeZonesOn] = useState(true);


  useEffect(() => {
    resetSeats();
  }, [resetSeats]);

  const playerCount = (Number(query.get('mode')) || 4) as PlayerCount;
  const allowAddPlayers = query.get('bots') !== '0';
  const isLocal = query.get('local') === '1';

  const visible = seats.slice(0, playerCount);
  const botCount = visible.filter((s) => s.type === 'bot').length;
  const emptyCount = visible.filter((s) => s.type === 'empty').length;

  const canStart = allowAddPlayers
    ? botCount >= 1
    : visible.filter((s) => s.type === 'you' || s.type === 'player').length >= 2;

  const onStart = async () => {
    if (!canStart || starting) return;
    retroAudio.playUiBeep(880, 0.1);
    setStartError(null);
    setStarting(true);
    try {
      const gameMode = allowAddPlayers ? 'pve' : isLocal || playerCount === 2 ? 'hotseat' : 'pvp';
      const filledCount = visible.filter((s) => s.type === 'you' || s.type === 'player').length;
      const botCount = allowAddPlayers ? visible.filter((s) => s.type === 'bot').length : 0;
      // The bot seats are fixed by index (0=blue,1=red,2=green,3=yellow). Send
      // the actual chosen bot colors so the backend places bots on the exact
      // seats picked here instead of always filling red first.
      const botColors = visible
        .map((s, i) => (s.type === 'bot' ? SEAT_COLORS[i] : null))
        .filter((c): c is ColorKey => c !== null);
      // Hotseat/PvE: send the exact seat colors, otherwise the engine's
      // playerCount-based default re-densifies slots the user skipped.
      const seatColors = visible
        .map((s, i) =>
          s.type === 'you' || s.type === 'player' || (gameMode === 'pve' && s.type === 'bot')
            ? SEAT_COLORS[i]
            : null,
        )
        .filter((c): c is ColorKey => c !== null);
      const res = await postApi<{
        gameId: string;
        token: string;
        engineUrl: string;
        color: PlayerColor;
        inviteCode?: string;
        mode: 'pvp' | 'pve' | 'hotseat';
        playerCount: number;
      }>('/api/match/create', {
        mode: gameMode,
        playerCount:
          gameMode === 'hotseat' ? filledCount : gameMode === 'pve' ? 1 + botCount : playerCount,
        botCount,
        botColors: botColors.length > 0 ? botColors : undefined,
        seatColors:
          (gameMode === 'hotseat' || gameMode === 'pve') && seatColors.length > 0
            ? seatColors
            : undefined,
        clashEnabled: clashOn,
        safeZones: safeZonesOn,
      });
      setActiveMatch(res);
      navigate(`/game?gameId=${res.gameId}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : 'Failed to create match');
      setStarting(false);
    }
  };

  return (
    <>
      {/* Animated 3D Synthwave Background */}
      <div className={GRID_BACKGROUND}>
        <div className={SYNTHWAVE_SUN} />
        <div className={GRID_HORIZON} />
        <div className={PERSPECTIVE_GRID} />
      </div>

      {/* Page shell (full-height wrapper) */}
      <div className={`${PAGE_SHELL} page-shell`}>
        {/* Main Content Container */}
        <div
          className={APP_WRAPPER}
          style={{
            marginLeft: 'auto',
            marginRight: 'auto',
            maxWidth: 1440,
            width: '100%',
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-start',
            padding: '16px 20px',
            boxSizing: 'border-box',
          }}
        >
          {/* Hero Header - Identical 1-to-1 design & dimensions as Game.tsx */}
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
                {t('lobby.arenaMatchConfig')}
              </h1>

              {/* Live Pill Announcement Bar */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 22px',
                  borderRadius: 4,
                  background: 'rgba(0, 240, 255, 0.15)',
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
                    color: '#ffffff',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('lobby.arenaLobbyReady')}
                </span>
              </div>

              {/* Status Marquee Subtitle Bar */}
              <div
                style={{
                  width: '100%',
                  maxWidth: 740,
                  padding: '10px 16px',
                  background: 'rgba(0, 0, 0, 0.6)',
                  border: '1px solid rgba(0, 240, 255, 0.35)',
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

          {/* Game Modifiers — rules for this arena match, applied in every
              mode (PvP / PvE / hotseat). Sent with the create payload. */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              flexWrap: 'wrap',
              justifyContent: 'center',
              marginTop: 14,
            }}
          >
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.82rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-main)',
                cursor: 'pointer',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                padding: '6px 10px',
                background: 'rgba(0, 0, 0, 0.4)',
              }}
            >
              <span>⚔️ {t('game.clashMode')}</span>
              <input
                type="checkbox"
                checked={clashOn}
                onChange={(e) => setClashOn(e.target.checked)}
                style={{ accentColor: 'var(--accent-pink)', width: 15, height: 15, cursor: 'pointer' }}
             />
            </label>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.82rem',
                fontFamily: 'var(--font-mono)',
                color: 'var(--text-main)',
                cursor: 'pointer',
                border: '1px solid var(--border-color)',
                borderRadius: 4,
                padding: '6px 10px',
                background: 'rgba(0, 0, 0, 0.4)',
              }}
            >
              <span>🛡 {t('game.safeZones')}</span>
              <input
                type="checkbox"
                checked={safeZonesOn}
                onChange={(e) => setSafeZonesOn(e.target.checked)}
                style={{ accentColor: 'var(--accent-cyan)', width: 15, height: 15, cursor: 'pointer' }}
             />
            </label>
          </div>

          {/* Main Grid */}
          <main
            className={DASHBOARD_GRID}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.25fr 0.85fr',
              gap: 20,
              alignItems: 'stretch',
              width: '100%',
              margin: '0 auto',
            }}
          >
            {/* LEFT COLUMN: SEAT ASSIGNMENT WINDOW & BACK BUTTON */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <section
                className={RETRO_WINDOW}
                style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              >
                <div className={WINDOW_HEADER} style={{ fontSize: '0.84rem' }}>
                  <span>
                    {t('lobby.seatRosterTitle', {
                      assigned: playerCount - emptyCount,
                      total: playerCount,
                    })}
                  </span>
                  <div className={WINDOW_CONTROLS}>
                    <span className={WINDOW_BTN_MIN} />
                    <span className={WINDOW_BTN_MAX} />
                  </div>
                </div>

                <div
                  className={WINDOW_BODY}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                    padding: 14,
                    flex: 1,
                  }}
                >
                  {visible.map((seat, i) => {
                    const ck = SEAT_COLORS[i];
                    const hue = SEAT_HUES[ck];
                    const colorName = t(COLOR_KEYS[ck]).toUpperCase();

                    return (
                      <div
                        key={i}
                        style={{
                          position: 'relative',
                          borderRadius: 6,
                          background: 'rgba(10, 2, 28, 0.85)',
                          border: `1.5px solid ${hue}`,
                          boxShadow: `0 0 10px ${hue}25`,
                          display: 'flex',
                          flexDirection: 'column',
                          height: 190,
                          overflow: 'hidden',
                          boxSizing: 'border-box',
                        }}
                      >
                        {/* Color Header Stripe */}
                        <div style={{ height: 4, background: hue }} />

                        <div
                          style={{
                            padding: 14,
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                          }}
                        >
                          {/* SEAT BADGE HEADER */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                            }}
                          >
                            <span
                              style={{
                                fontSize: '0.72rem',
                                fontFamily: 'var(--font-mono)',
                                color: hue,
                                fontWeight: 'bold',
                              }}
                            >
                              {t('lobby.seatBadgeHeader', { number: i + 1, color: colorName })}
                            </span>
                          </div>

                          {/* SEAT CONTENT */}
                          {seat.type === 'you' && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                flex: 1,
                                justifyContent: 'space-between',
                                marginTop: 4,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <UserAvatar
                                  username={user?.username ?? ''}
                                  userId={user?.id}
                                  hasAvatarPhoto={user?.hasAvatarPhoto ?? false}
                                  size={40}
                                  fallbackStyle={{
                                    width: 40,
                                    height: 40,
                                    borderRadius: 6,
                                    background: hue,
                                    color: '#0d0221',
                                    fontWeight: 'bold',
                                    display: 'grid',
                                    placeItems: 'center',
                                  }}
                                  style={{ borderRadius: 6, border: `1px solid ${hue}` }}
                               />
                                <div>
                                  <div
                                    style={{
                                      fontWeight: 800,
                                      fontSize: '0.92rem',
                                      color: '#ffffff',
                                      fontFamily: 'var(--font-heading)',
                                    }}
                                  >
                                    {(user?.displayName ?? user?.username ?? '').toUpperCase() ||
                                      t('common.you')}
                                  </div>
                                  <div
                                    style={{
                                      color: hue,
                                      fontSize: '0.72rem',
                                      fontFamily: 'var(--font-mono)',
                                    }}
                                  >
                                    {t('lobby.hostPilotTag')}
                                  </div>
                                </div>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.74rem',
                                  color: '#00ff88',
                                  fontFamily: 'var(--font-mono)',
                                  fontWeight: 'bold',
                                }}
                              >
                                {t('lobby.stateReadyHost')}
                              </div>
                            </div>
                          )}

                          {seat.type === 'bot' && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                flex: 1,
                                justifyContent: 'space-between',
                                marginTop: 4,
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div
                                    style={{
                                      width: 38,
                                      height: 38,
                                      borderRadius: 6,
                                      background: `${hue}25`,
                                      border: `1px solid ${hue}`,
                                      color: hue,
                                      fontWeight: 'bold',
                                      display: 'grid',
                                      placeItems: 'center',
                                      fontFamily: 'var(--font-mono)',
                                      fontSize: '0.82rem',
                                    }}
                                  >
                                    AI
                                  </div>
                                  <div>
                                    <div
                                      style={{
                                        fontWeight: 800,
                                        fontSize: '0.92rem',
                                        color: '#ffffff',
                                        fontFamily: 'var(--font-heading)',
                                      }}
                                    >
                                      {seat.name}
                                    </div>
                                    <div
                                      style={{
                                        color: 'var(--text-muted)',
                                        fontSize: '0.72rem',
                                        fontFamily: 'var(--font-mono)',
                                      }}
                                    >
                                      {t('lobby.aiBotTag')}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  onClick={() => {
                                    retroAudio.playUiBeep(320, 0.05);
                                    removeBot(i);
                                  }}
                                  style={{
                                    cursor: 'pointer',
                                    background: 'rgba(255, 0, 85, 0.15)',
                                    border: '1px solid #ff0055',
                                    color: '#ff0055',
                                    borderRadius: 4,
                                    width: 26,
                                    height: 26,
                                    display: 'grid',
                                    placeItems: 'center',
                                    fontSize: '0.8rem',
                                  }}
                                  title="Remove Bot"
                                >
                                  ✕
                                </button>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.74rem',
                                  color: hue,
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {t('lobby.stateAiReady')}
                              </div>
                            </div>
                          )}

                          {seat.type === 'player' && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 6,
                                flex: 1,
                                justifyContent: 'space-between',
                                marginTop: 4,
                              }}
                            >
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                }}
                              >
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    flex: 1,
                                  }}
                                >
                                  <div
                                    style={{
                                      width: 38,
                                      height: 38,
                                      borderRadius: 6,
                                      background: `${hue}25`,
                                      border: `1px solid ${hue}`,
                                      color: hue,
                                      fontWeight: 'bold',
                                      display: 'grid',
                                      placeItems: 'center',
                                      fontFamily: 'var(--font-mono)',
                                      fontSize: '0.82rem',
                                    }}
                                  >
                                    P{i + 1}
                                  </div>
                                  <div style={{ flex: 1 }}>
                                    {editingSeat === i ? (
                                      <input
                                        autoFocus
                                        value={editName}
                                        onChange={(e) => setEditName(e.target.value)}
                                        onBlur={() => {
                                          renamePlayer(i, editName.trim() || seat.name);
                                          setEditingSeat(null);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            renamePlayer(i, editName.trim() || seat.name);
                                            setEditingSeat(null);
                                          }
                                        }}
                                        style={{
                                          width: '90%',
                                          background: 'rgba(0,0,0,0.8)',
                                          border: `1px solid ${hue}`,
                                          borderRadius: 4,
                                          color: '#ffffff',
                                          padding: '3px 8px',
                                          fontSize: '0.86rem',
                                          fontFamily: 'var(--font-mono)',
                                        }}
                                     />
                                    ) : (
                                      <div
                                        onClick={() => {
                                          setEditingSeat(i);
                                          setEditName(seat.name);
                                        }}
                                        style={{
                                          fontWeight: 800,
                                          fontSize: '0.92rem',
                                          color: '#ffffff',
                                          fontFamily: 'var(--font-heading)',
                                          cursor: 'pointer',
                                        }}
                                        title={t('lobby.clickToRename')}
                                      >
                                        {seat.name} ✎
                                      </div>
                                    )}
                                    <div
                                      style={{
                                        color: 'var(--text-muted)',
                                        fontSize: '0.72rem',
                                        fontFamily: 'var(--font-mono)',
                                      }}
                                    >
                                      {t('lobby.hotseatPilotTag')}
                                    </div>
                                  </div>
                                </div>

                                <button
                                  onClick={() => {
                                    retroAudio.playUiBeep(320, 0.05);
                                    removePlayer(i);
                                  }}
                                  style={{
                                    cursor: 'pointer',
                                    background: 'rgba(255, 0, 85, 0.15)',
                                    border: '1px solid #ff0055',
                                    color: '#ff0055',
                                    borderRadius: 4,
                                    width: 26,
                                    height: 26,
                                    display: 'grid',
                                    placeItems: 'center',
                                    fontSize: '0.8rem',
                                  }}
                                  title="Remove Player"
                                >
                                  ✕
                                </button>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.74rem',
                                  color: '#00ff88',
                                  fontFamily: 'var(--font-mono)',
                                }}
                              >
                                {t('lobby.stateStandby')}
                              </div>
                            </div>
                          )}

                          {seat.type === 'empty' && (
                            <div
                              onClick={() => {
                                retroAudio.playUiBeep(520, 0.05);
                                if (allowAddPlayers) addBot(i);
                                else addPlayer(i);
                              }}
                              style={{
                                flex: 1,
                                border: `1.5px dashed ${hue}66`,
                                borderRadius: 4,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                cursor: 'pointer',
                                background: 'rgba(0,0,0,0.4)',
                                transition: 'all 0.2s ease',
                                marginTop: 4,
                              }}
                            >
                              <div
                                style={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: '50%',
                                  border: `1.5px dashed ${hue}`,
                                  color: hue,
                                  display: 'grid',
                                  placeItems: 'center',
                                  fontSize: '1.1rem',
                                  fontWeight: 'bold',
                                }}
                              >
                                +
                              </div>
                              <div
                                style={{
                                  fontSize: '0.78rem',
                                  color: hue,
                                  fontFamily: 'var(--font-mono)',
                                  fontWeight: 'bold',
                                }}
                              >
                                {allowAddPlayers ? t('lobby.addAiBot') : t('lobby.addHumanPilot')}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* RETURN TO GAME LOBBY BUTTON */}
              <button
                className={RETRO_BTN}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  fontSize: '0.84rem',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.5px',
                  background: 'rgba(0, 240, 255, 0.12)',
                  border: '1px solid var(--accent-cyan)',
                  color: 'var(--accent-cyan)',
                  cursor: 'pointer',
                }}
                onClick={() => {
                  retroAudio.playUiBeep(440, 0.05);
                  navigate('/gamelobby');
                }}
              >
                {t('lobby.returnToGameLobby')}
              </button>
            </div>

            {/* RIGHT COLUMN: LAUNCH CONTROL WINDOW */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* LAUNCH CONTROL WINDOW */}
              <section
                className={RETRO_WINDOW}
                style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
              >
                <div className={WINDOW_HEADER} style={{ fontSize: '0.84rem' }}>
                  <span>{t('lobby.arenaLaunchControlTitle')}</span>
                  <div className={WINDOW_CONTROLS}>
                    <span className={WINDOW_BTN_MIN} />
                    <span className={WINDOW_BTN_MAX} />
                  </div>
                </div>

                <div
                  className={WINDOW_BODY}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 22,
                    padding: '28px 24px',
                    flex: 1,
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>
                        {t('lobby.activePilotsLabel')}
                      </span>
                      <span style={{ color: '#ffffff', fontWeight: 'bold' }}>
                        {playerCount - emptyCount} / {playerCount}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>{t('lobby.botUnitsLabel')}</span>
                      <span style={{ color: '#00ff88', fontWeight: 'bold' }}>
                        {t('lobby.unitsCount', {
                          count: botCount,
                          plural: botCount === 1 ? '' : 'S',
                        })}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>
                        {t('lobby.arenaModeLabel')}
                      </span>
                      <span style={{ color: '#ffe600', fontWeight: 'bold' }}>
                        {isLocal ? t('lobby.localHotseat') : t('lobby.pveArena')}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>
                        {t('lobby.sectorMatrixLabel')}
                      </span>
                      <span style={{ color: 'var(--accent-cyan)', fontWeight: 'bold' }}>
                        {t('lobby.combatCross')}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '0.9rem',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      <span style={{ color: 'var(--text-muted)' }}>
                        {t('lobby.winConditionLabel')}
                      </span>
                      <span style={{ color: '#00ff88', fontWeight: 'bold' }}>
                        {t('lobby.fourPiecesInGoal')}
                      </span>
                    </div>

                    {/* Status Info Box */}
                    <div
                      style={{
                        padding: '16px 18px',
                        background: 'rgba(0, 0, 0, 0.5)',
                        border: '1px solid rgba(0, 240, 255, 0.3)',
                        borderRadius: 4,
                        textAlign: 'center',
                        fontSize: '0.82rem',
                        fontFamily: 'var(--font-mono)',
                        color: canStart ? '#00ff88' : '#ffe600',
                        marginTop: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      {canStart ? t('lobby.allSystemsPassed') : t('lobby.assignAtLeastOne')}
                    </div>
                  </div>

                  <div>
                    {/* LAUNCH BUTTON */}
                    <button
                      onClick={() => {
                        void onStart();
                      }}
                      disabled={!canStart || starting}
                      className={RETRO_BTN}
                      style={{
                        width: '100%',
                        padding: '16px 0',
                        fontSize: '1rem',
                        fontFamily: 'var(--font-heading)',
                        letterSpacing: '1.2px',
                        background: canStart
                          ? 'rgba(0, 255, 136, 0.2)'
                          : 'rgba(255, 255, 255, 0.05)',
                        border: canStart
                          ? '1px solid #00ff88'
                          : '1px solid rgba(255, 255, 255, 0.2)',
                        color: canStart ? '#00ff88' : 'var(--text-muted)',
                        cursor: canStart ? 'pointer' : 'not-allowed',
                        boxShadow: canStart ? '0 0 15px rgba(0, 255, 136, 0.4)' : 'none',
                      }}
                    >
                      {starting
                        ? t('lobby.initializingArena')
                        : canStart
                          ? t('lobby.launchArenaMatch')
                          : isLocal
                            ? t('lobby.addPlayerToStart')
                            : t('lobby.addBotToStart')}
                    </button>

                    {startError && (
                      <div
                        style={{
                          textAlign: 'center',
                          color: '#ff0055',
                          fontSize: '0.72rem',
                          fontFamily: 'var(--font-mono)',
                          marginTop: 8,
                        }}
                      >
                        {startError}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </>
  );
}
