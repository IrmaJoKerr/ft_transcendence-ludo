import { GameState, PlayerColor, LegalMove, MovePieceOutput, PieceId, GameEvent } from './types';
import { RedisGameStore } from './redis';
import { MoveValidator } from './move-validator';
import { ClashManager } from './clash';
import { ClashEngine } from './clash-engine';
import { applyMoveOutcome } from './turn';
import { advanceTurnInState } from './player-handler';
import {
  handlePlayerDisconnect,
  handlePlayerReconnect,
  handlePlayerReady,
  handlePlayerExit,
} from './player-handler';
import { LobbyManager } from './lobby';

/**
 * LudoEngine is the game-state-machine orchestrator: it owns the game lock,
 * the event stream, and the turn flow; lifecycle, lobby, and clash logic are
 * delegated to player-handler.ts / lobby.ts / clash-engine.ts.
 */
export class LudoEngine {
  private store: RedisGameStore;
  private eventHandler?: (event: GameEvent) => void;
  private clashManager: ClashManager;
  private lobbyManager?: LobbyManager;
  private clashEngine: ClashEngine;
  // Serializes each game's operations so concurrent roll/move/bot actions never lose a move.
  private gameLocks = new Map<string, Promise<unknown>>();

  constructor(store: RedisGameStore, clashManager: ClashManager) {
    this.store = store;
    this.clashManager = clashManager;
    this.clashEngine = new ClashEngine(
      this.store,
      this.clashManager,
      (event) => this.emit(event),
      this.withGameLock.bind(this),
    );
  }

  setLobbyManager(lobbyManager: LobbyManager): void {
    this.lobbyManager = lobbyManager;
  }

  /** Register the single source of truth for lifecycle events : the socket layer must not detect them itself. */
  onEvent(handler: (event: GameEvent) => void): void {
    this.eventHandler = handler;
  }

  private emit(event: GameEvent): void {
    this.eventHandler?.(event);
  }

  /** Public wrapper for emitting engine events (used by socket handlers). */
  emitEvent(event: GameEvent): void {
    this.emit(event);
  }

  /** Serialize a mutating operation per game; the next op starts only after the previous one resolves. */
  private withGameLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.gameLocks.get(gameId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.gameLocks.set(gameId, run.then(() => undefined, () => undefined));
    return run;
  }

  async getGameState(gameId: string): Promise<GameState | null> {
    return await this.store.loadGameState(gameId);
  }

