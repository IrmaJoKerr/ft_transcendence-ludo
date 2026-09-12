import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Board } from '../components/Board';
import { Die } from '../components/Die';
import { localizedBotName } from '../utils/botName';
import { applyEvent, initialView } from '../game/reducer';
import type { PlayerColor } from '../game/types';
import { ClashOverlay } from '../game/ClashOverlay';
import { navigate } from '../router';
import { connectSocket } from '../socket';
import { getApi, postApi } from '../api';
import { useApp } from '../store';
import { SEAT_COLORS } from '../theme';
import { UserAvatar } from '../components/UserAvatar';
import { CyberButton, CyberModal } from '../components/CyberModal';
import { ResultsModal } from '../components/ResultsModal';
import { retroAudio } from '../utils/audio';
import '../styles/retrowave.css';
import {
  CRT_SCREEN,
  GRID_BACKGROUND,
  SYNTHWAVE_SUN,
  PERSPECTIVE_GRID,
  GRID_HORIZON,
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

// Matches the backend's SLOT_COLORS — hotseat seat index i always maps to
// this color, regardless of the Lobby seat-picker's own (unrelated) display order.
const SLOT_COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

export function Game() {
  const { t } = useTranslation();
  const { user, activeMatch, seats, setPlaying, lastResult, setLastResult, setActiveMatch } =
    useApp();
  // The socket-connect effect keys on gameId/token only, so patching
  // activeMatch later can't reopen the socket; its handlers read this ref to
  // still see those patches (see the game docs, Implementation Notes).
  const activeMatchRef = useRef(activeMatch);
  activeMatchRef.current = activeMatch;

  // ------------------------------------------------------------------------
  // CRT & AUDIO CONTROLS
  // ------------------------------------------------------------------------
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

  // Custom names typed into the Lobby seat-setup for local (hotseat) seats —
  // seat 0 is always the logged-in host (uses their real username instead),
  // so only look at seats[1..].
  const localNames = useMemo<Partial<Record<PlayerColor, string>>>(() => {
    const names: Partial<Record<PlayerColor, string>> = {};
    seats.forEach((seat, i) => {
      if (i === 0) return;
      if (seat.type === 'player') names[SLOT_COLORS[i]] = seat.name;
    });
    return names;
  }, [seats]);
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
  const [displayedLastRolls, setDisplayedLastRolls] = useState<
    Partial<Record<PlayerColor, number>>
  >({});
  const [codeCopied, setCodeCopied] = useState(false);
  const [turnSwapNotice, setTurnSwapNotice] = useState<string | null>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const prevTurnRef = useRef<PlayerColor | null>(null);
  const isGameEnded = lastResult != null || view.status === 'finished';

  // Box-by-box move animation: while set, Board renders this piece at `step`
  // instead of its real (already-updated) logical position — see the
  // piece_moved handler below, which steps through the server's `path`.
  const [animatingPiece, setAnimatingPiece] = useState<{ pieceId: string; step: number } | null>(
    null,
  );
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isMovingPiece, setIsMovingPiece] = useState(false);
  const isMovingPieceRef = useRef(false);
  // Set when move_piece emits, cleared on piece_moved/rejection: blocks a
  // second click from firing a duplicate move the engine rejects.
  const pendingMoveRef = useRef(false);
  const STEP_ANIM_MS = 180;
  // Capture burst FX: a short cosmetic ring + sparks on the landing square
  // when a piece is captured. Set at the end of the mover's walk, cleared
  // after the burst plays out — purely visual, no game state involved.
  const [captureFx, setCaptureFx] = useState<{ color: string; to: number } | null>(null);

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
      const isNextBot = nextTurnPlayer?.isBot ?? false;
      const colorKey =
        `lobby.color${effectiveTurn.charAt(0).toUpperCase() + effectiveTurn.slice(1)}` as
          'lobby.colorRed' | 'lobby.colorGreen' | 'lobby.colorYellow' | 'lobby.colorBlue';
      const translatedColor = t(colorKey).toUpperCase();
      const nextName =
        (localNames[effectiveTurn] ?? '').toUpperCase() ||
        localizedBotName(t, nextTurnPlayer?.displayName).toUpperCase() ||
        localizedBotName(t, nextTurnPlayer?.username).toUpperCase() ||
        (nextTurnPlayer?.color ?? '').toUpperCase() ||
        (isNextBot ? `${t('common.bot').toUpperCase()} (${translatedColor})` : translatedColor);

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
      // Hotseat: one physical device controls every seat — the engine has no
      // separate accounts to join with, so this single socket must join_game
      // for every local color up front.
      if (current.mode === 'hotseat') {
        for (const ck of Object.keys(localNames) as PlayerColor[]) {
          socket.emit('join_game', current.gameId, ck, undefined, localNames[ck]);
        }
      }
      socket.emit('join_game', current.gameId, current.color, user?.id, user?.displayName);
    });

    socket.on('connect_error', (err: Error) => {
      console.error('[socket] connect_error', err.message);
    });

    socket.on('disconnect', () => {
      setIsRolling(false);
      isRollingRef.current = false;
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
          rollerColor;
        retroAudio.playLaserSound();
        setIsRolling(true);
        setTimeout(() => {
          setIsRolling(false);
          isRollingRef.current = false;
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
        }, 750);
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
        };
        const path = e.path ?? [];

        // Extract color of captured piece if a capture occurred
        let victimColor = '';
        if (e.captured) {
          if (e.capturedPieceIds && e.capturedPieceIds.length > 0) {
            victimColor = e.capturedPieceIds[0].split('-')[0].toUpperCase();
          } else {
            const victim = viewRef.current.pieces.find(
              (p) => p.color !== e.color && p.step === e.to,
            );
            if (victim) victimColor = victim.color.toUpperCase();
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
            setMoveLogs((prev) => [
              { ck: e.color, text: t('game.capturedPiece', { color: victimColor }) },
              ...prev.slice(0, 11),
            ]);
            retroAudio.playExplosionSound();
            setCaptureFx({ color: e.color, to: e.to });
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
            }, STEP_ANIM_MS);
          } else if (path.length === 1) {
            setAnimatingPiece({ pieceId: e.pieceId, step: path[0] });
            setTimeout(() => {
              finishMove();
            }, STEP_ANIM_MS);
          } else {
            finishMove();
          }
        };

        if (isRollingRef.current) {
          setTimeout(runStepAnimation, 750);
        } else {
          runStepAnimation();
        }
      } else if (type === 'lobby_update') {
        const e = state as { players: Array<{ username: string; color: PlayerColor }> };
        const mine = e.players.find((p) => p.username === user?.username);
        if (mine && mine.color !== viewRef.current.myColor && activeMatchRef.current) {
          dispatch({ type: 'my_color_changed', color: mine.color });
          socket.emit(
            'join_game',
            activeMatchRef.current.gameId,
            mine.color,
            user?.id,
            user?.displayName,
          );
          setActiveMatch({ ...activeMatchRef.current, color: mine.color });
        }
      } else if (type === 'game_ended') {
        const e = state as { winner: PlayerColor; resultDetail: string };
        retroAudio.playUiBeep(1100, 0.3, 'sawtooth');
        let endedPlayers = viewRef.current.players
          .filter((p) => p.status !== 'inactive')
          .map((p) => {
            const inGoal = p.color === e.winner ? 4 : p.piecesInGoal;
            return {
              color: p.color,
              username:
                (localNames[p.color] ?? localizedBotName(t, p.username)) ||
                (p.isBot ? t('common.bot') : 'Pilot'),
              isBot: p.isBot,
              piecesInGoal: inGoal,
            };
          });
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
        }, 900);
      }
    };

    socket.on('state_update', handleEngineEvent);
    socket.on('dice_rolled', handleEngineEvent);
    socket.on('piece_moved', handleEngineEvent);
    socket.on('game_started', handleEngineEvent);
    socket.on('game_ended', handleEngineEvent);
    socket.on('player_exited', handleEngineEvent);
    socket.on('player_disconnected', handleEngineEvent);
    socket.on('player_reconnected', handleEngineEvent);
    socket.on('lobby_update', handleEngineEvent);
    socket.on('clash_start', handleEngineEvent);
    socket.on('clash_result', handleEngineEvent);
    socket.on('clash_phase', handleEngineEvent);
    socket.on('clash_press', handleEngineEvent);

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
      let players = viewRef.current.players
        .filter((p) => p.status !== 'inactive')
        .map((p) => ({
          color: p.color,
          username:
            (localNames[p.color] ?? localizedBotName(t, p.username)) ||
            (p.isBot ? t('common.bot') : 'Pilot'),
          isBot: p.isBot,
          piecesInGoal: p.piecesInGoal,
        }));

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

    socket.on('error', (msg: string) => {
      console.error('[engine]', msg);
      setIsRolling(false);
      pendingMoveRef.current = false;
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      if (animTimerRef.current) clearInterval(animTimerRef.current);
      animTimerRef.current = null;
      if (captureFxTimerRef.current) clearTimeout(captureFxTimerRef.current);
      captureFxTimerRef.current = null;
      setAnimatingPiece(null);
      setCaptureFx(null);
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
      if (v.clash) return; // QTE in progress — space is a clash key, not a roll
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
      isRollingRef.current = true;
      setIsRolling(true);
      retroAudio.playUiBeep(980, 0.08, 'sawtooth');
      socketRef.current?.emit('roll_dice');
      setTimeout(() => {
        if (isRollingRef.current) {
          isRollingRef.current = false;
          setIsRolling(false);
        }
      }, 2000);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeMatch, user]);

  const rollDice = () => {
    if (!canRoll || isRolling || isRollingRef.current || isMovingPieceRef.current) return;
    isRollingRef.current = true;
    setIsRolling(true);
    retroAudio.playUiBeep(980, 0.08, 'sawtooth');
    socketRef.current?.emit('roll_dice');
    setTimeout(() => {
      if (isRollingRef.current) {
        isRollingRef.current = false;
        setIsRolling(false);
      }
    }, 2000);
  };

  // Host-only room rule toggles (clash QTE on/off + safe zones on/off).
  const updateModifiers = (clashEnabled: boolean, safeZones: boolean) => {
    retroAudio.playUiBeep(760, 0.06);
    socketRef.current?.emit('update_modifiers', clashEnabled, safeZones);
  };
  // Clash QTE: forward a pressed key to the engine, and clear the overlay
  // (clash + result card) once the client-side card animation completes.
  const clashInput = (key: string) => socketRef.current?.emit('clash_input', key);
  const clearClash = () => dispatch({ type: 'clash_clear' });

  const movePiece = (pieceId: string) => {
    if (isRolling || isRollingRef.current || isMovingPieceRef.current || pendingMoveRef.current)
      return;
    pendingMoveRef.current = true;
    retroAudio.playUiBeep(640, 0.05);
    socketRef.current?.emit('move_piece', pieceId);
    // Safety net: if the server never responds (dropped socket, etc.), clear the
    // guard so the next move is not blocked.
    setTimeout(() => {
      pendingMoveRef.current = false;
    }, 3000);
  };

  const markReady = () => {
    retroAudio.playUiBeep(1100, 0.1);
    socketRef.current?.emit('player_ready');
  };

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

    let players = viewRef.current.players
      .filter((p) => p.status !== 'inactive')
      .map((p) => ({
        color: p.color,
        username:
          (localNames[p.color] ?? localizedBotName(t, p.username)) ||
          (p.isBot ? t('common.bot') : 'Pilot'),
        isBot: p.isBot,
        piecesInGoal: p.piecesInGoal,
      }));

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

  // If no match credentials exist, redirect back to lobby
  if (!activeMatch) {
    return (
      <>
        <div className={GRID_BACKGROUND}>
          <div className={SYNTHWAVE_SUN} />
          <div className={GRID_HORIZON} />
          <div className={PERSPECTIVE_GRID} />
        </div>

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
                  NO MATCH CREDENTIALS DETECTED
                </div>
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.85rem',
                    marginBottom: 24,
                    lineHeight: 1.5,
                  }}
                >
                  Please initialize or join a tactical Ludo arena from the Game Lobby first.
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
  const activeHumanTurn = view.players.some(
    (p) => p.color === effectiveTurn && p.status === 'active' && !p.isBot,
  );
  const seatNameMatches = view.players.some(
    (p) => p.color === effectiveTurn && p.username === user?.username,
  );
  const isMyTurn = isHotseat
    ? activeHumanTurn
    : effectiveTurn === view.myColor || (user != null && seatNameMatches);
  // `status === 'active'` closes a game-end race: the winning move can leave
  // the other canRoll inputs looking rollable for one render, letting a click
  // slip through as a "Game not active" rejection.
  const canRoll =
    view.status === 'active' &&
    isMyTurn &&
    view.turnPhase !== 'WAITING_FOR_MOVE' &&
    view.legalMoves.length === 0 &&
    !view.clash &&
    !animatingPiece &&
    !isMovingPiece &&
    !captureFx;
  const turnLabel =
    view.status === 'waiting'
      ? t('game.waitingRoomTitle').toUpperCase()
      : isMyTurn
        ? t('game.yourTurnShort').toUpperCase()
        : `${effectiveTurn.toUpperCase()}'S TURN`;
  const turnAccent =
    view.status === 'waiting' ? 'var(--accent-cyan)' : SEAT_HUES[effectiveTurn] || '#00f0ff';

  return (
    <>
      {/* Animated 3D Synthwave Grid & Sun Background */}
      <div className={GRID_BACKGROUND}>
        <div className={SYNTHWAVE_SUN} />
        <div className={GRID_HORIZON} />
        <div className={PERSPECTIVE_GRID} />
      </div>

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
                    : isRolling
                      ? t('game.statusRolling')
                      : isMyTurn && view.turnPhase === 'WAITING_FOR_ROLL'
                        ? t('game.statusRollNow')
                        : isMyTurn && view.turnPhase === 'WAITING_FOR_MOVE'
                          ? t('game.statusSelectPiece')
                          : t('game.statusRivalTurn', { name: effectiveTurn.toUpperCase() }))}
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
                  title="Click to copy Room Code"
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
              <section className={RETRO_WINDOW} id="playersWindow">
                <div className={`${WINDOW_HEADER} ${GAME_WINDOW_HEADER_EXTRA}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>{t('game.pilotRosterTitle')}</span>
                  </div>
                </div>

                <div
                  className={WINDOW_BODY}
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0 4px',
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
                      // `ck === view.myColor` lags the server's seat assignment for a PvP joiner, so
                      // fall back to a username match — that recognises the seat on first paint.
                      const isYou =
                        ck === view.myColor ||
                        (occupied && !!user?.username && playerMeta?.username === user.username);
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
                              username={playerMeta.username}
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
                              CHOOSE
                            </span>
                          ) : null}
                        </div>
                      );
                    }

                    // Active game pilot card — only render participating pilots
                    if (!playerMeta || playerMeta.status === 'inactive') return null;
                    const isDisconnected = playerMeta.status === 'disconnected';
                    const isHotseat = activeMatch.mode === 'hotseat';
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
                          border: isActive
                            ? `1.5px solid ${colorAccent}`
                            : occupied
                              ? `1.5px solid ${colorAccent}44`
                              : '1.5px dashed rgba(255, 255, 255, 0.12)',
                          background: isActive
                            ? `rgba(35, 12, 70, 0.95)`
                            : 'rgba(25, 10, 56, 0.65)',
                          boxShadow: isActive
                            ? `0 0 20px ${colorAccent}aa, inset 0 0 12px ${colorAccent}44`
                            : 'none',
                          opacity: isDisconnected ? 0.55 : 1,
                          position: 'relative',
                          transition:
                            'background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease',
                          boxSizing: 'border-box',
                        }}
                      >
                        {/* Active Turn Top-Right Badge */}
                        {isActive && (
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

                        {!playerMeta.isBot && !isHotseat ? (
                          <UserAvatar
                            username={playerMeta.username}
                            userId={playerMeta.userId}
                            isBot={playerMeta.isBot}
                            hasAvatarPhoto={playerMeta.hasAvatarPhoto ?? false}
                            avatarStyle={playerMeta.avatarStyle}
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
                        ) : (
                          <div
                            style={{
                              width: 36,
                              height: 36,
                              flex: 'none',
                              borderRadius: 4,
                              display: 'grid',
                              placeItems: 'center',
                              fontWeight: 'bold',
                              fontSize: '0.75rem',
                              color: '#0d0221',
                              background: colorAccent,
                              border: `1.5px solid ${colorAccent}`,
                            }}
                          >
                            {name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
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
                            {isActive && (
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
                              }}
                            >
                              {name}
                            </span>
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
                          {lastRoll !== undefined && lastRoll > 0 && <MiniDie value={lastRoll} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Controls, Shortcuts & Audio Window */}
              <section className={RETRO_WINDOW} id="sectorControlWindow">
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
                maxWidth: 'min(650px, 66vh)',
                justifySelf: 'center',
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

                    {/* Host-only rules control — clash QTE + safe zones (PvP).
                        Toggles broadcast via update_modifiers; every client
                        re-renders from the modifiers_updated echo. */}
                    {activeMatch.mode === 'pvp' &&
                      (() => {
                        const isHost = Boolean(
                          view.hostId && user?.id && view.hostId === user?.id,
                        );
                        return (
                          <div
                            style={{
                              borderTop: '1px solid rgba(0, 240, 255, 0.25)',
                              paddingTop: 12,
                            }}
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
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                  fontSize: '0.78rem',
                                  fontFamily: 'var(--font-mono)',
                                  color: 'var(--text-main)',
                                  cursor: isHost ? 'pointer' : 'not-allowed',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: 4,
                                  padding: '7px 10px',
                                  background: 'rgba(0, 0, 0, 0.4)',
                                  opacity: isHost ? 1 : 0.55,
                                }}
                              >
                                <span>⚔️ {t('game.clashMode')}</span>
                                <input
                                  type="checkbox"
                                  checked={view.clashMode}
                                  disabled={!isHost}
                                  onChange={(e) => updateModifiers(e.target.checked, view.safeZones)}
                                  style={{
                                    accentColor: 'var(--accent-pink)',
                                    width: 15,
                                    height: 15,
                                    cursor: isHost ? 'pointer' : 'not-allowed',
                                  }}
                                />
                              </label>
                              <label
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 8,
                                  fontSize: '0.78rem',
                                  fontFamily: 'var(--font-mono)',
                                  color: 'var(--text-main)',
                                  cursor: isHost ? 'pointer' : 'not-allowed',
                                  border: '1px solid var(--border-color)',
                                  borderRadius: 4,
                                  padding: '7px 10px',
                                  background: 'rgba(0, 0, 0, 0.4)',
                                  opacity: isHost ? 1 : 0.55,
                                }}
                              >
                                <span>🛡 {t('game.safeZones')}</span>
                                <input
                                  type="checkbox"
                                  checked={view.safeZones}
                                  disabled={!isHost}
                                  onChange={(e) => updateModifiers(view.clashMode, e.target.checked)}
                                  style={{
                                    accentColor: 'var(--accent-cyan)',
                                    width: 15,
                                    height: 15,
                                    cursor: isHost ? 'pointer' : 'not-allowed',
                                  }}
                                />
                              </label>
                            </div>
                            {!isHost && (
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
                            )}
                          </div>
                        );
                      })()}

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
                        (
                          localizedBotName(t, activeTurnPlayer?.displayName) ||
                          localizedBotName(t, activeTurnPlayer?.username) ||
                          (activeTurnPlayer?.color ?? '')
                        ).toUpperCase() ||
                        (isBot
                          ? `AI BOT (${effectiveTurn.toUpperCase()})`
                          : effectiveTurn.toUpperCase());
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
                            : t('game.statusRivalTurn', { name: effectiveTurn.toUpperCase() })}
                    </div>

                    <div style={{ height: 90, display: 'grid', placeItems: 'center' }}>
                      <Die value={view.diceValue ?? 0} rolling={isRolling} />
                    </div>

                    <button
                      className={RETRO_BTN}
                      onClick={rollDice}
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
                    navigate('/gamelobby');
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
                  title="Return to Ludo Lobby"
                >
                  &lt; {t('game.returnToLobbyBtn')}
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
            </div>
          </main>
        </div>
      </div>

      {/* Cyberpunk Glitch Confirmation Modal */}
      <CyberModal
        isOpen={isAbortModalOpen}
        title={t('gameExtra.protocolTerminationTitle')}
        versionTag={
          activeMatch.gameId ? `ARENA.${activeMatch.gameId.slice(0, 8)}` : 'v001.e1349837856'
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

      {/* Cyberpunk System Control & Multi-Page Rules Modal (6 Pages) */}
      <CyberModal
        isOpen={isSystemModalOpen}
        title={t('gameExtra.rulesModalTitle')}
        versionTag={t('gameExtra.rulesVersionTag')}
        cancelLabel={t('gameExtra.closeBtn')}
        proceedLabel={rulesPage < 5 ? t('gameExtra.nextPageBtn') : t('gameExtra.startPlayingBtn')}
        cancelShortcut="ESC"
        proceedShortcut={rulesPage < 5 ? '→' : '↵'}
        closeOnProceed={rulesPage >= 5}
        onCancel={() => setIsSystemModalOpen(false)}
        onProceed={() => {
          if (rulesPage < 5) {
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
          </div>
        }
      />

      {/* QTE Clash overlay — mounted while a clash round is live; stays up
          through the result card and unmounts itself via onComplete. */}
      {view.clash && (
        <ClashOverlay
          clash={view.clash}
          result={view.clashResult}
          myColor={view.myColor}
          onKeyPress={clashInput}
          onComplete={clearClash}
        />
      )}

      {/* Game Results Modal Popup */}
      {showResultsModal && lastResult && (
        <ResultsModal
          result={lastResult}
          onReturnToLobby={() => {
            setLastResult(null);
            setShowResultsModal(false);
            setActiveMatch(null);
            navigate('/gamelobby');
          }}
          onClose={() => setShowResultsModal(false)}
        />
      )}
    </>
  );
}
