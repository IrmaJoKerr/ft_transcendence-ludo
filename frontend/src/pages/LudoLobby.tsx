import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { getApi, postApi } from '../api';
import { ColorPaletteModal } from '../components/ColorPaletteModal';
import { UserAvatar } from '../components/UserAvatar';
import { NavDock } from '../components/NavDock';
import type { PlayerColor } from '../game/types';
import { useFitTextSize } from '../hooks/useFitTextSize';
import { navigate, useRoute } from '../router';
import { useApp } from '../store';
import type { LobbyRoom, MyRoom } from '../sessionSocket';
import { COL, SEAT_COLORS, type ColorKey } from '../theme';
import { retroAudio } from '../utils/audio';
import '../styles/retrowave.css';
import {
  CRT_SCREEN,
  GRID_BACKGROUND,
  HERO_SECTION,
  HERO_TITLE,
  HERO_SUBTITLE,
  BADGE_BAR,
  RETRO_BADGE,
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_BODY,
  RETRO_BTN,
  RETRO_TICKET_PASS,
  TICKET_PINK,
  TICKET_YELLOW,
  TICKET_GREEN,
  TICKET_ACTION_PILL,
} from '../styles/tw';

// The lobby list and the "am I already seated?" flag are pushed over the session
// socket now (`rooms:list` / `rooms:mine`); this screen sends no periodic request.
// The one REST read below is first paint, before the socket connects.

type Room = LobbyRoom;

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

/**
 * The corners a room still offers, narrowed to the palette's key type. A room that
 * lists none is full; a code that matches no listed room has no list at all, so the
 * palette offers every corner and the server answers MATCH_COLOR_TAKEN if one is
 * gone (the claim is final either way).
 */
function claimableColors(free?: string[]): ColorKey[] {
  const pool = free ?? SEAT_COLORS;
  return SEAT_COLORS.filter((color) => pool.includes(color));
}

function hueForHost(host: string): string {
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
  return ROOM_AVATAR_HUES[hash % ROOM_AVATAR_HUES.length];
}

// One track list for the header and the rows. `minmax(0, …)` keeps a long chip from
// widening its track, and the fixed action width keeps a JOIN button from sizing it
// differently than the ACTION label does.
const ROOM_GRID_COLUMNS =
  'minmax(0, 0.95fr) minmax(0, 1.45fr) minmax(0, 0.7fr) minmax(0, 0.85fr) minmax(0, 1.55fr) 104px';

// The room rules, in the same order and with the same icons/accents as the
// create-screen toggles (clash, free exit, no safe zones), so a chip in the list
// reads as the switch that made it.
const ROOM_MODES = [
  { key: 'clashEnabled', icon: '⚔️', label: 'game.clashMode', hue: '#ff007f' },
  { key: 'freeExit', icon: '🚪', label: 'game.freeExit', hue: '#ffe600' },
  { key: 'noSafeZones', icon: '💀', label: 'game.noSafeZones', hue: '#00f0ff' },
] as const;

// A room with no mutator is the "base game" category, not an empty cell.
const BASE_MODE_HUE = '#b8a6e4';

function modeChipStyle(hue: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    padding: '2px 5px',
    borderRadius: 4,
    border: `1px solid ${hue}66`,
    background: `${hue}1f`,
    color: hue,
    fontFamily: 'var(--font-mono)',
    fontSize: '0.58rem',
    fontWeight: 'bold',
    letterSpacing: '0.3px',
    lineHeight: 1.35,
    whiteSpace: 'nowrap',
    textTransform: 'uppercase',
  };
}

/**
 * MODES cell: "Base Game" alone, or the active mutators only. The full names are
 * also on the cell's `title`, so a chip clipped by a narrow column still resolves
 * to something readable (a hover-only "i" would leave touch users with nothing).
 */
