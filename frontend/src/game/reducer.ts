// Reduces engine Socket.IO events into a renderable GameViewState.
// The reducer is a renderer: it never decides outcomes.
// The engine is authoritative; the reducer keeps the UI in sync.

import type { ClashState, GameState, LegalMove, MoveResult, PlayerColor } from './types';

// `clash_start` may omit these three (older payloads); the reducer fills them.
// `serverNow` is the frame's engine stamp for the clock offset; it is not part of
// the stored clash state, only of the frame.
type ClashPayload = Omit<ClashState, 'target' | 'attackerPresses' | 'defenderPresses'> &
  Partial<Pick<ClashState, 'target' | 'attackerPresses' | 'defenderPresses'>> & {
    serverNow?: number;
  };

export type ClashResult = {
  // Who attacked this round, whatever the outcome: the result FX is picked from it
  // (`winner === attacker` splits a won round from a lost one). Optional so a frame from
  // an older engine still reads; the overlay falls back to the live clash's attacker.
  attacker?: PlayerColor;
  winner: PlayerColor;
  loser: PlayerColor;
  winnerPresses: number;
  loserPresses: number;
  // Chain fields: absent (or undefined) on a single-defender clash.
  round?: number;
  totalRounds?: number;
  continues?: boolean;
  defenderPieceId?: string;
  remainingDefenderIds?: string[];
  // The engine's id for THIS card ("attacker-defender-moveCounter"), echoed back by
  // the release handshake. Optional so a frame from an older engine still reads.
  cardId?: string;
  // The card's deadline on the engine clock: the post-clash gates use the real end
  // instead of the 4 s ceiling. Absent on an older engine.
  resultCardUntil?: number;
};

export type GameViewState = {
  pieces: GameState['pieces'];
  players: GameState['players'];
  currentTurn: PlayerColor;
  turnPhase: GameState['turnPhase'];
  diceValue: number | null;
  legalMoves: LegalMove[];
  winner: PlayerColor | null;
  status: GameState['status'];
  myColor: PlayerColor;
  readyPlayers: PlayerColor[];
  /** True when the game is paused waiting for a disconnected player. */
  paused: boolean;
  /** Whose turn the paused game is waiting on. Undefined when not paused. */
  pauseTurnOwner?: PlayerColor;
  /** Live clash QTE. The overlay renders (and its keys listen) only while set. */
  clash: ClashState | null;
  /** Set for the CLASH_RESULT card window; cleared by the overlay's onComplete. */
  clashResult: ClashResult | null;
  /** Room rule: clash minigame on. */
  clashMode: boolean;
  /** Room rule: how many times the required letter changes mid-clash (0, 1 or 2). */
  clashKeyShift: 0 | 1 | 2;
  /** Room rule, inverted: true is hardcore, i.e. star squares no longer protect. */
  noSafeZones: boolean;
  /** Any roll leaves prison instead of only a 6; false until the engine sends it. */
  freeExit: boolean;
  /** Engine timestamp until which the clash result card freezes input. */
  resultCardUntil?: number;
};

export function initialView(myColor: PlayerColor): GameViewState {
  return {
    pieces: [],
    players: [],
    currentTurn: 'blue',
    turnPhase: 'WAITING_FOR_ROLL',
    diceValue: null,
    legalMoves: [],
    winner: null,
    status: 'waiting',
    myColor,
    readyPlayers: [],
    paused: false,
    pauseTurnOwner: undefined,
    clash: null,
    clashResult: null,
    // All room rules default false: a standard room is clash off, free exit off,
    // safe zones ON (the inverted flag is what makes that uniform), no key switch.
    clashMode: false,
    clashKeyShift: 0,
    noSafeZones: false,
    freeExit: false,
    resultCardUntil: undefined,
  };
}

