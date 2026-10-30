import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Board } from '../components/Board';
import { CaptureBurst } from '../components/CaptureBurst';
import { Die } from '../components/Die';
import { avatarSeed, localizedBotName, localizedColor } from '../utils/botName';
import { applyEvent, initialView } from '../game/reducer';
import type { PlayerColor, PlayerMeta } from '../game/types';
import { ClashOverlay } from '../game/ClashOverlay';
import { stepToCell } from '../game/boardGeometry';
import {
  CAPTURE_FX_AFTER_CARD_MS,
  CAPTURE_FX_CARD_OPACITY,
  CAPTURE_FX_MS,
  CARD_HOLD_MARGIN_MS,
  CLASH_RESULT_MS,
  DICE_BRAKE_ARM_MS,
  DICE_ROLL_ANIM_MS,
  MOVE_STEP_ANIM_MS,
  PENDING_MOVE_GUARD_MS,
  RESULTS_MODAL_DELAY_MS,
  diceLandAt,
} from '../game/timing';
import { navigate } from '../router';
import { connectSocket } from '../socket';
import { getApi, postApi, translateErrorCode } from '../api';
import { useApp, type ResultPlayer } from '../store';
import { SEAT_COLORS } from '../theme';
import { UserAvatar } from '../components/UserAvatar';
import { CyberButton, CyberModal } from '../components/CyberModal';
import { ResultsModal } from '../components/ResultsModal';
import { retroAudio } from '../utils/audio';
import '../styles/retrowave.css';
import {
  CRT_SCREEN,
  GRID_BACKGROUND,
  APP_WRAPPER,
  HERO_SECTION,
  HERO_TITLE,
  BADGE_BAR,
  RETRO_BADGE,
  RETRO_WINDOW,
  WINDOW_HEADER,
  GAME_WINDOW_HEADER_EXTRA,
  WINDOW_BODY,
  RETRO_BTN,
} from '../styles/tw';

const SEAT_HUES: Record<PlayerColor, string> = {
  red: '#ff007f',
  green: '#00ff88',
  yellow: '#ffe600',
  blue: '#00f0ff',
};

/** Pip indexes (3x3 grid, row-major) lit per face value - mirrors Die.tsx. */
const MINI_PIP_MAP: Partial<Record<number, number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

