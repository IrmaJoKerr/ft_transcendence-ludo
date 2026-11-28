import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApi, postApi } from '../../api';
import { ColorPaletteModal } from '../../components/ColorPaletteModal';
import type { PlayerColor } from '../../game/types';
import { navigate, useRoute } from '../../router';
import { freeColors, isOccupiedSeat, useApp, type PlayerCount } from '../../store';
import type { ColorKey } from '../../theme';
import { retroAudio } from '../../utils/audio';
import { CRT_SCREEN, APP_WRAPPER, DASHBOARD_GRID, RETRO_BTN } from '../../styles/tw';
import { LobbyHeader } from './LobbyHeader';
import { LobbySummary } from './LobbySummary';
import { SeatRoster } from './SeatRoster';

export function Lobby({ guest = false }: { guest?: boolean } = {}) {
  const { t } = useTranslation();
  const { query } = useRoute();
  const {
    seats,
    placeHost,
    addBot,
    addPlayer,
    removeSeat,
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
  // The card the palette is filling: the host's own card on arrival, then whichever
  // empty card's add action was pressed. Null while the palette is closed.
  const [paletteCard, setPaletteCard] = useState<number | null>(null);
  // The room rules chosen on this screen travel with the create body as separate fields of ONE
  // payload.
  const [clashEnabled, setClashEnabled] = useState(false);
  const [noSafeZones, setNoSafeZones] = useState(false);
  const [freeExit, setFreeExit] = useState(false);
  // The attack animations: a positive flag, independent of clash mode.
  const [captureFx, setCaptureFx] = useState(false);
  // The mutator's count, kept apart from whether it is on, so re-enabling restores
  // 1 or 2 instead of resetting: `clashKeyShift` is the value that ships.
  const [clashShiftCount, setClashShiftCount] = useState<1 | 2>(1);
  const [clashKeyShift, setClashKeyShift] = useState<0 | 1 | 2>(0);

  // Backend-authoritative mirror of the state lock: /api/games/mine lists every room
  // this player is seated in after a game started, so an empty answer means this screen
  // may launch. One fetch on mount is enough; activeMatch is deliberately not trusted.
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
  // the local-hotseat variant. `botRoom` is what "this room is filled with bots"
  // means; it is also the mode switch below, because a bot room is a PvE room.
  const botRoom = guest || query.get('bots') !== '0';
  const isLocal = !guest && query.get('local') === '1';

  const visible = seats.slice(0, playerCount);
  const filledCount = visible.filter(isOccupiedSeat).length;
  const hostSeat = visible.find((s) => s.type === 'you');
  const hostSeated = hostSeat !== undefined;
  const emptyCount = visible.length - filledCount;

  // The host picks first: until their colour is theirs, no card can be filled, so
  // the palette opens on arrival (and again whenever the host gives the seat back).
  // A guest picks too: the guest mint takes the same `hostColor` as any other create.
  useEffect(() => {
    if (hostSeated) return;
    setPaletteCard((prev) => prev ?? 0);
  }, [hostSeated]);

  // A pick is final and it seats whoever that card is for: the host on arrival,
  // then a bot (bot room) or a local pilot (hotseat). One palette, one meaning.
  const onPickColor = (color: ColorKey) => {
    const card = paletteCard ?? 0;
    setPaletteCard(null);
    if (!hostSeated) placeHost(card, color);
    else if (botRoom) addBot(card, color);
    else addPlayer(card, color);
  };

  const canStart = hostSeated && filledCount >= 2;

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
      // `canStart` guarantees a host seat, so `hostSeat` is narrowed here.
      // Guest launch: PvE only, and none of mode/playerCount/seatColors come from here;
      // the server forces the mode and derives the count. The guest's corner and the
      // bot colours travel, so the seats shown are the seats dealt.
      if (guest) {
        const botsSeated = visible.filter((s) => s.type === 'bot').length;
        const botColors = visible.filter((s) => s.type === 'bot').map((s) => s.color);
        const botNames = visible
          .map((s) => (s.type === 'bot' ? s.name : null))
          .filter((n): n is string => n !== null);
        const setup = {
          botCount: botsSeated,
          hostColor: hostSeat.color,
          botColors: botColors.length > 0 ? botColors : undefined,
          botNames: botNames.length > 0 ? botNames : undefined,
          clashEnabled,
          noSafeZones,
          freeExit,
          // The attack animations: a positive flag, independent of clash mode.
          captureFx,
          // The mutator only exists with clash mode on; the engine clamps it too.
          clashKeyShift: clashEnabled ? clashKeyShift : 0,
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
      const gameMode = botRoom ? 'pve' : isLocal || playerCount === 2 ? 'hotseat' : 'pvp';
      const participants = filledCount;
      const botCount = botRoom ? visible.filter((s) => s.type === 'bot').length : 0;
      // A bot's colour is the colour its card was given, in card order: the seats
      // shown here are the seats dealt, so the backend places each bot at the slot
      // that colour owns instead of filling red first.
      const botColors = visible.filter((s) => s.type === 'bot').map((s) => s.color);
      // The assistant name each bot seat was assigned here, index-aligned with
      // botColors. The engine has no locale, so the label travels with the match
      // and each client re-localizes the color word (FR: "bot-rouge (Siri)").
      const botNames = visible
        .map((s) => (s.type === 'bot' ? s.name : null))
        .filter((n): n is string => n !== null);
      // The seated cards' colours in card order. `seatColors` travels because a room that skips a corner
      // must not be re-densified: the engine seats exactly these colours. It does NOT decide who moves
      // first — turn order is colour order (blue → red → green → yellow).
      const seatColors = visible.filter(isOccupiedSeat).map((s) => s.color);
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
          gameMode === 'hotseat' ? participants : gameMode === 'pve' ? 1 + botCount : playerCount,
        botCount,
        // The host's colour is the host's seat: the server writes them at that
        // colour's slot, so the card here and the quadrant in game are the same.
        hostColor: hostSeat.color,
        botColors: botColors.length > 0 ? botColors : undefined,
        botNames: botNames.length > 0 ? botNames : undefined,
        seatColors: gameMode === 'pvp' ? undefined : seatColors,
        // Room rules, one field each, so the backend persists them in the same
        // create call (no second transaction). All four default to the standard
        // game: clash off, free exit off, safe zones ON, no key switch.
        clashEnabled,
        noSafeZones,
        freeExit,
        // The attack animations: a positive flag, independent of clash mode.
        captureFx,
        clashKeyShift: clashEnabled ? clashKeyShift : 0,
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
          {/* Hero Header - Identical 1-to-1 design & dimensions as Game.tsx */}{' '}
          <LobbyHeader guest={guest} />
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
              <SeatRoster
                visible={visible}
                playerCount={playerCount}
                emptyCount={emptyCount}
                editingSeat={editingSeat}
                editName={editName}
                guest={guest}
                botRoom={botRoom}
                hostSeated={hostSeated}
                onRemoveSeat={removeSeat}
                onRenameSeat={renamePlayer}
                onEditingSeat={setEditingSeat}
                onEditName={setEditName}
                onPickColor={setPaletteCard}
              />

              {/* RETURN TO GAME LOBBY BUTTON — centred for the same reason as LAUNCH:
                  the shared `RETRO_BTN` is an `inline-flex` row with no `justify`. */}
              <button
                className={`${RETRO_BTN} justify-center`}
                style={{
                  width: '100%',
                  padding: '12px 0',
                  fontSize: '0.84rem',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.5px',
                  background: 'rgb(var(--accent-cyan-rgb) / 0.12)',
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
              <LobbySummary
                playerCount={playerCount}
                emptyCount={emptyCount}
                botRoom={botRoom}
                visible={visible}
                isLocal={isLocal}
                canLaunch={canLaunch}
                canStart={canStart}
                lockedByActiveGame={lockedByActiveGame}
                hostSeated={hostSeated}
                starting={starting}
                startError={startError}
                onStart={() => {
                  void onStart();
                }}
                clashEnabled={clashEnabled}
                onClash={setClashEnabled}
                clashShiftCount={clashShiftCount}
                onClashShiftCount={setClashShiftCount}
                clashKeyShift={clashKeyShift}
                onClashKeyShift={setClashKeyShift}
                freeExit={freeExit}
                onFreeExit={setFreeExit}
                noSafeZones={noSafeZones}
                onNoSafeZones={setNoSafeZones}
                captureFx={captureFx}
                onCaptureFx={setCaptureFx}
              />
            </div>
          </main>
        </div>
      </div>

      {/* The colour picker. It lists the corners still free, so a taken colour is
          never offered, and it closes on the first pick: the claim is final. */}
      <ColorPaletteModal
        isOpen={paletteCard !== null}
        title={t('lobby.pickColorTitle')}
        colors={freeColors(seats)}
        onPick={onPickColor}
        onCancel={() => setPaletteCard(null)}
      />
    </>
  );
}
