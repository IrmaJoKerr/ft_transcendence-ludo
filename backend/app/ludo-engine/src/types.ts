export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';
export type PlayerStatus = 'active' | 'exited' | 'resigned' | 'inactive' | 'disconnected';
export type TurnPhase = 'WAITING_FOR_ROLL' | 'WAITING_FOR_MOVE';
export type ClashPhase = 'announce' | 'countdown' | 'pressing';

export type PieceId = string; // Format: "{color}-{index}" e.g., "red-0", "blue-3"

// One board piece: position is encoded in `step`.
export interface Piece {
  id: PieceId;
  color: PlayerColor;
  step: number; // -1=exited, 0=prison, 1-51=track, 52-56=home, 57=goal
  isInGoal?: boolean; // frontend-compatible: true when step === 57
  isInBase?: boolean; // frontend-compatible: true when step <= 0
}

// Per-seat metadata for one player (human or bot) in a game.
export interface PlayerMeta {
  color: PlayerColor; // seat color
  status: PlayerStatus; // active/exited/resigned/inactive/disconnected
  username: string; // immutable account name (bots: bot-<color>)
  displayName?: string; // shown name
  isBot: boolean; // AI seat flag
  isConnected: boolean; // socket currently attached
  // Immutable account id, so this seat's avatar can be keyed on something a
  // rename cannot invalidate. Absent for bots and hotseat's local seats.
  userId?: string;
  // Avatar facts read from the backend's Redis cache at join time (the engine
  // has no database access). False when there is no photo, so the client can
  // skip a request that would 404. See docs/avatar-system.md.
  hasAvatarPhoto: boolean;
  avatarStyle?: string; // dicebear style used when there is no photo
  piecesInGoal: number; // pieces that reached the goal
  hasRolled: boolean; // rolled in the current turn phase
  consecutiveSixes: number; // 6-streak for the forfeit rule
  bonusRoll: boolean; // extra roll granted (6/capture)
  isFinished: boolean; // all four pieces home
  finishedAt?: string; // ISO time of finishing
  stats: {
    // per-game tallies for postgame scoring
    turns: number;
    captures: number;
    piecesInGoal: number;
    clashDefends: number;
    clashAttacksWon: number;
  };
}

// Server-side state of one clash QTE round (the pressing minigame).
export interface ClashState {
  attacker: PlayerColor;
  defender: PlayerColor;
  attackerKey: string;
  defenderKey: string;
  target: number;
  duration: number; // press window seconds (CLASH_PRESS_MS / 1000)
  startedAt: number;
  announceDeadline: number;
  countdownDeadline: number;
  pressDeadline: number;
  phase: ClashPhase;
  attackerPresses: number;
  defenderPresses: number;
  lastPressAt?: Partial<Record<PlayerColor, number>>;
}

// A deferred capture awaiting the clash QTE outcome.
export interface PendingCapture {
  pieceId: PieceId;
  from: number;
  to: number;
  diceValue: number;
  attacker: PlayerColor;
  defender: PlayerColor;
  capturedPieceIds: PieceId[];
  enteredHome: boolean;
}

export interface DisconnectState {
  color: PlayerColor;
  disconnectedAt: number;
  reconnectDeadline: number;
}