export function applyEvent(
  state: GameViewState,
  event: { type: string } & Record<string, unknown>,
): GameViewState {
  switch (event.type) {
    case 'game_joined':
    case 'state_update': {
      const s = event as unknown as Partial<GameState> & { type: string };
      let players = s.players ?? state.players;
      if (s.status === 'waiting' || (!s.status && state.status === 'waiting')) {
        // In waiting room, each user can only occupy ONE active seat.
        // If a user changed seats, clear older duplicate entries.
        const seen = new Set<string>();
        const reversed = [...players].reverse();
        players = reversed
          .map((p) => {
            if (p.status === 'active' && p.username) {
              if (seen.has(p.username)) {
                return { ...p, username: '', displayName: '', status: 'inactive' as const };
              }
              seen.add(p.username);
            }
            return p;
          })
          .reverse();
      }
      return {
        ...state,
        pieces: s.pieces ?? state.pieces,
        players,
        currentTurn: s.currentTurn ?? state.currentTurn,
        turnPhase: s.turnPhase ?? state.turnPhase,
        status: s.status ?? state.status,
        legalMoves: s.pendingLegalMoves ?? state.legalMoves,
        diceValue: s.pendingDiceValue ?? state.diceValue,
        readyPlayers: s.readyPlayers ?? state.readyPlayers,
        paused: s.paused ?? false,
        pauseTurnOwner: s.pauseTurnOwner ?? undefined,
        clash: s.clash
          ? {
              ...s.clash,
              // The key-shift schedule rides the state, but its clock offset does not:
              // only a `clash_start` frame carries `serverNow`. A rebuild of the SAME
              // clash keeps the offset the frame gave it; a different clash starts at 0
              // (the device clock), which is how every other deadline already reads.
              serverOffset:
                state.clash && state.clash.startedAt === s.clash.startedAt
                  ? (state.clash.serverOffset ?? 0)
                  : 0,
            }
          : state.clash,
        clashMode: s.clashMode ?? state.clashMode,
        clashKeyShift: s.clashKeyShift ?? state.clashKeyShift,
        noSafeZones: s.noSafeZones ?? state.noSafeZones,
        freeExit: s.freeExit ?? state.freeExit,
        resultCardUntil: s.resultCardUntil ?? state.resultCardUntil,
      };
    }
    case 'lobby_update': {
      const payload =
        (event.players as
          | Array<{
              username: string;
              color: PlayerColor;
              ready: boolean;
              userId?: string;
              hasAvatarPhoto?: boolean;
              avatarStyle?: string;
            }>
          | undefined) ?? [];
      // The engine only includes active seats in this payload.
      // Any seat omitted from the payload is empty and must be reset to inactive.
      const players = state.players.map((p) => {
        const seat = payload.find((e) => e.color === p.color);
        return seat
          ? {
              ...p,
              username: seat.username,
              displayName: seat.username,
              // Avatar facts travel with the roster so a seat never has to ask
              // for a photo it does not have. `userId` is empty for bots and
              // hotseat's local seats.
              userId: seat.userId,
              hasAvatarPhoto: seat.hasAvatarPhoto ?? false,
              avatarStyle: seat.avatarStyle ?? null,
              status: 'active' as const,
            }
          : {
              ...p,
              username: '',
              displayName: '',
              userId: undefined,
              hasAvatarPhoto: false,
              avatarStyle: null,
              status: 'inactive' as const,
            };
      });
      return {
        ...state,
        players,
        readyPlayers: payload.filter((p) => p.ready).map((p) => p.color),
      };
    }
    case 'modifiers_updated':
      // One object both ways (no positional booleans). The engine broadcasts what
      // it actually persisted, so this is a mirror, never an optimistic guess.
      return {
        ...state,
        clashMode: Boolean(event.clashEnabled),
        clashKeyShift:
          event.clashKeyShift === 1 || event.clashKeyShift === 2 ? event.clashKeyShift : 0,
        noSafeZones: Boolean(event.noSafeZones),
        freeExit: Boolean(event.freeExit),
      };
    case 'my_color_changed':
      return { ...state, myColor: event.color as PlayerColor };
    case 'game_started':
      return { ...state, status: 'active' };
    case 'dice_rolled': {
      const legalMoves = (event.legalMoves as LegalMove[] | undefined) ?? [];
      // The frame names the seat that rolled. The engine advances the turn before
      // emitting on a no-move roll or the third-six forfeit, so `event.currentTurn` is
      // the NEXT seat; the roller has to come from the frame, never from a guess. The
      // face lands on that seat so the roster's MiniDie matches the die on the table.
      const roller = event.color as PlayerColor | undefined;
      return {
        ...state,
        diceValue: event.value as number,
        legalMoves,
        turnPhase: legalMoves.length > 0 ? 'WAITING_FOR_MOVE' : 'WAITING_FOR_ROLL',
        currentTurn: (event.currentTurn as PlayerColor | undefined) ?? state.currentTurn,
        players: roller
          ? state.players.map((p) =>
              p.color === roller ? { ...p, lastRoll: event.value as number } : p,
            )
          : state.players,
      };
    }
    case 'piece_moved':
      return applyMove(state, event as unknown as MoveResult);
    case 'game_ended':
      return { ...state, status: 'finished', winner: event.winner as PlayerColor };
    case 'clash_start': {
      const c = event as unknown as ClashPayload;
      // Payloads may omit the press counts (bars start empty) and the target
      // (the overlay then falls back to its own CLASH_TARGET constant). The
      // chain's round fields pass straight through when the engine sends them, and so
      // does the key-shift schedule. The clock offset is derived HERE, at receipt,
      // because that is the only moment the frame's server stamp can be compared with
      // this device's clock; every switch is then scheduled on the server clock.
      return {
        ...state,
        clash: {
          ...c,
          target: c.target ?? 42,
          attackerPresses: c.attackerPresses ?? 0,
          defenderPresses: c.defenderPresses ?? 0,
          serverOffset: typeof c.serverNow === 'number' ? c.serverNow - Date.now() : 0,
        },
        clashResult: null,
      };
    }
    case 'clash_phase': {
      const e = event as unknown as {
        phase: ClashState['phase'];
        countdownDeadline: number;
        pressDeadline: number;
      };
      if (!state.clash) return state;
      return {
        ...state,
        clash: {
          ...state.clash,
          phase: e.phase,
          countdownDeadline: e.countdownDeadline,
          pressDeadline: e.pressDeadline,
        },
      };
    }
    case 'clash_result':
      // Keep `clash` through the result card: the overlay renders only while `view.clash`
      // is truthy and its timer fires `clash_clear`; nulling it here would leave
      // `clashResult` set. The card's deadline is kept so the gates read its real end.
      return {
        ...state,
        clashResult: event as unknown as ClashResult,
        resultCardUntil:
          (event.resultCardUntil as number | null | undefined) ?? state.resultCardUntil,
      };
    case 'clash_card_released':
      // The card keeps its own clock: the overlay's timer ends it at CLASH_RESULT_MS.
      // The engine emits this a round trip into the card, so it only carries the
      // shortened freeze; clearing here would hide the result before it is read.
      return {
        ...state,
        resultCardUntil: (event.resultCardUntil as number | undefined) ?? state.resultCardUntil,
      };
    case 'clash_press': {
      const e = event as unknown as { color: PlayerColor; presses: number };
      if (!state.clash) return state;
      const clash = { ...state.clash };
      if (e.color === clash.attacker) clash.attackerPresses = e.presses;
      else if (e.color === clash.defender) clash.defenderPresses = e.presses;
      return { ...state, clash };
    }
    case 'clash_clear':
      // A chain's rounds are 2s apart, exactly the overlay's result-card timer: if that
      // timer fires immediately after the next `clash_start`, a blind clear would take
      // the new clash down. `clash_start` nulls `clashResult`, so a null card is leftover.
      if (!state.clashResult) return state;
      return { ...state, clash: null, clashResult: null };
    case 'player_exited':
      return {
        ...state,
        players: state.players.map((p) =>
          p.color === (event.color as PlayerColor) ? { ...p, status: 'exited' } : p,
        ),
      };
    case 'player_disconnected':
      return {
        ...state,
        // Keep all data/pieces: the player is temporarily away, not gone.
        players: state.players.map((p) =>
          p.color === (event.color as PlayerColor) ? { ...p, status: 'disconnected' } : p,
        ),
      };
    case 'player_reconnected':
      return {
        ...state,
        players: state.players.map((p) =>
          p.color === (event.color as PlayerColor)
            ? {
                ...p,
                status: 'active',
                // The reconnecting client reports the name it has now, which can
                // differ from the one the seat was created with.
                ...(event.displayName ? { displayName: event.displayName as string } : {}),
              }
            : p,
        ),
      };
    case 'turn_skipped':
      // A held turn passed without a move: Skip on the armed Wall Breaker exit.
      // No piece moved, so nothing else needs re-deriving, and the engine names
      // the seat that takes over.
      return {
        ...state,
        legalMoves: [],
        turnPhase: 'WAITING_FOR_ROLL',
        currentTurn: (event.currentTurn as PlayerColor | undefined) ?? state.currentTurn,
      };
    default:
      return state;
  }
}