function RoomModes({ room }: { room: Room }) {
  const { t } = useTranslation();
  const active = ROOM_MODES.filter((mode) => room[mode.key]);
  const summary = active.length
    ? active.map((mode) => t(mode.label)).join(' · ')
    : t('ludoLobbyPasses.modeBase');

  return (
    <div
      title={summary}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 4,
        minWidth: 0,
      }}
    >
      {active.length === 0 ? (
        <span style={modeChipStyle(BASE_MODE_HUE)}>{t('ludoLobbyPasses.modeBase')}</span>
      ) : (
        active.map((mode) => (
          <span key={mode.key} style={modeChipStyle(mode.hue)}>
            <span aria-hidden="true">{mode.icon}</span>
            {t(mode.label)}
          </span>
        ))
      )}
    </div>
  );
}
// The three passes end in the same control in three colours, so the three pills
// share one width: the widest of the labels the active language can produce.
// Each pill stacks all of those labels in one grid cell, hidden, so the cell —
// and with it the pill — is as wide as the longest one. Nothing is measured and
// no number is stored, so a new translation or a longer label needs no code.
interface PassActionPillProps {
  label: string;
  /** Every label the three pills can show, in the active language. */
  probes: string[];
  style?: CSSProperties;
}

function PassActionPill({ label, probes, style }: PassActionPillProps) {
  return (
    <div
      className={TICKET_ACTION_PILL}
      style={{ display: 'inline-grid', placeItems: 'center', ...style }}
    >
      <span style={{ gridArea: '1 / 1' }}>{label}</span>
      {probes.map((probe) => (
        <span key={probe} aria-hidden="true" style={{ gridArea: '1 / 1', visibility: 'hidden' }}>
          {probe}
        </span>
      ))}
    </div>
  );
}