// The complete server-side state of one Ludo game, persisted to Redis.
export interface GameState {
  id: string; // game id (matches match:<id> in backend Redis)
  pieces: Piece[]; // 16 pieces: 4 per player × 4 players
  players: PlayerMeta[]; // seat metadata for all four colors
  currentTurn: PlayerColor; // whose turn it is
  consecutiveSixes: number; // sixes rolled in the current player's streak
  moveCounter: number; // Total moves made in the game
  turnPhase: TurnPhase; // roll or move expected next
  firstRollOfTurn: boolean; // True until the six-bonus has been used once during the current player's turn-holding streak
  pendingLegalMoves: LegalMove[]; // Server-authoritative legal moves after roll
  pendingDiceValue?: number; // The dice value from the most recent roll (server-authoritative)
  pendingIsFirstRoll?: boolean; // Whether pendingDiceValue came from the first roll of the turn (server-authoritative)
  disconnectedPlayers: DisconnectState[]; // Players temporarily disconnected (grace period)
  status: 'waiting' | 'active' | 'finished';
  winner?: PlayerColor;
  resultDetail?: string; // why the game ended (e.g. four_pieces, resign)
  resultSubmitted?: boolean; // Prevents duplicate backend submissions
  botBusy?: boolean; // Prevents overlapping bot turns
  clash?: ClashState; // Active clash QTE round, if any
  clashMode: boolean; // Whether clash minigame is enabled (false = standard capture)
  safeZones: boolean; // Whether safe/star squares are capture-immune (false = hardcore mod)
  readyPlayers: PlayerColor[]; // Players who have clicked "ready"
  pendingCapture?: PendingCapture; // Move deferred until the clash QTE resolves
  resultCardUntil?: number; // Server-side input freeze after a clash result card
  paused?: boolean; // game paused (e.g. disconnect grace period)
  pauseTurnOwner?: PlayerColor; // whose turn it was when paused
}

// The outcome of one applied move, recorded in history and broadcast to clients.
export interface MoveResult {
  ply: number; // 1-based move number within the game
  color: PlayerColor; // mover
  diceValue: number; // roll used for this move
  pieceId: PieceId; // which piece moved
  from: number; // starting step
  path: number[]; // Every intermediate step from `from`+1 through `to`, for step-by-step movement on the frontend
  to: number; // final step
  captured: boolean; // landed on an opponent piece
  capturedPieceIds?: PieceId[]; // Every opponent piece sent home from the landing square (a stacked block sends all of them back)
  enteredHome: boolean; // moved into the home stretch
  bonusRoll: boolean; // mover rolls again
  clashOutcome?: 'attacker_won' | 'defender_won';
}

// A move the current player is allowed to make after a roll.
export interface LegalMove {
  pieceId: PieceId; // piece to move
  from: number; // current step
  to: number; // destination step
  isCapture: boolean; // destination holds an opponent piece
  isHomeEntry: boolean; // move enters the home stretch (52)
}

export interface MovePieceOutput {
  result: MoveResult;
  state: GameState;
}

// Events emitted by the engine, the only place that detects game lifecycle changes.
export type GameEvent =
  | {
      type: 'dice_rolled';
      gameId: string;
      value: number;
      legalMoves: LegalMove[];
      bonusRoll: boolean;
      currentTurn: PlayerColor;
      forfeited?: boolean;
    }
  | { type: 'piece_moved'; gameId: string; result: MoveResult }
  | { type: 'game_ended'; gameId: string; winner: PlayerColor; resultDetail: string }
  | { type: 'game_started'; gameId: string }
  | { type: 'player_exited'; gameId: string; color: PlayerColor }
  | { type: 'player_resigned'; gameId: string; color: PlayerColor }
  | { type: 'player_aborted'; gameId: string; color: PlayerColor; username: string }
  | { type: 'player_disconnected'; gameId: string; color: PlayerColor }
  | { type: 'player_reconnected'; gameId: string; color: PlayerColor }
  | { type: 'color_selected'; gameId: string; userId: string; color: PlayerColor }
  | { type: 'clash_start'; gameId: string; attackerKey: string; defenderKey: string; target: number; duration: number; attacker: PlayerColor; defender: PlayerColor; phase: ClashPhase; startAt: number; announceDeadline: number; countdownDeadline: number; pressDeadline: number; attackerPresses: number; defenderPresses: number }
  | { type: 'clash_phase'; gameId: string; phase: ClashPhase; countdownDeadline: number; pressDeadline: number }
  | { type: 'clash_press'; gameId: string; color: PlayerColor; presses: number }
  | { type: 'clash_result'; gameId: string; winner: PlayerColor; loser: PlayerColor; winnerPresses: number; loserPresses: number }
  | { type: 'modifiers_updated'; gameId: string; clashEnabled: boolean; safeZones: boolean }
  | {
      type: 'lobby_update';
      gameId: string;
      players: {
        userId: string;
        username: string;
        avatarStyle: string;
        color: PlayerColor;
        ready: boolean;
      }[];
    };