/** Compact 3x3 mini-die face for the "Last Rolled" box in the player rows. */
function MiniDie({ value }: { value: number }) {
  const on = MINI_PIP_MAP[value] ?? [];
  return (
    <div
      style={{
        width: 38,
        height: 38,
        borderRadius: 8,
        background: '#190a38',
        boxShadow: '0 0 8px rgba(0, 240, 255, 0.3), inset 0 0 4px rgba(255, 0, 127, 0.3)',
        border: '1.5px solid var(--accent-cyan)',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 1fr',
        gridTemplateRows: '1fr 1fr 1fr',
        padding: 4,
        gap: 2,
        flex: 'none',
      }}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} style={{ display: 'grid', placeItems: 'center' }}>
          {on.includes(i) ? (
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: '#ffe600',
                boxShadow: '0 0 4px #ffe600',
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

// Matches the backend's SLOT_COLORS: hotseat seat index i always maps to this
// color, regardless of the Lobby seat-picker's own (unrelated) display order.
const SLOT_COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

// The Barrier Buster hand cap, mirrored from the engine
// (types.ts BARRIER_BUSTER_TOKEN_CAP): the wall-break cell draws exactly this many
// glyph slots, so an empty hand reads as empty rather than as a row that vanished.
const BARRIER_BUSTER_TOKEN_CAP = 3;
// The wall break tokens panel: its width and the gap in front of it. That span is how
// much further the roster box overhangs its grid track in clash mode; a smaller
// CARD_ROOM_OVERHANG is always added, so the cards come out the same width.
const BUSTER_PANEL_W = 96;
const BUSTER_PANEL_GAP = 10;
const CARD_ROOM_OVERHANG = 46;
// The wall-break token glyph. A padlock read as "locked"; dynamite (or a
// sledgehammer) reads as "breaker", which is what the toggle actually does. One
// constant, so switching glyphs is one edit.
const BUSTER_GLYPH = '🧨';

/**
 * Where a capture's burst belongs on screen: the viewport centre of the cell the mover
 * landed on. Measured from the board at the moment the move lands, because the clash
 * result card is a fixed layer drawn OVER the board — the card's dim copy of the burst
 * has to be placed in the same space as the board's own copy, not guessed at. Null when
 * the step has no cell (a home entry) or the board is not rendered, which skips the FX.
 *
 * The lookup is `data-cell` on the board's squares (`components/Board.tsx`): one board
 * is mounted at a time, so the key is unique.
 */
function captureBurstAnchor(
  color: PlayerColor,
  to: number,
): { color: string; x: number; y: number } | null {
  if (to < 1 || to > 57) return null;
  const cell = stepToCell(color, to);
  if (!cell) return null;
  const el = document.querySelector(`[data-cell="${cell.r},${cell.c}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0) return null;
  return {
    color: SEAT_HUES[color],
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

export function Game() {
  const { t } = useTranslation();
  const {
    user,
    activeMatch,
    seats,
    setPlaying,
    lastResult,
    setLastResult,
    setActiveMatch,
    guestSetup,
  } = useApp();
  // Guests are a memory-only handoff. `activeMatch.isGuest` is what every exit
  // and the end card branch on; it is NOT the same as mode === 'pve' (a
  // signed-in player's PvE game is that too).
  const isGuest = activeMatch?.isGuest === true;
  // The name this guest appears under. A ref, as with userRef, because the socket
  // effect must not reconnect on a language change.
  const guestNameRef = useRef(t('guest.playerName'));
  guestNameRef.current = t('guest.playerName');
  const [playAgainError, setPlayAgainError] = useState<string | null>(null);
  // The socket-connect effect keys on gameId/token only, so patching
  // activeMatch later can't reopen the socket; its handlers read this ref to
  // still see those patches (see the game docs, Implementation Notes).
  const activeMatchRef = useRef(activeMatch);
  activeMatchRef.current = activeMatch;
  // The same trap applies to the identity: the socket handlers below outlive the
  // render that created the socket, so a mid-match rename would have the OLD
  // display name resent on a reconnect (and written back onto the seat).
  const userRef = useRef(user);
  userRef.current = user;

  // **CRT & AUDIO CONTROLS**
  const [crtEnabled, setCrtEnabled] = useState(true);
  const [soundMuted, setSoundMuted] = useState(retroAudio.muted);
  const [isAbortModalOpen, setIsAbortModalOpen] = useState(false);
  const [isSystemModalOpen, setIsSystemModalOpen] = useState(false);
  const [rulesPage, setRulesPage] = useState(0);

  useEffect(() => {
    const savedCrt = localStorage.getItem('retro_crt');
    if (savedCrt === 'false') {
      setCrtEnabled(false);
    }
  }, []);

  const toggleSound = () => {
    const isMuted = retroAudio.toggleMute();
    setSoundMuted(isMuted);
    if (!isMuted) {
      retroAudio.playUiBeep(520, 0.06);
    }
  };

  // Custom names typed into the Lobby seat-setup for local (hotseat) seats: seat
  // 0 is always the logged-in host (uses their real username instead), so only
  // look at seats[1..].
  const localNames = useMemo<Partial<Record<PlayerColor, string>>>(() => {
    const names: Partial<Record<PlayerColor, string>> = {};
    seats.forEach((seat, i) => {
      if (i === 0) return;
      if (seat.type === 'player') names[SLOT_COLORS[i]] = seat.name;
    });
    return names;
  }, [seats]);
  // Seat label for the move log / podium rows: a hotseat seat's typed-in name
  // first, then the engine's display label (bots carry "bot-<color>
  // (<assistant>)", localized by localizedBotName), then the raw id.
  const seatLabel = (p: {
    color: PlayerColor;
    username: string;
    displayName?: string;
    isBot: boolean;
  }): string =>
    (localNames[p.color] ?? '') ||
    localizedBotName(t, p.displayName) ||
    localizedBotName(t, p.username) ||
    (p.isBot ? t('common.bot') : 'Pilot');
  // Seeded name for a seat's generated avatar. A bot has no account, so it uses the
  // assistant name the lobby gave that seat, the same name the invoice seeds from.
  const seatAvatarName = (p: PlayerMeta): string =>
    p.isBot ? avatarSeed(p.displayName ?? p.username) : p.username;
  // Maps the live roster to `LastResult.players`, carrying each seat's avatar
  // facts. A `winner` is recorded as four pieces because the view lags the winning
  // move. Hotseat is described in docs/frontend/frontend-game-module.md.
  const toResultPlayers = (players: PlayerMeta[], winner?: PlayerColor): ResultPlayer[] => {
    const match = activeMatchRef.current;
    const me = userRef.current;
    const hostSeatColor = match?.mode === 'hotseat' ? match.color : null;
    return players
      .filter((p) => p.status !== 'inactive')
      .map((p) => {
        const isHostSeat = hostSeatColor !== null && p.color === hostSeatColor;
        return {
          color: p.color,
          // A bot row keeps its raw `bot-<color> (<assistant>)` label: the invoice
          // re-localizes it and seeds the same avatar the lobby table uses.
          username: p.isBot ? (p.displayName ?? p.username) : seatLabel(p),
          isBot: p.isBot,
          piecesInGoal: p.color === winner ? 4 : p.piecesInGoal,
          userId: isHostSeat ? me?.id : p.userId,
          hasAvatarPhoto: isHostSeat ? (me?.hasAvatarPhoto ?? false) : (p.hasAvatarPhoto ?? false),
          avatarStyle: isHostSeat ? (me?.avatarStyle ?? null) : (p.avatarStyle ?? null),
        };
      });
  };
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null);
  const [view, dispatch] = useReducer(applyEvent, null, () =>
    initialView(activeMatch?.color ?? 'red'),
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  const [moveLogs, setMoveLogs] = useState<Array<{ ck: PlayerColor; text: string }>>([]);
  const moveLogContainerRef = useRef<HTMLDivElement>(null);
  const [displayedTurn, setDisplayedTurn] = useState<PlayerColor>(activeMatch?.color ?? 'red');
  const [isRolling, setIsRolling] = useState(false);
  const isRollingRef = useRef(false);
  // One roll's clock, in refs: the brake window opens at the tap that started the
  // roll and closes at the landing, so a tap is never judged against a stale render.
  // `rollStartRef` stays null for a roll this device did not start, which is what
  // keeps an opponent's or a bot's dice un-brakeable.
  const rollStartRef = useRef<number | null>(null);
  const rollBrakeAtRef = useRef<number | null>(null);
  const rollLandAtRef = useRef<number | null>(null);
  const rollLandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollAnswerGuardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rollLandFnRef = useRef<(() => void) | null>(null);
  const rollValueRef = useRef<number | null>(null);
  // The face a braked die settles onto, null until the server's value is in hand;
  // Die derives the near-miss it shows from it.
  const [brakeTo, setBrakeTo] = useState<number | null>(null);
  // The Space listener is bound once per match and would otherwise capture a stale
  // `canRoll`; this ref always points at the newest `beginRoll` closure (assigned
  // next to its definition, the same way `viewRef` is).
  const beginRollRef = useRef<() => void>(() => {});
  const [displayedLastRolls, setDisplayedLastRolls] = useState<
    Partial<Record<PlayerColor, number>>
  >({});
  const [codeCopied, setCodeCopied] = useState(false);
  const [turnSwapNotice, setTurnSwapNotice] = useState<string | null>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);
  // Reserved engine-error banner: localized text of the last engine socket error
  // (see the 'error' handler below), auto-cleared after a short delay.
  const [engineError, setEngineError] = useState<string | null>(null);
  const engineErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTurnRef = useRef<PlayerColor | null>(null);
  const isGameEnded = lastResult != null || view.status === 'finished';

  // Box-by-box move animation: while set, Board renders this piece at `step`
  // instead of its real (already-updated) logical position. See the piece_moved
  // handler below, which steps through the server's `path`.
  const [animatingPiece, setAnimatingPiece] = useState<{ pieceId: string; step: number } | null>(
    null,
  );
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isMovingPiece, setIsMovingPiece] = useState(false);
  const isMovingPieceRef = useRef(false);
  // Set when move_piece emits, cleared on piece_moved/rejection: blocks a
  // second click from firing a duplicate move the engine rejects.
  const pendingMoveRef = useRef(false);
  // Capture burst FX: a short ring + sparks on the landing square when a piece
  // is captured. Set at the end of the mover's walk and cleared after the burst
  // plays out, so it is visual only and never touches game state.
  const [captureFx, setCaptureFx] = useState<{ color: string; to: number } | null>(null);
  // A clash capture lands behind the result card, so the card gets a dim copy of the
  // burst at the cell (viewport coordinates, measured when the move landed) while the
  // board's real copy waits for the card to go. Alive exactly as long as the card.
  const [cardCaptureFx, setCardCaptureFx] = useState<{
    color: string;
    x: number;
    y: number;
  } | null>(null);
  // Barrier Buster: the token-priced exit is armed explicitly, so a tap in prison can
  // never spend a token by accident. The arm switch lives on the server
  // (`PlayerMeta.barrierArmed`), and the engine blocks an unarmed seat at a wall.
  const bustMoves = useMemo(
    () => view.legalMoves.filter((m) => m.spendsBarrierToken),
    [view.legalMoves],
  );
  const armSeat = view.players.find((p) => p.color === view.currentTurn);
  const bustArmed = armSeat?.barrierArmed === true;
  // Arming needs a token in hand: the engine refuses an arm without one, and the
  // column disables the button. The engine also refuses an arm out of turn.
  const canArmBust = view.clashMode === true && (armSeat?.barrierTokens ?? 0) > 0;
  const toggleBustArm = () => {
    if (!canArmBust) return;
    retroAudio.playUiBeep(bustArmed ? 420 : 880, 0.06, 'square');
    socketRef.current?.emit('arm_barrier', !bustArmed);
  };
  // How far the roster box reaches past its grid track (and the controls box under it
  // follows the same width): the panel's span in clash mode, plus the same extra room
  // for the display names in every room, so the cards are equally wide either way.
  const rosterOverhang =
    view.clashMode === true
      ? CARD_ROOM_OVERHANG + BUSTER_PANEL_W + BUSTER_PANEL_GAP
      : CARD_ROOM_OVERHANG;
  // Only the three-column desktop layout (the `lg` grid) has a panel overhanging its column,
  // so the board placement below is biased at that breakpoint and keeps the previously
  // centred behaviour at the stacked tablet/mobile one, where the panels sit above and below.
  const [desktopLayout, setDesktopLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    setDesktopLayout(mq.matches);
    const sync = () => setDesktopLayout(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  // Desktop board placement: the board yields the roster panel's overhang and takes
  // 20% of the space left as a right margin, so the left gutter holds the panel. The
  // min() clamps the margin to 0 when the track is too narrow.
  const boardSlack = `100% - min(650px, 66vh, 100% - ${rosterOverhang}px)`;
  const boardMaxWidth = desktopLayout
    ? `min(650px, 66vh, 100% - ${rosterOverhang}px)`
    : 'min(650px, 66vh)';
  const boardMarginRight = desktopLayout
    ? `max(0px, min((${boardSlack}) * 0.2, ${boardSlack} - ${rosterOverhang}px))`
    : undefined;

  useEffect(() => {
    if (moveLogContainerRef.current) {
      moveLogContainerRef.current.scrollTop = 0;
    }
  }, [moveLogs.length]);

  // Only update displayedTurn when the player is actually allowed to roll the dice
  // (i.e. not while piece is stepping, capture animation is running, or dice is rolling)
  useEffect(() => {
    if (!isMovingPiece && !animatingPiece && !captureFx && !isRolling) {
      setDisplayedTurn(view.currentTurn);
    }
  }, [view.currentTurn, isMovingPiece, animatingPiece, captureFx, isRolling]);

  const effectiveTurn = displayedTurn;

  useEffect(() => {
    if (view.status === 'waiting') return;
    if (prevTurnRef.current && prevTurnRef.current !== effectiveTurn) {
      const nextTurnPlayer = view.players.find((p) => p.color === effectiveTurn);
      const translatedColor = localizedColor(t, effectiveTurn).toUpperCase();
      const nextName =
        (localNames[effectiveTurn] ?? '').toUpperCase() ||
        localizedBotName(t, nextTurnPlayer?.displayName).toUpperCase() ||
        localizedBotName(t, nextTurnPlayer?.username).toUpperCase() ||
        translatedColor;

      retroAudio.playUiBeep(640, 0.08, 'sine');
      setTurnSwapNotice(t('game.turnSwapNotice', { name: nextName, color: translatedColor }));

      const timer = setTimeout(() => {
        setTurnSwapNotice(null);
      }, 700);

      prevTurnRef.current = effectiveTurn;
      return () => clearTimeout(timer);
    }
    prevTurnRef.current = effectiveTurn;
  }, [effectiveTurn, view.status, view.players, localNames, t]);
  const captureFxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The board burst a clash card is holding back: set when the settling move lands,
  // fired `CAPTURE_FX_AFTER_CARD_MS` after the card goes (see the `view.clash` effect).
  const pendingCardBurstRef = useRef<{ color: string; to: number } | null>(null);
  // Friend-invite picker (waiting room, PvP only): lets the host invite an
  // online accepted friend into THIS room (POST /api/game/:id/invite).
  const [friends, setFriends] = useState<
    Array<{ id: string; username: string; displayName?: string; status?: string }>
  >([]);
  const [inviteStates, setInviteStates] = useState<Record<string, 'idle' | 'busy' | 'sent'>>({});

  const copyRoomCode = () => {
    if (!activeMatch?.inviteCode) return;
    retroAudio.playUiBeep(720, 0.06);
    navigator.clipboard
      .writeText(activeMatch.inviteCode)
      .then(() => {
        setCodeCopied(true);
        setTimeout(() => setCodeCopied(false), 1500);
      })
      .catch((err) => {
        console.error('Failed to copy room code:', err);
      });
  };

  // Set presence status
  useEffect(() => {
    setPlaying(true);
    return () => setPlaying(false);
  }, [setPlaying]);

  // Load online accepted friends when waiting in a PvP room so the host can invite.
  useEffect(() => {
    if (view.status !== 'waiting' || activeMatch?.mode !== 'pvp') return;

    const loadFriends = () => {
      getApi<Array<{ id: string; username: string; displayName?: string; status?: string }>>(
        '/api/friends',
      )
        .then((data) => {
          const list = Array.isArray(data) ? data : [];
          const onlineOnly = list.filter((f) => f.status === 'online');
          setFriends(onlineOnly);
        })
        .catch(() => setFriends([]));
    };

    loadFriends();
    const interval = setInterval(loadFriends, 5000);
    return () => clearInterval(interval);
  }, [view.status, activeMatch?.mode, activeMatch?.gameId]);

  // Connect to engine via Socket.IO
  useEffect(() => {
    if (!activeMatch) return;

    const socket = connectSocket(activeMatch.token);
    socketRef.current = socket;

    // Refresh safety: a pre-upgrade cached activeMatch may lack `mode`. Re-derive
    // it from the match record so hotseat/PvE can't collapse into a PvP rejoin.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cached activeMatch may lack mode after a browser refresh
    if (activeMatch && !activeMatch.mode) {
      fetch('/api/games/mine', { credentials: 'include' })
        .then((r) => (r.ok ? r.json() : null))
        .then((rooms: Array<{ id: string; gameType?: string }> | null) => {
          const current = activeMatchRef.current;
          if (!current) return;
          const room = rooms?.find((x) => x.id === current.gameId);
          if (room?.gameType) {
            const mode =
              room.gameType === 'PVP' ? 'pvp' : room.gameType === 'PVE' ? 'pve' : 'hotseat';
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cached activeMatch may lack playerCount
            setActiveMatch({ ...current, mode, playerCount: current.playerCount ?? 4 });
          }
        })
        .catch(() => undefined);
    }

    socket.on('connect', () => {
      const current = activeMatchRef.current;
      if (!current) return;
      const me = userRef.current;
      // Hotseat: one physical device controls every seat. The engine has no
      // separate accounts to join with, so this single socket must join_game for
      // every local color up front.
      if (current.mode === 'hotseat') {
        for (const ck of Object.keys(localNames) as PlayerColor[]) {
          socket.emit('join_game', current.gameId, ck, undefined, localNames[ck]);
        }
      }
      socket.emit(
        'join_game',
        current.gameId,
        current.color,
        me?.id,
        // A guest has no `me`; the engine also defaults to 'Guest' when nothing
        // arrives, so this only localizes the label.
        me?.displayName ?? (current.isGuest ? guestNameRef.current : undefined),
      );
    });

    socket.on('connect_error', (err: Error) => {
      console.error('[socket] connect_error', err.message);
    });

    socket.on('disconnect', () => {
      // A dropped socket ends the roll's clock too: nothing will ever land it.
      resetRoll();
    });

    socket.on('game_joined', (state) => {
      dispatch({ type: 'game_joined', ...(state as object) });
    });

    const handleEngineEvent = (state: unknown) => {
      const type = (state as { type?: string }).type;

      if (type === 'dice_rolled') {
        const e = state as { value: number; bonusRoll: boolean; forfeited?: boolean };
        const rollerColor = viewRef.current.currentTurn;
        const roller = viewRef.current.players.find((p) => p.color === rollerColor);
        const rollerName =
          localizedBotName(t, roller?.displayName) ||
          localizedBotName(t, roller?.username) ||
          localizedColor(t, rollerColor).toLowerCase();
        retroAudio.playLaserSound();
        const arrivedAt = performance.now();
        // Everything the landing does, in one body: a brake moves the landing
        // earlier and a slow answer moves it later, and neither path skips the
        // dispatch or the log.
        const land = () => {
          resetRoll();
          dispatch({ type: 'dice_rolled', ...(state as object) });
          setDisplayedLastRolls((prev) => ({ ...prev, [rollerColor]: e.value }));
          setMoveLogs((prev) => [
            {
              ck: rollerColor,
              text: e.forfeited
                ? t('game.thirdSixForfeit', { name: rollerName })
                : `${t('game.rolledValue', { value: e.value })}${e.bonusRoll ? t('game.bonusSuffix') : ''}`,
            },
            ...prev.slice(0, 11),
          ]);
        };
        rollLandFnRef.current = land;
        const start = rollStartRef.current;
        if (start == null) {
          // A roll this device did not start (an opponent's or a bot's): the die
          // tumbles for the full window and there is no local tap to brake it.
          setIsRolling(true);
          scheduleLand(arrivedAt + DICE_ROLL_ANIM_MS);
          return;
        }
        // This device's roll. A brake already taken means the near-miss can start
        // now; either way only WHEN it lands changes, never the face.
        rollValueRef.current = e.value;
        const brakeAt = rollBrakeAtRef.current;
        if (brakeAt != null) setBrakeTo(e.value);
        scheduleLand(diceLandAt(start, arrivedAt, brakeAt));
        return;
      }

      if (type !== 'piece_moved') {
        dispatch({ type: type ?? 'state_update', ...(state as object) });
      }

      if (type === 'piece_moved') {
        pendingMoveRef.current = false;
        isMovingPieceRef.current = true;
        setIsMovingPiece(true);
        const e = state as {
          pieceId: string;
          color: PlayerColor;
          captured: boolean;
          capturedPieceIds?: string[];
          to: number;
          path?: number[];
          // The engine's hand-off decision for this move: true means the SAME seat rolls
          // again (a 6 or a capture), which is also what the reducer uses to pick whose turn
          // it is. Read here only to say so in the log.
          bonusRoll?: boolean;
          // Set only when this move settled a clash: the result card is about to take the
          // screen, which moves the capture burst out of the board (see below).
          clashOutcome?: 'attacker_won' | 'defender_won';
        };
        const path = e.path ?? [];
        // A wall break on the wire: the engine credits one when the landing square stood TWO
        // or more defenders, and those ids ride the result, so the count is the same test the
        // credit uses (a repulse lists only the attacker itself, a lone defender lists one).
        const wallBroken = e.captured && (e.capturedPieceIds?.length ?? 0) >= 2;

        // Extract color of captured piece if a capture occurred
        let victimColor = '';
        if (e.captured) {
          if (e.capturedPieceIds && e.capturedPieceIds.length > 0) {
            victimColor = localizedColor(
              t,
              e.capturedPieceIds[0].split('-')[0] as PlayerColor,
            ).toUpperCase();
          } else {
            const victim = viewRef.current.pieces.find(
              (p) => p.color !== e.color && p.step === e.to,
            );
            if (victim) victimColor = localizedColor(t, victim.color).toUpperCase();
          }
          if (!victimColor) victimColor = 'OPPONENT';
        }

        const finishMove = () => {
          if (animTimerRef.current) {
            clearInterval(animTimerRef.current);
            animTimerRef.current = null;
          }
          setAnimatingPiece(null);
          dispatch({ type: 'piece_moved', ...(state as object) });
          if (e.captured) {
            // One line per capture: a wall break names the wall and the re-roll it awarded,
            // because that is the bigger event (a whole stack went home); anything else names
            // the piece it sent home.
            setMoveLogs((prev) => [
              {
                ck: e.color,
                text:
                  wallBroken && e.bonusRoll === true
                    ? t('game.wallBrokenBonusRoll')
                    : t('game.capturedPiece', { color: victimColor }),
              },
              ...prev.slice(0, 11),
            ]);
            retroAudio.playExplosionSound();
            if (e.clashOutcome) {
              // The clash result card is taking the screen in this same frame, and the
              // board's burst would burn down behind its backdrop. So the card gets a dim
              // copy at the landing cell now, and the real burst is held until the card
              // goes (the `view.clash` effect below).
              pendingCardBurstRef.current = { color: e.color, to: e.to };
              setCardCaptureFx(captureBurstAnchor(e.color, e.to));
            } else {
              setCaptureFx({ color: e.color, to: e.to });
            }
          }
          // A capture re-rolls the same seat. Say so when the capture was not a wall break:
          // the wall line already names its own re-roll, and the board looks like it is simply
          // "still your turn" otherwise (the roll control alone is quiet about why).
          if (e.captured && e.bonusRoll === true && !wallBroken) {
            setMoveLogs((prev) => [
              { ck: e.color, text: t('game.bonusRollAgain') },
              ...prev.slice(0, 11),
            ]);
          }
          const settleMs = e.captured ? 600 : 350;
          if (captureFxTimerRef.current) clearTimeout(captureFxTimerRef.current);
          captureFxTimerRef.current = setTimeout(() => {
            setCaptureFx(null);
            isMovingPieceRef.current = false;
            setIsMovingPiece(false);
          }, settleMs);
        };

        const runStepAnimation = () => {
          retroAudio.playUiBeep(580, 0.06, 'sine');

          if (path.length > 1) {
            if (animTimerRef.current) clearInterval(animTimerRef.current);
            let i = 0;
            setAnimatingPiece({ pieceId: e.pieceId, step: path[0] });
            animTimerRef.current = setInterval(() => {
              i++;
              if (i >= path.length) {
                finishMove();
                return;
              }
              setAnimatingPiece({ pieceId: e.pieceId, step: path[i] });
            }, MOVE_STEP_ANIM_MS);
          } else if (path.length === 1) {
            setAnimatingPiece({ pieceId: e.pieceId, step: path[0] });
            setTimeout(() => {
              finishMove();
            }, MOVE_STEP_ANIM_MS);
          } else {
            finishMove();
          }
        };

        if (isRollingRef.current) {
          // Wait out what is LEFT of the spin rather than the whole constant: a
          // braked roll is shorter, and the walk starts on the landed face.
          const landAt = rollLandAtRef.current;
          const wait =
            landAt == null ? DICE_ROLL_ANIM_MS : Math.max(0, landAt - performance.now());
          setTimeout(runStepAnimation, wait);
        } else {
          runStepAnimation();
        }
      } else if (type === 'lobby_update') {
        const e = state as { players: Array<{ username: string; color: PlayerColor }> };
        const me = userRef.current;
        const mine = e.players.find((p) => p.username === me?.username);
        if (mine && mine.color !== viewRef.current.myColor && activeMatchRef.current) {
          dispatch({ type: 'my_color_changed', color: mine.color });
          socket.emit(
            'join_game',
            activeMatchRef.current.gameId,
            mine.color,
            me?.id,
            me?.displayName,
          );
          setActiveMatch({ ...activeMatchRef.current, color: mine.color });
        }
      } else if (type === 'turn_skipped') {
        // The held turn passed without a move: the armed Barrier Buster exit was
        // declined. The reducer clears the moves and moves the turn on; this is the
        // log line, named for the seat that skipped (read before the re-render).
        const skipper = viewRef.current.currentTurn;
        const skipperSeat = viewRef.current.players.find((p) => p.color === skipper);
        const skipperName =
          localizedBotName(t, skipperSeat?.displayName) ||
          localizedBotName(t, skipperSeat?.username) ||
          localizedColor(t, skipper);
        setMoveLogs((prev) => [
          { ck: skipper, text: t('game.bustSkipped', { name: skipperName }) },
          ...prev.slice(0, 11),
        ]);
      } else if (type === 'game_ended') {
        const e = state as { winner: PlayerColor; resultDetail: string };
        retroAudio.playUiBeep(1100, 0.3, 'sawtooth');
        // The winning seat is recorded as four pieces: its last move can still be
        // mid-animation, so the view can lag the final count.
        let endedPlayers = toResultPlayers(viewRef.current.players, e.winner);
        const matchAtEnd = activeMatchRef.current;
        if (
          matchAtEnd?.mode === 'pvp' &&
          matchAtEnd.playerCount &&
          endedPlayers.length > matchAtEnd.playerCount
        ) {
          endedPlayers = endedPlayers.slice(0, matchAtEnd.playerCount);
        }
        setLastResult({
          winner: e.winner,
          resultDetail: e.resultDetail,
          mode: matchAtEnd?.mode ?? 'pvp',
          playerCount: matchAtEnd?.playerCount ?? endedPlayers.length,
          players: endedPlayers,
          abandoned: false,
        });
        setTimeout(() => {
          setShowResultsModal(true);
        }, RESULTS_MODAL_DELAY_MS);
      }
    };

    socket.on('state_update', handleEngineEvent);
    socket.on('dice_rolled', handleEngineEvent);
    socket.on('piece_moved', handleEngineEvent);
    // A held turn passed by Skip: no piece moved, the turn simply advanced.
    socket.on('turn_skipped', handleEngineEvent);
    socket.on('game_started', handleEngineEvent);
    socket.on('game_ended', handleEngineEvent);
    socket.on('player_exited', handleEngineEvent);
    socket.on('player_disconnected', handleEngineEvent);
    socket.on('player_reconnected', handleEngineEvent);
    socket.on('lobby_update', handleEngineEvent);
    // Clash QTE frames: every phase is derived from the server-borne deadlines,
    // so the reducer merges each frame as it arrives.
    socket.on('clash_start', handleEngineEvent);
    socket.on('clash_phase', handleEngineEvent);
    socket.on('clash_press', handleEngineEvent);
    socket.on('clash_result', handleEngineEvent);
    // The result card's hold: the engine fixed the freeze at the shortened deadline.
    // The reducer keeps the card, which its own timer ends.
    socket.on('clash_card_released', handleEngineEvent);
    // The host flipped the room rules: the frame carries what the engine
    // actually persisted, not what was asked for.
    socket.on('modifiers_updated', handleEngineEvent);

    socket.on(
      'player_aborted',
      (e: { color: PlayerColor; username: string; displayName?: string }) => {
        setMoveLogs((prev) => [
          {
            ck: e.color,
            text: t('game.playerAborted', {
              name: localizedBotName(t, e.displayName) || localizedBotName(t, e.username),
            }),
          },
          ...prev.slice(0, 11),
        ]);
      },
    );

    const buildAbandonedResult = () => {
      let players: ResultPlayer[] = toResultPlayers(viewRef.current.players);

      if (players.length === 0 && Array.isArray(seats) && seats.length > 0) {
        const SEAT_COLORS: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];
        players = seats
          .map((s, idx) => {
            if (s.type === 'empty') return null;
            const color = SEAT_COLORS[idx] || 'red';
            let username: string;
            if (s.type === 'you') username = user?.username ?? 'You';
            else username = s.name;
            return {
              color,
              username,
              isBot: s.type === 'bot',
              piecesInGoal: 0,
            };
          })
          .filter(
            (
              p,
            ): p is {
              color: PlayerColor;
              username: string;
              isBot: boolean;
              piecesInGoal: number;
            } => p !== null,
          );
      }

      const matchNow = activeMatchRef.current;
      if (
        matchNow?.mode === 'pvp' &&
        matchNow.playerCount &&
        players.length > matchNow.playerCount
      ) {
        players = players.slice(0, matchNow.playerCount);
      }

      return {
        winner: viewRef.current.winner ?? viewRef.current.currentTurn,
        resultDetail: 'abandoned',
        mode: matchNow?.mode ?? 'pvp',
        playerCount: matchNow?.playerCount ?? players.length,
        players,
        abandoned: true,
      };
    };

    socket.on('game_timeout', () => {
      setLastResult(buildAbandonedResult());
      setShowResultsModal(true);
    });
    socket.on('game_expired', () => {
      setLastResult(buildAbandonedResult());
      setShowResultsModal(true);
    });
    // The engine refused this seat: our grace window expired before the join
    // arrived. Show the end-of-match card instead of the board.
    socket.on('seat_expired', () => {
      setLastResult(buildAbandonedResult());
      setShowResultsModal(true);
    });

    socket.on('error', (msg: string) => {
      console.error('[engine]', msg);
      // Engine errors carry i18n codes (lobby.ts): show the localized text in the
      // reserved banner. Unmapped messages stay console-only.
      const localized = translateErrorCode(msg);
      if (localized) {
        setEngineError(localized);
        if (engineErrorTimerRef.current) clearTimeout(engineErrorTimerRef.current);
        engineErrorTimerRef.current = setTimeout(() => setEngineError(null), 6000);
      }
      // A refused roll must not leave the die spinning: the turn did not start, so
      // there is nothing left to land.
      resetRoll();
      pendingMoveRef.current = false;
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      if (animTimerRef.current) clearInterval(animTimerRef.current);
      animTimerRef.current = null;
      if (captureFxTimerRef.current) clearTimeout(captureFxTimerRef.current);
      captureFxTimerRef.current = null;
      if (engineErrorTimerRef.current) clearTimeout(engineErrorTimerRef.current);
      engineErrorTimerRef.current = null;
      if (rollLandTimerRef.current) clearTimeout(rollLandTimerRef.current);
      rollLandTimerRef.current = null;
      if (rollAnswerGuardRef.current) clearTimeout(rollAnswerGuardRef.current);
      rollAnswerGuardRef.current = null;
      setAnimatingPiece(null);
      setCaptureFx(null);
      setCardCaptureFx(null);
      pendingCardBurstRef.current = null;
    };
    // Keyed on identity fields only, never the whole activeMatch object, so
    // patching it after connect can't reopen the socket (see the game docs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch?.gameId, activeMatch?.token, setLastResult]);

  useEffect(() => {
    if (activeMatch?.mode !== 'hotseat') return;
    if (view.status !== 'active' || view.currentTurn === viewRef.current.myColor) return;
    const seat = viewRef.current.players.find((p) => p.color === view.currentTurn);
    if (!seat || seat.isBot || seat.status !== 'active') return;
    dispatch({ type: 'my_color_changed', color: view.currentTurn });
    socketRef.current?.emit(
      'join_game',
      activeMatch.gameId,
      view.currentTurn,
      user?.id,
      localNames[view.currentTurn] ?? user?.displayName,
    );
  }, [view.currentTurn, view.status, activeMatch, localNames, user]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable))
        return;
      const v = viewRef.current;
      if (v.status !== 'active') return;
      // Paused for a reconnect: block the dice shortcut so no action can slip
      // in while the engine holds the turn.
      if (v.paused) return;
      // The clash QTE owns the keyboard: Space must not fire a roll while the
      // clash is up, or during the engine's post-clash freeze.
      if (v.clash) return;
      if (v.resultCardUntil != null && Date.now() < v.resultCardUntil) return;
      const isHotseatMode = activeMatch?.mode === 'hotseat';
      const activeHumanTurn = v.players.some(
        (p) => p.color === v.currentTurn && p.status === 'active' && !p.isBot,
      );
      const seatNameMatches = v.players.some(
        (p) => p.color === v.currentTurn && p.username === user?.username,
      );
      const myTurnNow = isHotseatMode
        ? activeHumanTurn
        : v.currentTurn === v.myColor || (user != null && seatNameMatches);
      if (!myTurnNow) return;
      if (v.turnPhase === 'WAITING_FOR_MOVE' || v.legalMoves.length > 0) return;
      if (isRollingRef.current || isMovingPieceRef.current) return;
      e.preventDefault();
      // Through the ref: this listener is bound once per match, so it would hold a
      // stale `canRoll` if it called `beginRoll` directly.
      beginRollRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeMatch, user]);

  // Clear the timers of the roll in flight. The landing and the "the server never
  // answered" guard never need to run together, so one helper covers both.
  const clearRollTimers = () => {
    if (rollLandTimerRef.current != null) clearTimeout(rollLandTimerRef.current);
    if (rollAnswerGuardRef.current != null) clearTimeout(rollAnswerGuardRef.current);
    rollLandTimerRef.current = null;
    rollAnswerGuardRef.current = null;
  };

  // Put the die back at rest and forget the roll. The landing, a refusal and a
  // dropped socket all end here, so no path leaves a die spinning forever.
  const resetRoll = () => {
    clearRollTimers();
    rollStartRef.current = null;
    rollBrakeAtRef.current = null;
    rollLandAtRef.current = null;
    rollLandFnRef.current = null;
    rollValueRef.current = null;
    isRollingRef.current = false;
    setIsRolling(false);
    setBrakeTo(null);
  };

  // Start a roll this device owns. The clock starts at the tap, not at the server's
  // answer, so the brake window is the same length whatever the round trip is.
  const beginRoll = () => {
    if (!canRoll || isRolling || isRollingRef.current || isMovingPieceRef.current) return;
    clearRollTimers();
    rollStartRef.current = performance.now();
    rollBrakeAtRef.current = null;
    rollLandAtRef.current = null;
    rollLandFnRef.current = null;
    rollValueRef.current = null;
    isRollingRef.current = true;
    setIsRolling(true);
    setBrakeTo(null);
    retroAudio.playUiBeep(980, 0.08, 'sawtooth');
    socketRef.current?.emit('roll_dice');
    // No answer: give the die back rather than leave it spinning forever.
    rollAnswerGuardRef.current = setTimeout(() => {
      rollAnswerGuardRef.current = null;
      if (isRollingRef.current) resetRoll();
    }, 2000);
  };
  // Assigned every render, so the Space listener bound once per match always calls
  // the newest closure (the same pattern as `viewRef`).
  beginRollRef.current = beginRoll;

  // Schedule the landing. `rollLandAtRef` is what the move animation reads, so a
  // braked roll does not make the piece wait for time the roll no longer has.
  const scheduleLand = (landAt: number) => {
    if (rollLandTimerRef.current != null) clearTimeout(rollLandTimerRef.current);
    rollLandAtRef.current = landAt;
    rollLandTimerRef.current = setTimeout(
      () => {
        rollLandTimerRef.current = null;
        const land = rollLandFnRef.current;
        rollLandFnRef.current = null;
        land?.();
      },
      Math.max(0, landAt - performance.now()),
    );
  };

  // The die's one handler, three states: at rest it starts a roll, a spinning roll
  // THIS device started brakes once it is armed, anything else is ignored (another
  // seat's roll, a tap inside the arming window, a roll already braked). The brake
  // moves only WHEN the die lands: the value stays the server's, dispatched as it
  // arrived at the landing below.
  const tapDie = () => {
    if (!isRollingRef.current) {
      beginRoll();
      return;
    }
    const start = rollStartRef.current;
    if (start == null || rollBrakeAtRef.current != null) return;
    const now = performance.now();
    if (now - start < DICE_BRAKE_ARM_MS) return;
    rollBrakeAtRef.current = now;
    const value = rollValueRef.current;
    // The answer is still in flight: its handler completes the brake, since only it
    // knows when the face arrived.
    if (value == null) return;
    setBrakeTo(value);
    scheduleLand(diceLandAt(start, now, now));
  };

  const movePiece = (pieceId: string) => {
    // The clash overlay owns the board while the QTE (or its result card, which
    // the engine freezes input for) is up.
    if (viewRef.current.clash) return;
    if (isRolling || isRollingRef.current || isMovingPieceRef.current || pendingMoveRef.current)
      return;
    // A Barrier Buster exit is only ever sent while the player has armed it. The
    // board hides it from the tap targets too, so this is the second gate on the
    // same rule and a stray tap can never spend a token.
    const mine = viewRef.current.legalMoves.filter((m) => m.pieceId === pieceId);
    if (mine.length > 0 && mine.every((m) => m.spendsBarrierToken) && !bustArmed) return;
    pendingMoveRef.current = true;
    retroAudio.playUiBeep(640, 0.05);
    socketRef.current?.emit('move_piece', pieceId);
    // Safety net: if the server never responds (dropped socket, etc.), clear the
    // guard so the next move is not blocked.
    setTimeout(() => {
      pendingMoveRef.current = false;
    }, PENDING_MOVE_GUARD_MS);
  };

  // Skip: the deliberate way out of a turn the armed exit is holding. The token
  // stays in hand, the dice are spent and the turn passes. The engine refuses a
  // Skip when no armed exit is on the table, so this only sends the intent.
  const skipBust = () => {
    // Inert unless the roll can only reach a wall. The guards repeat the button's test
    // against the freshest view, so a curious click or a stray call emits nothing and
    // never produces a refusal.
    const v = viewRef.current;
    if (v.status !== 'active' || v.clash) return;
    if (isRolling || isRollingRef.current || isMovingPieceRef.current || pendingMoveRef.current)
      return;
    if (v.turnPhase !== 'WAITING_FOR_MOVE') return;
    const priced = v.legalMoves.filter((m) => m.spendsBarrierToken);
    if (priced.length === 0 || priced.length !== v.legalMoves.length) return;
    retroAudio.playUiBeep(520, 0.06);
    socketRef.current?.emit('skip_bust');
  };

  const markReady = () => {
    retroAudio.playUiBeep(1100, 0.1);
    socketRef.current?.emit('player_ready');
  };

  // One press of this player's clash key. The overlay matches the key; the server
  // proves ownership and applies the press cap, which discards a decoy pad press.
  const clashInput = (key: string, count = 1) => socketRef.current?.emit('clash_input', key, count);
  // The overlay's result-card timer calls this after CLASH_RESULT_MS. It is what
  // frees canRoll again: the reducer deliberately keeps `clash` alive until then.
  const clearClash = () => dispatch({ type: 'clash_clear' });

  // The result card appeared: tell the engine when it will be done. The forecast is
  // in this client's clock and is sent once per card, so a chain reports each round.
  // It gates nothing locally; the engine's release frame is the authority.
  useEffect(() => {
    const cardId = view.clashResult?.cardId;
    if (!cardId) return;
    socketRef.current?.emit('clash_card_hold', cardId, CLASH_RESULT_MS + CARD_HOLD_MARGIN_MS);
  }, [view.clashResult]);

  // The clash card owns the capture burst. While it is up the card wears a dim copy
  // (rendered with it, below), and the moment the card goes the board gets the real one:
  // CAPTURE_FX_AFTER_CARD_MS later, so the two never share a frame. The card can leave
  // two ways — its own CLASH_RESULT_MS timer and the engine releasing the clash early —
  // and both narrow to `view.clash` going null, which is what this watches. A chain's
  // intermediate rounds never set a pending burst, so only the settling move fires.
  useEffect(() => {
    if (view.clash) return;
    const pending = pendingCardBurstRef.current;
    if (!pending) return;
    pendingCardBurstRef.current = null;
    setCardCaptureFx(null);
    const timer = setTimeout(() => {
      setCaptureFx(pending);
      if (captureFxTimerRef.current) clearTimeout(captureFxTimerRef.current);
      captureFxTimerRef.current = setTimeout(() => setCaptureFx(null), CAPTURE_FX_MS);
    }, CAPTURE_FX_AFTER_CARD_MS);
    return () => clearTimeout(timer);
  }, [view.clash]);

  // The three room rules travel as ONE object both ways, so a fourth rule is a
  // field rather than a fifth positional boolean. The engine enforces host-only
  // (MODIFIERS_HOST_ONLY) and echoes back what it actually persisted.
  const updateModifiers = (rules: {
    clashEnabled: boolean;
    noSafeZones: boolean;
    freeExit: boolean;
  }) => socketRef.current?.emit('update_modifiers', rules);

  const selectColor = (color: PlayerColor) => {
    if (activeMatch?.mode === 'pvp') return;
    retroAudio.playUiBeep(720, 0.05);
    socketRef.current?.emit('select_color', color);
  };

  const inviteFriend = async (friendId: string) => {
    if (!activeMatch || inviteStates[friendId] === 'busy') return;
    retroAudio.playUiBeep(800, 0.06);
    setInviteStates((prev) => ({ ...prev, [friendId]: 'busy' }));
    try {
      await postApi(`/api/game/${activeMatch.gameId}/invite`, { friendId });
      setInviteStates((prev) => ({ ...prev, [friendId]: 'sent' }));
    } catch {
      setInviteStates((prev) => ({ ...prev, [friendId]: 'idle' }));
    }
  };

  const endGame = () => {
    retroAudio.playExplosionSound();
    socketRef.current?.emit('end_game');

    let players: ResultPlayer[] = toResultPlayers(viewRef.current.players);

    if (players.length === 0 && Array.isArray(seats) && seats.length > 0) {
      const SEAT_COLORS: PlayerColor[] = ['red', 'green', 'yellow', 'blue'];
      players = seats
        .map((s, idx) => {
          if (s.type === 'empty') return null;
          const color = SEAT_COLORS[idx] || 'red';
          let username: string;
          if (s.type === 'you') username = user?.username ?? 'You';
          else username = s.name;
          return {
            color,
            username,
            isBot: s.type === 'bot',
            piecesInGoal: 0,
          };
        })
        .filter(
          (
            p,
          ): p is { color: PlayerColor; username: string; isBot: boolean; piecesInGoal: number } =>
            p !== null,
        );
    }

    if (
      activeMatch?.mode === 'pvp' &&
      activeMatch.playerCount &&
      players.length > activeMatch.playerCount
    ) {
      players = players.slice(0, activeMatch.playerCount);
    }

    setLastResult({
      winner: viewRef.current.winner ?? viewRef.current.currentTurn,
      resultDetail: 'abandoned',
      mode: activeMatch?.mode ?? 'pvp',
      playerCount: activeMatch?.playerCount ?? players.length,
      players,
      abandoned: true,
    });
    setShowResultsModal(true);
  };

  // Guest "Play again": a fresh mint with the same seats and rules. The Game
  // component is keyed on gameId in App, so the new room remounts this page
  // cleanly instead of inheriting the finished board's local state.
  const playAgain = async () => {
    if (!guestSetup) {
      navigate('/guest');
      return;
    }
    setPlayAgainError(null);
    try {
      const res = await postApi<{
        gameId: string;
        token: string;
        engineUrl: string;
        color: PlayerColor;
        mode: 'pvp' | 'pve' | 'hotseat';
        playerCount: number;
        isGuest?: boolean;
      }>('/api/match/guest', guestSetup);
      setLastResult(null);
      setShowResultsModal(false);
      setActiveMatch({ ...res, isGuest: true });
      navigate(`/game?gameId=${res.gameId}`);
    } catch (error) {
      // GUEST_LIMITED / GUEST_CAPACITY arrive localized. The card stays open so
      // the message is read, not flashed away by a navigation.
      setPlayAgainError(error instanceof Error ? error.message : t('lobby.createFailed'));
    }
  };

  // If no match credentials exist, redirect back to lobby
  if (!activeMatch) {
    return (
      <>
        <div className={GRID_BACKGROUND} />

        <div className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''}`} id="crtScreen">
          <div
            className={APP_WRAPPER}
            style={{
              minHeight: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginLeft: 'auto',
              marginRight: 'auto',
              maxWidth: '100%',
              width: '100%',
            }}
          >
            <section
              className={RETRO_WINDOW}
              style={{ maxWidth: 460, width: '90%', margin: '0 auto' }}
            >
              <div className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}>
                <span>{t('game.noActiveSessionTitle')}</span>
              </div>
              <div className={WINDOW_BODY} style={{ textAlign: 'center', padding: '30px 24px' }}>
                <div
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: '0.85rem',
                    color: 'var(--accent-yellow)',
                    marginBottom: 10,
                  }}
                >
                  {t('game.noMatchCredentials')}
                </div>
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                    marginBottom: 24,
                    lineHeight: 1.5,
                  }}
                >
                  {t('game.noMatchCredentialsHint')}
                </div>
                <button
                  className={RETRO_BTN}
                  style={{ width: '100%', padding: '12px 0', fontSize: '0.8rem' }}
                  onClick={() => {
                    retroAudio.playUiBeep(600, 0.05);
                    navigate('/gamelobby');
                  }}
                >
                  &gt;_ {t('game.returnToLobbyBtn')}
                </button>
              </div>
            </section>
          </div>
        </div>
      </>
    );
  }

  const isHotseat = activeMatch.mode === 'hotseat';
  // Waiting-for-reconnect banner: either the engine set `paused` (a PvP player
  // dropped during their own turn), or the turn is parked on a disconnected seat
  // (they dropped during another player's turn). PvE and hotseat never pause.
  const pausedSeat =
    view.players.find((p) => p.color === view.pauseTurnOwner) ??
    view.players.find((p) => p.color === effectiveTurn && p.status === 'disconnected');
  const isPausedForReconnect = Boolean(view.paused) || Boolean(pausedSeat);
  const pausedOwnerName = (() => {
    if (!isPausedForReconnect) return null;
    const color = view.pauseTurnOwner ?? effectiveTurn;
    // First non-empty candidate wins; the colour name is the final fallback.
    const candidates = [localNames[color], pausedSeat?.displayName, pausedSeat?.username];
    return candidates.find((name) => name) ?? localizedColor(t, color);
  })();
  const activeHumanTurn = view.players.some(
    (p) => p.color === effectiveTurn && p.status === 'active' && !p.isBot,
  );
  const seatNameMatches = view.players.some(
    (p) => p.color === effectiveTurn && p.username === user?.username,
  );
  const isMyTurn =
    !isPausedForReconnect &&
    (isHotseat
      ? activeHumanTurn
      : effectiveTurn === view.myColor || (user != null && seatNameMatches));
  // `status === 'active'` closes a game-end race: the winning move can leave
  // the other canRoll inputs looking rollable for one render, letting a click
  // slip through as a "Game not active" rejection.
  const canRoll =
    view.status === 'active' &&
    !isPausedForReconnect &&
    isMyTurn &&
    view.turnPhase !== 'WAITING_FOR_MOVE' &&
    view.legalMoves.length === 0 &&
    // No timing term here on purpose. The engine refuses a roll outside its phase and
    // during the result-card freeze, so a missing frame costs one refused click, not
    // the dead roll button a client-side clock comparison used to cause.
    !animatingPiece &&
    !isMovingPiece &&
    !captureFx;
  // The Barrier Buster control: offered only while this device owns the turn and the
  // seat holds a token. Never on a 6, because that roll already leaves prison on the
  // room's rules, so no armed variant exists.
  const canOfferBust =
    view.status === 'active' &&
    !isPausedForReconnect &&
    isMyTurn &&
    !view.clash &&
    bustMoves.length > 0 &&
    (view.players.find((p) => p.color === view.currentTurn)?.barrierTokens ?? 0) > 0 &&
    view.diceValue !== 6;
  // Skip exists for one situation: every legal move is token-priced, so the turn is
  // stuck unless the player spends a token. With an ordinary move available the
  // button stays inert. It is always visible in a clash room and greyed when false.
  const allMovesPriced = view.legalMoves.length > 0 && bustMoves.length === view.legalMoves.length;
  const canSkipBust =
    view.status === 'active' && !isPausedForReconnect && isMyTurn && !view.clash && allMovesPriced;
  const turnLabel =
    view.status === 'waiting'
      ? t('game.waitingRoomTitle').toUpperCase()
      : isPausedForReconnect && pausedOwnerName
        ? t('game.pausedForReconnectTitle', { name: pausedOwnerName.toUpperCase() })
        : isMyTurn
          ? t('game.yourTurnShort').toUpperCase()
          : t('game.botTurn', { name: localizedColor(t, effectiveTurn) }).toUpperCase();
  const turnAccent =
    view.status === 'waiting' ? 'var(--accent-cyan)' : SEAT_HUES[effectiveTurn] || '#00f0ff';

  return (
    <>
      {/* Synthwave cityscape background */}
      <div className={GRID_BACKGROUND} />

      {/* CRT Monitor Overlay FX Container */}
      <div className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''}`} id="crtScreen">
        {/* Main Content Wrapper */}
        <div
          className={`${APP_WRAPPER} app-wrapper game-page`}
          style={{ marginLeft: 'auto', marginRight: 'auto', maxWidth: 1440, width: '100%' }}
        >
          {/* Hero Telemetry & Badge Bar */}
          <header className={HERO_SECTION} style={{ padding: '12px 0 10px', textAlign: 'center' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <h1
                className={HERO_TITLE}
                style={{ fontSize: '1.5rem', marginBottom: 2, textAlign: 'center' }}
              >
                {t('game.heroTitle')}
              </h1>

              {/* Live Turn Announcement Pill */}
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 20px',
                  borderRadius: 4,
                  background: `${turnAccent}25`,
                  border: `1.5px solid ${turnAccent}`,
                  boxShadow: `0 0 15px ${turnAccent}66`,
                  animation: isMyTurn ? 'pulse 1.6s infinite' : 'none',
                  boxSizing: 'border-box',
                  transition:
                    'background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: turnAccent,
                    boxShadow: `0 0 8px ${turnAccent}`,
                    transition: 'background 0.25s ease, box-shadow 0.25s ease',
                  }}
                />
                <span
                  style={{
                    fontFamily: 'var(--font-heading)',
                    fontSize: '0.75rem',
                    color: '#ffffff',
                    letterSpacing: '0.5px',
                  }}
                >
                  {turnLabel}
                </span>
              </div>

              {/* Game Status Marquee Bar */}
              <div
                style={{
                  width: '100%',
                  maxWidth: 740,
                  minHeight: 38,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px 14px',
                  background: turnSwapNotice ? `${turnAccent}38` : `${turnAccent}18`,
                  border: `1.5px solid ${turnAccent}`,
                  boxShadow: turnSwapNotice ? `0 0 22px ${turnAccent}` : `0 0 12px ${turnAccent}66`,
                  borderRadius: 4,
                  textAlign: 'center',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.82rem',
                  fontWeight: 'bold',
                  color: turnAccent,
                  transition:
                    'background 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease, color 0.25s ease',
                  boxSizing: 'border-box',
                }}
              >
                {turnSwapNotice ??
                  (view.status === 'waiting'
                    ? t('game.readyNeedsOpponent')
                    : isPausedForReconnect && pausedOwnerName
                      ? t('game.pausedForReconnectDetail', { name: pausedOwnerName })
                      : isRolling
                        ? t('game.statusRolling')
                        : isMyTurn && view.turnPhase === 'WAITING_FOR_ROLL'
                          ? t('game.statusRollNow')
                          : isMyTurn && view.turnPhase === 'WAITING_FOR_MOVE'
                            ? t('game.statusSelectPiece')
                            : t('game.statusRivalTurn', {
                                name: localizedColor(t, effectiveTurn).toUpperCase(),
                              }))}
              </div>

              {/* Reserved engine-error banner: localized socket `error` text. */}
              <div
                role="alert"
                aria-live="assertive"
                style={{
                  minHeight: 22,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ff0055',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  letterSpacing: '0.5px',
                  textShadow: '0 0 8px #ff0055',
                  boxSizing: 'border-box',
                }}
              >
                {engineError ?? ''}
              </div>
            </div>

            {/* Badge Bar with Room Code */}
            {activeMatch.inviteCode && (
              <div className={BADGE_BAR} style={{ marginTop: 14, justifyContent: 'center' }}>
                <button
                  className={RETRO_BADGE}
                  style={{
                    cursor: 'pointer',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--accent-cyan)',
                    color: 'var(--accent-cyan)',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                  onClick={copyRoomCode}
                  title={t('game.copyRoomCodeTooltip')}
                >
                  {t('game.roomLabel', {
                    code: activeMatch.inviteCode,
                    status: codeCopied ? t('game.roomCopiedOk') : t('game.roomCopy'),
                  })}
                </button>
              </div>
            )}
          </header>

          {/* Main Tactical Grid Layout */}
          <main
            className="game-tactical-grid grid grid-cols-1 gap-3 lg:grid-cols-[250px_1fr_250px] lg:gap-2.5 xl:grid-cols-[285px_1fr_285px] 2xl:grid-cols-[310px_1fr_310px]"
            style={{
              alignItems: 'start',
              width: '100%',
              margin: '0 auto',
            }}
          >
            {/* COLUMN 1: PILOT ROSTER // TACTICAL STATUS & SYSTEM CONTROL */}
            <div
              className="order-2 lg:order-none"
              style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
            >
              {/* Pilot Roster Window */}
              <section
                className={RETRO_WINDOW}
                id="playersWindow"
                style={{
                  // The token panel and display names need more room, so the box overhangs
                  // its grid track instead of shrinking the cards. The controls box follows
                  // the same width; rosterOverhang keeps cards equal with or without clash.
                  width: `calc(100% + ${rosterOverhang}px)`,
                  position: 'relative',
                  zIndex: 2,
                }}
              >
                <div className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{t('game.pilotRosterTitle')}</span>
                  </div>
                </div>

                <div
                  className={WINDOW_BODY}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  {/* Header row: the roster labels on the left, and (clash mode only) the
                      wall break tokens label on the right, aligned with the toggle panel
                      below so the divider runs straight down through both rows. */}
                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'stretch',
                      ...(view.clashMode === true
                        ? {
                            borderBottom: '1px solid rgba(255, 255, 255, 0.12)',
                            paddingBottom: 6,
                          }
                        : {}),
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.7rem',
                          color: 'var(--accent-cyan)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {t('game.seatPilotHeader')}
                      </span>
                      <span
                        style={{
                          fontSize: '0.65rem',
                          color: 'var(--text-muted)',
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        {t('game.lastRolled').toUpperCase()}
                      </span>
                    </div>
                    {view.clashMode === true && (
                      <div
                        title={t('game.barrierColumnTitle')}
                        style={{
                          width: BUSTER_PANEL_W,
                          flex: 'none',
                          boxSizing: 'border-box',
                          paddingLeft: 10,
                          borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
                          display: 'flex',
                          alignItems: 'center',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.58rem',
                          lineHeight: 1.3,
                          letterSpacing: '0.06em',
                          color: 'var(--accent-yellow)',
                        }}
                      >
                        {t('game.barrierColumnHeader')}
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      {SEAT_COLORS.map((ck) => {
                        const playerMeta = view.players.find((p) => p.color === ck);
                        const occupied = Boolean(
                          playerMeta &&
                          (view.status !== 'waiting' ||
                            (playerMeta.status === 'active' && playerMeta.username)),
                        );
                        const isActive = effectiveTurn === ck;

                        // Color neon accent map
                        const colorAccent =
                          ck === 'red'
                            ? '#ff007f'
                            : ck === 'green'
                              ? '#00ff88'
                              : ck === 'yellow'
                                ? '#ffe600'
                                : '#00f0ff';

                        if (view.status === 'waiting') {
                          if (
                            activeMatch.playerCount &&
                            SEAT_COLORS.indexOf(ck) >= activeMatch.playerCount
                          ) {
                            return null;
                          }
                          // `ck === view.myColor` lags the server's seat assignment for a PvP joiner,
                          // so fall back to a username match, which recognises the seat on first paint.
                          const isYou =
                            ck === view.myColor ||
                            (occupied &&
                              !!user?.username &&
                              playerMeta?.username === user.username);
                          const isReady = view.readyPlayers.includes(ck);
                          const takenByOther = Boolean(
                            occupied &&
                            !isYou &&
                            playerMeta?.username &&
                            playerMeta.username !== user?.username,
                          );
                          const canSelect = activeMatch.mode !== 'pvp' && !takenByOther && !isYou;

                          return (
                            <div
                              key={ck}
                              onClick={() => {
                                if (canSelect) {
                                  selectColor(ck);
                                }
                              }}
                              title={
                                isYou
                                  ? t('game.yourSeat', 'Your seat')
                                  : occupied
                                    ? t('game.occupied', 'Occupied seat')
                                    : t('game.emptySeat', 'Empty seat')
                              }
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                padding: '10px 12px',
                                borderRadius: 4,
                                cursor: canSelect
                                  ? 'pointer'
                                  : takenByOther
                                    ? 'not-allowed'
                                    : 'default',
                                border: isYou
                                  ? `1.5px solid ${colorAccent}`
                                  : occupied
                                    ? `1px solid ${colorAccent}66`
                                    : canSelect
                                      ? `1.5px dashed ${colorAccent}`
                                      : '1px dashed rgba(255, 255, 255, 0.15)',
                                background: isYou
                                  ? `${colorAccent}26`
                                  : occupied
                                    ? 'rgba(25, 10, 56, 0.65)'
                                    : canSelect
                                      ? 'rgba(10, 5, 25, 0.5)'
                                      : 'rgba(10, 5, 25, 0.35)',
                                boxShadow: isYou ? `0 0 12px ${colorAccent}55` : 'none',
                                opacity: occupied || isYou ? 1 : 0.5,
                                transition: 'all 0.2s ease',
                              }}
                            >
                              {occupied && playerMeta?.username ? (
                                <UserAvatar
                                  username={seatAvatarName(playerMeta)}
                                  // The engine reports the seat's immutable id and whether it has a photo, so
                                  // the client never asks for an image that is not there; `isBot` gates bot seats.
                                  userId={playerMeta.userId}
                                  isBot={playerMeta.isBot}
                                  hasAvatarPhoto={playerMeta.hasAvatarPhoto ?? false}
                                  avatarStyle={playerMeta.avatarStyle}
                                  size={34}
                                  fallbackStyle={{
                                    width: 34,
                                    height: 34,
                                    flex: 'none',
                                    borderRadius: 4,
                                    display: 'grid',
                                    placeItems: 'center',
                                    fontWeight: 'bold',
                                    fontSize: '0.75rem',
                                    color: '#0d0221',
                                    background: colorAccent,
                                    border: `1px solid ${colorAccent}`,
                                  }}
                                  style={{ borderRadius: 4, border: `1px solid ${colorAccent}` }}
                                />
                              ) : (
                                <div
                                  style={{
                                    width: 34,
                                    height: 34,
                                    flex: 'none',
                                    borderRadius: 4,
                                    display: 'grid',
                                    placeItems: 'center',
                                    fontWeight: 'bold',
                                    fontSize: '0.7rem',
                                    color: colorAccent,
                                    background: canSelect ? `${colorAccent}15` : 'transparent',
                                    border: `1.5px dashed ${colorAccent}88`,
                                  }}
                                >
                                  {ck.slice(0, 1).toUpperCase()}
                                </div>
                              )}

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div
                                  style={{
                                    fontWeight: 'bold',
                                    fontSize: '0.82rem',
                                    color: '#ffffff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                  }}
                                >
                                  <span
                                    style={{
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {occupied && playerMeta?.username
                                      ? localizedBotName(t, playerMeta.displayName) ||
                                        localizedBotName(t, playerMeta.username)
                                      : t('game.emptySeat')}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontSize: '0.68rem',
                                    color: isYou ? colorAccent : 'var(--text-muted)',
                                    fontFamily: 'var(--font-mono)',
                                  }}
                                >
                                  {isYou
                                    ? `// [${t('game.yourSeat', 'YOUR SEAT')}]`
                                    : occupied
                                      ? `// [${t('game.occupied', 'OCCUPIED')}]`
                                      : `// [${t('game.emptySeat', 'EMPTY SEAT')}]`}
                                </div>
                              </div>

                              {occupied ? (
                                <span
                                  className={RETRO_BADGE}
                                  style={{
                                    padding: '2px 6px',
                                    fontSize: '0.62rem',
                                    border: isReady ? '1px solid #00ff88' : '1px solid #ff0055',
                                    color: isReady ? '#00ff88' : '#ff0055',
                                  }}
                                >
                                  {isReady ? 'READY OK' : 'WAITING'}
                                </span>
                              ) : canSelect ? (
                                <span
                                  className={RETRO_BADGE}
                                  style={{
                                    padding: '2px 6px',
                                    fontSize: '0.62rem',
                                    border: `1px solid ${colorAccent}`,
                                    color: colorAccent,
                                    background: `${colorAccent}18`,
                                  }}
                                >
                                  {t('game.chooseBadge')}
                                </span>
                              ) : null}
                            </div>
                          );
                        }

                        // Active game pilot card: only render participating pilots
                        if (!playerMeta || playerMeta.status === 'inactive') return null;
                        const isDisconnected = playerMeta.status === 'disconnected';
                        // An exited seat is shown as gone: it has no pieces left, but
                        // the row stays because the results card needs it.
                        const isOut = playerMeta.status === 'exited';
                        // An exited seat can never hold the turn, so never advertise it
                        // as the pilot in control.
                        const isActiveSeat = isActive && !isOut;
                        const isHotseat = activeMatch.mode === 'hotseat';
                        // Hotseat's local seats have no account, so the engine leaves
                        // their userId undefined. Only the host's seat (the colour this
                        // device joined with) can show a photo.
                        const isHostSeat = isHotseat && ck === activeMatch.color;
                        const isYou = isHotseat
                          ? ck === view.myColor
                          : !playerMeta.isBot && playerMeta.username === user?.username;
                        const name =
                          (localNames[ck] ?? localizedBotName(t, playerMeta.displayName)) ||
                          localizedBotName(t, playerMeta.username) ||
                          (playerMeta.isBot
                            ? t('common.bot')
                            : isYou
                              ? t('common.you')
                              : isHotseat
                                ? t('game.localPlayer')
                                : 'Pilot');
                        const lastRoll = displayedLastRolls[ck];

                        return (
                          <div
                            key={ck}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '10px 12px',
                              borderRadius: 4,
                              border: isActiveSeat
                                ? `1.5px solid ${colorAccent}`
                                : occupied
                                  ? `1.5px solid ${colorAccent}44`
                                  : '1.5px dashed rgba(255, 255, 255, 0.12)',
                              background: isActiveSeat
                                ? `rgba(35, 12, 70, 0.95)`
                                : 'rgba(25, 10, 56, 0.65)',
                              boxShadow: isActiveSeat
                                ? `0 0 20px ${colorAccent}aa, inset 0 0 12px ${colorAccent}44`
                                : 'none',
                              // Three levels of presence: in the match (full), temporarily
                              // away (dimmed), or out of the match for good (faded out and
                              // desaturated, so it reads as removed rather than present).
                              opacity: isOut ? 0.3 : isDisconnected ? 0.55 : 1,
                              filter: isOut ? 'grayscale(1)' : 'none',
                              position: 'relative',
                              transition:
                                'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
                              boxSizing: 'border-box',
                            }}
                          >
                            {/* Active Turn Top-Right Badge */}
                            {isActiveSeat && (
                              <span
                                style={{
                                  position: 'absolute',
                                  top: -7,
                                  right: 8,
                                  background: colorAccent,
                                  color: '#0d0221',
                                  fontSize: '0.55rem',
                                  fontFamily: 'var(--font-mono)',
                                  fontWeight: 900,
                                  padding: '1px 6px',
                                  borderRadius: 3,
                                  letterSpacing: '0.5px',
                                  boxShadow: `0 0 10px ${colorAccent}`,
                                }}
                              >
                                ▶ {t('game.inControl')} ◀
                              </span>
                            )}

                            {/* Every seat renders an avatar. A bot has no account, so it takes
                            the generated avatar seeded from the lobby's assistant name, and
                            only the host's seat can show an uploaded photo. */}
                            <UserAvatar
                              // The host's seat uses the account identity, so the navbar
                              // and this card share one DiceBear seed. Other local seats
                              // seed from the name typed in the lobby.
                              username={
                                isHostSeat
                                  ? (user?.username ?? playerMeta.username)
                                  : seatAvatarName(playerMeta)
                              }
                              userId={isHostSeat ? user?.id : playerMeta.userId}
                              isBot={playerMeta.isBot}
                              hasAvatarPhoto={
                                isHostSeat
                                  ? (user?.hasAvatarPhoto ?? false)
                                  : (playerMeta.hasAvatarPhoto ?? false)
                              }
                              avatarStyle={
                                isHostSeat ? (user?.avatarStyle ?? null) : playerMeta.avatarStyle
                              }
                              size={36}
                              fallbackStyle={{
                                width: 36,
                                height: 36,
                                flex: 'none',
                                borderRadius: 4,
                                display: 'grid',
                                placeItems: 'center',
                                fontWeight: 'bold',
                                fontSize: '0.8rem',
                                color: '#0d0221',
                                background: colorAccent,
                              }}
                              style={{ borderRadius: 4, border: `1.5px solid ${colorAccent}` }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 'bold',
                                  fontSize: '0.84rem',
                                  color: '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                }}
                              >
                                {isActiveSeat && (
                                  <span
                                    style={{
                                      color: colorAccent,
                                      fontWeight: 'bold',
                                      fontSize: '0.75rem',
                                    }}
                                  >
                                    ▶
                                  </span>
                                )}
                                <span
                                  style={{
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    // The badge below is `flex: none`, so the callsign must be able
                                    // to shrink for its ellipsis to apply.
                                    flex: '1 1 auto',
                                    minWidth: 0,
                                    color: isOut ? 'var(--text-muted)' : undefined,
                                    textDecoration: isOut ? 'line-through' : 'none',
                                  }}
                                >
                                  {name}
                                </span>
                                {/* Seat presence: away for now, or out of the match for good. */}
                                {(isOut || isDisconnected) && (
                                  <span
                                    className={RETRO_BADGE}
                                    style={{
                                      flex: 'none',
                                      padding: '1px 5px',
                                      fontSize: '0.55rem',
                                      border: `1px solid ${isOut ? '#ff0055' : '#ffb300'}`,
                                      color: isOut ? '#ff0055' : '#ffb300',
                                    }}
                                  >
                                    {isOut ? t('game.pilotLeft') : t('game.reconnecting')}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Fixed slot for MiniDie to prevent callsign layout jitter */}
                            <div
                              style={{
                                width: 36,
                                height: 28,
                                flex: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-end',
                              }}
                            >
                              {lastRoll !== undefined && lastRoll > 0 && (
                                <MiniDie value={lastRoll} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Barrier breaker column: clash mode is the OPPORTUNITY to break
                        a wall, and this column is where the player takes it. One
                        numbered button per pilot (the token count), aligned to that
                        pilot's card; only the seat this device owns and only while it
                        holds the turn can be armed, and the engine owns the flag. */}
                    {view.clashMode === true && (
                      <div
                        style={{
                          width: BUSTER_PANEL_W,
                          flex: 'none',
                          boxSizing: 'border-box',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          // A panel of its own: the left divider and the padding are what
                          // make the toggle section read as separate from the roster, and
                          // stretching it keeps that divider running the cards' full height.
                          paddingLeft: 10,
                          borderLeft: '1px solid rgba(255, 255, 255, 0.12)',
                          alignSelf: 'stretch',
                        }}
                      >
                        {/* The column's description sits above both sub-columns (see
                            the barrier breaker hint), so the buttons start level with
                            the cards. */}
                        {SEAT_COLORS.map((ck) => {
                          const seat = view.players.find((p) => p.color === ck);
                          if (!seat || seat.status === 'inactive') {
                            return <div key={ck} style={{ flex: 1 }} />;
                          }
                          const tokens = seat.barrierTokens ?? 0;
                          const armed = seat.barrierArmed === true;
                          const canArm =
                            ck === view.myColor &&
                            ck === view.currentTurn &&
                            tokens > 0 &&
                            seat.status === 'active';
                          return (
                            <button
                              key={ck}
                              type="button"
                              disabled={!canArm}
                              aria-pressed={armed}
                              onClick={toggleBustArm}
                              title={
                                canArm
                                  ? armed
                                    ? t('game.barrierArmedTitle')
                                    : t('game.barrierArmTitle')
                                  : t('game.barrierCannotArmTitle')
                              }
                              style={{
                                flex: 1,
                                minHeight: 44,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 4,
                                padding: '4px 2px',
                                borderRadius: 4,
                                border: `1.5px solid ${
                                  armed
                                    ? 'var(--accent-yellow)'
                                    : canArm
                                      ? SEAT_HUES[ck]
                                      : 'rgba(255, 255, 255, 0.14)'
                                }`,
                                background: armed
                                  ? 'rgba(255, 230, 0, 0.2)'
                                  : 'rgba(25, 10, 56, 0.65)',
                                color: armed ? 'var(--accent-yellow)' : '#ffffff',
                                boxShadow: armed ? '0 0 14px var(--accent-yellow)' : 'none',
                                fontFamily: 'var(--font-mono)',
                                cursor: canArm ? 'pointer' : 'not-allowed',
                                opacity: canArm || armed ? 1 : 0.45,
                                touchAction: 'manipulation',
                                boxSizing: 'border-box',
                              }}
                            >
                              <span
                                style={{
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: '0.5rem',
                                  letterSpacing: '0.08em',
                                  whiteSpace: 'nowrap',
                                  color: armed ? 'var(--accent-yellow)' : 'var(--text-muted)',
                                }}
                              >
                                {armed
                                  ? t('game.barrierArmedCaption')
                                  : t('game.barrierToggleHint')}
                              </span>
                              <span
                                style={{
                                  display: 'flex',
                                  gap: 3,
                                  fontSize: '0.85rem',
                                  lineHeight: 1,
                                }}
                              >
                                {Array.from({ length: BARRIER_BUSTER_TOKEN_CAP }, (_, slot) => (
                                  <span key={slot} style={{ opacity: slot < tokens ? 1 : 0.22 }}>
                                    {BUSTER_GLYPH}
                                  </span>
                                ))}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Controls, Shortcuts & Audio Window */}
              <section
                className={RETRO_WINDOW}
                id="sectorControlWindow"
                style={{
                  // Kept in step with the roster box above it (see rosterOverhang): both
                  // boxes share one width, wider only where the token panel needs room.
                  width: `calc(100% + ${rosterOverhang}px)`,
                  position: 'relative',
                  zIndex: 2,
                }}
              >
                <div className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{t('gameExtra.controlsShortcuts')}</span>
                  </div>
                </div>

                <div
                  className={WINDOW_BODY}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    padding: '14px 14px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{t('gameExtra.diceRollLabel')}</span>
                      <span
                        style={{
                          color: '#fff',
                          fontFamily: 'var(--font-mono)',
                          background: 'rgba(0, 240, 255, 0.15)',
                          padding: '2px 6px',
                          borderRadius: 3,
                          border: '1px solid var(--accent-cyan)',
                        }}
                      >
                        {t('gameExtra.spacebarKey')}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{t('gameExtra.selectPieceLabel')}</span>
                      <span
                        style={{
                          color: '#fff',
                          fontFamily: 'var(--font-mono)',
                          background: 'rgba(255, 0, 127, 0.15)',
                          padding: '2px 6px',
                          borderRadius: 3,
                          border: '1px solid var(--accent-pink)',
                        }}
                      >
                        {t('gameExtra.leftClickKey')}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>{t('gameExtra.goalColonLabel')}</span>
                      <span style={{ color: '#ffe600', fontFamily: 'var(--font-mono)' }}>
                        {t('gameExtra.goalValue')}
                      </span>
                    </div>
                  </div>

                  <div
                    style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)', margin: '2px 0' }}
                  />

                  {/* Audio Preferences Toggle Button */}
                  <button
                    className={RETRO_BADGE}
                    style={{
                      cursor: 'pointer',
                      padding: '8px 10px',
                      background: soundMuted ? 'rgba(255, 0, 85, 0.12)' : 'rgba(0, 255, 136, 0.12)',
                      border: soundMuted ? '1.5px solid #ff0055' : '1.5px solid #00ff88',
                      color: soundMuted ? '#ff0055' : '#00ff88',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.72rem',
                      fontWeight: 'bold',
                      letterSpacing: '0.8px',
                      textAlign: 'center',
                      justifyContent: 'center',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      borderRadius: 4,
                      boxShadow: soundMuted ? 'none' : '0 0 8px rgba(0, 255, 136, 0.25)',
                      transition: 'all 0.2s ease',
                      width: '100%',
                      boxSizing: 'border-box',
                    }}
                    onClick={toggleSound}
                    title={t('gameExtra.toggleAudio')}
                  >
                    <span>{soundMuted ? '🔇' : '🔊'}</span>
                    <span>{soundMuted ? t('game.audioOff') : t('game.audioOn')}</span>
                  </button>

                  <CyberButton
                    label={t('gameExtra.gameRulesBtn')}
                    shortcut="?"
                    variant="cyan"
                    onClick={() => {
                      retroAudio.playUiBeep(600, 0.05);
                      setRulesPage(0);
                      setIsSystemModalOpen(true);
                    }}
                    style={{ width: '100%', justifyContent: 'center' }}
                  />
                </div>
              </section>

              {/* View Results Button below Pilot Roster */}
              {lastResult && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column' }}>
                  <button
                    className={RETRO_BTN}
                    onClick={() => {
                      retroAudio.playUiBeep(640, 0.06);
                      setShowResultsModal(true);
                    }}
                    style={{
                      width: '100%',
                      padding: '12px 0',
                      fontSize: '0.82rem',
                      fontFamily: 'var(--font-heading)',
                      letterSpacing: '1px',
                      background: 'linear-gradient(135deg, #ff007f, #9d00ff)',
                      borderColor: 'var(--accent-pink)',
                      color: '#ffffff',
                      boxShadow: '0 0 16px rgba(255, 0, 127, 0.4)',
                      borderRadius: 4,
                      justifyContent: 'center',
                    }}
                  >
                    ★ {t('results.viewResultsBtn', 'VIEW RESULTS')}
                  </button>
                </div>
              )}
            </div>

            {/* COLUMN 2: QUANTUM LUDO MATRIX / BOARD */}
            <div
              className="order-1 lg:order-none"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                width: '100%',
                // Desktop: the board yields the roster panel's overhang and then biases right
                // (see boardMaxWidth / boardMarginRight); the stacked layout stays centred.
                maxWidth: boardMaxWidth,
                justifySelf: desktopLayout ? 'end' : 'center',
                marginRight: boardMarginRight,
              }}
            >
              {(() => {
                const currentTurnPlayer = view.players.find((p) => p.color === view.currentTurn);
                const isBotTurn = currentTurnPlayer?.isBot ?? false;
                const activeLegalMoves = isRolling || isBotTurn ? [] : view.legalMoves;

                return (
                  <div style={{ width: '100%' }}>
                    <Board
                      pieces={view.pieces}
                      players={view.players}
                      legalMoves={activeLegalMoves}
                      onPieceClick={isRolling || isBotTurn ? () => {} : movePiece}
                      animating={animatingPiece}
                      fx={captureFx}
                      noSafeZones={view.noSafeZones}
                      bustArmed={bustArmed}
                    />
                  </div>
                );
              })()}
            </div>

            {/* COLUMN 3: TACTICAL CONTROLS & LOGS */}
            <div
              className="order-3 lg:order-none"
              style={{ display: 'flex', flexDirection: 'column', gap: 18 }}
            >
              {view.status === 'waiting' ? (
                /* WAITING ROOM SETUP WINDOW */
                <section className={RETRO_WINDOW} id="waitingSetupWindow">
                  <div className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}>
                    <span>{t('game.waitingBayTitle')}</span>
                  </div>

                  <div
                    className={WINDOW_BODY}
                    style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
                  >
                    {(() => {
                      const activeCount = view.players.filter((p) => p.status === 'active').length;
                      const alreadyReady = view.readyPlayers.includes(view.myColor);
                      const soloRoom = activeCount < 2;
                      const disabled = alreadyReady || soloRoom;
                      return (
                        <button
                          className={RETRO_BTN}
                          onClick={markReady}
                          disabled={disabled}
                          style={{
                            width: '100%',
                            padding: '12px 0',
                            fontSize: '0.8rem',
                            background: alreadyReady ? 'rgba(0, 255, 136, 0.2)' : 'var(--btn-bg)',
                            borderColor: alreadyReady ? '#00ff88' : 'var(--accent-pink)',
                            color: alreadyReady ? '#00ff88' : '#ffffff',
                            opacity: disabled ? 0.6 : 1,
                            cursor: disabled ? 'default' : 'pointer',
                          }}
                        >
                          {alreadyReady
                            ? `[${t('game.readyBadge').toUpperCase()}] (${t('game.waitingForHost')})`
                            : soloRoom
                              ? t('game.readyNeedsOpponent')
                              : t('game.startMatchBtn')}
                        </button>
                      );
                    })()}

                    <div
                      style={{
                        fontSize: '0.72rem',
                        color: 'var(--accent-cyan)',
                        textAlign: 'center',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {t('game.readyPilots', {
                        current: view.readyPlayers.length,
                        total: view.players.filter((p) => p.status === 'active').length,
                      })}
                    </div>

                    {activeMatch.mode === 'pvp' && (
                      <div
                        style={{ borderTop: '1px solid rgba(0, 240, 255, 0.25)', paddingTop: 12 }}
                      >
                        <div
                          style={{
                            fontSize: '0.72rem',
                            color: 'var(--accent-cyan)',
                            marginBottom: 8,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {t('game.rulesControl')}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {(
                            [
                              {
                                key: 'clashMode' as const,
                                icon: '⚔️',
                                label: t('game.clashMode'),
                                desc: t('game.clashModeDesc'),
                                checked: view.clashMode,
                                accent: 'var(--accent-pink)',
                              },
                              {
                                key: 'noSafeZones' as const,
                                icon: '💀',
                                label: t('game.noSafeZones'),
                                desc: t('game.noSafeZonesDesc'),
                                checked: view.noSafeZones,
                                accent: 'var(--accent-cyan)',
                              },
                              {
                                key: 'freeExit' as const,
                                icon: '🚪',
                                label: t('game.freeExit'),
                                desc: t('game.freeExitDesc'),
                                checked: view.freeExit,
                                accent: 'var(--accent-yellow)',
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
                              <span
                                style={{
                                  display: 'flex',
                                  flexDirection: 'column',
                                  lineHeight: 1.3,
                                }}
                              >
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
                                  // Same pair as the local table's rule toggles: ON reads
                                  // like a seat added, OFF like one removed.
                                  retroAudio.playUiBeep(e.target.checked ? 520 : 320, 0.05);
                                  // One object each way: the toggle that moved is the
                                  // only field that changes, the other two are echoed.
                                  updateModifiers({
                                    clashEnabled:
                                      rule.key === 'clashMode' ? e.target.checked : view.clashMode,
                                    noSafeZones:
                                      rule.key === 'noSafeZones'
                                        ? e.target.checked
                                        : view.noSafeZones,
                                    freeExit:
                                      rule.key === 'freeExit' ? e.target.checked : view.freeExit,
                                  });
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
                        <div
                          style={{
                            fontSize: '0.65rem',
                            color: 'var(--text-muted)',
                            marginTop: 6,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {t('game.hostOnlyRules')}
                        </div>
                      </div>
                    )}

                    {activeMatch.mode === 'pvp' && (
                      <div
                        style={{ borderTop: '1px solid rgba(255, 0, 127, 0.25)', paddingTop: 12 }}
                      >
                        <div
                          style={{
                            fontSize: '0.72rem',
                            color: 'var(--accent-cyan)',
                            marginBottom: 8,
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {t('game.inviteComms')}
                        </div>
                        {friends.length === 0 ? (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            {t('game.noFriendsToInvite')}
                          </div>
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 6,
                              maxHeight: 110,
                              overflowY: 'auto',
                            }}
                          >
                            {friends.map((f) => {
                              const st = inviteStates[f.id] ?? 'idle';
                              return (
                                <div
                                  key={f.id}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '6px 8px',
                                    background: 'rgba(0, 0, 0, 0.4)',
                                    borderRadius: 3,
                                  }}
                                >
                                  <div
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 6,
                                      minWidth: 0,
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: '50%',
                                        background: '#00ff88',
                                        boxShadow: '0 0 6px #00ff88',
                                        flex: 'none',
                                      }}
                                    />
                                    <span
                                      style={{
                                        fontSize: '0.75rem',
                                        color: '#ffffff',
                                        fontFamily: 'var(--font-mono)',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      {f.displayName ?? f.username}
                                    </span>
                                  </div>
                                  <button
                                    className={RETRO_BTN}
                                    onClick={() => {
                                      void inviteFriend(f.id);
                                    }}
                                    disabled={st !== 'idle'}
                                    style={{
                                      padding: '3px 8px',
                                      fontSize: '0.62rem',
                                      flex: 'none',
                                    }}
                                  >
                                    {st === 'busy'
                                      ? '...'
                                      : st === 'sent'
                                        ? t('game.inviteSent')
                                        : `+ ${t('game.inviteBtn')}`}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              ) : (
                /* IN-GAME DICE CONTROLS WINDOW */
                <section className={RETRO_WINDOW} id="diceControlWindow">
                  <div className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}>
                    <span>{t('game.diceSystemTitle')}</span>
                  </div>

                  <div
                    className={WINDOW_BODY}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 12,
                      padding: '16px 14px',
                    }}
                  >
                    {/* Active Turn Pilot Banner */}
                    {(() => {
                      const activeTurnPlayer = view.players.find((p) => p.color === effectiveTurn);
                      const isBot = activeTurnPlayer?.isBot ?? false;
                      const activeName =
                        localizedBotName(t, activeTurnPlayer?.displayName) ||
                        localizedBotName(t, activeTurnPlayer?.username) ||
                        (isBot
                          ? `${t('common.bot')} (${localizedColor(t, effectiveTurn)})`
                          : localizedColor(t, effectiveTurn));
                      const turnColorHex = SEAT_HUES[effectiveTurn] || '#00f0ff';

                      return (
                        <div
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            background: isMyTurn ? 'rgba(255, 0, 127, 0.25)' : `${turnColorHex}18`,
                            border: isMyTurn
                              ? '1.5px solid var(--accent-pink)'
                              : `1.5px solid ${turnColorHex}`,
                            boxShadow: isMyTurn
                              ? '0 0 16px rgba(255, 0, 127, 0.6)'
                              : `0 0 8px ${turnColorHex}44`,
                            animation: isMyTurn ? 'pulse-turn-banner 1.6s infinite' : 'none',
                            borderRadius: 4,
                            textAlign: 'center',
                            fontSize: '0.78rem',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 'bold',
                            color: '#ffffff',
                            letterSpacing: '0.5px',
                          }}
                        >
                          {isMyTurn
                            ? `▶ ${t('game.yourTurn').toUpperCase()} ◀`
                            : `▶ ${t('game.botTurn', { name: activeName }).toUpperCase()} ◀`}
                        </div>
                      );
                    })()}

                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.72rem',
                        color: isMyTurn ? '#ffe600' : 'var(--text-muted)',
                      }}
                    >
                      {isRolling
                        ? t('game.statusRolling')
                        : canRoll
                          ? t('game.statusRollNow')
                          : view.turnPhase === 'WAITING_FOR_MOVE'
                            ? t('game.statusSelectPiece')
                            : t('game.statusRivalTurn', {
                                name: localizedColor(t, effectiveTurn).toUpperCase(),
                              })}
                    </div>

                    {/* The die IS the brake. A tap while it is at rest rolls, a tap
                        on a spinning roll this device started shortens it, and it
                        stays ENABLED while spinning on purpose: a disabled button
                        cannot report the tap. */}
                    <div style={{ height: 90, display: 'grid', placeItems: 'center' }}>
                      <button
                        type="button"
                        onClick={tapDie}
                        aria-label={isRolling ? t('game.rolling') : t('game.rollDiceBtn')}
                        style={{
                          display: 'grid',
                          placeItems: 'center',
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          font: 'inherit',
                          cursor: isRolling || canRoll ? 'pointer' : 'default',
                        }}
                      >
                        <Die
                          value={view.diceValue ?? 0}
                          rolling={isRolling}
                          brakeTo={brakeTo}
                        />
                      </button>
                    </div>

                    <button
                      className={RETRO_BTN}
                      onClick={beginRoll}
                      disabled={!canRoll || isRolling}
                      style={{
                        width: '100%',
                        padding: '14px 20px',
                        fontSize: '0.96rem',
                        fontFamily: 'var(--font-heading)',
                        letterSpacing: '1.5px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        background:
                          canRoll && !isRolling ? 'var(--btn-bg)' : 'rgba(25, 10, 56, 0.5)',
                        borderColor:
                          canRoll && !isRolling ? 'var(--accent-pink)' : 'rgba(255, 255, 255, 0.2)',
                        boxShadow: canRoll && !isRolling ? '0 0 20px var(--accent-pink)' : 'none',
                        animation: canRoll && !isRolling ? 'pulse-glow 1.5s infinite' : 'none',
                        cursor: canRoll && !isRolling ? 'pointer' : 'default',
                        opacity: canRoll && !isRolling ? 1 : 0.5,
                        boxSizing: 'border-box',
                      }}
                    >
                      {isRolling ? t('game.rolling').toUpperCase() : t('game.rollDiceBtn')}
                    </button>

                    {/* Barrier Buster: the token is spent on the FIRST tap that
                        commits it, so the control has two steps. Arm it here, then
                        tap the prison exit on the board; Skip declines and keeps
                        the token. Both render only while the roll actually offers
                        such a bust, which is what makes them mean something. */}
                    {canOfferBust && (
                      <button
                        className={RETRO_BTN}
                        onClick={toggleBustArm}
                        title={
                          bustArmed
                            ? t('game.barrierBusterArmedTitle')
                            : t('game.barrierBusterTitle')
                        }
                        style={{
                          width: '100%',
                          padding: '10px 16px',
                          fontSize: '0.78rem',
                          fontFamily: 'var(--font-heading)',
                          letterSpacing: '1px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          textAlign: 'center',
                          background: bustArmed ? 'rgba(255, 230, 0, 0.22)' : 'var(--btn-bg)',
                          borderColor: bustArmed ? 'var(--accent-yellow)' : 'var(--accent-cyan)',
                          color: bustArmed ? 'var(--accent-yellow)' : '#ffffff',
                          boxShadow: bustArmed ? '0 0 18px var(--accent-yellow)' : 'none',
                          animation: bustArmed ? 'pulse-glow 1.5s infinite' : 'none',
                          cursor: 'pointer',
                          boxSizing: 'border-box',
                        }}
                      >
                        {bustArmed
                          ? `🔓 ${t('game.barrierBusterArmedBtn')}`
                          : `🔓 ${t('game.barrierBusterBtn')}`}
                      </button>
                    )}

                    <div
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.68rem',
                        color: 'var(--accent-cyan)',
                        textAlign: 'center',
                      }}
                    >
                      [ {t('game.spaceToRoll')} ]
                    </div>
                  </div>
                </section>
              )}

              {/* MISSION TELEMETRY LOG WINDOW */}
              <section
                className={RETRO_WINDOW}
                id="moveLogWindow"
                style={{
                  height: 180,
                  maxHeight: 180,
                  flex: 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  overflow: 'hidden',
                }}
              >
                <div
                  className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}
                  style={{ flex: 'none' }}
                >
                  <span>{t('game.reconLogsTitle')}</span>
                </div>

                <div
                  ref={moveLogContainerRef}
                  className={WINDOW_BODY}
                  style={{
                    flex: 1,
                    height: '100%',
                    maxHeight: '100%',
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '10px 12px',
                    background: 'rgba(5, 2, 15, 0.75)',
                    boxSizing: 'border-box',
                  }}
                >
                  {moveLogs.length === 0 ? (
                    <div
                      style={{
                        fontSize: '0.72rem',
                        color: 'var(--text-muted)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {t('game.noReconLogged')}
                    </div>
                  ) : (
                    moveLogs.map((ml, i) => {
                      const dotColor =
                        ml.ck === 'red'
                          ? '#ff007f'
                          : ml.ck === 'green'
                            ? '#00ff88'
                            : ml.ck === 'yellow'
                              ? '#ffe600'
                              : '#00f0ff';
                      return (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: 8,
                            fontSize: '0.72rem',
                            color: '#ffffff',
                            fontFamily: 'var(--font-mono)',
                            lineHeight: 1.3,
                          }}
                        >
                          <span style={{ color: dotColor, fontWeight: 'bold' }}>●</span>
                          <span>{ml.text}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </section>

              {/* RETURN TO LOBBY BUTTON (Shown whenever game has ended across all modes, or in online PvP) */}
              {(isGameEnded || (activeMatch.mode !== 'pve' && activeMatch.mode !== 'hotseat')) && (
                <button
                  className={RETRO_BTN}
                  onClick={() => {
                    retroAudio.playUiBeep(440, 0.05);
                    setLastResult(null);
                    setShowResultsModal(false);
                    setActiveMatch(null);
                    navigate(isGuest ? '/login' : '/gamelobby');
                  }}
                  style={{
                    width: '100%',
                    padding: isGameEnded ? '14px 18px' : '12px 14px',
                    fontSize: isGameEnded ? '0.88rem' : '0.78rem',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 'bold',
                    letterSpacing: '1px',
                    lineHeight: '1.4',
                    background: isGameEnded
                      ? 'linear-gradient(135deg, rgba(0, 240, 255, 0.25), rgba(157, 0, 255, 0.25))'
                      : 'rgba(0, 240, 255, 0.12)',
                    border: '1.5px solid var(--accent-cyan)',
                    color: '#ffffff',
                    boxShadow: isGameEnded ? '0 0 16px rgba(0, 240, 255, 0.4)' : 'none',
                    cursor: 'pointer',
                    textAlign: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box',
                    transition: 'all 0.2s ease',
                  }}
                  title={t('game.returnToLobbyTooltip')}
                >
                  &lt; {isGuest ? t('guest.backToLogin') : t('game.returnToLobbyBtn')}
                </button>
              )}

              {/* ABORT MISSION / END GAME BUTTON */}
              {!isGameEnded &&
                (() => {
                  const isBotOrHotseat =
                    activeMatch.mode === 'pve' || activeMatch.mode === 'hotseat';
                  return (
                    <CyberButton
                      label={
                        isBotOrHotseat ? t('gameExtra.abortSimulationBtn') : t('game.abortMatchBtn')
                      }
                      shortcut="ESC"
                      variant="danger"
                      onClick={() => setIsAbortModalOpen(true)}
                      style={{ width: '100%', justifyContent: 'center' }}
                    />
                  );
                })()}

              {/* Skip: the deliberate way out of a turn a wall attack is holding (it keeps
                  the token and passes). It sits under the abort control and is always on
                  screen in a clash room, greyed out while nothing is holding the turn, so
                  the control is discoverable before it is needed. The wrapper carries the
                  tooltip because a disabled button fires no pointer events of its own. */}
              {view.clashMode === true && !isGameEnded && (
                <span
                  style={{ display: 'block', width: '100%' }}
                  title={canSkipBust ? t('game.skipBustTitle') : t('game.skipBustDisabledTitle')}
                >
                  <CyberButton
                    label={t('game.skipBustBtn')}
                    variant="yellow"
                    disabled={!canSkipBust}
                    onClick={skipBust}
                    style={{ width: '100%', justifyContent: 'center' }}
                  />
                </span>
              )}
            </div>
          </main>
        </div>
      </div>

      {/* Cyberpunk Glitch Confirmation Modal */}
      <CyberModal
        isOpen={isAbortModalOpen}
        title={t('gameExtra.protocolTerminationTitle')}
        versionTag={
          activeMatch.gameId
            ? t('gameExtra.abortVersionTag', { code: activeMatch.gameId.slice(0, 8) })
            : 'v001.e1349837856'
        }
        message={
          activeMatch.mode === 'pve' || activeMatch.mode === 'hotseat'
            ? t('gameExtra.abortConfirmPve')
            : t('gameExtra.abortConfirmPvp')
        }
        subMessage={t('gameExtra.abortSubMessage')}
        onCancel={() => setIsAbortModalOpen(false)}
        onProceed={() => {
          setIsAbortModalOpen(false);
          endGame();
        }}
        cancelLabel={t('gameExtra.cancelBtn')}
        proceedLabel={t('gameExtra.confirmAbortBtn')}
        cancelShortcut="ESC"
        proceedShortcut="↵"
        isDanger
      />

      {/* Cyberpunk System Control & Multi-Page Rules Modal (10 Pages) */}
      <CyberModal
        isOpen={isSystemModalOpen}
        title={t('gameExtra.rulesModalTitle')}
        versionTag={t('gameExtra.rulesVersionTag')}
        cancelLabel={t('common.close')}
        proceedLabel={rulesPage < 9 ? t('gameExtra.nextPageBtn') : t('gameExtra.startPlayingBtn')}
        cancelShortcut="ESC"
        proceedShortcut={rulesPage < 9 ? '→' : '↵'}
        closeOnProceed={rulesPage >= 9}
        onCancel={() => setIsSystemModalOpen(false)}
        onProceed={() => {
          if (rulesPage < 9) {
            retroAudio.playUiBeep(700, 0.05);
            setRulesPage((p) => p + 1);
          } else {
            setIsSystemModalOpen(false);
          }
        }}
        message={
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              minWidth: 380,
              maxWidth: 520,
            }}
          >
            {/* Page Navigation Tabs: Compact 1-row layout */}
            <div
              style={{
                display: 'flex',
                gap: 6,
                borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
                paddingBottom: 10,
              }}
            >
              {[
                { id: 0, label: t('gameExtra.rulesTab0') },
                { id: 1, label: t('gameExtra.rulesTab1') },
                { id: 2, label: t('gameExtra.rulesTab2') },
                { id: 3, label: t('gameExtra.rulesTab3') },
                { id: 4, label: t('gameExtra.rulesTab4') },
                { id: 5, label: t('gameExtra.rulesTab5') },
                { id: 6, label: t('gameExtra.rulesTab6') },
                { id: 7, label: t('gameExtra.rulesTab7') },
                { id: 8, label: t('gameExtra.rulesTab8') },
                { id: 9, label: t('gameExtra.rulesTab9') },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    retroAudio.playUiBeep(520, 0.04);
                    setRulesPage(p.id);
                  }}
                  style={{
                    flex: 1,
                    padding: '6px 2px',
                    fontSize: '0.68rem',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 'bold',
                    background:
                      rulesPage === p.id ? 'rgba(0, 240, 255, 0.22)' : 'rgba(255, 255, 255, 0.04)',
                    border:
                      rulesPage === p.id
                        ? '1.5px solid var(--accent-cyan)'
                        : '1px solid rgba(255, 255, 255, 0.1)',
                    color: rulesPage === p.id ? '#ffffff' : 'var(--text-muted)',
                    boxShadow: rulesPage === p.id ? '0 0 10px rgba(0, 240, 255, 0.35)' : 'none',
                    borderRadius: 4,
                    cursor: 'pointer',
                    textAlign: 'center',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* PAGE 0: Objective & Controls */}
            {rulesPage === 0 && (
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
                    border: '1px solid rgba(255, 0, 127, 0.3)',
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
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      {t('gameExtra.rulesRollDiceLabel')}
                    </span>
                    <span
                      style={{
                        color: '#fff',
                        fontFamily: 'var(--font-mono)',
                        background: 'rgba(0, 240, 255, 0.2)',
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
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                      {t('gameExtra.rulesSelectWarpLabel')}
                    </span>
                    <span
                      style={{
                        color: '#fff',
                        fontFamily: 'var(--font-mono)',
                        background: 'rgba(255, 0, 127, 0.2)',
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
            )}

            {/* PAGE 1: Rolling a 6 */}
            {rulesPage === 1 && (
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
                    color: 'var(--accent-yellow)',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.05rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesPage1Header')}
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    background: 'rgba(5, 2, 18, 0.65)',
                    padding: 16,
                    borderRadius: 6,
                    borderLeft: '4px solid var(--accent-yellow)',
                    border: '1px solid rgba(255, 230, 0, 0.2)',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                  >
                    <span style={{ color: 'var(--accent-yellow)', fontSize: '1.2rem' }}>⚡</span>
                    <span>{t('gameExtra.rulesPage1Line1')}</span>
                  </div>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                  >
                    <span style={{ color: 'var(--accent-yellow)', fontSize: '1.2rem' }}>🚀</span>
                    <span>{t('gameExtra.rulesPage1Line2')}</span>
                  </div>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                  >
                    <span style={{ color: '#ff0055', fontSize: '1.2rem' }}>⛔</span>
                    <span>{t('gameExtra.rulesPage1Line3')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* PAGE 2: Landing on Enemy Piece */}
            {rulesPage === 2 && (
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
                  {t('gameExtra.rulesPage2Header')}
                </div>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage2Intro')}
                </p>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    background: 'rgba(5, 2, 18, 0.65)',
                    padding: 16,
                    borderRadius: 6,
                    borderLeft: '4px solid var(--accent-pink)',
                    border: '1px solid rgba(255, 0, 127, 0.2)',
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                  >
                    <span style={{ color: 'var(--accent-pink)', fontSize: '1.2rem' }}>⚔</span>
                    <span>{t('gameExtra.rulesPage2Line1')}</span>
                  </div>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                  >
                    <span style={{ color: '#00ff88', fontSize: '1.2rem' }}>✦</span>
                    <span>{t('gameExtra.rulesPage2Line2')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* PAGE 3: The Star */}
            {rulesPage === 3 && (
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
                    color: 'var(--accent-cyan)',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.05rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesPage3Header')}
                </div>
                <div
                  style={{
                    background: 'rgba(5, 2, 18, 0.65)',
                    padding: 16,
                    borderRadius: 6,
                    borderLeft: '4px solid var(--accent-cyan)',
                    border: '1px solid rgba(0, 240, 255, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div
                    style={{ color: 'var(--accent-cyan)', fontWeight: 'bold', fontSize: '1.1rem' }}
                  >
                    {t('gameExtra.rulesPage3Title')}
                  </div>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage3Body')}
                  </p>
                </div>
              </div>
            )}

            {/* PAGE 4: Two Pieces Together (Blockade) */}
            {rulesPage === 4 && (
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
                    color: '#00ff88',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.05rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesPage4Header')}
                </div>
                <div
                  style={{
                    background: 'rgba(5, 2, 18, 0.65)',
                    padding: 16,
                    borderRadius: 6,
                    borderLeft: '4px solid #00ff88',
                    border: '1px solid rgba(0, 255, 136, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ color: '#00ff88', fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {t('gameExtra.rulesPage4Title')}
                  </div>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage4Body')}
                  </p>
                </div>
              </div>
            )}

            {/* PAGE 5: Home Lane */}
            {rulesPage === 5 && (
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
                    color: '#9d00ff',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.05rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesPage5Header')}
                </div>
                <div
                  style={{
                    background: 'rgba(5, 2, 18, 0.65)',
                    padding: 16,
                    borderRadius: 6,
                    borderLeft: '4px solid #9d00ff',
                    border: '1px solid rgba(157, 0, 255, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                  }}
                >
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage5Line1')}
                  </p>
                  <p
                    style={{
                      margin: 0,
                      color: '#ffe600',
                      fontWeight: 'bold',
                      fontSize: '1.05rem',
                      letterSpacing: '0.5px',
                    }}
                  >
                    {t('gameExtra.rulesPage5Line2')}
                  </p>
                </div>
              </div>
            )}

            {/* PAGE 6: Clash Mode */}
            {rulesPage === 6 && (
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
                    color: '#ffe600',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.05rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesPage6Header')}
                </div>
                <div
                  style={{
                    background: 'rgba(5, 2, 18, 0.65)',
                    padding: 16,
                    borderRadius: 6,
                    border: '1px solid rgba(255, 230, 0, 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ color: '#ffe600', fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {t('gameExtra.rulesPage6Title')}
                  </div>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage6Body')}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      borderLeft: '3px solid rgba(255, 230, 0, 0.35)',
                      paddingLeft: 10,
                    }}
                  >
                    <div style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>
                      {t('gameExtra.rulesPage6Step1')}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>
                      {t('gameExtra.rulesPage6Step2')}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>
                      {t('gameExtra.rulesPage6Step3')}
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>
                      {t('gameExtra.rulesPage6Step4')}
                    </div>
                  </div>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.9rem' }}>
                    {t('gameExtra.rulesPage6Chain')}
                  </p>
                  <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {t('gameExtra.rulesPage6Touch')}
                  </p>
                </div>
              </div>
            )}

            {/* PAGE 7: No Safe Zones (hardcore) */}
            {rulesPage === 7 && (
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
                    color: '#ff0055',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.05rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesPage7Header')}
                </div>
                <div
                  style={{
                    background: 'rgba(5, 2, 18, 0.65)',
                    padding: 16,
                    borderRadius: 6,
                    border: '1px solid rgba(255, 0, 85, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ color: '#ff0055', fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {t('gameExtra.rulesPage7Title')}
                  </div>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage7Body')}
                  </p>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage7Body2')}
                  </p>
                </div>
              </div>
            )}

            {/* PAGE 8: Free exit */}
            {rulesPage === 8 && (
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
                    color: '#00f0ff',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.05rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesPage8Header')}
                </div>
                <div
                  style={{
                    background: 'rgba(5, 2, 18, 0.65)',
                    padding: 16,
                    borderRadius: 6,
                    border: '1px solid rgba(0, 240, 255, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ color: '#00f0ff', fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {t('gameExtra.rulesPage8Title')}
                  </div>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage8Body')}
                  </p>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage8Body2')}
                  </p>
                </div>
              </div>
            )}
            {rulesPage === 9 && (
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
                    color: '#00f0ff',
                    fontWeight: 'bold',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.05rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesPage9Header')}
                </div>
                <div
                  style={{
                    background: 'rgba(5, 2, 18, 0.65)',
                    padding: 16,
                    borderRadius: 6,
                    border: '1px solid rgba(0, 240, 255, 0.25)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ color: '#00f0ff', fontWeight: 'bold', fontSize: '1.1rem' }}>
                    {t('gameExtra.rulesPage9Title')}
                  </div>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage9Body')}
                  </p>
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                    {t('gameExtra.rulesPage9Body2')}
                  </p>
                </div>
              </div>
            )}
          </div>
        }
      />

      {/* QTE Clash overlay: one component serves keyboard and touch. In hotseat a
          single device owns both seats, so both sides' keys are live at once. */}
      {view.clash && (
        <ClashOverlay
          clash={view.clash}
          result={view.clashResult}
          myColor={view.myColor}
          onKeyPress={clashInput}
          onComplete={clearClash}
          allowBothSides={activeMatch.mode === 'hotseat'}
        />
      )}

      {/* The clash card's dim copy of the capture burst: the same ring and sparks at the
          cell the capture landed on, held for exactly as long as the card. It is pinned
          above the overlay (zIndex 1000) because the card covers the middle of the board,
          so a copy behind it would be invisible on half the loop. The board's own burst
          fires once the card is gone (see the `view.clash` effect). */}
      {view.clash && cardCaptureFx && (
        <div
          style={{
            position: 'fixed',
            left: cardCaptureFx.x,
            top: cardCaptureFx.y,
            width: 0,
            height: 0,
            zIndex: 1000,
            pointerEvents: 'none',
          }}
        >
          <CaptureBurst color={cardCaptureFx.color} opacity={CAPTURE_FX_CARD_OPACITY} />
        </div>
      )}

      {/* Game Results Modal Popup */}
      {showResultsModal && lastResult && (
        <ResultsModal
          result={lastResult}
          returnLabel={isGuest ? t('guest.backToLogin') : undefined}
          errorText={isGuest ? playAgainError : undefined}
          onPlayAgain={isGuest ? () => void playAgain() : undefined}
          onReturnToLobby={() => {
            setLastResult(null);
            setShowResultsModal(false);
            setActiveMatch(null);
            navigate(isGuest ? '/login' : '/gamelobby');
          }}
          onClose={() => setShowResultsModal(false)}
        />
      )}
    </>
  );
}
