import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Board } from '../components/Board';
import { CaptureBurst } from '../components/CaptureBurst';
import { GoalBurst } from '../components/GoalBurst';
import { GoalCard, GOAL_CARD_ASPECT, GOAL_CARD_MAX_PX } from '../components/GoalCard';
import { GoalConfetti } from '../components/GoalConfetti';
import { Die } from '../components/Die';
import { RoomRuleToggle } from '../components/RoomRuleToggle';
import { avatarSeed, localizedBotName, localizedColor } from '../utils/botName';
import { applyEvent, initialView } from '../game/reducer';
import { LOG_CAP, type LogEntry, type PlayerColor, type PlayerMeta } from '../game/types';
import { ClashOverlay } from '../game/ClashOverlay';
import { ResultFx, FLASH_CARD_ASPECT, FLASH_CARD_STAGE_MAX_PX, FLASH_CARD_VIEWBOX } from '../game/ResultFx';
import { stepToCell } from '../game/boardGeometry';
import {
  CAPTURE_CARD_FADE_MS,
  CAPTURE_CARD_GRACE_MS,
  CAPTURE_CARD_MS,
  CARD_HOLD_MARGIN_MS,
  DICE_ROLL_ANIM_MS,
  GOAL_CARD_FADE_MS,
  GOAL_CARD_MS,
  MOVE_STEP_ANIM_MS,
} from '../__shared__/timing.constants';
import {
  CAPTURE_FX_AFTER_CARD_MS,
  CAPTURE_FX_CARD_OPACITY,
  CAPTURE_FX_MS,
  DICE_BRAKE_ARM_MS,
  PENDING_MOVE_GUARD_MS,
  RESULTS_MODAL_DELAY_MS,
  clashCardMs,
  diceLandAt,
  goalCelebrationMs,
} from '../game/timing';
import { navigate } from '../router';
import { connectSocket } from '../socket';
import type { RoomRules } from '../socket';
import { postApi, translateErrorCode } from '../api';
import { WALL_BREAKER_TOKEN_CAP } from '../__shared__/wall-breaker.constants';
import { useApp, isOccupiedSeat, type LastResult, type ResultPlayer, type Seat } from '../store';
import { SEAT_COLORS } from '../theme';
import { UserAvatar } from '../components/UserAvatar';
import { CyberButton, CyberModal } from '../components/CyberModal';
import { ControlsSettingsModal } from '../components/ControlsSettingsModal';
import { ResultsModal } from '../components/ResultsModal';
import { ChatCard } from '../components/ChatCard';
import type { ChatCardLine, ChatCardStatus } from '../components/chatCardTypes';
import { ChatNameCard } from '../components/ChatNameCard';
import type { ChatNameCardTarget } from '../components/ChatNameCard';
import { InviteComms } from '../components/InviteComms';
import { useFriendships } from '../hooks/useFriendships';
import { useChatFeed } from '../hooks/useChatFeed';
import { retroAudio } from '../utils/audio';
import {
  CRT_SCREEN,
  GRID_BACKGROUND,
  APP_WRAPPER,
  HERO_SECTION,
  HERO_TITLE,
  RETRO_BADGE,
  RETRO_WINDOW,
  WINDOW_HEADER,
  GAME_WINDOW_HEADER_EXTRA,
  WINDOW_BODY,
  RETRO_BTN,
  INLINE_CHIP,
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
                background: 'var(--accent-yellow)',
                boxShadow: '0 0 4px var(--accent-yellow)',
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/**
 * Last-resort roster for a result card, built from the seats this screen created,
 * used when the engine's own player list never arrived. Each row carries the
 * colour its seat owns: the colour is never taken from the seat's index, because a
 * room can skip a corner (the red-first order this replaced relabelled quadrants).
 */
function seatsAsResultPlayers(seats: Seat[], you: string): ResultPlayer[] {
  return seats.filter(isOccupiedSeat).map((seat) => ({
    color: seat.color,
    username: seat.type === 'you' ? you : seat.name,
    isBot: seat.type === 'bot',
    piecesInGoal: 0,
  }));
}

// One seat of a row's snapshot, as the backend keeps it
// (backend/src/match/match.postgame.service.ts): the row renders with no join.
type SnapshotSeat = {
  username: string;
  displayName: string;
  color: string; // uppercase, matching PlayerColor
  rank: number | null;
  isBot: boolean;
  abandoned?: boolean;
  piecesInGoal?: number;
};

// The answer to GET /api/game/:id/result, for the caller's own seat. `pending` means
// the room is still live for the others, `unknown` means there is nothing to wait for.
type SeatResultAnswer = {
  state: 'unknown' | 'pending' | 'finished';
  row: {
    gameId: string;
    gameType: 'PVP' | 'PVE';
    gameModes: { playerCount?: number } | null;
    status: 'COMPLETED' | 'ABANDONED';
    rank: number;
    participants: SnapshotSeat[];
  } | null;
};

/**
 * The result card, rebuilt from the row the backend keeps. This is the only path that
 * reaches a seat that was away when its room ended: the frame that ends a match is
 * addressed to the sockets still inside the room, so a dropped client's answer has to
 * come from the database. A room that did not finish names no champion, so `winner` is
 * null rather than "whoever held the turn".
 */
function rowAsLastResult(row: NonNullable<SeatResultAnswer['row']>): NonNullable<LastResult> {
  const seats = Array.isArray(row.participants) ? row.participants : [];
  const champion = seats.find((seat) => seat.rank === 1 && !seat.abandoned);
  return {
    winner: champion ? (champion.color.toLowerCase() as PlayerColor) : null,
    resultDetail: row.status === 'ABANDONED' ? 'abandoned' : 'four_pieces',
    mode: row.gameType === 'PVE' ? 'pve' : 'pvp',
    playerCount: row.gameModes?.playerCount ?? seats.length,
    players: seats.map((seat) => ({
      color: seat.color.toLowerCase() as PlayerColor,
      username: seat.isBot ? seat.displayName || seat.username : seat.username,
      isBot: seat.isBot,
      // Only when the row knew it: a seat recorded at its own departure has none, and
      // its card prints the name alone rather than "0/4".
      ...(typeof seat.piecesInGoal === 'number' ? { piecesInGoal: seat.piecesInGoal } : {}),
      abandoned: seat.abandoned === true,
    })),
    abandoned: row.status === 'ABANDONED',
  };
}

// The recon panel's one write: a frame's entries arrive oldest-first and the panel
// shows newest-first, capped at LOG_CAP (the engine's own bound). Kept pure and
// module-level so a socket handler never closes over a stale render.
function withLog(prev: LogEntry[], entries?: LogEntry[]): LogEntry[] {
  if (!entries?.length) return prev;
  return [...[...entries].reverse(), ...prev].slice(0, LOG_CAP);
}

// The Wall Breaker hand cap is a tunable the engine also counts, so it comes from
// `common/src/wall-breaker.constants.ts`: the wall-break cell draws exactly this many
// glyph slots, so an empty hand reads as empty rather than as a row that vanished.
// The wall break tokens panel: its width and the gap in front of it. That span is how
// much further the roster box overhangs its grid track in clash mode; a smaller
// CARD_ROOM_OVERHANG is always added, so the cards come out the same width.
const WALL_BREAKER_PANEL_W = 96;
const WALL_BREAKER_PANEL_GAP = 10;
const CARD_ROOM_OVERHANG = 46;
// The wall-break token glyph. A padlock read as "locked"; dynamite (or a
// sledgehammer) reads as "breaker", which is what the toggle actually does. One
// constant, so switching glyphs is one edit.
const WALL_BREAKER_GLYPH = '🧨';

// Lines the board keeps in memory (M3). The room stores 1,000; the panel paints the
// tail, and a few hundred is enough scrollback without growing this page's state on
// every frame of a long game. The cap itself is `useChatFeed`'s `CHAT_LINES_KEPT`
// (19.8), applied by the same hook the lobby's channel drives.

// How long the composer waits for the engine's ack before it says the line did not go:
// an ack that never arrives is a dead socket, not a slow one.
const CHAT_ACK_TIMEOUT_MS = 4000;

// How long the turn-swap notice stays in the banner's band (20.5). 700 ms was long enough
// to catch the eye and too short to read a 60-character upper-case line, so it flicked
// away mid-sentence. It stays a notice and not a standing line — the pill already says
// whose turn it is — so it clears itself once the swap has been read.
const TURN_SWAP_NOTICE_MS = 1500;

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
  const [isControlsModalOpen, setIsControlsModalOpen] = useState(false);
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

  // Custom names typed into the Lobby seat-setup for local (hotseat) seats, keyed
  // by the colour that seat owns: the card's colour IS the seat, so no index maps
  // to a colour any more. The host seat (`you`) uses the real username instead.
  const localNames = useMemo<Partial<Record<PlayerColor, string>>>(() => {
    const names: Partial<Record<PlayerColor, string>> = {};
    for (const seat of seats) if (seat.type === 'player') names[seat.color] = seat.name;
    return names;
  }, [seats]);
  // Seat label for the move log / podium rows: a hotseat seat's name first (a typed
  // one, or the raw `player-<color>` id the lobby wrote, both localized the same way),
  // then the engine's display label (bots carry "bot-<color> (<assistant>)"), then the
  // raw id.
  const seatLabel = (p: {
    color: PlayerColor;
    username: string;
    displayName?: string;
    isBot: boolean;
  }): string =>
    localizedBotName(t, localNames[p.color]) ||
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
          // A seat that left is not a finisher: the card keeps its name and gives it
          // no rank badge, so a dropped player is never crowned over the real winner.
          abandoned: p.status === 'exited',
        };
      });
  };
  const socketRef = useRef<ReturnType<typeof connectSocket> | null>(null);
  // Once the database says this match is decided, the page never asks for a seat again
  // (M1): a refused join_game re-emits on every reconnect, and each one ends in the same
  // banner over a board that cannot move.
  const matchOverRef = useRef(false);
  const [view, dispatch] = useReducer(applyEvent, null, () =>
    initialView(activeMatch?.color ?? 'red'),
  );
  const viewRef = useRef(view);
  viewRef.current = view;
  const [moveLogs, setMoveLogs] = useState<LogEntry[]>([]);
  const moveLogContainerRef = useRef<HTMLDivElement>(null);
  // The room's channel (M3): the transcript as this seat sees it, and whether the
  // engine socket is up. The lines live in `useChatFeed` (19.8), above the card, so a
  // re-render cannot drop a frame and the room cannot merge or order differently from
  // the lobby; the card's draft and band stay inside the card for the same reason.
  const {
    lines: chatLines,
    replace: replaceChatLines,
    append: appendChatLine,
  } = useChatFeed<ChatCardLine>();
  const [chatConnected, setChatConnected] = useState(false);
  // The card's one status band. It is owned here rather than by the card so a name
  // card's answer (a refusal, or the confirmation) lands in the same line as a send
  // refusal.
  const [chatStatus, setChatStatus] = useState<ChatCardStatus | null>(null);
  // The pilot whose name was pressed in the transcript, and where the name was: the
  // card is placed off that rectangle, because the transcript scrolls under the
  // pointer. The card itself is `ChatNameCard`, the same one the lobby mounts (19.7).
  const [nameTarget, setNameTarget] = useState<ChatNameCardTarget | null>(null);
  // The friendship snapshot the name card reads, taken here so opening a card
  // refetches nothing and so a block can re-read it. The room's transcript needs no
  // local block filter: the engine's history is already cut for this seat.
  const { friends, requests, loading: friendsLoading, refresh: refreshFriends } = useFriendships();
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
  const [codeCopied, setCodeCopied] = useState(false);
  const [turnSwapNotice, setTurnSwapNotice] = useState<string | null>(null);
  // The swap notice's clear timer, held in a ref rather than in its effect's cleanup: that
  // effect also re-runs for a roster or locale update, and a cleanup on the path that
  // changes no turn would cancel the clear without rescheduling it, leaving the notice up
  // until the next swap. Same shape as `engineErrorTimerRef` and `captureFxTimerRef`.
  const turnSwapNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);
  // Reserved engine-error banner: localized text of the last engine socket error
  // (see the 'error' handler below), auto-cleared after a short delay.
  const [engineError, setEngineError] = useState<string | null>(null);
  const engineErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTurnRef = useRef<PlayerColor | null>(null);
  const isGameEnded = lastResult != null || view.status === 'finished';

  // The room's own closing clock (R14/R20): the engine publishes `closesAt` while a
  // waiting PvP room sits below quorum, and this only counts down to that number. Bots
  // never get impatient and a started game's clock is the seat's reconnect window, so
  // no other room has one.
  const [roomClock, setRoomClock] = useState(() => Date.now());
  useEffect(() => {
    if (view.closesAt == null) return;
    setRoomClock(Date.now());
    const id = setInterval(() => setRoomClock(Date.now()), 1000);
    return () => clearInterval(id);
  }, [view.closesAt]);
  const roomClosesInS =
    view.closesAt == null ? null : Math.max(0, Math.ceil((view.closesAt - roomClock) / 1000));
  const roomClosesLabel =
    roomClosesInS == null
      ? null
      : `${Math.floor(roomClosesInS / 60)}:${String(roomClosesInS % 60).padStart(2, '0')}`;

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
  // The opt-in capture flash card (25.6): a non-clash capture, when the room rule is on,
  // paints the capture gesture top-centre over the board. It is derived from the move
  // event, never reducer state, and the next piece_moved/dice_rolled unmounts it. `id`
  // forces a fresh mount (and its one sound) for a repeat capture of the same colours.
  const [flashCard, setFlashCard] = useState<{
    id: number;
    attacker: PlayerColor;
    defender: PlayerColor;
  } | null>(null);
  const flashCardSeq = useRef(0);
  // The roll guard is TIME-bounded, not tied to the card's state: the state lingers until
  // the next event (25.6 item 3), but a roll must reopen once the card has visually gone,
  // or the capturer's own bonus re-roll would deadlock behind a card nothing else clears.
  const flashCardGuardUntilRef = useRef(0);
  // The goal celebration (32.5): a piece reaching home bursts on the cell its last step left,
  // and then exactly one overlay — confetti with the room's effects off, the ramp card with
  // them on — runs for `goalCelebrationMs`. `count` is the seat's pieces home AFTER the move,
  // which is the station the ramp card's figure climbs to, and `id` forces a fresh mount for
  // two goals by the same seat. `goalFxEndsAtRef` dates the END of the celebration the moment
  // the path is queued, because `game_ended` arrives while the walk is still in front of it
  // and the result modal has to wait for a celebration that has not begun.
  const [goalFx, setGoalFx] = useState<{
    id: number;
    color: PlayerColor;
    x: number;
    y: number;
    count: number;
  } | null>(null);
  const goalFxSeq = useRef(0);
  const goalFxEndsAtRef = useRef<number | null>(null);
  const goalFxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wall Breaker: the token-priced exit is armed explicitly, so a tap in prison can
  // never spend a token by accident. The arm switch lives on the server
  // (`PlayerMeta.wallBreakerArmed`), and the engine blocks an unarmed seat at a wall.
  const wallBreakMoves = useMemo(
    () => view.legalMoves.filter((m) => m.spendsWallBreakerToken),
    [view.legalMoves],
  );
  const armSeat = view.players.find((p) => p.color === view.currentTurn);
  const breakerArmed = armSeat?.wallBreakerArmed === true;
  // Arming needs a token in hand: the engine refuses an arm without one, and the
  // column disables the button. The engine also refuses an arm out of turn.
  const canArmBreaker = view.clashMode === true && (armSeat?.wallBreakerTokens ?? 0) > 0;
  const toggleWallBreakArm = () => {
    if (!canArmBreaker) return;
    retroAudio.playUiBeep(breakerArmed ? 420 : 880, 0.06, 'square');
    socketRef.current?.emit('arm_wall_breaker', !breakerArmed);
  };
  // The Wall Breaker column is an in-game control, so it starts with the opening roll:
  // in the waiting room there is no turn to take, the engine refuses an arm ("Game not
  // active"), and every hand still holds only the dealt starting token. Gating it here
  // also keeps the lobby identical whether the room has clash mode on or not.
  const showWallBreakerColumn = view.clashMode === true && view.status !== 'waiting';
  // The waiting rail draws the room's own seats, in turn order: `view.players` is one
  // entry per seat (the engine seats exactly the colours the room was created with),
  // so sorting it by `SEAT_COLORS` shows the rotation and nothing else — no seat index
  // is involved. Before the first engine frame that list is still empty, so the rail
  // falls back to the canonical prefix for the room's seat count. Once the match is
  // live every canonical colour is drawn, so an unseated corner still reads as empty.
  const waitingRailColors: PlayerColor[] =
    view.players.length > 0
      ? [...view.players]
          .sort((a, b) => SEAT_COLORS.indexOf(a.color) - SEAT_COLORS.indexOf(b.color))
          .map((p) => p.color)
      : SEAT_COLORS.slice(0, activeMatch?.playerCount || SEAT_COLORS.length);
  const railColors: PlayerColor[] = view.status === 'waiting' ? waitingRailColors : SEAT_COLORS;
  // How far the roster box reaches past its grid track: the panel's span in clash mode,
  // plus the same extra room for the display names in every room, so the cards are
  // equally wide either way.
  const rosterOverhang = showWallBreakerColumn
    ? CARD_ROOM_OVERHANG + WALL_BREAKER_PANEL_W + WALL_BREAKER_PANEL_GAP
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
  // The banner's corner cluster needs room on *both* sides of the title: each flank has to
  // hold the 240px-capped cluster beside a ~395px title, which the banner (the viewport
  // minus the 365px nav gutter) only has from ~1250px up. That is a wider threshold than
  // the page's own three-column grid, so it gets its own query rather than moving
  // `desktopLayout`: below it the banner stacks — title, cluster, pill, marquee — while the
  // page keeps its columns.
  const [cornerBanner, setCornerBanner] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1250px)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1250px)');
    setCornerBanner(mq.matches);
    const sync = () => setCornerBanner(mq.matches);
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
      // Restarted, not merely scheduled: a bot can hand the turn on inside the window, and
      // the second swap's line is the one worth reading. `TURN_SWAP_NOTICE_MS` (not 700) is
      // the dwell — the line is 60 characters at 0.82rem and was leaving mid-sentence.
      if (turnSwapNoticeTimerRef.current) clearTimeout(turnSwapNoticeTimerRef.current);
      turnSwapNoticeTimerRef.current = setTimeout(() => {
        turnSwapNoticeTimerRef.current = null;
        setTurnSwapNotice(null);
      }, TURN_SWAP_NOTICE_MS);

      prevTurnRef.current = effectiveTurn;
      return;
    }
    prevTurnRef.current = effectiveTurn;
  }, [effectiveTurn, view.status, view.players, localNames, t]);
  const captureFxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The board burst a clash card is holding back: set when the settling move lands,
  // fired `CAPTURE_FX_AFTER_CARD_MS` after the card goes (see the `view.clash` effect).
  const pendingCardBurstRef = useRef<{ color: string; to: number } | null>(null);

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

  // Connect to engine via Socket.IO
  useEffect(() => {
    if (!activeMatch) return;

    const socket = connectSocket(activeMatch.token);
    socketRef.current = socket;
    matchOverRef.current = false;

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

    // The result read (M1): what this seat's match did, from the database. The client
    // asks it on the three signals that mean "this room will not be joined" and acts on
    // `finished` only: the match becomes terminal, so no join_game is ever re-emitted,
    // and the card renders from the record instead of from whatever the board last held.
    // A `pending` answer leaves the socket alone: the room is still live for the others.
    const querySeatResult = async (gameId: string) => {
      if (matchOverRef.current) return;
      try {
        const res = await fetch(`/api/game/${gameId}/result`, { credentials: 'include' });
        if (!res.ok) return;
        const answer = (await res.json()) as SeatResultAnswer;
        if (answer.state !== 'finished' || !answer.row) return;
        matchOverRef.current = true;
        setLastResult(rowAsLastResult(answer.row));
        setShowResultsModal(true);
      } catch {
        // Offline or a 5xx: the card the page already holds stays the answer.
      }
    };
    // Signal one: a mount whose match is already terminal. The read is cheap and the
    // room decides whether there is anything to show, so it runs on every mount rather
    // than guessing from local state.
    void querySeatResult(activeMatch.gameId);

    socket.on('connect', () => {
      const current = activeMatchRef.current;
      setChatConnected(true);
      if (!current) return;
      // A decided match is never re-joined: the read above already answered for it.
      if (matchOverRef.current) return;
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
      setChatConnected(false);
    });

    // The other half of the reconnect budget (socket.ts): a frozen or backgrounded
    // tab stops counting attempts, so being looked at again is the trigger, and the
    // seat's own window decides whether that brings the player back.
    const revive = () => {
      if (!socket.connected) socket.connect();
    };
    const reviveOnVisible = () => {
      if (document.visibilityState === 'visible') revive();
    };
    window.addEventListener('focus', revive);
    document.addEventListener('visibilitychange', reviveOnVisible);

    socket.on('game_joined', (state) => {
      dispatch({ type: 'game_joined', ...(state as object) });
      // The snapshot is the reconciliation point: a reload, a rejoin, a second tab or an
      // engine restart rebuild the whole panel from the log the engine stored. The
      // stored order is oldest-first; the panel renders newest-first.
      setMoveLogs([...((state as { log?: LogEntry[] }).log ?? [])].reverse().slice(0, LOG_CAP));
    });

    // The room's channel (M3). `chat:history` is pushed to this socket right after
    // `game_joined`, already filtered by the engine for this seat, and replaces the
    // local copy: it is the authority on what was said before the panel mounted.
    // `chat:message` is one live line, deduped by id so the history's seam and a frame
    // that raced it cannot paint the same line twice. Both rules are `useChatFeed`'s.
    socket.on('chat:history', (payload: { lines?: ChatCardLine[] } = {}) => {
      replaceChatLines(payload.lines);
    });
    socket.on('chat:message', (payload: { line?: ChatCardLine } = {}) => {
      appendChatLine(payload.line);
    });

    const handleEngineEvent = (state: unknown) => {
      const type = (state as { type?: string }).type;

      // A roll is not dispatched where it arrives: the reducer sees it when the die
      // lands, so the moves do not light up mid-spin. Every other frame is applied on
      // arrival, which means a frame that follows a roll on the wire but beats its
      // landing reaches the reducer FIRST. That is not cosmetic: a roll frame names the
      // seat that rolled, still current when it left the engine, so a Skip that lands
      // 4 ms after the roll would be applied, then overwritten by the older roll naming
      // the seat the engine already left. The board parks on a bot that will never be
      // asked to act again. Land the die first, so the reducer takes the frames in
      // arrival order. `piece_moved` is exempt: its walk is meant to start on the
      // landed face, and its own dispatch already waits for the landing below.
      if (type !== 'piece_moved') {
        const pendingLand = rollLandFnRef.current;
        if (pendingLand) pendingLand();
      }

      if (type === 'dice_rolled') {
        // A roll ends the beat the flash card explains (25.6 item 3).
        setFlashCard(null);
        const e = state as {
          value: number;
          bonusRoll: boolean;
          forfeited?: boolean;
          log?: LogEntry[];
        };
        retroAudio.playLaserSound();
        const arrivedAt = performance.now();
        // Everything the landing does, in one body: a brake moves the landing
        // earlier and a slow answer moves it later, and neither path skips the
        // dispatch or the log.
        const land = () => {
          resetRoll();
          dispatch({ type: 'dice_rolled', ...(state as object) });
          // The engine wrote the line (a roll, or the third-six forfeit) and the frame
          // carries it; the panel never derives one of its own.
          setMoveLogs((prev) => withLog(prev, e.log));
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
        // A move ends the beat the previous card explained (25.6 item 3); this move's own
        // capture re-mounts it below once the walk finishes.
        setFlashCard(null);
        pendingMoveRef.current = false;
        isMovingPieceRef.current = true;
        setIsMovingPiece(true);
        const e = state as {
          pieceId: string;
          color: PlayerColor;
          captured: boolean;
          capturedPieceIds?: string[];
          from: number;
          to: number;
          path?: number[];
          // Set only when the path ends at home (step 57): the arrival gets its own beat
          // (32.5) on top of the walk.
          enteredHome?: boolean;
          // Set only when this move settled a clash: the result card is about to take the
          // screen, which moves the capture burst out of the board (see below).
          clashOutcome?: 'attacker_won' | 'defender_won';
          // The lines the engine wrote for this move (a capture and its re-roll, or the
          // repulse). The panel renders these; it derives none of its own.
          log?: LogEntry[];
        };
        const path = e.path ?? [];
        // What is left of a spin in flight. Measured here rather than where the walk is
        // scheduled, because the celebration's end is dated below and the roll's tail is part
        // of it.
        const rollWait = !isRollingRef.current
          ? 0
          : rollLandAtRef.current == null
            ? DICE_ROLL_ANIM_MS
            : Math.max(0, rollLandAtRef.current - performance.now());
        // A path that ends at home is the one move whose beat outlives the walk, and the result
        // modal is dated off it: `game_ended` follows this frame while the walk is still in
        // front of it, so the end is worked out NOW — the roll's tail, the walk's own length,
        // then the celebration the room's rule chose. `enterGoal` below does not touch it: one
        // writer, and it is this one.
        if (e.enteredHome) {
          goalFxEndsAtRef.current =
            performance.now() +
            rollWait +
            path.length * MOVE_STEP_ANIM_MS +
            goalCelebrationMs(viewRef.current.captureFx);
        }

        const finishMove = () => {
          if (animTimerRef.current) {
            clearInterval(animTimerRef.current);
            animTimerRef.current = null;
          }
          setAnimatingPiece(null);
          dispatch({ type: 'piece_moved', ...(state as object) });
          // The engine wrote this move's lines (a capture and its re-roll, or the repulse
          // that sent the attacker home) and the frame carries them.
          setMoveLogs((prev) => withLog(prev, e.log));
          if (e.captured) {
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
              // The opt-in flash card rides above the board's own burst (25.6). Only the
              // non-clash path paints it, and only when the room turned the rule on. Both
              // reads go through the ref: this handler is bound once per socket (the effect
              // is keyed on the match, never on `view`), so its `view` is the mount-time one
              // and `captureFx` there is `initialView`'s false forever. The ref is also
              // pre-dispatch at this point, which is what keeps the victim in `pieces` for
              // the lookup below.
              const live = viewRef.current;
              if (live.captureFx) {
                const victim =
                  live.pieces.find((p) => (e.capturedPieceIds ?? []).includes(p.id))?.color ??
                  e.color;
                setFlashCard({
                  id: ++flashCardSeq.current,
                  attacker: e.color,
                  defender: victim,
                });
                flashCardGuardUntilRef.current =
                  performance.now() + CAPTURE_CARD_MS + CAPTURE_CARD_GRACE_MS;
              }
            }
          }
          const settleMs = e.captured ? 600 : 350;
          if (captureFxTimerRef.current) clearTimeout(captureFxTimerRef.current);
          captureFxTimerRef.current = setTimeout(() => {
            setCaptureFx(null);
            isMovingPieceRef.current = false;
            setIsMovingPiece(false);
          }, settleMs);
        };

        const enterGoal = () => {
          // The cell the piece just left: the step before the last one, and for a one-step
          // path the step it came from. Home has no square (`stepToCell` answers null for 57),
          // so nothing is looked up BY 57 — the burst lands where the walk's previous tick put
          // the piece, and mounting it in the same batch as that piece's exit is what keeps a
          // frame from showing an empty cell.
          const leftStep = path.length > 1 ? path[path.length - 2] : e.from;
          const anchor = captureBurstAnchor(e.color, leftStep);
          const animations = viewRef.current.captureFx;
          const celebrationMs = goalCelebrationMs(animations);
          // The fanfare is NOT the rule's: a room with the acts switched off still hears the
          // piece arrive. `retroAudio` is the master switch's business and nothing else's.
          retroAudio.playFanfare();
          // Pre-dispatch, so the arriving piece is counted here by hand.
          const count = Math.min(
            4,
            viewRef.current.pieces.filter((p) => p.color === e.color && p.isInGoal).length + 1,
          );
          if (goalFxTimerRef.current) clearTimeout(goalFxTimerRef.current);
          goalFxTimerRef.current = setTimeout(() => setGoalFx(null), celebrationMs);
          setGoalFx({
            id: ++goalFxSeq.current,
            color: e.color,
            // A cell that cannot be measured (a layout mid-resize) still gets its
            // celebration, from the middle of the screen rather than nowhere.
            x: anchor?.x ?? window.innerWidth / 2,
            y: anchor?.y ?? window.innerHeight / 2,
            count,
          });
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
              // The last tick of a path into home: the piece is off the board from this frame
              // on, so this is where the arrival is drawn — by the setter that lands it, and
              // never by a second pass over the path.
              if (i === path.length - 1 && e.enteredHome) enterGoal();
            }, MOVE_STEP_ANIM_MS);
          } else if (path.length === 1) {
            setAnimatingPiece({ pieceId: e.pieceId, step: path[0] });
            if (e.enteredHome) enterGoal();
            setTimeout(() => {
              finishMove();
            }, MOVE_STEP_ANIM_MS);
          } else {
            finishMove();
          }
        };

        if (isRollingRef.current) {
          // Wait out what is LEFT of the spin rather than the whole constant: a braked roll is
          // shorter, and the walk starts on the landed face. The same remainder was measured
          // above, where the goal's end was dated with it.
          setTimeout(runStepAnimation, rollWait);
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
        // The held turn passed without a move: the armed Wall Breaker exit was
        // declined. The reducer clears the moves and moves the turn on; the engine wrote
        // the line naming the seat that skipped, and the frame carries it.
        setMoveLogs((prev) => withLog(prev, (state as { log?: LogEntry[] }).log));
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
        // A game can end on the goal that ended it, and that celebration is still playing — or,
        // more often, still ahead of the walk. The card waits for the celebration and then for
        // its own beat: the sum, never the larger of the two, so a win shows the piece arrive,
        // then the burst, then the card. `goalFxEndsAtRef` was dated when the path was queued,
        // because this frame arrives before the walk has finished; reading it here consumes it.
        const goalEndsAt = goalFxEndsAtRef.current;
        goalFxEndsAtRef.current = null;
        const celebrationLeft = goalEndsAt == null ? 0 : Math.max(0, goalEndsAt - performance.now());
        setTimeout(() => {
          setShowResultsModal(true);
        }, celebrationLeft + RESULTS_MODAL_DELAY_MS);
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
    socket.on('room_closing', handleEngineEvent);
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

    socket.on('player_aborted', (e: { color: PlayerColor; username: string; log?: LogEntry[] }) => {
      // The engine wrote the line into the snapshot and onto this frame; the panel
      // renders it as-is, so the departing seat is named the same way after a rejoin.
      setMoveLogs((prev) => withLog(prev, e.log));
    });

    const buildAbandonedResult = () => {
      let players: ResultPlayer[] = toResultPlayers(viewRef.current.players);

      if (players.length === 0 && Array.isArray(seats) && seats.length > 0) {
        players = seatsAsResultPlayers(seats, user?.username ?? 'You');
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
        // No champion: a room that did not finish has none, and naming the seat that
        // held the turn crowned the player who had left.
        winner: viewRef.current.winner ?? null,
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
      // Signal two (M1): the join was refused because the room is gone. The engine can
      // only say "not found"; the backend knows whether this seat has a result, so ask
      // it rather than leaving a banner over a board that will never move.
      if (msg === 'MATCH_GAME_NOT_FOUND') {
        const current = activeMatchRef.current;
        if (current) void querySeatResult(current.gameId);
      }
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

    // Signal three (M1): the reconnect budget (socket.ts) is spent, so no join is
    // coming from this socket. The seat may still hold a row, and the read is the only
    // way to find out.
    const onReconnectFailed = () => {
      const current = activeMatchRef.current;
      if (current) void querySeatResult(current.gameId);
    };
    socket.io.on('reconnect_failed', onReconnectFailed);

    return () => {
      window.removeEventListener('focus', revive);
      document.removeEventListener('visibilitychange', reviveOnVisible);
      socket.io.off('reconnect_failed', onReconnectFailed);
      socket.disconnect();
      socketRef.current = null;
      if (animTimerRef.current) clearInterval(animTimerRef.current);
      animTimerRef.current = null;
      if (captureFxTimerRef.current) clearTimeout(captureFxTimerRef.current);
      captureFxTimerRef.current = null;
      if (goalFxTimerRef.current) clearTimeout(goalFxTimerRef.current);
      goalFxTimerRef.current = null;
      goalFxEndsAtRef.current = null;
      if (engineErrorTimerRef.current) clearTimeout(engineErrorTimerRef.current);
      engineErrorTimerRef.current = null;
      if (turnSwapNoticeTimerRef.current) clearTimeout(turnSwapNoticeTimerRef.current);
      turnSwapNoticeTimerRef.current = null;
      if (rollLandTimerRef.current) clearTimeout(rollLandTimerRef.current);
      rollLandTimerRef.current = null;
      if (rollAnswerGuardRef.current) clearTimeout(rollAnswerGuardRef.current);
      rollAnswerGuardRef.current = null;
      setAnimatingPiece(null);
      setCaptureFx(null);
      setCardCaptureFx(null);
      setGoalFx(null);
      setFlashCard(null);
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
    if (
      !canRoll ||
      isRolling ||
      isRollingRef.current ||
      isMovingPieceRef.current ||
      performance.now() < flashCardGuardUntilRef.current
    )
      return;
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
    // A Wall Breaker exit is only ever sent while the player has armed it. The
    // board hides it from the tap targets too, so this is the second gate on the
    // same rule and a stray tap can never spend a token.
    const mine = viewRef.current.legalMoves.filter((m) => m.pieceId === pieceId);
    if (mine.length > 0 && mine.every((m) => m.spendsWallBreakerToken) && !breakerArmed) return;
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
  const skipWallBreak = () => {
    // Inert unless the roll can only reach a wall. The guards repeat the button's test
    // against the freshest view, so a curious click or a stray call emits nothing and
    // never produces a refusal.
    const v = viewRef.current;
    if (v.status !== 'active' || v.clash) return;
    if (isRolling || isRollingRef.current || isMovingPieceRef.current || pendingMoveRef.current)
      return;
    if (v.turnPhase !== 'WAITING_FOR_MOVE') return;
    const priced = v.legalMoves.filter((m) => m.spendsWallBreakerToken);
    if (priced.length === 0 || priced.length !== v.legalMoves.length) return;
    retroAudio.playUiBeep(520, 0.06);
    socketRef.current?.emit('skip_wall_breaker');
  };

  const markReady = () => {
    retroAudio.playUiBeep(1100, 0.1);
    socketRef.current?.emit('player_ready');
  };

  // One press of this player's clash key. The overlay matches the key; the server
  // proves ownership and applies the press cap, which discards a decoy pad press.
  const clashInput = (key: string, count = 1) => socketRef.current?.emit('clash_input', key, count);
  // The overlay's result-card timer calls this when the card's own length is up (2900 on a
  // pair, 3800 on a wall and 4200 on a breach). It is what frees canRoll again: the reducer
  // deliberately keeps `clash` alive until then.
  const clearClash = () => dispatch({ type: 'clash_clear' });

  // The result card appeared: tell the engine when it will be done. The forecast is
  // in this client's clock and is sent once per card, so a chain reports each round.
  // It gates nothing locally; the engine's release frame is the authority.
  //
  // The number is the card's OWN length plus the margin, never a constant, and the
  // card's length is per path: 3100 on a pair's two-act card (2900 + 200), 4000 on a
  // wall's (3800 + 200, the dome's beat included), 4400 on a breach (4200 + 200, the
  // cloud's act on top of the beat) and 1600 on a text-only one. An over-ask is harmless —
  // a receipt cannot extend the engine's deadline — and an under-ask truncates, so the
  // length has to come from the card (25.8, 32.4).
  const clashCardLength = clashCardMs(
    view.clashResult,
    view.clashResult?.attacker ?? view.clash?.attacker,
    view.captureFx,
  );
  useEffect(() => {
    const cardId = view.clashResult?.cardId;
    if (!cardId) return;
    socketRef.current?.emit('clash_card_hold', cardId, clashCardLength + CARD_HOLD_MARGIN_MS);
  }, [view.clashResult, clashCardLength]);

  // The clash card owns the capture burst. While it is up the card wears a dim copy
  // (rendered with it, below), and the moment the card goes the board gets the real one:
  // CAPTURE_FX_AFTER_CARD_MS later, so the two never share a frame. The card can leave
  // two ways — its own per-card timer and the engine releasing the clash early — and both
  // narrow to `view.clash` going null, which is what this watches. A chain's intermediate
  // rounds never set a pending burst, so only the settling move fires.
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

  // The room rules travel as ONE object both ways, so a fifth rule is a field
  // rather than a fifth positional boolean. The engine enforces host-only
  // (MODIFIERS_HOST_ONLY) and echoes back what it actually persisted.
  const updateModifiers = (rules: RoomRules) => socketRef.current?.emit('update_modifiers', rules);

  // One line out to the room's channel (M3). The ack is the engine's own: `ok`, or a
  // code the card localizes. A socket that never answers (a dead connection) is
  // reported as unavailable rather than leaving the composer waiting forever.
  const sendChatLine = useCallback(
    (text: string, ack: (reply: { ok: true } | { ok: false; error: string }) => void) => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        ack({ ok: false, error: 'CHAT_UNAVAILABLE' });
        return;
      }
      let answered = false;
      const guard = setTimeout(() => {
        if (answered) return;
        answered = true;
        ack({ ok: false, error: 'CHAT_UNAVAILABLE' });
      }, CHAT_ACK_TIMEOUT_MS);
      socket.emit('chat:send', text, (reply: { ok: true } | { ok: false; error: string }) => {
        if (answered) return;
        answered = true;
        clearTimeout(guard);
        ack(reply ?? { ok: false, error: 'CHAT_UNAVAILABLE' });
      });
    },
    [],
  );

  // The key-shift row's own count. Re-enabling the mutator restores this instead of
  // resetting to 1, while the room's canonical value stays `view.clashKeyShift` (the
  // engine forces 0 when clash is off, so the view cannot remember the count for us).
  const [clashShiftCount, setClashShiftCount] = useState<1 | 2>(1);
  useEffect(() => {
    if (view.clashKeyShift === 1 || view.clashKeyShift === 2)
      setClashShiftCount(view.clashKeyShift);
  }, [view.clashKeyShift]);

  // A rule toggle replaces the whole object, so the field it moved is the only one
  // that changes and the rest are echoed from the view rather than guessed.
  const emitRule = (patch: Partial<RoomRules>) =>
    updateModifiers({
      clashEnabled: view.clashMode,
      noSafeZones: view.noSafeZones,
      freeExit: view.freeExit,
      // The attack-animations flag rides every payload like the other rules.
      captureFx: view.captureFx,
      // The mutator's count rides every payload; the engine forces it to 0 while
      // clash mode is off.
      clashKeyShift: view.clashKeyShift,
      ...patch,
    });

  // The key-shift row goes through the same door, so every rule row sends one
  // complete object.
  const emitKeyShift = (next: 0 | 1 | 2) => emitRule({ clashKeyShift: next });

  const endGame = () => {
    retroAudio.playExplosionSound();
    // Two ways to end a room, and the room decides which (rows 2-4 of the leave/abort
    // matrix): the host closing a waiting room calls the host-only route, which tears
    // the room down for everybody, and everyone else leaves their own seat through the
    // engine. The route also guards both conditions server-side, so a stale client
    // cannot turn a live game ABORTED from here.
    const current = activeMatchRef.current;
    const isHostClosingWaitingRoom =
      viewRef.current.status === 'waiting' &&
      !!current?.gameId &&
      !!user?.id &&
      viewRef.current.hostId === user.id;
    if (isHostClosingWaitingRoom) {
      // Nobody is left to read a result card: the room is gone, so the page follows it
      // out the way the Return-to-lobby control does.
      void postApi(`/api/game/${current.gameId}/abort`, {})
        .catch(() => undefined)
        .then(() => {
          setLastResult(null);
          setShowResultsModal(false);
          setActiveMatch(null);
          navigate('/gamelobby');
        });
      return;
    }
    socketRef.current?.emit('end_game');

    let players: ResultPlayer[] = toResultPlayers(viewRef.current.players);

    if (players.length === 0 && Array.isArray(seats) && seats.length > 0) {
      players = seatsAsResultPlayers(seats, user?.username ?? 'You');
    }

    if (
      activeMatch?.mode === 'pvp' &&
      activeMatch.playerCount &&
      players.length > activeMatch.playerCount
    ) {
      players = players.slice(0, activeMatch.playerCount);
    }

    setLastResult({
      // No champion: a room that did not finish has none, and naming the seat that
      // held the turn crowned the player who had left.
      winner: viewRef.current.winner ?? null,
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
  // The Wall Breaker control: offered only while this device owns the turn and the
  // seat holds a token. Never on a 6, because that roll already leaves prison on the
  // room's rules, so no armed variant exists.
  const canOfferWallBreak =
    view.status === 'active' &&
    !isPausedForReconnect &&
    isMyTurn &&
    !view.clash &&
    wallBreakMoves.length > 0 &&
    (view.players.find((p) => p.color === view.currentTurn)?.wallBreakerTokens ?? 0) > 0 &&
    view.diceValue !== 6;
  // Skip exists for one situation: every legal move is token-priced, so the turn is
  // stuck unless the player spends a token. With an ordinary move available the
  // button stays inert. It is always visible in a clash room and greyed when false.
  const allMovesPriced =
    view.legalMoves.length > 0 && wallBreakMoves.length === view.legalMoves.length;
  const canSkipWallBreak =
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
  // The status marquee only speaks when the pill cannot (20.5 step 1, settling
  // 20.7 item 2): the pill already names WAITING ROOM, YOUR TURN, a colour's turn and
  // the paused seat, and the board column prints the phase hint under the die, so those
  // marquee rows said nothing new. What is left is the turn swap notice and whose turn
  // the reconnect pause is holding.
  const statusMarquee =
    turnSwapNotice ??
    (isPausedForReconnect && pausedOwnerName
      ? t('game.pausedForReconnectDetail', { name: pausedOwnerName })
      : null);
  // The notice's one box, placed differently in the two layouts (20.5). In the corner
  // layout it is absolute inside the band the floor opens *between* the title and the
  // pill, so a notice can speak for a whole turn without changing the card's height and
  // without taking the pill's 5px anchor off the bottom border: the band is an empty flex
  // item, and an absolutely placed box inside it costs the layout nothing. In the stacked
  // layout there is no band — the cluster sits between those two — and nothing is anchored
  // to a frame there, so the notice follows the pill in flow.
  const statusMarqueeBox =
    statusMarquee == null ? null : (
      <div
        style={{
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
          ...(cornerBanner
            ? {
                // `max-content` up to 640, not `100%`: the band is only as wide as the
                // title column, and a box that shrank to it would wrap a two-word notice
                // at the narrowest corner width. The band is centred on the page, so the
                // box is too, and it may overrun the band into the flanks — the middle of
                // those is empty, the cluster keeping to the top and bottom of its flank.
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'max-content',
                maxWidth: 640,
              }
            : { margin: '0 auto', width: '100%', maxWidth: 740 }),
        }}
      >
        {statusMarquee}
      </div>
    );

  // One recon line, painted here: the entry stores colours and values, never text, so a
  // language switch (or a rejoin in another language) re-renders every line instead of
  // freezing the wording the event happened in.
  const seatName = (color: PlayerColor): string => {
    const seat = view.players.find((p) => p.color === color);
    return (
      localizedBotName(t, seat?.displayName) ||
      localizedBotName(t, seat?.username) ||
      localizedColor(t, color).toLowerCase()
    );
  };
  const renderLog = (entry: LogEntry): string => {
    const victim = entry.victim ? localizedColor(t, entry.victim).toUpperCase() : '';
    switch (entry.kind) {
      case 'roll':
        return `${t('game.rolledValue', { value: entry.value ?? 0 })}${
          entry.bonus ? t('game.bonusSuffix') : ''
        }`;
      case 'thirdSixForfeit':
        return t('game.thirdSixForfeit', { name: seatName(entry.color) });
      case 'capturedPiece':
        return t('game.capturedPiece', { color: victim });
      case 'failcapturePiece':
        return t('game.failcapturePiece', { attacker: seatName(entry.color), victim });
      case 'wallBrokenBonusRoll':
        return t('game.wallBrokenBonusRoll', { attacker: seatName(entry.color), victim });
      case 'wallAttackFailed':
        return t('game.wallAttackFailed', { attacker: seatName(entry.color), victim });
      case 'bonusRollAgain':
        return t('game.bonusRollAgain');
      case 'wallBreakerSkipped':
        return t('game.wallBreakerSkipped', { name: seatName(entry.color) });
      case 'playerAborted':
        return t('game.playerAborted', { name: seatName(entry.color) });
    }
  };

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
          {/* Hero Telemetry & Badge Bar. One flex row since 20.5: the title centred on the
              page with the room's own clock and code in its right corner, the turn pill
              under the title, and the marquee *between* those two when it has something to
              say, so a notice costs the card no height. The header's own padding is the
              frame anchor — 5px over the title, 5px under the pill — and every gap inside
              is relative to those two, so nothing grows into the border. The row also
              carries a floor that scales with the viewport height, and spends what the floor
              leaves over *between* the anchors rather than under them. */}
          <header
            className={HERO_SECTION}
            style={{
              // A flex column so the notice can follow the row in the stacked layout, and
              // the frame anchor for both ends of it: 5px over the title, 5px under the
              // pill — the same 5px whether or not a turn notice is up.
              display: 'flex',
              flexDirection: 'column',
              padding: '5px 0 5px',
              textAlign: 'center',
            }}
          >
            <div
              style={
                cornerBanner
                  ? {
                      display: 'flex',
                      // `1 1 auto` so the row can take what the floor leaves over, and the
                      // floor itself in the axis the board is already measured on
                      // (`min(650px, 66vh)`): the row's content is 72px (title, 8, pill) and
                      // 82 with the frame's 5/5, and the floor opens that to 129..185 — 40%
                      // over the first pass (92/11vh/132, which measured 99 at 900 and still
                      // read cramped against the 94 this block was before 20.5). The 10px is
                      // the header's padding, so the floor is border to border. It sits on
                      // the row rather than on the card so the slack lands *between* the
                      // anchors — the title keeps its 5px, the pill its 5px, and the band
                      // between them takes the rest, which is also the only place a turn
                      // notice can speak without moving either anchor.
                      flex: '1 1 auto',
                      minHeight: 'calc(clamp(129px, 15.4vh, 185px) - 10px)',
                      // Two empty `1fr` flanks around the title keep it centred on the page
                      // whatever the cluster weighs on the right, which `justify-content:
                      // center` cannot promise once one side is wider. `stretch` also makes
                      // the row as tall as the title column, and that height is what the
                      // cluster in the right flank takes, so its last line can end on the
                      // pill's lower border instead of floating above it.
                      alignItems: 'stretch',
                    }
                  : {
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                    }
              }
            >
              {cornerBanner && <div style={{ flex: '1 1 0', minWidth: 0 }} aria-hidden="true" />}

              {/* The title, the band and the pill share one column: the title hangs off the
                  header's top padding, the pill off the bottom of this column, so the cluster
                  between them cannot push either one into the frame, and the band between the
                  two is where a turn notice speaks without joining the stack. */}
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <h1
                  className={HERO_TITLE}
                  style={{
                    minWidth: 0,
                    fontSize: '1.5rem',
                    // 0, not the class's `mb-2`: gaps here are the band's own flex and the
                    // pill's 8px, so the column is the title's line box plus the band plus
                    // the pill, and nothing else measures into the pill's anchor.
                    marginBottom: 0,
                    textAlign: 'center',
                  }}
                >
                  {t('game.heroTitle')}
                </h1>

                {/* The band the floor opens between the title and the pill, which is where
                    the turn announcement speaks (20.5): an empty flex item that takes the
                    row's slack, so the notice is placed *inside* it rather than laid out in
                    it and the card measures the same with or without one. It is also what
                    holds the pill down on its 5px anchor now — the slack `marginTop: 'auto'`
                    used to take — so the announcement can never push the pill off the frame. */}
                {cornerBanner && (
                  <div style={{ position: 'relative', flex: '1 1 auto', minHeight: 0 }}>
                    {statusMarqueeBox}
                  </div>
                )}

                {/* Live Turn Announcement Pill, in the title's own column: its lower border
                    is the banner's baseline, and the corner cluster's code is pushed down to
                    it rather than measured off it. The 8px is the air under the band, and the
                    band (not this wrapper) is what drops the pill when a wrapped cluster
                    makes the row taller than its floor; `auto` stays as the fallback for a
                    branch that renders no band. */}
                <div style={{ marginTop: 'auto', paddingTop: 8 }}>
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
                        color: 'var(--text-main)',
                        letterSpacing: '0.5px',
                      }}
                    >
                      {turnLabel}
                    </span>
                  </div>
                </div>
              </div>

              {/* The right flank takes the leftover width and the cluster sits at its end.
                  The row stretches its items, so the flank is as tall as the title column
                  and the cluster takes that full height: its last line then hangs on the
                  pill's lower border by `marginTop: 'auto'` on the code below, rather than
                  on a gap measured to land there. The `min(240px, 100%)` cap on the cluster
                  is what keeps a 56-character French label out of the title: past 240px the
                  label wraps instead of widening the cluster, and at 100% of the flank it
                  can never overrun it. */}
              <div
                style={{
                  flex: cornerBanner ? '1 1 0' : undefined,
                  minWidth: 0,
                  display: 'flex',
                  justifyContent: 'flex-end',
                }}
              >
                {(roomClosesLabel != null || activeMatch.inviteCode) && (
                  <div
                    style={{
                      marginRight: cornerBanner ? 38 : 0,
                      maxWidth: 'min(240px, 100%)',
                      // (1.5rem × 1.25 − 0.62rem × 1.2) / 2: half the difference between
                      // the title's line box and the label's, which lands the label's middle
                      // on the title's. Both are sized in rem, so it holds at any zoom, and
                      // only the label's first line counts here — wrapping under the 240px
                      // cap adds lines below it without moving it.
                      paddingTop: cornerBanner ? 'calc((1.875rem - 0.744rem) / 2)' : 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      textAlign: 'center',
                    }}
                  >
                    {roomClosesLabel && (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 2,
                          fontFamily: 'var(--font-mono)',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.62rem',
                            // 1.2, not `normal`: the cluster's padding is arithmetic on this
                            // label's line box, so it has to be a known multiple of the font
                            // size. Not 1 — `fr` and `ms` wrap at the 240px cap and would run
                            // their two lines together.
                            lineHeight: 1.2,
                            letterSpacing: '0.5px',
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                          }}
                        >
                          {t('game.roomClosesLabel')}
                        </span>
                        <span
                          role="timer"
                          aria-live="off"
                          style={{
                            fontSize: '1rem',
                            fontWeight: 'bold',
                            color: 'var(--accent-yellow)',
                            textShadow: '0 0 10px var(--accent-yellow)',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {roomClosesLabel}
                        </span>
                      </div>
                    )}
                    {activeMatch.inviteCode && (
                      <button
                        className={RETRO_BADGE}
                        style={{
                          // `auto`, not a fixed gap: the cluster is stretched to the height
                          // of the title column, so the code lands on the pill's lower border
                          // whatever the countdown's line box measures in this browser.
                          marginTop: 'auto',
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
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* The stacked layout has no band to speak in — the cluster sits between the
                title and the pill — and anchors nothing to a frame, so the notice follows
                the pill in flow there, centred on the card. */}
            {!cornerBanner && statusMarqueeBox}

            {/* The engine's last error, drawn over the title rather than reserving a row
                (20.5 step 4): an error is the one line here worth seeing at once and rare
                enough to overlay the banner for. It stays mounted so the assertive live
                region exists before its text does, and takes no room while it is empty. */}
            <div
              role="alert"
              aria-live="assertive"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                display: 'block',
                padding: engineError ? '4px 14px' : 0,
                background: engineError ? 'rgba(13, 2, 33, 0.95)' : 'transparent',
                borderBottom: engineError ? '1px solid var(--state-off)' : 'none',
                color: 'var(--state-off)',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                lineHeight: 1.4,
                letterSpacing: '0.5px',
                textAlign: 'center',
                textShadow: '0 0 8px var(--state-off)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                pointerEvents: 'none',
                boxSizing: 'border-box',
                zIndex: 3,
              }}
            >
              {engineError ?? ''}
            </div>
          </header>

          {/* Main Tactical Grid Layout. The columns stretch to the row's height rather
              than starting at the top (20.4): the board column is the tall one, and its
              CONTROLS & SETTINGS row is what the left column's feed now reaches, so the
              room ends on one line instead of two. */}
          <main
            className="game-tactical-grid grid grid-cols-1 gap-3 lg:grid-cols-[250px_1fr_250px] lg:gap-2.5 xl:grid-cols-[285px_1fr_285px] 2xl:grid-cols-[310px_1fr_310px]"
            style={{
              alignItems: 'stretch',
              width: '100%',
              margin: '0 auto',
            }}
          >
            {/* COLUMN 1: PILOT ROSTER // TACTICAL STATUS & SYSTEM CONTROL */}
            <div
              className="order-2 lg:order-none"
              // `minHeight: 0` lets the column be shorter than its content, which is what
              // hands the slack to the feed below rather than overrunning the grid (20.4).
              style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}
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
                      ...(showWallBreakerColumn
                        ? {
                            borderBottom: '1px solid rgb(var(--ink-rgb) / 0.12)',
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
                    {showWallBreakerColumn && (
                      <div
                        title={t('game.wallBreakerColumnTitle')}
                        style={{
                          width: WALL_BREAKER_PANEL_W,
                          flex: 'none',
                          boxSizing: 'border-box',
                          paddingLeft: 10,
                          borderLeft: '1px solid rgb(var(--ink-rgb) / 0.12)',
                          display: 'flex',
                          alignItems: 'center',
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.58rem',
                          lineHeight: 1.3,
                          letterSpacing: '0.06em',
                          color: 'var(--accent-yellow)',
                        }}
                      >
                        {t('game.wallBreakerColumnHeader')}
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
                      {railColors.map((ck) => {
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
                          // `ck === view.myColor` lags the server's seat assignment for a PvP joiner,
                          // so fall back to a username match, which recognises the seat on first paint.
                          const isYou =
                            ck === view.myColor ||
                            (occupied &&
                              !!user?.username &&
                              playerMeta?.username === user.username);
                          const isReady = view.readyPlayers.includes(ck);

                          return (
                            <div
                              key={ck}
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
                                cursor: 'default',
                                border: isYou
                                  ? `1.5px solid ${colorAccent}`
                                  : occupied
                                    ? `1px solid ${colorAccent}66`
                                    : '1px dashed rgb(var(--ink-rgb) / 0.15)',
                                background: isYou
                                  ? `${colorAccent}26`
                                  : occupied
                                    ? 'rgba(25, 10, 56, 0.65)'
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
                                    background: 'transparent',
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
                                    color: 'var(--text-main)',
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
                                    border: isReady ? '1px solid var(--state-on)' : '1px solid var(--state-off)',
                                    color: isReady ? 'var(--state-on)' : 'var(--state-off)',
                                  }}
                                >
                                  {isReady ? 'READY OK' : 'WAITING'}
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
                        // The engine stamps the face on the seat that actually rolled, so a
                        // rejoined client shows it instead of guessing from the turn.
                        const lastRoll = playerMeta.lastRoll;

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
                                  : '1.5px dashed rgb(var(--ink-rgb) / 0.12)',
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
                                  color: 'var(--text-main)',
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
                                      border: `1px solid ${isOut ? 'var(--state-off)' : '#ffb300'}`,
                                      color: isOut ? 'var(--state-off)' : '#ffb300',
                                    }}
                                  >
                                    {isOut
                                      ? playerMeta.departedReason === 'leave'
                                        ? t('game.pilotAborted')
                                        : t('game.pilotLeft')
                                      : t('game.reconnecting')}
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
                              {typeof lastRoll === 'number' && lastRoll > 0 && (
                                <MiniDie value={lastRoll} />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Wall Breaker column: clash mode is the OPPORTUNITY to break
                        a wall, and this column is where the player takes it. One
                        numbered button per pilot (the token count), aligned to that
                        pilot's card; only the seat this device owns and only while it
                        holds the turn can be armed, and the engine owns the flag. The
                        waiting room has no turn to arm on, so the column starts with
                        the match (showWallBreakerColumn). */}
                    {showWallBreakerColumn && (
                      <div
                        style={{
                          width: WALL_BREAKER_PANEL_W,
                          flex: 'none',
                          boxSizing: 'border-box',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                          // A panel of its own: the left divider and the padding are what
                          // make the toggle section read as separate from the roster, and
                          // stretching it keeps that divider running the cards' full height.
                          paddingLeft: 10,
                          borderLeft: '1px solid rgb(var(--ink-rgb) / 0.12)',
                          alignSelf: 'stretch',
                        }}
                      >
                        {/* The column's description sits above both sub-columns (see
                            the Wall Breaker hint), so the buttons start level with
                            the cards. */}
                        {SEAT_COLORS.map((ck) => {
                          const seat = view.players.find((p) => p.color === ck);
                          if (!seat || seat.status === 'inactive') {
                            return <div key={ck} style={{ flex: 1 }} />;
                          }
                          const tokens = seat.wallBreakerTokens ?? 0;
                          const armed = seat.wallBreakerArmed === true;
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
                              onClick={toggleWallBreakArm}
                              title={
                                canArm
                                  ? armed
                                    ? t('game.wallBreakerArmedTitle')
                                    : t('game.wallBreakerArmTitle')
                                  : t('game.wallBreakerCannotArmTitle')
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
                                      : 'rgb(var(--ink-rgb) / 0.14)'
                                }`,
                                background: armed
                                  ? 'rgb(var(--accent-yellow-rgb) / 0.2)'
                                  : 'rgba(25, 10, 56, 0.65)',
                                color: armed ? 'var(--accent-yellow)' : 'var(--text-main)',
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
                                  ? t('game.wallBreakerArmedCaption')
                                  : t('game.wallBreakerToggleHint')}
                              </span>
                              <span
                                style={{
                                  display: 'flex',
                                  gap: 3,
                                  fontSize: '0.85rem',
                                  lineHeight: 1,
                                }}
                              >
                                {Array.from({ length: WALL_BREAKER_TOKEN_CAP }, (_, slot) => (
                                  <span key={slot} style={{ opacity: slot < tokens ? 1 : 0.22 }}>
                                    {WALL_BREAKER_GLYPH}
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

              {/* The room's channel (M3): the compact feed in this column's slot, the
                  full card as an overlay on click. PvP only, and independent of the
                  room's status: it opens in the waiting room and never leaves when the
                  match starts. While the room is still WAITING, INVITE COMMS rides the
                  card head's switch as a panel portaled beside the card (19.8), beside
                  CLOSE: off until the switch asks for it, and gone at the start, while
                  the card stays put. */}
              {activeMatch.mode === 'pvp' && (
                // The feed's right border is the roster's: the window above overhangs its
                // track by `rosterOverhang` to make room for the display names (and, in a
                // clash, the Wall Breaker column), so the slot is given the same overhang
                // instead of the track's own width — two windows stacked in one column have
                // to end on one edge. The wrapper takes over the slot's job as the column's
                // last child, so it is the wrapper that absorbs the stretched column's slack
                // and the plate still grows inside it (20.4).
                <div
                  style={{
                    width: `calc(100% + ${rosterOverhang}px)`,
                    display: 'flex',
                    flex: '1 1 auto',
                    minHeight: 0,
                  }}
                >
                  <ChatCard
                    lines={chatLines}
                    send={sendChatLine}
                    connected={chatConnected}
                    inert={Boolean(view.clash)}
                    status={chatStatus}
                    onStatus={setChatStatus}
                    onOpenName={(id, name, anchor) => setNameTarget({ id, name, anchor })}
                    sidePanel={
                      view.status === 'waiting' ? (
                        <InviteComms
                          gameId={activeMatch.gameId}
                          seatUserIds={view.players
                            .map((player) => player.userId)
                            .filter((id): id is string => typeof id === 'string' && id !== '')}
                          playerCount={activeMatch.playerCount ?? 4}
                          friends={friends}
                        />
                      ) : undefined
                    }
                  />
                </div>
              )}

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
                      color: 'var(--text-main)',
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
                // Anchor the opt-in flash card (below) over the board, not the screen.
                position: 'relative',
                // Desktop: the board yields the roster panel's overhang and then biases right
                // (see boardMaxWidth / boardMarginRight); the stacked layout stays centred.
                maxWidth: boardMaxWidth,
                justifySelf: desktopLayout ? 'end' : 'center',
                marginRight: boardMarginRight,
              }}
            >
              {/* The opt-in capture flash card (25.6, re-based in 25.17): top centre of the
                  board column, over the board and not the screen, no scrim, pointerEvents
                  none. Event-driven: a capture mounts it, the next move or roll unmounts it,
                  and the wrapper fades it out so an idle board never keeps a stale cell.
                  It plays the clash card's own scene at the clash stage's own 0.8 — same
                  pixels per unit, same 4:3, same clock — so no clip is rescaled; only the
                  window is smaller (the versus columns are cropped away) and the chrome is
                  the clash card's, with 3 mm of padding instead of 44/56 px. */}
              {flashCard && (
                <div
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    // 92 % of the board column, less the 3 mm padding on both sides, then
                    // the ratio cap: 48vw is 0.8 of the clash stage's 60vw, so the two
                    // stages cross 700 px together and are never in different regimes.
                    width: `min(calc(92% - 2 * 3mm), 48vw, ${FLASH_CARD_STAGE_MAX_PX}px)`,
                    aspectRatio: FLASH_CARD_ASPECT,
                    boxSizing: 'content-box',
                    padding: '3mm',
                    borderRadius: 12,
                    background: 'var(--bg-card)',
                    border: 'var(--card-border-style)',
                    boxShadow: 'var(--box-shadow)',
                    overflow: 'hidden',
                    zIndex: 30,
                    pointerEvents: 'none',
                    animation: `flash-card-out ${CAPTURE_CARD_FADE_MS}ms ease-in ${CAPTURE_CARD_MS - CAPTURE_CARD_FADE_MS}ms both`,
                  }}
                >
                  <ResultFx
                    key={`flash-${flashCard.id}`}
                    kind="capture"
                    attacker={flashCard.attacker}
                    defender={flashCard.defender}
                    n={1}
                    totalRounds={1}
                    viewBox={FLASH_CARD_VIEWBOX}
                  />
                </div>
              )}
              {/* The goal celebration (32.5): the arrival, then exactly ONE overlay. The
                  starburst is the arrival and sits above everything — the piece has left its
                  cell, so the burst is the only thing on the square, and with the ramp card
                  mounted it would otherwise burn down behind it. The overlay is the room's
                  effects rule and never both: the ramp card on the flash card's own chrome, or
                  the confetti. Both are pinned to the cell the piece left (viewport
                  coordinates, measured when the walk landed) and neither takes a click. */}
              {goalFx && (
                <>
                  <div
                    style={{
                      position: 'fixed',
                      left: goalFx.x,
                      top: goalFx.y,
                      width: 0,
                      height: 0,
                      zIndex: 40,
                      pointerEvents: 'none',
                    }}
                  >
                    <GoalBurst key={`goal-burst-${goalFx.id}`} color={SEAT_HUES[goalFx.color]} />
                  </div>
                  {view.captureFx ? (
                    <div
                      key={`goal-card-${goalFx.id}`}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        // The flash card's own window and chrome, so the two cards are one
                        // family: 92 % of the board column less its 3 mm padding, the ratio
                        // cap, and the same border and shadow.
                        width: `min(calc(92% - 2 * 3mm), 48vw, ${GOAL_CARD_MAX_PX}px)`,
                        aspectRatio: GOAL_CARD_ASPECT,
                        boxSizing: 'content-box',
                        padding: '3mm',
                        borderRadius: 12,
                        background: 'var(--bg-card)',
                        border: 'var(--card-border-style)',
                        boxShadow: 'var(--box-shadow)',
                        overflow: 'hidden',
                        zIndex: 30,
                        pointerEvents: 'none',
                        animation: `goal-card-out ${GOAL_CARD_FADE_MS}ms ease-in ${GOAL_CARD_MS}ms both`,
                      }}
                    >
                      <GoalCard color={goalFx.color} count={goalFx.count} />
                    </div>
                  ) : (
                    <div
                      style={{
                        position: 'fixed',
                        left: goalFx.x,
                        top: goalFx.y,
                        width: 0,
                        height: 0,
                        zIndex: 35,
                        pointerEvents: 'none',
                      }}
                    >
                      <GoalConfetti key={`goal-confetti-${goalFx.id}`} color={SEAT_HUES[goalFx.color]} />
                    </div>
                  )}
                </>
              )}
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
                      breakerArmed={breakerArmed}
                    />
                  </div>
                );
              })()}

              {/* Under the board, in every mode and also mid-game. The controls
                  popover and the rules deck used to share one column box; they
                  are two controls now, so neither label covers both. This column
                  is `order-1` when the layout stacks, so one placement serves the
                  desktop second column and the tablet/phone stack alike. */}
              <div style={{ display: 'flex', gap: 10, width: '100%', marginTop: 12 }}>
                <CyberButton
                  label={t('gameExtra.controlsSettings')}
                  variant="cyan"
                  onClick={() => {
                    retroAudio.playUiBeep(600, 0.05);
                    setIsControlsModalOpen(true);
                  }}
                  style={{ flex: 1, justifyContent: 'center', textAlign: 'center' }}
                />
                <CyberButton
                  label={t('gameExtra.gameRulesBtn')}
                  variant="pink"
                  onClick={() => {
                    retroAudio.playUiBeep(600, 0.05);
                    setRulesPage(0);
                    setIsSystemModalOpen(true);
                  }}
                  style={{ flex: 1, justifyContent: 'center', textAlign: 'center' }}
                />
              </div>
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
                            background: alreadyReady ? 'rgb(var(--state-on-rgb) / 0.2)' : 'var(--btn-bg)',
                            borderColor: alreadyReady ? 'var(--state-on)' : 'var(--accent-pink)',
                            color: alreadyReady ? 'var(--state-on)' : 'var(--text-main)',
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
                          <RoomRuleToggle
                            icon="⚔️"
                            label={t('game.clashMode')}
                            desc={t('game.clashModeDesc')}
                            checked={view.clashMode}
                            accent="var(--accent-pink)"
                            onToggle={(next) => emitRule({ clashEnabled: next })}
                          />
                          {/* The key-shift mutator sits directly under the clash
                              toggle it depends on, so the panel reads clash → mid-clash
                              key shift → free exit → no safe zones → attack animations:
                              a checkbox and its 1 / 2 count. Both are disabled unless
                              clash mode is on, because the engine forces the count to 0
                              there. The count lives in local state so re-enabling
                              restores it instead of resetting to 1. A native <select> is
                              the first in the app, so it carries its own dark styling. */}
                          <label
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 8,
                              fontSize: '0.78rem',
                              fontFamily: 'var(--font-mono)',
                              color: 'var(--text-main)',
                              cursor: view.clashMode ? 'pointer' : 'not-allowed',
                              opacity: view.clashMode ? 1 : 0.55,
                              border: '1px solid var(--border-color)',
                              borderRadius: 4,
                              padding: '7px 10px',
                              background: 'rgb(var(--shade-rgb) / 0.4)',
                            }}
                          >
                            <span
                              style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}
                            >
                              <span>🔀 {t('game.clashKeyShift')}</span>
                              <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                                {t('game.clashKeyShiftDesc')}
                              </span>
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <select
                                aria-label={t('game.clashKeyShiftCount')}
                                value={clashShiftCount}
                                disabled={!view.clashMode}
                                onChange={(e) => {
                                  const next = e.target.value === '2' ? 2 : 1;
                                  setClashShiftCount(next);
                                  retroAudio.playUiBeep(520, 0.05);
                                  // A count only means something with the mutator on.
                                  emitKeyShift(view.clashKeyShift > 0 ? next : 0);
                                }}
                                className={INLINE_CHIP}
                              >
                                <option value={1}>1</option>
                                <option value={2}>2</option>
                              </select>
                              <input
                                type="checkbox"
                                checked={view.clashKeyShift > 0}
                                disabled={!view.clashMode}
                                onChange={(e) => {
                                  retroAudio.playUiBeep(e.target.checked ? 520 : 320, 0.05);
                                  emitKeyShift(e.target.checked ? clashShiftCount : 0);
                                }}
                                style={{
                                  accentColor: 'var(--accent-pink)',
                                  width: 15,
                                  height: 15,
                                  cursor: view.clashMode ? 'pointer' : 'not-allowed',
                                }}
                              />
                            </span>
                          </label>
                          <RoomRuleToggle
                            icon="🚪"
                            label={t('game.freeExit')}
                            desc={t('game.freeExitDesc')}
                            checked={view.freeExit}
                            accent="var(--accent-yellow)"
                            onToggle={(next) => emitRule({ freeExit: next })}
                          />
                          <RoomRuleToggle
                            icon="💀"
                            label={t('game.noSafeZones')}
                            desc={t('game.noSafeZonesDesc')}
                            checked={view.noSafeZones}
                            accent="var(--accent-cyan)"
                            onToggle={(next) => emitRule({ noSafeZones: next })}
                          />
                          {/* The one purely cosmetic rule: capture FX only changes
                              what you see when a piece is taken, never the game, so
                              it sits after every gameplay rule instead of inside
                              their ramp. */}
                          <RoomRuleToggle
                            icon="💥"
                            label={t('game.captureFx')}
                            desc={t('game.captureFxDesc')}
                            checked={view.captureFx}
                            accent="#00ff88"
                            onToggle={(next) => emitRule({ captureFx: next })}
                          />
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
                            color: 'var(--text-main)',
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
                        color: isMyTurn ? 'var(--accent-yellow)' : 'var(--text-muted)',
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
                        <Die value={view.diceValue ?? 0} rolling={isRolling} brakeTo={brakeTo} />
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
                          canRoll && !isRolling ? 'var(--accent-pink)' : 'rgb(var(--ink-rgb) / 0.2)',
                        boxShadow: canRoll && !isRolling ? '0 0 20px var(--accent-pink)' : 'none',
                        animation: canRoll && !isRolling ? 'pulse-glow 1.5s infinite' : 'none',
                        cursor: canRoll && !isRolling ? 'pointer' : 'default',
                        opacity: canRoll && !isRolling ? 1 : 0.5,
                        boxSizing: 'border-box',
                      }}
                    >
                      {isRolling ? t('game.rolling').toUpperCase() : t('game.rollDiceBtn')}
                    </button>

                    {/* Wall Breaker: the token is spent on the FIRST tap that
                        commits it, so the control has two steps. Arm it here, then
                        tap the prison exit on the board; Skip declines and keeps
                        the token. Both render only while the roll actually offers
                        such a break, which is what makes them mean something. */}
                    {canOfferWallBreak && (
                      <button
                        className={RETRO_BTN}
                        onClick={toggleWallBreakArm}
                        title={
                          breakerArmed
                            ? t('game.wallBreakerActionArmedTitle')
                            : t('game.wallBreakerActionTitle')
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
                          background: breakerArmed ? 'rgb(var(--accent-yellow-rgb) / 0.22)' : 'var(--btn-bg)',
                          borderColor: breakerArmed ? 'var(--accent-yellow)' : 'var(--accent-cyan)',
                          color: breakerArmed ? 'var(--accent-yellow)' : 'var(--text-main)',
                          boxShadow: breakerArmed ? '0 0 18px var(--accent-yellow)' : 'none',
                          animation: breakerArmed ? 'pulse-glow 1.5s infinite' : 'none',
                          cursor: 'pointer',
                          boxSizing: 'border-box',
                        }}
                      >
                        {breakerArmed
                          ? `🔓 ${t('game.wallBreakerArmedBtn')}`
                          : `🔓 ${t('game.wallBreakerBtn')}`}
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

              {/* MISSION TELEMETRY LOG WINDOW: a live match only. The engine writes its
                  first line on the opening roll, so in the waiting room this box could
                  only ever read NO TELEMETRY LOGGED while taking 180px from a column
                  whose whole content there is the room's own window. */}
              {view.status !== 'waiting' && (
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
                          ml.color === 'red'
                            ? '#ff007f'
                            : ml.color === 'green'
                              ? '#00ff88'
                              : ml.color === 'yellow'
                                ? '#ffe600'
                                : '#00f0ff';
                        return (
                          <div
                            // Entries carry no id: the newest line is always at index 0, so
                            // the pair (engine stamp, index) is stable enough to key on.
                            key={`${ml.at}-${i}`}
                            style={{
                              display: 'flex',
                              gap: 8,
                              fontSize: '0.72rem',
                              color: 'var(--text-main)',
                              fontFamily: 'var(--font-mono)',
                              lineHeight: 1.3,
                            }}
                          >
                            <span style={{ color: dotColor, fontWeight: 'bold' }}>●</span>
                            <span>{renderLog(ml)}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </section>
              )}

              {/* RETURN TO LOBBY BUTTON (every ended game, a live online PvP, and a live PvE that
                  holds an account's seat: the seat and the board stay, so the lobby's rejoin
                  banner has a door out of the room to answer. A guest PvE has no account to list,
                  and a live hotseat keeps QUIT TO MENU as its only exit.) */}
              {(isGameEnded ||
                activeMatch.mode === 'pvp' ||
                (activeMatch.mode === 'pve' && !isGuest)) && (
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
                    color: 'var(--text-main)',
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
                        activeMatch.mode === 'hotseat'
                          ? t('gameExtra.quitToMenuBtn')
                          : isBotOrHotseat
                            ? t('gameExtra.abortSimulationBtn')
                            : t('game.abortMatchBtn')
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
                  screen once a clash room is live, greyed out while nothing is holding
                  the turn, so the control is discoverable before it is needed. The
                  waiting room is excluded: there is no turn there to skip, and the
                  control would only ever be greyed. The wrapper carries the tooltip
                  because a disabled button fires no pointer events of its own. */}
              {view.clashMode === true && !isGameEnded && view.status !== 'waiting' && (
                <span
                  style={{ display: 'block', width: '100%' }}
                  title={
                    canSkipWallBreak
                      ? t('game.skipWallBreakTitle')
                      : t('game.skipWallBreakDisabledTitle')
                  }
                >
                  <CyberButton
                    label={t('game.skipWallBreakBtn')}
                    variant="yellow"
                    disabled={!canSkipWallBreak}
                    onClick={skipWallBreak}
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
          // Hotseat: the End Game path ends the room (single-instance rooms are torn
          // down by the post-game flow, so nothing is left to resume), and the menu is
          // where the player came from. No result card to read and nobody else to
          // inform.
          if (activeMatch.mode === 'hotseat') {
            setLastResult(null);
            setShowResultsModal(false);
            setActiveMatch(null);
            navigate('/gamelobby');
          }
        }}
        cancelLabel={t('gameExtra.cancelBtn')}
        proceedLabel={t('gameExtra.confirmAbortBtn')}
        cancelShortcut="ESC"
        proceedShortcut="↵"
        isDanger
      />

      {/* The name card (19.7). Pressing a pilot's name in the transcript opens the
          same card the lobby opens, so a player met across the board can be added,
          accepted or blocked without leaving the game. It passes no `challenge`: in a
          room, inviting is the occupancy panel's job, and it says so by not offering
          the button. */}
      {nameTarget && (
        <ChatNameCard
          target={nameTarget}
          friends={friends}
          requests={requests}
          loading={friendsLoading}
          onClose={() => setNameTarget(null)}
          onStatus={setChatStatus}
          onBlocked={refreshFriends}
        />
      )}

      {/* Keys and audio, the popover the old column box became. It holds no rule
          switch: those stay in the waiting-room window, which is where the host
          gate already lives, so this panel is safe for every seat. */}
      <ControlsSettingsModal
        isOpen={isControlsModalOpen}
        onClose={() => setIsControlsModalOpen(false)}
        muted={soundMuted}
        onToggleSound={toggleSound}
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
            {/* Page Navigation Tabs: the pill is the label plus a 6px border of air on every
                side (20.5), so it sizes to its label and the strip wraps instead of sharing a
                `flex: 1` that is narrower than "10. WALL BREAKER" — the share squeezed the
                text out of its own pill, which is what made the distance read as 2 to 6px. */}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
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
                    // Natural width, so the 6px padding on all four sides is a distance the
                    // eye can see: `flex: 1` divided a 380–520px deck by ten and gave every
                    // pill less than its own label.
                    flex: '0 0 auto',
                    padding: 6,
                    fontSize: '0.68rem',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 'bold',
                    background:
                      rulesPage === p.id ? 'rgba(0, 240, 255, 0.22)' : 'rgb(var(--ink-rgb) / 0.04)',
                    border:
                      rulesPage === p.id
                        ? '1.5px solid var(--accent-cyan)'
                        : '1px solid rgb(var(--ink-rgb) / 0.1)',
                    color: rulesPage === p.id ? 'var(--text-main)' : 'var(--text-muted)',
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
                        color: 'var(--text-main)',
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
                        color: 'var(--text-main)',
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
                    border: '1px solid rgb(var(--accent-yellow-rgb) / 0.2)',
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
                    <span style={{ color: 'var(--state-off)', fontSize: '1.2rem' }}>⛔</span>
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
                      color: 'var(--accent-yellow)',
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
                    color: 'var(--accent-yellow)',
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
                    border: '1px solid rgb(var(--accent-yellow-rgb) / 0.2)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ color: 'var(--accent-yellow)', fontWeight: 'bold', fontSize: '1.1rem' }}>
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
                      borderLeft: '3px solid rgb(var(--accent-yellow-rgb) / 0.35)',
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
                  <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.9rem' }}>
                    {t('gameExtra.rulesPage6KeyShift')}
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
          single device owns both seats, so both sides' keys are live at once. The
          card's acts answer to the room's one rule, so the overlay is told the flag
          rather than reading it: off means a text-only card (25.7). */}
      {view.clash && (
        <ClashOverlay
          clash={view.clash}
          result={view.clashResult}
          myColor={view.myColor}
          players={view.players}
          onKeyPress={clashInput}
          onComplete={clearClash}
          allowBothSides={activeMatch.mode === 'hotseat'}
          animations={view.captureFx}
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