  // Seeded PRNG (mulberry32). Math.random() can't be seeded directly, so every
  // roll re-seeds a fresh generator from a large Math.random() value — giving
  // each die roll its own isolated, uniform 1..6 stream.
  private static seededRand(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Roll for the current player; stores pending moves/dice and auto-advances when there are no legal moves. */
  async rollDice(gameId: string): Promise<{ value: number; legalMoves: LegalMove[]; bonusRoll: boolean }> {
    return this.withGameLock(gameId, async () => {
    const state = await this.store.loadGameState(gameId);
    if (!state || state.status !== 'active') {
      throw new Error('Game not active');
    }

    // Result-card freeze: no input while the 3s clash card is up.
    if (state.resultCardUntil && Date.now() < state.resultCardUntil) {
      console.log(`[clash] ROLL BLOCKED ${gameId} (until ${state.resultCardUntil})`);
      throw new Error('Clash result in progress : wait for the card to clear');
    }

    // Only allow roll during WAITING_FOR_ROLL phase
    if (state.turnPhase !== 'WAITING_FOR_ROLL' && state.turnPhase !== undefined) {
      throw new Error('Invalid turn phase: expected WAITING_FOR_ROLL');
    }

    const currentPlayer = state.players.find(p => p.color === state.currentTurn);
    if (!currentPlayer || currentPlayer.status === 'exited') {
      throw new Error('Current player has exited');
    }

    // Seed a per-roll PRNG stream with a fresh Math.random() scaled to a huge
    // integer range (Math.random() itself cannot be seeded directly). Entropy is
    // capped by Math.random()'s 53-bit output, but the dice stream is now
    // isolated from other Math.random() users in the process.
    const rand = LudoEngine.seededRand(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
    // Single draw from the seeded stream → every face 1..6 is exactly 1/6 (fair
    // die, max entropy ~2.585 bits). No averaging, no middle-face bias.
    const diceValue = Math.floor(rand() * 6) + 1;

    currentPlayer.hasRolled = true;
    // Per-player 6-streak: a third consecutive 6 forfeits the turn; it lives on
    // PlayerMeta so it resets on turn advance and never leaks across players.
    currentPlayer.consecutiveSixes = diceValue === 6 ? currentPlayer.consecutiveSixes + 1 : 0;

    if (diceValue === 6) {
      if (currentPlayer.consecutiveSixes >= 3) {
        currentPlayer.consecutiveSixes = 0;
        currentPlayer.bonusRoll = false;
        state.turnPhase = 'WAITING_FOR_ROLL';
        state.pendingLegalMoves = [];
        state.pendingDiceValue = undefined;
        state.pendingIsFirstRoll = undefined;
        advanceTurnInState(state);
        await this.store.saveGameState(gameId, state);
        this.emit({ type: 'dice_rolled', gameId, value: diceValue, legalMoves: [], bonusRoll: false, currentTurn: state.currentTurn, forfeited: true });
        return { value: diceValue, legalMoves: [], bonusRoll: false };
      }
    }

    const sixBonus = diceValue === 6;
    currentPlayer.bonusRoll = sixBonus;

    const legalMoves = MoveValidator.getLegalMoves(state, state.currentTurn, diceValue);

    // Store authoritative dice value so movePiece() doesn't need to recompute it
    state.pendingDiceValue = diceValue;

    if (legalMoves.length === 0) {
      // No legal moves: auto-advance turn (with bonus roll only on a first-roll 6)
      state.pendingLegalMoves = [];
      if (sixBonus) {
        state.turnPhase = 'WAITING_FOR_ROLL';
      } else {
        state.turnPhase = 'WAITING_FOR_ROLL';
        advanceTurnInState(state);
      }
      await this.store.saveGameState(gameId, state);
      this.emit({ type: 'dice_rolled', gameId, value: diceValue, legalMoves: [], bonusRoll: sixBonus, currentTurn: state.currentTurn });
      return { value: diceValue, legalMoves: [], bonusRoll: sixBonus };
    }

    // Set turn phase and store pending legal moves (server-authoritative)
    state.turnPhase = 'WAITING_FOR_MOVE';
    state.pendingLegalMoves = legalMoves;

    await this.store.saveGameState(gameId, state);

    this.emit({ type: 'dice_rolled', gameId, value: diceValue, legalMoves, bonusRoll: sixBonus, currentTurn: state.currentTurn });
    return { value: diceValue, legalMoves, bonusRoll: sixBonus };
    });
  }

  /** Move a piece against the server-authoritative pending move/dice; returns the result + updated state. */
  async movePiece(gameId: string, pieceId: PieceId): Promise<MovePieceOutput> {
    return this.withGameLock(gameId, async () => {
    const state = await this.store.loadGameState(gameId);
    if (!state || state.status !== 'active') {
      throw new Error('Game not active');
    }

    // Result-card freeze: no input while the 3s clash card is up.
    if (state.resultCardUntil && Date.now() < state.resultCardUntil) {
      console.log(`[clash] MOVE BLOCKED ${gameId} (until ${state.resultCardUntil})`);
      throw new Error('Clash result in progress : wait for the card to clear');
    }

    // Validate: must be in WAITING_FOR_MOVE phase
    if (state.turnPhase !== 'WAITING_FOR_MOVE') {
      throw new Error('Invalid turn phase: expected WAITING_FOR_MOVE');
    }

    // The legal-move snapshot from roll time is the contract : no re-deriving at
    // execution time; a player who disconnected/forfeited since is rejected here.
    const pendingMove = state.pendingLegalMoves.find(m => m.pieceId === pieceId);
    if (!pendingMove) {
      throw new Error('Invalid move: piece not in legal moves');
    }

    // Use the server-authoritative dice value
    const diceValue = state.pendingDiceValue;
    if (diceValue === undefined) {
      throw new Error('No pending dice value : roll first');
    }

    const moverColor = (state.pieces.find(p => p.id === pieceId)?.color) as PlayerColor;

    // Clash gate: capture moves are deferred to the QTE : applied only after it resolves.
    if (state.clashMode && pendingMove.isCapture) {
      // Find the defender via the SHARED track position : per-color step equality is wrong across colors.
      const capturedPieceIds = MoveValidator.findPiecesAtPosition(state, moverColor, pendingMove.to);
      // No defender on the square → fall through to a normal capture move.
      const defenderPiece = state.pieces.find(p => p.id === capturedPieceIds[0]);
      if (defenderPiece) {
        const defenderColor = defenderPiece.color as PlayerColor;

        state.pendingCapture = {
          pieceId,
          from: pendingMove.from,
          to: pendingMove.to,
          diceValue,
          attacker: moverColor,
          defender: defenderColor,
          capturedPieceIds,
          enteredHome: pendingMove.isHomeEntry,
        };
        state.pendingLegalMoves = [];
        state.pendingDiceValue = undefined;
        state.pendingIsFirstRoll = undefined;
        await this.store.saveGameState(gameId, state);

        const attackerIsBot = state.players.find(p => p.color === moverColor)?.isBot ?? false;
        const defenderIsBot = state.players.find(p => p.color === defenderColor)?.isBot ?? false;

        await this.clashEngine.startClash(gameId, moverColor, defenderColor, attackerIsBot, defenderIsBot);

        // Deferred : no piece_moved yet; the clash outcome emits it afterwards.
        return {
          result: {
            ply: state.moveCounter + 1,
            color: moverColor,
            diceValue,
            pieceId,
            from: pendingMove.from,
            path: [],
            to: pendingMove.to,
            captured: true,
            capturedPieceIds: [],
            enteredHome: pendingMove.isHomeEntry,
            bonusRoll: false,
          },
          state,
        };
      }
    }

    // Execute move via MoveValidator (pure game logic)
    const result = MoveValidator.executeMove(state, pendingMove, diceValue);

    // Record move history
    await this.store.recordMove(gameId, {
      ply: result.ply,
      color: result.color,
      diceValue: result.diceValue,
      pieceId: result.pieceId,
      from: result.from,
      to: result.to,
      captured: result.captured,
      enteredHome: result.enteredHome,
      timestamp: Date.now()
    });

    // Apply the move outcome (stats, win check, bonus/turn advance).
    const winner = applyMoveOutcome(state, result, diceValue, true);

    await this.store.saveGameState(gameId, state);

    this.emit({ type: 'piece_moved', gameId, result });
    if (winner) {
      this.emit({ type: 'game_ended', gameId, winner, resultDetail: 'four_pieces' });
    }

    return { result, state };
    });
  }

  // Clash orchestration facades (logic lives in ClashEngine)
  /** Boot-time clash recovery sweep (see clash-engine.ts). */
  startClashRecoverySweep(): void {
    this.clashEngine.startRecoverySweep();
  }

  /** Locked clash press recorder (see clash-engine.ts). */
  async recordClashPress(gameId: string, color: PlayerColor, key?: string, isBot = false): Promise<number> {
    return this.clashEngine.recordClashPress(gameId, color, key, isBot);
  }

  // Player lifecycle handlers (delegated to player-handler.ts)
  async handlePlayerDisconnect(gameId: string, color: PlayerColor, notifyAbort?: (gameId: string) => void): Promise<void> {
    return this.withGameLock(gameId, () => handlePlayerDisconnect(this.store, (e) => this.emit(e), gameId, color, notifyAbort));
  }

  /** Settle a mid-clash disconnect immediately by meters : called after the disconnect lock releases to avoid deadlock. */
  async resolveClashOnDisconnect(gameId: string): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state?.clash) return;
    const clash = state.clash;
    const winner = clash.attackerPresses >= clash.defenderPresses ? clash.attacker : clash.defender;
    await this.clashEngine.resolveClashOutcome(gameId, winner);
  }

