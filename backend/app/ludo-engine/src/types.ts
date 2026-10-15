export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';
export type PlayerStatus = 'active' | 'exited' | 'inactive' | 'disconnected';
export type TurnPhase = 'WAITING_FOR_ROLL' | 'WAITING_FOR_MOVE';
// Clash QTE phases: flash, 3-2-1 countdown, then the press race.
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
  status: PlayerStatus; // active/exited/inactive/disconnected
  username: string; // immutable account name (bots: bot-<color>)
  displayName?: string; // shown name
  isBot: boolean; // AI seat flag
  isConnected: boolean; // socket currently attached
  // Immutable account id, so this seat's avatar can be keyed on something a
  // rename cannot invalidate. Absent for bots and hotseat's local seats.
  userId?: string;
  // Avatar facts read from the backend's Redis cache at join time (the engine
  // has no database access). False when there is no photo, so the client can
  // skip a request that would 404.
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
    // clash QTE tallies: drives the two clash achievements
    clashDefends: number;
    clashAttacksWon: number;
    // Barrier Buster tallies: a clash won on a token-bought exit walk (drives
    // achTearDownThisWall). Absent on a state written before the token existed.
    barrierBreaks: number;
  };
  // Barrier Buster tokens in hand for this seat: one is dealt at game start, and
  // one is spent per token-bought exit walk. Optional so a state written before
  // the token existed reads as 0 (spend nothing, offer nothing).
  barrierTokens?: number;
}

// One live clash QTE. Deadlines are absolute, so a restarted engine can re-arm
// the exact phase timers from what Redis holds.
export interface ClashState {
  attacker: PlayerColor;
  defender: PlayerColor;
  attackerKey: string; // key the attacker must mash
  defenderKey: string; // key the defender must mash
  target: number; // presses needed to win
  duration: number; // press window seconds (CLASH_PRESS_MS / 1000)
  startedAt: number;
  announceDeadline: number;
  countdownDeadline: number;
  pressDeadline: number;
  phase: ClashPhase;
  attackerPresses: number;
  defenderPresses: number;
  lastPressAt?: Partial<Record<PlayerColor, number>>; // press-cap per side
  // Clash CHAINS: a wall of N defenders costs N rounds, one defender per round.
  // `round` is the round in progress (1-based) and `totalRounds` the size of the
  // wall as stamped when the attack began. Both are 1 (or absent, on a state
  // written before the chain existed) for a single-defender clash: the chain is
  // the R = 1 case of the same shape, never a second code path.
  round?: number;
  totalRounds?: number;
}

// One battle of a deferred move: the square it is fought on and the defenders
// standing there, in the order they will be fought. A normal capture is one
// battle; an armed exit walk that crosses a barrier and then lands on a defender
// is two, in path order, and the move is applied only after the last of them.
export interface BattlePlan {
  step: number;
  defenderIds: PieceId[];
}

// A capture deferred until the clash resolves: the move is held here instead of
// being applied at move time.
export interface PendingCapture {
  pieceId: PieceId;
  from: number;
  to: number;
  diceValue: number;
  attacker: PlayerColor;
  defender: PlayerColor;
  capturedPieceIds: PieceId[];
  enteredHome: boolean;
  // Chain ledger. `remainingDefenderIds` holds every defender still standing (the
  // round's defender first) and `beatenDefenderIds` the ones already sent home by
  // earlier rounds, so the final application can send the whole ledger home without
  // re-deriving it from the board. `round` is the round in progress, `totalRounds`
  // the defender count stamped at move time.
  //
  // The ledger is PATH-ORDERED and spans the whole move: for a single landing it is
  // that square's stack, and for an armed exit walk that crosses a barrier before
  // landing it is both battles flattened in path order. That is what lets one
  // chain run a two-square walk with one round per defending piece, and it is
  // persisted with the state, so a restart replays the walk exactly where it
  // stopped.
  round?: number;
  totalRounds?: number;
  remainingDefenderIds?: PieceId[];
  beatenDefenderIds?: PieceId[];
  // The move's battles that stood 2 or more defenders, stamped at move time: a
  // won chain credits that many barrierBreaks to the attacker (achTearDownThisWall).
  // A lone defender is 0, a landing on a 2-stack is 1, an armed walk over a wall is
  // 1 whatever the wall's size.
  barrierBattles?: number;
}

// What one round of a chain needs beyond the two colours: which round it is, how
// many rounds the attack takes, and who is standing in this round. Absent on a
// single-defender clash, which reads as { round: 1, totalRounds: 1 }.
export type ChainRound = {
  round: number;
  totalRounds: number;
  defenderPieceId?: PieceId;
  remainingDefenderIds?: PieceId[];
};

export interface DisconnectState {
  color: PlayerColor;
  disconnectedAt: number;
  reconnectDeadline: number;
}

