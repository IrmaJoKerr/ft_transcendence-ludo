import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApi, postApi } from '../api';
import { UserAvatar } from '../components/UserAvatar';
import { LandscapeNotice } from '../components/RetroAuthLayout';
import type { PlayerColor } from '../game/types';
import { navigate, useRoute } from '../router';
import { useApp, type PlayerCount } from '../store';
import { SEAT_COLORS, type ColorKey } from '../theme';
import { retroAudio } from '../utils/audio';
import '../styles/retrowave.css';
import {
  CRT_SCREEN,
  GRID_BACKGROUND,
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

// `guest` renders the same config screen without a session: bots only, no
// state-lock poll, and its launch posts the public guest endpoint.
export function Lobby({ guest = false }: { guest?: boolean } = {}) {
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
    setGuestSetup,
  } = useApp();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [editingSeat, setEditingSeat] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [hasActiveGame, setHasActiveGame] = useState(false);
  // The three room rules chosen on this screen travel with the create body as
  // separate fields of ONE payload. A standard room is false/false/false:
  // safe zones are stored inverted, so `noSafeZones: false` means they protect.
  const [clashEnabled, setClashEnabled] = useState(false);
  const [noSafeZones, setNoSafeZones] = useState(false);
  const [freeExit, setFreeExit] = useState(false);

  // Backend-authoritative mirror of the state lock: /api/games/mine lists every
  // room this player is seated in after a game started, so an empty answer means
  // this screen may launch. One fetch on mount is enough for a config screen; the
  // persisted activeMatch is deliberately not trusted (it outlives a closed tab).
  useEffect(() => {
    // A guest has no account, so /api/games/mine is a guaranteed 401 and there
    // is no state lock to mirror. The per-address budgets are server-side.
    if (guest) return;
    getApi<Array<{ id: string }>>('/api/games/mine')
      .then((data) => setHasActiveGame(data.length > 0))
      .catch(() => {});
  }, [guest]);

  const [crtEnabled] = useState(() => {
    return localStorage.getItem('crt_enabled') !== 'false';
  });

  useEffect(() => {
    resetSeats();
  }, [resetSeats]);

  const playerCount = (Number(query.get('mode')) || 4) as PlayerCount;
  // Guests always fill with bots (there is nobody else to seat) and never pick
  // the local-hotseat variant.
  const allowAddPlayers = guest || query.get('bots') !== '0';
  const isLocal = !guest && query.get('local') === '1';

  const visible = seats.slice(0, playerCount);
  const botCount = visible.filter((s) => s.type === 'bot').length;
  const emptyCount = visible.filter((s) => s.type === 'empty').length;

  const canStart = allowAddPlayers
    ? botCount >= 1
    : visible.filter((s) => s.type === 'you' || s.type === 'player').length >= 2;

  // Strict state lock, mirrored from the backend: with a live game on the books,
  // this screen cannot launch another one until the player leaves that game.
  const lockedByActiveGame = !guest && hasActiveGame;
  const canLaunch = canStart && !lockedByActiveGame;

  const onStart = async () => {
    if (lockedByActiveGame) {
      retroAudio.playUiBeep(300, 0.08);
      setStartError(t('lobby.activeGameLockError'));
      return;
    }
    if (!canStart || starting) return;
    retroAudio.playUiBeep(880, 0.1);
    setStartError(null);
    setStarting(true);
    try {
      // Guest launch: PvE only, and none of mode/playerCount/seatColors come
      // from here - the server forces the mode, derives the count and seats the
      // human as blue. The exact bot colours travel so the seats shown here are
      // the seats dealt (the server expands them to [blue, ...botColors]).
      if (guest) {
        // Named apart from the non-guest `botCount` below: that one is declared
        // later in this same try block, so reading it here would hit its TDZ.
        const botsSeated = visible.filter((s) => s.type === 'bot').length;
        const botColors = visible
          .map((s, i) => (s.type === 'bot' ? SEAT_COLORS[i] : null))
          .filter((c): c is ColorKey => c !== null);
        const botNames = visible
          .map((s) => (s.type === 'bot' ? s.name : null))
          .filter((n): n is string => n !== null);
        const setup = {
          botCount: botsSeated,
          botColors: botColors.length > 0 ? botColors : undefined,
          botNames: botNames.length > 0 ? botNames : undefined,
          clashEnabled,
          noSafeZones,
          freeExit,
        };
        const res = await postApi<{
          gameId: string;
          token: string;
          engineUrl: string;
          color: PlayerColor;
          mode: 'pvp' | 'pve' | 'hotseat';
          playerCount: number;
          isGuest?: boolean;
        }>('/api/match/guest', setup);
        setGuestSetup(setup);
        setActiveMatch({ ...res, isGuest: true });
        navigate(`/game?gameId=${res.gameId}`);
        return;
      }
      const gameMode = allowAddPlayers ? 'pve' : isLocal || playerCount === 2 ? 'hotseat' : 'pvp';
      const filledCount = visible.filter((s) => s.type === 'you' || s.type === 'player').length;
      const botCount = allowAddPlayers ? visible.filter((s) => s.type === 'bot').length : 0;
      // The bot seats are fixed by index (0=blue,1=red,2=green,3=yellow). Send
      // the actual chosen bot colors so the backend places bots on the exact
      // seats picked here instead of always filling red first.
      const botColors = visible
        .map((s, i) => (s.type === 'bot' ? SEAT_COLORS[i] : null))
        .filter((c): c is ColorKey => c !== null);
      // The assistant name each bot seat was assigned here, index-aligned with
      // botColors. The engine has no locale, so the label travels with the match
      // and each client re-localizes the color word (FR: "bot-rouge (Siri)").
      const botNames = visible
        .map((s) => (s.type === 'bot' ? s.name : null))
        .filter((n): n is string => n !== null);
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
        botNames: botNames.length > 0 ? botNames : undefined,
        seatColors:
          (gameMode === 'hotseat' || gameMode === 'pve') && seatColors.length > 0
            ? seatColors
            : undefined,
        // Room rules, one field each, so the backend persists them in the same
        // create call (no second transaction). All three default to the standard
        // game: clash off, free exit off, safe zones ON.
        clashEnabled,
        noSafeZones,
        freeExit,
      });
      setActiveMatch(res);
      navigate(`/game?gameId=${res.gameId}`);
    } catch (err) {
      setStartError(err instanceof Error ? err.message : t('lobby.createFailed'));
      setStarting(false);
    }
  };

  return (
    <>
      {/* Synthwave cityscape background */}
      <div className={GRID_BACKGROUND} />

      {/* CRT FX Overlay */}
      <div className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''}`} id="crtScreen">
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
          {/* Pre-game notice: keyboard or touch, landscape only. */}
          <LandscapeNotice />

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
                {guest ? t('guest.setupTitle') : t('lobby.arenaMatchConfig')}
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
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  minWidth: 0,
                                }}
                              >
                                <UserAvatar
                                  username={user?.username ?? ''}
                                  userId={user?.id}
                                  hasAvatarPhoto={user?.hasAvatarPhoto ?? false}
                                  avatarStyle={user?.avatarStyle}
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
                                  style={{
                                    borderRadius: 6,
                                    border: `1px solid ${hue}`,
                                    flex: 'none',
                                  }}
                                />
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontWeight: 800,
                                      fontSize: '0.92rem',
                                      color: '#ffffff',
                                      fontFamily: 'var(--font-heading)',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                    title={
                                      (user?.displayName ?? user?.username ?? '') ||
                                      (guest ? t('guest.playerName') : t('common.you'))
                                    }
                                  >
                                    {(user?.displayName ?? user?.username ?? '').toUpperCase() ||
                                      (guest ? t('guest.playerName') : t('common.you'))}
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
                                <div
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    minWidth: 0,
                                  }}
                                >
                                  {/* A bot has no account: a generated avatar, seeded from the
                                      assistant name this seat was assigned here. */}
                                  <UserAvatar
                                    username={seat.name}
                                    isBot
                                    size={38}
                                    fallbackStyle={{
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
                                    style={{
                                      width: 38,
                                      height: 38,
                                      borderRadius: 6,
                                      border: `1px solid ${hue}`,
                                      flex: 'none',
                                    }}
                                  />
                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        fontWeight: 800,
                                        fontSize: '0.92rem',
                                        color: '#ffffff',
                                        fontFamily: 'var(--font-heading)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                      title={seat.name}
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
                                    flex: 'none',
                                  }}
                                  title={t('lobby.removeBotTooltip')}
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
                                    minWidth: 0,
                                  }}
                                >
                                  {/* Local hotseat pilots have no account, so the DiceBear
                                      avatar is seeded from the name typed here. Only the
                                      host's seat above can show an uploaded photo. */}
                                  <UserAvatar
                                    username={seat.name}
                                    size={38}
                                    fallbackStyle={{
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
                                    style={{
                                      width: 38,
                                      height: 38,
                                      borderRadius: 6,
                                      border: `1px solid ${hue}`,
                                      flex: 'none',
                                    }}
                                  />
                                  <div style={{ flex: 1, minWidth: 0 }}>
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
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 4,
                                          minWidth: 0,
                                          fontWeight: 800,
                                          fontSize: '0.92rem',
                                          color: '#ffffff',
                                          fontFamily: 'var(--font-heading)',
                                          cursor: 'pointer',
                                        }}
                                        title={t('lobby.clickToRename')}
                                      >
                                        {/* The pencil stays outside the ellipsized span, so a
                                            long name cannot hide the rename affordance. */}
                                        <span
                                          style={{
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                            minWidth: 0,
                                          }}
                                        >
                                          {seat.name}
                                        </span>
                                        <span style={{ flex: 'none' }}>✎</span>
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
                                    flex: 'none',
                                  }}
                                  title={t('lobby.removePlayerTooltip')}
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
                  if (guest) {
                    setActiveMatch(null);
                    navigate('/login');
                    return;
                  }
                  navigate('/gamelobby');
                }}
              >
                {guest ? t('guest.backToLogin') : t('lobby.returnToGameLobby')}
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

                    {/* Room rules: the three toggles this room is created with. They
                        travel in the create body, so the room is made with them in
                        one call, and the host can still flip them from the game's
                        room-rules panel once the room exists. */}
                    <div
                      style={{
                        borderTop: '1px solid rgba(0, 240, 255, 0.25)',
                        paddingTop: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--accent-cyan)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {t('game.rulesControl')}
                      </span>
                      {(
                        [
                          {
                            key: 'clashMode' as const,
                            icon: '⚔️',
                            label: t('game.clashMode'),
                            desc: t('game.clashModeDesc'),
                            checked: clashEnabled,
                            accent: 'var(--accent-pink)',
                            toggle: setClashEnabled,
                          },
                          {
                            key: 'noSafeZones' as const,
                            icon: '💀',
                            label: t('game.noSafeZones'),
                            desc: t('game.noSafeZonesDesc'),
                            checked: noSafeZones,
                            accent: 'var(--accent-cyan)',
                            toggle: setNoSafeZones,
                          },
                          {
                            key: 'freeExit' as const,
                            icon: '🚪',
                            label: t('game.freeExit'),
                            desc: t('game.freeExitDesc'),
                            checked: freeExit,
                            accent: 'var(--accent-yellow)',
                            toggle: setFreeExit,
                          },
                        ] as const
                      ).map((rule) => (
                        <label
                          key={rule.key}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            fontSize: '0.78rem',
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--text-main)',
                            cursor: 'pointer',
                            border: '1px solid var(--border-color)',
                            borderRadius: 4,
                            padding: '7px 10px',
                            background: 'rgba(0, 0, 0, 0.4)',
                          }}
                        >
                          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                            <span>
                              {rule.icon} {rule.label}
                            </span>
                            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                              {rule.desc}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            checked={rule.checked}
                            onChange={(e) => {
                              // The mutation toggles borrow the seat add/remove pair from this
                              // lobby, so switching a rule ON reads like a seat being added
                              // (520 Hz) and switching one OFF like a seat being removed
                              // (320 Hz), both at the same 0.05 s blip.
                              retroAudio.playUiBeep(e.target.checked ? 520 : 320, 0.05);
                              rule.toggle(e.target.checked);
                            }}
                            style={{
                              accentColor: rule.accent,
                              width: 15,
                              height: 15,
                              cursor: 'pointer',
                            }}
                          />
                        </label>
                      ))}
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
                        color: canLaunch ? '#00ff88' : '#ffe600',
                        marginTop: 12,
                        lineHeight: 1.5,
                      }}
                    >
                      {lockedByActiveGame
                        ? t('lobby.activeGameLockError')
                        : canStart
                          ? t('lobby.allSystemsPassed')
                          : t('lobby.assignAtLeastOne')}
                    </div>
                  </div>

                  <div>
                    {/* LAUNCH BUTTON */}
                    <button
                      onClick={() => {
                        void onStart();
                      }}
                      disabled={!canLaunch || starting}
                      className={RETRO_BTN}
                      title={lockedByActiveGame ? t('lobby.activeGameLockTooltip') : undefined}
                      style={{
                        width: '100%',
                        padding: '16px 0',
                        fontSize: '1rem',
                        fontFamily: 'var(--font-heading)',
                        letterSpacing: '1.2px',
                        background: canLaunch
                          ? 'rgba(0, 255, 136, 0.2)'
                          : 'rgba(255, 255, 255, 0.05)',
                        border: canLaunch
                          ? '1px solid #00ff88'
                          : '1px solid rgba(255, 255, 255, 0.2)',
                        color: canLaunch ? '#00ff88' : 'var(--text-muted)',
                        cursor: canLaunch ? 'pointer' : 'not-allowed',
                        boxShadow: canLaunch ? '0 0 15px rgba(0, 255, 136, 0.4)' : 'none',
                      }}
                    >
                      {lockedByActiveGame
                        ? t('lobby.activeGameLockLabel')
                        : starting
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
