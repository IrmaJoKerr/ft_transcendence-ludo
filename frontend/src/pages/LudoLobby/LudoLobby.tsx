import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApi, postApi } from '../../api';
import { ColorPaletteModal } from '../../components/ColorPaletteModal';
import { GameRulesModal } from '../../components/GameRulesModal';
import { NavDock } from '../../components/NavDock';
import { useFitTextSize } from '../../hooks/useFitTextSize';
import { navigate, useRoute } from '../../router';
import { useApp } from '../../store';
import type { MyRoom } from '../../sessionSocket';
import { SEAT_COLORS, type ColorKey } from '../../theme';
import { retroAudio } from '../../utils/audio';
import { CRT_SCREEN } from '../../styles/tw';
import { LudoLobbyHeader } from './LudoLobbyHeader';
import { PassStack } from './PassStack';
import { RoomsWindow } from './RoomsWindow';
import { claimableColors, type MatchResult, type Room } from './ludoLobbyTypes';

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
  // The arena's rules, opened from the header's GAME RULES button. The modal is the
  // game screen's own component (34, item 2), so the lobby cannot read a page the
  // game does not have; the open flag is all this page owns.
  const [rulesOpen, setRulesOpen] = useState(false);

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
  // MATCH_ALREADY_SEATED. Polling can lag a refresh; the backend is the gate.
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

    // The push half. `rooms:list` is already filtered for this viewer, so the rows drop straight in;
  // `rooms:mine` answers the "active game" lock. A reconnect refetches once, because the broadcaster
  // only emits a diff and the socket may have missed a change while it was down.
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
            // A PvP room is created with the standard rules (false/false/false: clash off, free exit off, safe
      // zones ON, stored inverted).
      const res = await postApi<MatchResult>('/api/match/pvp/invite', {
        hostColor,
        clashEnabled: false,
        noSafeZones: false,
        freeExit: false,
        captureFx: false,
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

    // A friend invite lands here as `? join=<code>`: the accept path in the notification bell/toast
  // carries the room, not a seat, so the invitee claims a corner exactly like a hand-typed code.
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
            <LudoLobbyHeader
              roomsCount={rooms ? rooms.length : 0}
              userName={user?.displayName ?? user?.username}
              lockedByActiveGame={lockedByActiveGame}
            />

            {/* The tactical stack: the three passes, then the rooms window, 3 px apart. */}
            <main className="flex flex-col gap-[3px]" style={{ flex: '1 1 auto', minHeight: 0 }}>
              <PassStack
                passActionProbes={passActionProbes}
                hostLocked={hostLocked}
                hostBusy={hostBusy}
                lockedByActiveGame={lockedByActiveGame}
                onCreateRoom={openCreateRoom}
              />

              <RoomsWindow
                rooms={rooms}
                filteredRooms={filteredRooms}
                error={error}
                roomCodeInputRef={roomCodeInputRef}
                roomCodeInput={roomCodeInput}
                onCodeChange={setRoomCodeInput}
                roomCodeFontSize={roomCodeFontSize}
                joiningByCode={joiningByCode}
                lockedByActiveGame={lockedByActiveGame}
                joiningRoomId={joiningRoomId}
                username={user?.username}
                onOpenJoinByCode={openJoinByCode}
                onRejoinRoom={rejoinRoom}
                onOpenJoinRoom={openJoinRoom}
                onOpenRules={() => setRulesOpen(true)}
              />
            </main>
          </div>
        </div>
      </div>

      {/* The rules, ten pages of them: the game screen's component, mounted here so
          the lobby's GAME RULES button and the game's read the same ten pages. */}
      <GameRulesModal isOpen={rulesOpen} onClose={() => setRulesOpen(false)} />

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
