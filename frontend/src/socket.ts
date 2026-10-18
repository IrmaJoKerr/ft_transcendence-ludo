import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ClashPhase, GameState, PlayerColor, LegalMove, MoveResult } from './game/types';

// The three room rules travel as ONE object in both directions (create body and
// `update_modifiers` / `modifiers_updated`): a fourth rule is a field, not a
// fifth positional boolean. See the room-rule payload design note in todo.md.
export type RoomRules = {
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
};

// The clash frames the engine emits. The chain fields (round / totalRounds /
// remainingDefenderIds / defenderPieceId / continues) are declared OPTIONAL now
// so a single-defender clash and a chain round share one signature.
export type ClashStartEvent = {
  attackerKey: string;
  defenderKey: string;
  target: number;
  duration: number;
  attacker: PlayerColor;
  defender: PlayerColor;
  phase: ClashPhase;
  startAt: number;
  announceDeadline: number;
  countdownDeadline: number;
  pressDeadline: number;
  attackerPresses: number;
  defenderPresses: number;
  round?: number;
  totalRounds?: number;
  defenderPieceId?: string;
  remainingDefenderIds?: string[];
};

export type ServerEvents = {
  game_joined: (state: GameState) => void;
  dice_rolled: (e: {
    value: number;
    legalMoves: LegalMove[];
    bonusRoll: boolean;
    currentTurn: PlayerColor;
    forfeited?: boolean;
  }) => void;
  piece_moved: (e: MoveResult) => void;
  // A held turn passed by Skip: no piece moved, the turn advanced, and the engine
  // names the seat that takes over.
  turn_skipped: (e: { gameId: string; currentTurn: PlayerColor }) => void;
  clash_start: (e: ClashStartEvent) => void;
  clash_phase: (e: { phase: ClashPhase; countdownDeadline: number; pressDeadline: number }) => void;
  clash_press: (e: { color: PlayerColor; presses: number }) => void;
  clash_result: (e: {
    cardId?: string;
    winner: PlayerColor;
    loser: PlayerColor;
    winnerPresses: number;
    loserPresses: number;
    round?: number;
    totalRounds?: number;
    resultCardUntil?: number;
    continues?: boolean;
    defenderPieceId?: string;
    remainingDefenderIds?: string[];
  }) => void;
  // The result card's hold: every participating client reported how long its card
  // runs, so the engine fixed the freeze at the shortened deadline. The card itself
  // stays the client's own presentation clock.
  clash_card_released: (e: { gameId: string; resultCardUntil: number }) => void;
  game_started: (e: { gameId: string }) => void;
  game_ended: (e: { winner: PlayerColor; resultDetail: string }) => void;
  player_exited: (e: { color: PlayerColor }) => void;
  player_aborted: (e: { color: PlayerColor; username: string }) => void;
  player_disconnected: (e: { color: PlayerColor }) => void;
  player_reconnected: (e: { color: PlayerColor; displayName?: string }) => void;
  // Sent to a single socket whose join was refused because the grace window had
  // already expired: the seat is gone for good, so that client must leave.
  seat_expired: (e: { gameId: string; color: PlayerColor }) => void;
  lobby_update: (e: {
    players: Array<{ username: string; color: PlayerColor; ready: boolean }>;
  }) => void;
  game_timeout: () => void;
  game_expired: () => void;
  state_update: (payload: GameState) => void;
  // Host flipped the room rules while the room is still waiting. Carries what
  // the engine actually persisted, not what the caller asked for.
  modifiers_updated: (e: RoomRules) => void;
  error: (msg: string) => void;
};

export type ClientEvents = {
  join_game: (gameId: string, color: PlayerColor, userId?: string, displayName?: string) => void;
  roll_dice: () => void;
  move_piece: (pieceId: string) => void;
  // Decline the armed Barrier Buster exit that is holding the turn: the token
  // stays in hand, the dice are spent and the turn passes.
  skip_bust: () => void;
  // One press of this player's clash key. The server proves ownership and
  // applies the press cap; a decoy (touch pad) press is discarded there.
  clash_input: (key: string, count?: number) => void;
  // The Barrier Buster arm switch (clash mode only). The engine owns the flag:
  // armed means this seat may break a wall this turn, and every wall landing
  // spends one token.
  arm_barrier: (armed: boolean) => void;
  // The result-card release handshake: how long this client's own card will run
  // (its forecast, not a state change). `cardId` is the id the engine put on the
  // `clash_result` frame this receipt belongs to.
  clash_card_hold: (cardId: string, holdMs: number) => void;
  player_ready: () => void;
  select_color: (color: PlayerColor) => void;
  update_modifiers: (rules: RoomRules) => void;
  leave_game: () => void;
  end_game: () => void;
};

// Always connects to the page's own origin: nginx (or, in dev, the Vite
// proxy) forwards /socket.io/ to the engine, so the browser never needs to
// know its real hostname/port. See nginx/conf/nginx.conf and vite.config.ts.
export function connectSocket(token: string): Socket<ServerEvents, ClientEvents> {
  return io(window.location.origin, {
    auth: { token },
    transports: ['websocket'],
    reconnectionAttempts: 5,
  });
}
