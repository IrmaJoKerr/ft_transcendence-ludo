// Mirror of the ludo-engine TypeScript types; the engine defines them, this copy
// matches. Terminal seats are 'exited' only.

export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';
export type PlayerStatus = 'active' | 'exited' | 'inactive' | 'disconnected';
export type TurnPhase = 'WAITING_FOR_ROLL' | 'WAITING_FOR_MOVE';
export type PieceId = string;
// Clash QTE phases: announce flash, 3-2-1 countdown, then the press race.
export type ClashPhase = 'announce' | 'countdown' | 'pressing';

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
  // Barrier Buster tokens this seat still holds, dealt at game start
  // (STARTING_BUSTER_TOKENS). Display only: the engine owns the counter and re-reads
  // the field when a move spends one; the board never decides it.
  barrierTokens?: number;
  // The Barrier Buster arm switch, mirrored from the engine (clash mode only):
  // armed means this seat may break a wall this turn (1 token per wall), disarmed
  // means a wall blocks the landing. Server-owned; the UI renders it.
  barrierArmed?: boolean;
}

export interface LegalMove {
  pieceId: PieceId;
  from: number;
  to: number;
  isCapture: boolean;
  isHomeEntry: boolean;
  // Defenders the move would fight: 1 for a single one, R for a stacked square
  // (an attack on a wall costs R clash rounds), 0 for a plain move. The board's
  // ×R badge reads it, so the price of an attack is visible before the click.
  captureCount?: number;
  // The Barrier Buster variant of a prison exit: one token, landing on the barrier
  // the roll reaches exactly. The player arms it explicitly, and a piece carries at
  // most one exit, so a click names the piece alone.
  spendsBarrierToken?: boolean;
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
  // Set only on a move that came out of a clash: who won the press race.
  clashOutcome?: 'attacker_won' | 'defender_won';
}

// One live clash QTE. Deadlines are absolute (server timestamps), which is what
// lets the overlay derive every phase from `announceDeadline` /
// `countdownDeadline` / `pressDeadline` instead of counting locally.
export interface ClashState {
  attacker: PlayerColor;
  defender: PlayerColor;
  attackerKey: string; // the key the attacker must mash
  defenderKey: string; // the key the defender must mash
  target: number; // presses needed to win
  duration: number; // press window in seconds
  startedAt: number;
  announceDeadline: number;
  countdownDeadline: number;
  pressDeadline: number;
  phase: ClashPhase;
  attackerPresses: number;
  defenderPresses: number;
  lastPressAt?: Partial<Record<PlayerColor, number>>; // press cap per side
  // Clash CHAINS (a stacked square): declared optional on day one so the chain
  // (Pass 5) is a change of behaviour, not a reopening of the render path.
  // Absent or 1 on a single-defender clash.
  round?: number;
  totalRounds?: number;
}

// A capture deferred until its clash resolves: the move is held here instead of
// being applied at move time, so a repelled attack can send the mover home.
export interface PendingCapture {
  pieceId: PieceId;
  from: number;
  to: number;
  diceValue: number;
  attacker: PlayerColor;
  defender: PlayerColor;
  capturedPieceIds: PieceId[];
  enteredHome: boolean;
  // Chain ledger, optional for the same reason as ClashState's round fields.
  round?: number;
  totalRounds?: number;
  remainingDefenderIds?: PieceId[];
  beatenDefenderIds?: PieceId[];
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
  readyPlayers: PlayerColor[];
  paused?: boolean;
  pauseTurnOwner?: PlayerColor;
  pausedReason?: string;
  clash?: ClashState; // live clash QTE, absent when none is running
  clashMode: boolean; // clash minigame on (false: capture applies immediately)
  // Safe zones, stored inverted so the three room rules are uniform (false = the
  // variant is off). A standard room is false/false/false, and an absent key reads
  // as false: safe zones on.
  noSafeZones: boolean; // star squares capture-immune when false
  freeExit?: boolean; // any roll leaves prison (absent reads as false)
  pendingCapture?: PendingCapture; // capture held until its clash resolves
  resultCardUntil?: number; // engine timestamp: input freeze while the card shows
}
