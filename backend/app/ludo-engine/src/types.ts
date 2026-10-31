export type PlayerColor = 'red' | 'green' | 'yellow' | 'blue';
export type PlayerStatus = 'active' | 'exited' | 'inactive' | 'disconnected';
// Why a seat left. `waiting_leave` is reversible and keeps the seat; the other
// reasons mark it exited. It lives beside the seat because finalizeDeparture
// persists it there.
export type DepartureReason =
  | 'timeout' // grace window expired
  | 'leave' // left a live game (socket leave_game, a tab-close prune, or a sign-out)
  | 'end_game' // End Game button: frees the seat
  | 'waiting_leave'; // left a waiting room: reversible, keeps the seat
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

// One line of the game's narrative, stored in the state so a rejoin rebuilds the
// recon panel from the snapshot. Semantic, never rendered text: colours and values
// only, so each client paints the line in whatever language it holds when it renders.
export type LogKind =
  | 'roll' // a seat rolled the die
  | 'thirdSixForfeit' // the third 6 in a row forfeited the turn
  | 'capturedPiece' // a landing sent one or more defenders home
  | 'failcapturePiece' // a clash lost: the attacker went home instead
  | 'wallBrokenBonusRoll' // the landing broke a wall and won the re-roll
  | 'wallAttackFailed' // a clash lost against a wall
  | 'bonusRollAgain' // a capture grants the same seat another roll
  | 'bustSkipped' // the armed Wall Breaker exit was declined
  | 'playerAborted'; // a seat aborted the game

export interface LogEntry {
  kind: LogKind;
  at: number; // engine clock (ms), so lines that share a ply still order
  color: PlayerColor; // the seat the line is about; the panel's dot colour
  value?: number; // roll: the face
  bonus?: boolean; // roll: the roll carried a bonus re-roll
  victim?: PlayerColor; // capture/repulse: the defender's colour
  wall?: boolean; // capture: the landing square stood two or more defenders
}

// The log is a panel, not an audit trail: it keeps the newest entries and drops the
// rest, so a long game cannot grow the state snapshot without bound.
export const LOG_CAP = 30;

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
  // The face this seat's die last landed on, stamped by the true roller in rollDice.
  // A rejoining client renders the seat's MiniDie from it instead of guessing the
  // roller from currentTurn. Absent on a state written before the field existed.
  lastRoll?: number | null;
  isFinished: boolean; // all four pieces home
  finishedAt?: string; // ISO time of finishing
  // Why this seat left, written by finalizeDeparture on the live-game paths. The
  // client labels the seat from it ("Aborted" for a leave); a reloaded client reads
  // it back from the state. Absent while the seat is still in the game, and on the
  // reversible waiting-room leave.
  departedReason?: DepartureReason;
  stats: {
    // per-game tallies for postgame scoring
    turns: number;
    captures: number;
    piecesInGoal: number;
    // clash QTE tallies: drives the two clash achievements
    clashDefends: number;
    clashAttacksWon: number;
    // Wall Breaker tallies: a clash won on a landing that stood a barrier
    // (drives achTearDownThisWall). Absent on a state written before the token
    // existed.
    barrierBreaks: number;
  };
  // Wall Breaker arm switch, clash mode only. While on, this seat may attack a wall
  // and every such landing spends a token; while off the wall blocks. Never settable
  // with an empty hand, and cleared when the turn leaves. Absent reads as off.
  barrierArmed?: boolean;
  // Wall Breaker tokens in hand: STARTING_BUSTER_TOKENS at game start, one spent
  // per token-bought exit, one earned per clash won against exactly one defender
  // (see BARRIER_BUSTER_TOKEN_CAP). Absent reads as 0.
  barrierTokens?: number;
}