function applyMove(state: GameViewState, move: MoveResult): GameViewState {
  const pieces = state.pieces.map((p) => {
    // Captured-first precedence: a repelled clash sends the mover to prison instead of
    // the landing square. A normal move never lists its own mover as captured, so
    // non-clash behaviour is unchanged.
    if (move.captured && move.capturedPieceIds?.includes(p.id))
      return { ...p, step: 0, isInGoal: false, isInBase: true };
    if (p.id === move.pieceId)
      return { ...p, step: move.to, isInGoal: move.to === 57, isInBase: false };
    return p;
  });

  const players = state.players.map((p) => {
    if (p.color === move.color) {
      const inGoal = pieces.filter((pc) => pc.color === move.color && pc.isInGoal).length;
      return { ...p, piecesInGoal: inGoal };
    }
    return p;
  });

  return {
    ...state,
    pieces,
    players,
    diceValue: move.diceValue,
    legalMoves: [],
    turnPhase: 'WAITING_FOR_ROLL',
    currentTurn: move.bonusRoll ? move.color : nextTurn(state.players, move.color),
  };
}

function nextTurn(players: GameState['players'], from: PlayerColor): PlayerColor {
  const idx = players.findIndex((x) => x.color === from);
  if (idx === -1) return from;
  // Mirror of the engine's turn advance: the next seat in players[] order takes
  // the turn unless it has left. A disconnected seat with an open grace window
  // holds the turn, so the prediction must not skip past it.
  for (let i = 1; i <= players.length; i++) {
    const p = players[(idx + i) % players.length];
    if (p.status === 'active' || p.status === 'disconnected') return p.color;
  }
  return from;
}