  async handlePlayerReconnect(gameId: string, color: PlayerColor): Promise<void> {
    return this.withGameLock(gameId, () => handlePlayerReconnect(this.store, gameId, color));
  }

  async handlePlayerReady(gameId: string, color: PlayerColor): Promise<void> {
    await this.withGameLock(gameId, () => handlePlayerReady(this.store, (e) => this.emit(e), gameId, color));
    await this.emitLobbyUpdate(gameId);
  }

  async handlePlayerExit(gameId: string, color: PlayerColor): Promise<void> {
    return this.withGameLock(gameId, () => handlePlayerExit(this.store, (e) => this.emit(e), gameId, color));
  }

  async handlePlayerSelectColor(gameId: string, userId: string, color: PlayerColor): Promise<void> {
    if (!this.lobbyManager) {
      throw new Error('Lobby manager not initialized');
    }
    await this.withGameLock(gameId, () => this.lobbyManager!.handleSelectColor(gameId, userId, color));
    await this.emitLobbyUpdate(gameId);
  }

  /** Host-only live update of game rules; the LobbyManager mirrors it into the match hash + state, then broadcasts. */
  async handleUpdateModifiers(gameId: string, userId: string, clashEnabled: boolean, safeZones: boolean): Promise<void> {
    if (!this.lobbyManager) {
      throw new Error('Lobby manager not initialized');
    }
    await this.withGameLock(gameId, () => this.lobbyManager!.updateModifiers(gameId, userId, clashEnabled, safeZones));
    await this.emitModifiersUpdate(gameId);
  }

  /** Broadcast the current rule toggles (clash mode + safe zones) to the room. */
  async emitModifiersUpdate(gameId: string): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state) return;
    this.emit({ type: 'modifiers_updated', gameId, clashEnabled: state.clashMode, safeZones: state.safeZones });
  }

  /** Broadcast the waiting-room roster after ready toggles / color swaps / joins so all lobbies stay in sync. */
  async emitLobbyUpdate(gameId: string): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state) return;
    const matchData = await this.store.getMatchData(gameId);
    const players = state.players
      // Exclude exited seats : including them would make clients resurrect their cleared pieces.
      .filter(p => p.status === 'active' || p.status === 'disconnected')
      .map(p => ({
        userId: '',
        username: p.username,
        avatarStyle: '',
        color: p.color,
        ready: state.readyPlayers.includes(p.color),
      }));
    this.emit({ type: 'lobby_update', gameId, hostId: matchData?.player1_id || '', players });
  }
}