// One live clash QTE. Deadlines are absolute, so a restarted engine can re-arm
// the exact phase timers from what Redis holds.
export interface ClashState {
  attacker: PlayerColor;
  defender: PlayerColor;
  // The round's OPENING letter per side. A room with the mutator off (the default)
  // has nothing else, so these stay the whole story there; a room with it on also
  // carries `attackerKeys` / `defenderKeys`, whose element 0 is these.
  attackerKey: string; // key the attacker must mash
  defenderKey: string; // key the defender must mash
  // Key-shift mutator: one schedule per side, drawn at clash start (one letter, plus
  // one per switch). Element i replaces element i-1 at `switchAt[i-1]`; the letters
  // are distinct, so a switch never re-shows the letter already on screen. Absent on
  // a room with the mutator off, which reads as the opening letter alone.
  attackerKeys?: string[];
  defenderKeys?: string[];
  // The switch instants, absolute on the engine clock, first one at
  // countdownDeadline + 2000..2500 and each next 800..1100 after the one before.
  // Length equals the room's switch count (0, 1 or 2).
  switchAt?: number[];
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
  // Clash chains: a wall of N defenders costs N rounds, one per defender. `round` is
  // the round in progress and `totalRounds` the wall size when the attack began. A
  // single defender is the R = 1 case, not a second path.
  round?: number;
  totalRounds?: number;
}

// The Wall Breaker hand starts here: every seat is dealt this many tokens. A token
// buys one landing on a barrier the roll reaches exactly.
export const STARTING_BUSTER_TOKENS = 1;

// The hand is capped here: the seed is one and a clash won against one defender pays
// one back, so a seat banks at most three attempts. A won barrier never pays, so a
// wall cannot feed the token that breaks walls.
export const BARRIER_BUSTER_TOKEN_CAP = 3;

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
  // Chain ledger. `remainingDefenderIds` holds every defender still standing and
  // `beatenDefenderIds` the ones already sent home, so the final apply needs no
  // re-derivation. The ledger is persisted with the state, so a restart replays it.
  round?: number;
  totalRounds?: number;
  remainingDefenderIds?: PieceId[];
  beatenDefenderIds?: PieceId[];
  // 1 when the landing square stood 2 or more defenders, else 0. Stamped at move time
  // because the wall is gone once the chain resolves; a won chain credits that many
  // barrierBreaks. A lone defender pays nothing.
  barrierBattles?: number;
  // The key-shift seam: the letter each seat ended its last round on. Round n+1 of a
  // chain opens on a different letter per seat, so the seam between two rounds is
  // visibly a new letter rather than looking like no switch at all. Optional because
  // a record written before the mutator existed (or by a room with it off) has none;
  // the draw then falls back to an unconstrained pick.
  lastKeys?: Partial<Record<PlayerColor, string>>;
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

// The four room rules as one object, in both directions of the wire: the host's
// rules panel sends them and `modifiers_updated` broadcasts them, in the shape the
// create body, match hash and full `state_update` all carry.
export type RoomRules = {
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
  // Key-shift mutator: how many times the required letter changes mid-clash (0, 1
  // or 2). Clamped at every boundary and forced to 0 whenever `clashEnabled` is
  // false, so "the mutator is on but clash is off" cannot be stored or read.
  clashKeyShift: 0 | 1 | 2;
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
  // The four room rules, frozen when the room is created (lobby.ts can still
  // change them while it is WAITING), all phrased so that false is the standard
  // game: clash in the QTE, star squares protecting, prison exits needing a 6.
  clashMode: boolean; // clash minigame on (false: capture applies immediately)
  noSafeZones: boolean; // true: hardcore mod, star squares capture-immune no more
  freeExit: boolean; // true: any roll leaves prison, and the first step out counts as part of the roll (exit lands on the roll)
  // Key-shift mutator: 0, 1 or 2 switches of the required letter per clash. Always 0
  // while clash mode is off, and the default for a state written before it existed.
  clashKeyShift: 0 | 1 | 2;
  pendingCapture?: PendingCapture; // capture held until the clash resolves
  resultCardUntil?: number; // input freeze while the clash result card shows
  // The narrative the recon panel renders: the newest LOG_CAP lines, written by the
  // engine at the same sites that emit the frames, so a reload, a rejoin, a second tab
  // or an engine restart rebuilds the panel from the snapshot. Absent on a state
  // written before the log existed.
  log?: LogEntry[];
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
  // Set on a move that came out of a clash: the loser's colour (the defender's, whatever
  // the outcome) and how many defenders the landing stood. The repulse case needs both
  // because capturedPieceIds then holds the ATTACKER's own id, so the victim colour
  // cannot be read from it. `wallBroken` is true when the attack beat two or more.
  defenderColor?: PlayerColor;
  defenderCount?: number;
  wallBroken?: boolean;
}