export function LudoLobby() {
  const { t } = useTranslation();
  const { user, setActiveMatch, sessionSocket } = useApp();
  const { query } = useRoute();

  // Every string a pass pill can display, so the three pills can share the widest
  // one's width. `creating` is in the list because the host pill swaps to it while
  // the room is being made, and the pill must not resize under the pointer.
  const passActionProbes = Array.from(
    new Set(
      ['hostNewTable', 'creating', 'launchHotseat', 'playVsBots'].map(
        (key) => `▶ ${t(`ludoLobbyPasses.${key}`)}`,
      ),
    ),
  );

  // **CRT CONTROLS**
  // Read once at mount: the CRT look is a page-level choice, not a dock control.
  const [crtEnabled] = useState(() => localStorage.getItem('retro_crt') !== 'false');

  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  const [hasActiveGame, setHasActiveGame] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);

  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [joiningByCode, setJoiningByCode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The colour picker. Both directions claim one corner: a created room is the
  // host's own colour, a joined room is one of the corners it still lists. Nothing
  // is posted until a colour is picked, and a pick is final (no swap afterwards).
  const [palette, setPalette] = useState<
    | { kind: 'create' }
    | { kind: 'join'; code: string; room?: Room; colors: ColorKey[] }
    | null
  >(null);

  // Strict state lock, mirrored from the backend: /api/games/mine lists every room
  // this player is seated in, and the backend refuses create or join with
  // MATCH_ACTIVE_GAME. Polling can lag a refresh; the backend is the gate.
  const lockedByActiveGame = hasActiveGame;
  const hostLocked = hostBusy || lockedByActiveGame;

  // The room-code field is a fixed-width box in the rooms window header, so scale
  // its text down to fit: the Malay placeholder ("MASUKKAN KOD") is longer than
  // the EN/FR ones and was overflowing the input.
  const { ref: roomCodeInputRef, fontSize: roomCodeFontSize } = useFitTextSize(
    [t('ludoLobbyPasses.enterCodePlaceholder'), roomCodeInput],
    { maxFontSize: 13, reserve: 4 },
  );

  const fetchRooms = () => {
    getApi<Room[]>('/api/games/rooms')
      .then((data) => setRooms(data))
      .catch(() => setRooms((prev) => prev ?? []));
  };

  const fetchHasActiveGame = () => {
    getApi<MyRoom[]>('/api/games/mine')
      .then((data) => setHasActiveGame(data.length > 0))
      .catch(() => {});
  };

  // First paint only: the socket push carries every change after it connects.
  useEffect(() => {
    fetchRooms();
    fetchHasActiveGame();
  }, []);

  // The push half. `rooms:list` is already filtered for this viewer, so the rows
  // drop straight in; `rooms:mine` answers the "active game" lock. A reconnect
  // refetches once, because the broadcaster only emits a diff and the socket may
  // have missed a change while it was down.
  useEffect(() => {
    if (!sessionSocket) return;
    const onRooms = (rooms: Room[]) => setRooms(rooms);
    const onMine = (rooms: MyRoom[]) => setHasActiveGame(rooms.length > 0);
    const onConnect = () => {
      fetchRooms();
      fetchHasActiveGame();
    };
    sessionSocket.on('rooms:list', onRooms);
    sessionSocket.on('rooms:mine', onMine);
    sessionSocket.on('connect', onConnect);
    return () => {
      sessionSocket.off('rooms:list', onRooms);
      sessionSocket.off('rooms:mine', onMine);
      sessionSocket.off('connect', onConnect);
    };
  }, [sessionSocket]);

  const createRoom = async (hostColor: ColorKey) => {
    if (lockedByActiveGame) {
      retroAudio.playUiBeep(300, 0.08);
      setError(t('lobbyBrowser.createRoomWhileActiveError'));
      return;
    }
    setHostBusy(true);
    setError(null);
    retroAudio.playUiBeep(920, 0.08);
    try {
      // A PvP room is created with the standard rules (false/false/false: clash
      // off, free exit off, safe zones ON, stored inverted). The host flips them
      // from the room's rules panel, which is where the wire carries the object.
      // `hostColor` is the corner the host picked: the room is theirs, so their
      // seat is written at that colour's slot and the other three stay claimable.
      const res = await postApi<MatchResult>('/api/match/pvp/invite', {
        hostColor,
        clashEnabled: false,
        noSafeZones: false,
        freeExit: false,
      });
      setActiveMatch(res);
      navigate(`/game?gameId=${res.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lobbyBrowser.createFailed'));
    } finally {
      setHostBusy(false);
    }
  };

  // Opening the palette is the whole "host a table" action now: the room does not
  // exist until the host has picked the corner it will be theirs in.
  const openCreateRoom = () => {
    if (lockedByActiveGame) {
      retroAudio.playUiBeep(300, 0.08);
      setError(t('lobbyBrowser.createRoomWhileActiveError'));
      return;
    }
    setError(null);
    retroAudio.playUiBeep(920, 0.08);
    setPalette({ kind: 'create' });
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
      setError(err instanceof Error ? err.message : t('lobbyBrowser.rejoinFailed'));
      setJoiningRoomId(null);
      fetchRooms();
    }
  };

  // The code path. A code that is one of this viewer's own rooms goes straight to
  // the rejoin; anything else opens the palette on the corners that room lists, or
  // on all four when the code matched no listed row (the server is the last word).
  const openJoinByCode = (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    const listed = (rooms ?? []).find((r) => r.roomCode === trimmed);
    const ownRoom = (rooms ?? []).find(
      (r) => r.roomCode === trimmed && (r.mySeat ?? r.hostUsername === user?.username),
    );
    if (ownRoom) {
      void rejoinRoom(ownRoom);
      return;
    }
    if (lockedByActiveGame) {
      retroAudio.playUiBeep(300, 0.08);
      setError(t('lobbyBrowser.activeGameLockError'));
      return;
    }
    setError(null);
    retroAudio.playUiBeep(780, 0.06);
    setPalette({ kind: 'join', code: trimmed, colors: claimableColors(listed?.freeColors) });
  };

  const joinByCode = async (code: string, color: ColorKey) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setJoiningByCode(true);
    setError(null);
    retroAudio.playUiBeep(780, 0.06);
    try {
      // The claim is final: the seat is written at this colour's slot, and a taken
      // colour answers MATCH_COLOR_TAKEN instead of seating the joiner elsewhere.
      const res = await postApi<MatchResult>(`/api/match/join/${encodeURIComponent(trimmed)}`, {
        color,
      });
      setActiveMatch(res);
      navigate(`/game?gameId=${res.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lobbyBrowser.joinFailed'));
      setJoiningByCode(false);
      fetchRooms();
    }
  };

  const joinRoom = async (room: Room, color: ColorKey) => {
    // Strict lock: a second room cannot be entered while one game is live.
    if (lockedByActiveGame) {
      retroAudio.playUiBeep(300, 0.08);
      setError(t('lobbyBrowser.activeGameLockError'));
      return;
    }
    setJoiningRoomId(room.id);
    setError(null);
    retroAudio.playUiBeep(780, 0.06);
    try {
      const res = await postApi<MatchResult>(
        `/api/match/join/${encodeURIComponent(room.roomCode)}`,
        { color },
      );
      setActiveMatch(res);
      navigate(`/game?gameId=${res.gameId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('lobbyBrowser.joinFailed'));
      setJoiningRoomId(null);
      fetchRooms();
    }
  };

  // A row's JOIN opens the palette on the corners it still lists; a full row never
  // gets here (the button is disabled).
  const openJoinRoom = (room: Room) => {
    if (lockedByActiveGame) {
      retroAudio.playUiBeep(300, 0.08);
      setError(t('lobbyBrowser.activeGameLockError'));
      return;
    }
    setError(null);
    retroAudio.playUiBeep(780, 0.06);
    setPalette({
      kind: 'join',
      code: room.roomCode,
      room,
      colors: claimableColors(room.freeColors),
    });
  };

  // One pick, one claim: the palette's target says whether this pick creates the
  // room (the host's own corner) or joins one (a corner the room still lists).
  const onPickColor = (color: ColorKey) => {
    const target = palette;
    setPalette(null);
    if (!target) return;
    if (target.kind === 'create') void createRoom(color);
    else if (target.room) void joinRoom(target.room, color);
    else void joinByCode(target.code, color);
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

  // A friend invite lands here as `?join=<code>`: the accept path in the notification
  // bell/toast carries the room, not a seat, so the invitee claims a corner exactly
  // like a hand-typed code. It waits for the first room snapshot, because that is
  // what tells the palette which corners the room still offers; the ref makes it
  // one-shot, so closing the palette does not reopen it on the next render.
  const handledJoinCode = useRef<string | null>(null);
  useEffect(() => {
    const code = (query.get('join') ?? '').trim().toUpperCase();
    if (!code || rooms === null || handledJoinCode.current === code) return;
    handledJoinCode.current = code;
    setRoomCodeInput(code);
    openJoinByCode(code);
    // `openJoinByCode` is re-created every render; the ref guard above is what keeps
    // this effect from firing twice, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, rooms]);

  const filteredRooms = rooms ?? [];

  return (
    <>
      {/* Synthwave cityscape background */}
      <div className={GRID_BACKGROUND} />

      {/* CRT Monitor Overlay FX Container */}
      <div className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''}`} id="crtScreen">
        {/* Dynamic Full-Width Seated Sidebar & Content Layout Container */}
        <div className="relative z-10 box-border flex min-h-screen w-full flex-row items-start justify-center gap-7 px-6 py-8">
          {/* Left-Seated Navigation Dock */}
          <NavDock activeRoute="/gamelobby" />

          {/* Main Content Flow */}
          <div
            className="sticky top-8 flex w-full min-w-0 flex-1 flex-col"
            style={{ margin: 0, padding: 0, minHeight: 'calc(100vh - 64px)' }}
          >
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
                    border: lockedByActiveGame
                      ? '1px solid var(--accent-yellow)'
                      : '1px dashed rgba(255,255,255,0.2)',
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

            {/* The tactical stack: the three passes, then the rooms window, 3 px
                apart — the same air the passes keep between themselves. A single
                column, so it is a flex column rather than a 12-column grid, and it
                is as tall as the dock (`100vh - 64`): the passes keep their size and
                the window takes whatever is left, so its lower edge lands on the
                dock's and its top sits 3 px under Level 03. The error channel is not
                in this column at all — it rides in the rooms window's header (see
                `roomsWindow`) — so no failure can move the passes or resize the
                window. */}
            <main className="flex flex-col gap-[3px]" style={{ flex: '1 1 auto', minHeight: 0 }}>
              {/* TACTICAL COMBAT PASSES CONTAINER: three tickets, 3 px apart, so
                  they read as one stack rather than three separate cards. */}
              <div className="flex flex-col gap-[3px]">
                {/* **LEVEL 1: HOST NEW TABLE TICKET** */}
                <div
                  className={`${RETRO_TICKET_PASS} ${TICKET_PINK} ${hostLocked ? 'disabled' : ''}`}
                  onClick={
                    hostLocked
                      ? undefined
                      : () => {
                          openCreateRoom();
                        }
                  }
                  role="button"
                  tabIndex={0}
                  title={lockedByActiveGame ? t('lobbyBrowser.activeGameLockTooltip') : undefined}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (!hostLocked) openCreateRoom();
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
                      color: '#ffffff',
                      boxShadow: '0 0 18px rgba(255, 0, 127, 0.5)',
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
                    style={{
                      background: 'rgba(255, 230, 0, 0.22)',
                      border: '1.5px solid #ffe600',
                      color: '#ffe600',
                      boxShadow: '0 0 16px rgba(255, 230, 0, 0.4)',
                    }}
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
                    <div style={{ minWidth: 0, flex: 1 }}>
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
                    style={{
                      background: 'rgba(0, 255, 136, 0.22)',
                      border: '1.5px solid #00ff88',
                      color: '#00ff88',
                      boxShadow: '0 0 16px rgba(0, 255, 136, 0.4)',
                    }}
                  />
                </div>
              </div>

              {/* **BELOW THEM: OPEN QUANTUM ROOMS** */}
              {/* The window takes the height the passes leave behind, so its lower
                  edge sits on the dock's. The `0` basis matters: with an `auto`
                  basis the window's own content would size the whole column, and
                  the column would grow past the viewport instead of the list
                  scrolling inside the window. The floor is one row plus the
                  window's chrome; below that the page scrolls. */}
              <section
                className={RETRO_WINDOW}
                id="roomsWindow"
                style={{ flex: '1 1 0', minHeight: 180 }}
              >
                {/* The room-code field is the header's right-hand control. The
                    header wraps, and the title keeps `minWidth: 0`, so the input
                    can never squeeze it.

                    The page's error line shares this row, between the title and the
                    field: the header is the only strip in the lobby with slack to
                    spare, so a failure is read where the action that caused it
                    lives, and the list stops paying rent for a reserved band. It is
                    centred in that slack — `justifyContent: 'center'` on the span —
                    so every string the three locales can produce sits equidistant
                    from the counter and the field instead of hugging the counter.
                    The status span is `width: 0` with `flex: 1 1 0` and
                    `minWidth: 0`: the definite zero width is what keeps the message
                    out of the line-breaking maths (a zero basis alone still counts
                    the text towards the group's max-content size — measured, the
                    header grew 57 → 87 px), and `grow` hands it the row's slack, so
                    a long message cannot widen the title group, push the field onto
                    a second row or change the header's height. It shrinks first,
                    ellipsising to fit (`maxWidth: 100%` on the message); an empty
                    one leaves the row exactly as it was, and its 4 px of margin —
                    on top of the group's 8 px gap, against the header's 12 px gap
                    on the other side — is what keeps the air symmetric when a
                    message fills the slack. One line, with the whole
                    sentence in `title`. `role="status"` is on the always mounted
                    span, so the line is announced when it arrives. */}
                <div
                  className={WINDOW_HEADER}
                  style={{
                    background: '#190a38',
                    borderBottom: '1px solid rgba(0, 240, 255, 0.3)',
                    padding: '12px 14px',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0,
                      flex: '1 1 auto',
                    }}
                  >
                    <span
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flexShrink: 0,
                      }}
                    >
                      {t('ludoLobbyPasses.openQuantumRooms')} ({filteredRooms.length})
                    </span>
                    <span
                      role="status"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        // Centred in the row's slack: whatever string is in it —
                        // any of the three locales, any length — sits equidistant
                        // from the counter and the code field rather than hugging
                        // the counter. A message too long for the slack fills it
                        // (`maxWidth: 100%` on the child) and ellipsises.
                        justifyContent: 'center',
                        // A definite zero width is what keeps the message out of the
                        // header's line-breaking maths (a `0` basis alone does not:
                        // the text still counts towards the group's max-content
                        // size). `grow` then hands it every pixel the row has left.
                        width: 0,
                        flex: '1 1 0',
                        minWidth: 0,
                        // 4 + the group's 8 px gap = the header's own 12 px gap on
                        // the other side of this span, so a message that fills the
                        // slack gets the same air on both sides.
                        marginLeft: error ? 4 : 0,
                      }}
                    >
                      {error && (
                        <span
                          title={t('ludoLobbyExtra.errorPrefix', { message: error })}
                          style={{
                            minWidth: 0,
                            maxWidth: '100%',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            letterSpacing: '0.4px',
                            color: '#ffffff',
                            textShadow: '0 0 10px rgba(255, 0, 85, 0.65)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {t('ludoLobbyExtra.errorPrefix', { message: error })}
                        </span>
                      )}
                    </span>
                  </div>

                  {/* Warp by code: the header's right-hand control. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <input
                      ref={roomCodeInputRef}
                      value={roomCodeInput}
                      onChange={(e) => setRoomCodeInput(e.target.value.toUpperCase())}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          roomCodeInput.trim().length > 0 &&
                          !joiningByCode
                        ) {
                          void openJoinByCode(roomCodeInput);
                        }
                      }}
                      placeholder={t('ludoLobbyPasses.enterCodePlaceholder')}
                      maxLength={8}
                      aria-label={t('ludoLobbyPasses.accessViaCode')}
                      title={t('ludoLobbyPasses.accessViaCodeDesc')}
                      style={{
                        width: 132,
                        height: 32,
                        boxSizing: 'border-box',
                        background: 'rgba(5, 2, 18, 0.92)',
                        border: '1.5px solid var(--accent-cyan)',
                        borderRadius: 6,
                        color: '#ffe600',
                        padding: '0 10px',
                        fontSize: roomCodeFontSize,
                        fontWeight: 'bold',
                        fontFamily: 'var(--font-mono)',
                        letterSpacing: '1.5px',
                        textAlign: 'center',
                        outline: 'none',
                        boxShadow: 'inset 0 0 10px rgba(0, 240, 255, 0.25)',
                      }}
                    />
                    <button
                      type="button"
                      className={RETRO_BTN}
                      onClick={() => openJoinByCode(roomCodeInput)}
                      disabled={!roomCodeInput.trim() || joiningByCode || lockedByActiveGame}
                      title={
                        lockedByActiveGame ? t('lobbyBrowser.activeGameLockTooltip') : undefined
                      }
                      style={{
                        height: 32,
                        padding: '0 14px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '0.72rem',
                        background: 'rgba(0, 240, 255, 0.22)',
                        borderColor: 'var(--accent-cyan)',
                        color: 'var(--accent-cyan)',
                        opacity:
                          !roomCodeInput.trim() || joiningByCode || lockedByActiveGame ? 0.5 : 1,
                        cursor:
                          !roomCodeInput.trim() || joiningByCode || lockedByActiveGame
                            ? 'not-allowed'
                            : 'pointer',
                        boxShadow: '0 0 16px rgba(0, 240, 255, 0.4)',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {joiningByCode
                        ? `▶ ${t('ludoLobbyPasses.warping')}`
                        : `▶ ${t('ludoLobbyPasses.accessRoom')}`}
                    </button>
                  </div>
                </div>

                <div
                  className={WINDOW_BODY}
                  style={{
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    minHeight: 0,
                  }}
                >
                  {/* Room Table: it fills the body, so the list is the box that
                      grows with the window and scrolls on its own. */}
                  <div
                    style={{
                      border: '1px solid rgba(0, 240, 255, 0.25)',
                      borderRadius: 6,
                      background: 'rgba(5, 2, 18, 0.8)',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      flex: '1 1 auto',
                      minHeight: 0,
                    }}
                  >
                    {/* Header and rows share one scroll box, so the scrollbar takes
                        the same width from both and the tracks stay aligned. */}
                    <div style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
                      {/* Header Row */}
                      <div
                        style={{
                          position: 'sticky',
                          top: 0,
                          zIndex: 1,
                          display: 'grid',
                          gridTemplateColumns: ROOM_GRID_COLUMNS,
                          gap: 8,
                          padding: '10px 14px',
                          background: 'rgba(25, 10, 56, 0.98)',
                          borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
                          fontSize: '0.68rem',
                          fontWeight: 'bold',
                          color: 'var(--accent-cyan)',
                          fontFamily: 'var(--font-mono)',
                          textAlign: 'left',
                        }}
                      >
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colSectorCode')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colHostCallsign')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colCapacity')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colStakes')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colModes')}
                        </div>
                        <div style={{ textAlign: 'left', whiteSpace: 'nowrap' }}>
                          {t('ludoLobbyPasses.colAction')}
                        </div>
                      </div>

                      {/* Room Rows */}
                      <div
                        style={{
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
                        ) : filteredRooms.length === 0 ? (
                          <div
                            style={{
                              padding: '28px 0',
                              textAlign: 'center',
                              color: 'var(--text-soft)',
                              fontSize: 'calc(0.78rem + 1pt)',
                            }}
                          >
                            {t('ludoLobbyPasses.noOpenRooms')}
                          </div>
                        ) : (
                          filteredRooms.map((room) => {
                            const isMySeat = room.mySeat ?? room.hostUsername === user?.username;
                            const full = room.seats >= room.maxSeats;
                            const hue = hueForHost(room.host);
                            return (
                              <div
                                key={room.id}
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: ROOM_GRID_COLUMNS,
                                  gap: 8,
                                  padding: '12px 14px',
                                  borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
                                  alignItems: 'center',
                                  textAlign: 'left',
                                  background: isMySeat ? 'rgba(255, 0, 127, 0.12)' : 'transparent',
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
                                    <div style={{ color: 'var(--text-soft)', fontSize: '0.65rem' }}>
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
                                  <span style={badgeStyle('ranked')}>
                                    {t('lobbyBrowser.ranked')}
                                  </span>
                                </div>
                                <div style={{ minWidth: 0 }}>
                                  <RoomModes room={room} />
                                </div>
                                <div>
                                  <button
                                    className={RETRO_BTN}
                                    onClick={() => {
                                      if (isMySeat) void rejoinRoom(room);
                                      else openJoinRoom(room);
                                    }}
                                    disabled={
                                      (!isMySeat && (full || lockedByActiveGame)) ||
                                      joiningRoomId === room.id
                                    }
                                    title={
                                      !isMySeat && lockedByActiveGame
                                        ? t('lobbyBrowser.activeGameLockTooltip')
                                        : undefined
                                    }
                                    style={{
                                      padding: '5px 12px',
                                      fontSize: '0.7rem',
                                      background: isMySeat ? 'var(--accent-pink)' : undefined,
                                      opacity:
                                        (!isMySeat && (full || lockedByActiveGame)) ||
                                        joiningRoomId === room.id
                                          ? 0.4
                                          : 1,
                                      cursor:
                                        !isMySeat && (full || lockedByActiveGame)
                                          ? 'not-allowed'
                                          : 'pointer',
                                    }}
                                  >
                                    {isMySeat
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
                </div>
              </section>
            </main>
          </div>
        </div>
      </div>

      {/* The corner picker. It is the only place a seat colour is chosen: the host
          picks the corner the room is created in, a joiner picks from the corners
          that room still lists. `null` closes it, and the pick itself closes the
          modal before the request goes out so a double click cannot claim twice. */}
      {palette && (
        <ColorPaletteModal
          isOpen
          title={t('lobby.pickColorTitle')}
          colors={palette.kind === 'create' ? SEAT_COLORS : palette.colors}
          onPick={onPickColor}
          onCancel={() => setPalette(null)}
        />
      )}
    </>
  );
}