// The three room rules as ONE object, in both directions of the wire: the host's
// rules panel sends them and `modifiers_updated` broadcasts them, in the same
// shape the create body carries, the match hash stores and a full `state_update`
// carries. A fourth rule is a field here, not a fifth positional boolean at the
// four call sites that would each have to agree on it.
export type RoomRules = {
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
};

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
  resultDetail?: string; // why the game ended (e.g. four_pieces)
  resultSubmitted?: boolean; // Prevents duplicate backend submissions
  botBusy?: boolean; // Prevents overlapping bot turns
  readyPlayers: PlayerColor[]; // Players who have clicked "ready"
  paused?: boolean; // game paused (e.g. disconnect grace period)
  pauseTurnOwner?: PlayerColor; // whose turn it was when paused
  pausedReason?: string; // rationale for the pause (e.g. 'disconnect_grace')
  clash?: ClashState; // live clash QTE, absent when none is running
  // The three room rules, frozen when the room is created (lobby.ts can still
  // change them while it is WAITING), all phrased so that false is the standard
  // game: clash in the QTE, star squares protecting, prison exits needing a 6.
  clashMode: boolean; // clash minigame on (false: capture applies immediately)
  noSafeZones: boolean; // true: hardcore mod, star squares capture-immune no more
  freeExit: boolean; // true: any roll leaves prison, and the first step out counts as part of the roll (exit lands on the roll)
  pendingCapture?: PendingCapture; // capture held until the clash resolves
  resultCardUntil?: number; // input freeze while the clash result card shows
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
  // Set only on a move that came out of a clash: who won the press race.
  clashOutcome?: 'attacker_won' | 'defender_won';
}

// A move the current player is allowed to make after a roll.
export interface LegalMove {
  pieceId: PieceId; // piece to move
  from: number; // current step
  to: number; // destination step
  isCapture: boolean; // destination holds an opponent piece
  isHomeEntry: boolean; // move enters the home stretch (52)
  // How many defenders that capture sends home: 1 for a single piece, the wall's
  // size (2-4) when the landing attacks a breakable wall, 0 when nothing is
  // captured at all (a plain move, a shared square). For an ARMED exit, whose walk
  // fights a crossed barrier and then its landing square, it is the TOTAL across
  // those battles, i.e. the number of clash rounds the move costs. The bot ranks a
  // capture by it (each defender is another clash round) and the client labels the
  // clash "x N" from it.
  captureCount: number;
  // The ordered battles of an ARMED exit walk that fights on more than one square
  // (a crossed barrier, then the landing): the engine flattens this list in path
  // order instead of re-deriving a single landing square, and the move is applied
  // only after the last battle. Absent for an ordinary move, whose one battle is
  // read off `to`.
  fights?: BattlePlan[];
  // True on the Barrier Buster variant of an exit: the move costs one token from
  // the mover's hand, waives the exit-roll gate and crosses one barrier. A piece
  // is offered at most ONE exit per roll (see MoveValidator.armedExit, which is
  // reached only when the plain exit is illegal), so a piece never carries two
  // moves the same `pieceId` cannot tell apart; this flag is what the board tags
  // the bay pieces with and what the bot filters the variant by, and `movePiece`'s
  // optional `to` is the disambiguator for a caller that already knows its
  // landing square.
  spendsBarrierToken?: boolean;
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
  | { type: 'game_expired'; gameId: string }
  | { type: 'player_exited'; gameId: string; color: PlayerColor }
  | { type: 'player_aborted'; gameId: string; color: PlayerColor; username: string }
  | { type: 'player_disconnected'; gameId: string; color: PlayerColor }
  | { type: 'player_reconnected'; gameId: string; color: PlayerColor; displayName?: string }
  // Full-state frame: the engine changed something the event-specific payloads
  // do not carry (a prune moves the turn and clears the departed
  // player's pieces). The SPA's reducer merges it field by field.
  | { type: 'state_update'; gameId: string; state: GameState }
  | { type: 'color_selected'; gameId: string; userId: string; color: PlayerColor }
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
    }
  | {
      type: 'clash_start';
      gameId: string;
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
      // Chain fields: which round this is, how many the attack takes, and the
      // defender standing in it. Absent on a single-defender clash.
      round?: number;
      totalRounds?: number;
      defenderPieceId?: PieceId;
      remainingDefenderIds?: PieceId[];
    }
  | {
      type: 'clash_phase';
      gameId: string;
      phase: ClashPhase;
      countdownDeadline: number;
      pressDeadline: number;
    }
  | { type: 'clash_press'; gameId: string; color: PlayerColor; presses: number }
  | {
      type: 'clash_result';
      gameId: string;
      winner: PlayerColor;
      loser: PlayerColor;
      winnerPresses: number;
      loserPresses: number;
      // Chain fields. A chain reuses this frame for every round: `continues` says
      // whether the square still holds defenders, `defenderPieceId` the defender
      // that just lost this round, and `remainingDefenderIds` the defenders left
      // standing AFTER it (what the board re-renders, excluding the beaten one).
      // `continues` false means the move is complete: this frame follows a
      // `piece_moved`, or a repulse, on the round the chain ended.
      round?: number;
      totalRounds?: number;
      continues?: boolean;
      defenderPieceId?: PieceId;
      remainingDefenderIds?: PieceId[];
    }
  // Host changed the room rules while the room was still waiting. One object in,
  // one object out: the same three fields the panel sent, carrying what was
  // actually persisted, so the waiting room mirrors the room and never guesses.
  | {
      type: 'modifiers_updated';
      gameId: string;
      clashEnabled: boolean;
      noSafeZones: boolean;
      freeExit: boolean;
    };