// A move the current player is allowed to make after a roll.
export interface LegalMove {
  pieceId: PieceId; // piece to move
  from: number; // current step
  to: number; // destination step
  isCapture: boolean; // destination holds an opponent piece
  isHomeEntry: boolean; // move enters the home stretch (52)
  // How many defenders the capture sends home: 1 for a single piece, the barrier size
  // (2-4) for a breakable barrier, 0 when nothing is captured. It is also the clash
  // rounds the move costs. The bot ranks by it and the client labels "x N" from it.
  captureCount: number;
  // True on the Wall Breaker variant of a prison exit: the move costs one token and
  // lands on the barrier the roll reaches exactly, never a crossing. A piece is offered
  // at most one exit per roll. The engine keys the debit off this flag.
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
      // The seat that rolled. The engine advances the turn before emitting on a
      // no-move roll or the third-six forfeit, so a client cannot read it off
      // currentTurn; this is the truth the seat's die face is written from.
      color: PlayerColor;
      value: number;
      legalMoves: LegalMove[];
      bonusRoll: boolean;
      currentTurn: PlayerColor;
      forfeited?: boolean;
      // The lines this roll added to the log, so a live client never re-derives them.
      log?: LogEntry[];
    }
  | { type: 'piece_moved'; gameId: string; result: MoveResult; log?: LogEntry[] }
  // A held turn passed without a move: the armed exit was declined (Skip), so no
  // token was spent and the turn moves on. Carries the seat that takes over.
  | { type: 'turn_skipped'; gameId: string; currentTurn: PlayerColor; log?: LogEntry[] }
  // The result card's hold ended: every participating client reported it was done, so
  // the engine shortened `resultCardUntil`. Clients clear the live clash on this frame;
  // the card itself is their own presentation clock.
  | { type: 'clash_card_released'; gameId: string; resultCardUntil: number }
  | { type: 'game_ended'; gameId: string; winner: PlayerColor; resultDetail: string }
  | { type: 'game_started'; gameId: string }
  | { type: 'game_expired'; gameId: string }
  | { type: 'player_exited'; gameId: string; color: PlayerColor }
  | { type: 'player_aborted'; gameId: string; color: PlayerColor; username: string; log?: LogEntry[] }
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
      // Key-shift schedules: one letter per side plus one per switch, and the absolute
      // instants the letters change. Both sides travel on the one frame the room
      // already received (a hotseat socket owns both seats and needs both); the client
      // renders its own seat's schedule. Empty arrays on a room with the mutator off,
      // so the frame's field set is constant.
      attackerKeys: string[];
      defenderKeys: string[];
      switchAt: number[];
      keyShift: 0 | 1 | 2;
      // The engine clock at the instant the frame was built. The overlay derives one
      // offset per clash from it and schedules the switches on the SERVER clock, so a
      // skewed client does not flip early and show a letter the server is not yet
      // accepting. It never gates a press: `recordPress` judges on the server clock.
      serverNow: number;
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
      // Who attacked, independent of who won this round: it is what the client's
      // result FX is picked from (a won single round, a won chain round, a broken
      // wall, or the attacker behind the shield), so the card never has to infer it.
      attacker: PlayerColor;
      winner: PlayerColor;
      loser: PlayerColor;
      winnerPresses: number;
      loserPresses: number;
      // Chain fields. A chain reuses this frame for every round: `continues` says
      // whether the square still holds defenders, `defenderPieceId` the defender that
      // lost, and `remainingDefenderIds` the defenders left standing after it.
      round?: number;
      // The result card's identity for the release handshake: "attacker-defender-
      // moveCounter" (`blue-red-41`). A client echoes it back and a receipt for any
      // other card is dropped. Absent leaves the ceiling in charge.
      cardId?: string;
      totalRounds?: number;
      // The result card's deadline on the engine clock. The socket layer times a
      // bot's resume from THIS instead of a second fixed guard, so a card with no
      // human on it (the short ceiling) does not leave the bot waiting 4 s.
      resultCardUntil?: number;
      continues?: boolean;
      defenderPieceId?: PieceId;
      remainingDefenderIds?: PieceId[];
    }
  // Host changed the room rules while the room was still waiting. One object in,
  // one object out: the same four fields the panel sent, carrying what was
  // actually persisted, so the waiting room mirrors the room and never guesses.
  | {
      type: 'modifiers_updated';
      gameId: string;
      clashEnabled: boolean;
      noSafeZones: boolean;
      freeExit: boolean;
      clashKeyShift: 0 | 1 | 2;
    };
