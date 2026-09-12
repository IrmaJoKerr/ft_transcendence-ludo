// Mirror of the ludo-engine TypeScript types; the engine defines them, this copy matches.

export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';
export type PlayerStatus = 'active' | 'exited' | 'inactive' | 'disconnected';
export type TurnPhase = 'WAITING_FOR_ROLL' | 'WAITING_FOR_MOVE';
export type ClashPhase = 'announce' | 'countdown' | 'pressing';
export type PieceId = string;

export interface Piece {
  id: PieceId;
  color: PlayerColor;
  step: number;
  isInGoal: boolean;
  isInBase: boolean;
}

export interface PlayerMeta {
  color: PlayerColor;
  status: PlayerStatus;
  username: string;
  displayName?: string;
  // Immutable account id + avatar facts. The engine fills these from the
  // backend's Redis cache at join time; they are absent for bots and hotseat's
  // local seats, which have no account and therefore no photo.
  userId?: string;
  hasAvatarPhoto?: boolean;
  avatarStyle?: string | null;
  isBot: boolean;
  isConnected: boolean;
  pieces: Piece[];
  piecesInGoal: number;
  hasRolled: boolean;
  consecutiveSixes: number;
  bonusRoll: boolean;
  isFinished: boolean;
  finishedAt?: string;
}

export interface LegalMove {
  pieceId: PieceId;
  from: number;
  to: number;
  isCapture: boolean;
  isHomeEntry: boolean;
}

export interface MoveResult {
  ply: number;
  color: PlayerColor;
  diceValue: number;
  pieceId: PieceId;
  from: number;
  path: number[];
  to: number;
  captured: boolean;
  capturedPieceIds?: PieceId[];
  enteredHome: boolean;
  bonusRoll: boolean;
  clashOutcome?: 'attacker_won' | 'defender_won';
}

// Mirror of the engine's ClashState: one clash QTE round (pressing duel).
export interface ClashState {
  attacker: PlayerColor;
  defender: PlayerColor;
  attackerKey: string;
  defenderKey: string;
  /** Presses needed to win — sent by the engine (CLASH_TARGET); the bars are
   *  sized from this, so the client never hardcodes a press count. */
  target: number;
  duration: number;
  startedAt: number;
  announceDeadline: number;
  countdownDeadline: number;
  pressDeadline: number;
  phase: ClashPhase;
  attackerPresses: number;
  defenderPresses: number;
  /** Result-card length in ms (engine CLASH_RESULT_MS): the overlay's
   *  auto-dismiss timer, always shorter than the server's post-clash freeze. */
  resultMs: number;
  disconnectTimestamp?: number;
  reconnectDeadline?: number;
  waitingForReconnect?: PlayerColor;
}

export interface DisconnectState {
  color: PlayerColor;
  disconnectedAt: number;
  reconnectDeadline: number;
}

export interface GameState {
  id: string;
  pieces: Piece[];
  players: PlayerMeta[];
  currentTurn: PlayerColor;
  consecutiveSixes: number;
  moveCounter: number;
  turnPhase: TurnPhase;
  pendingLegalMoves: LegalMove[];
  pendingDiceValue?: number;
  disconnectedPlayers: DisconnectState[];
  status: 'waiting' | 'active' | 'finished';
  winner?: PlayerColor;
  resultDetail?: string;
  resultSubmitted?: boolean;
  botBusy?: boolean;
  clash?: ClashState;
  clashMode: boolean;
  readyPlayers: PlayerColor[];
  resultCardUntil?: number;
  safeZones?: boolean;
}
