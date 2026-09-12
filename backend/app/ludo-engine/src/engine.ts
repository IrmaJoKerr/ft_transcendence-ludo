import { GameState, PlayerColor, LegalMove, MovePieceOutput, PieceId, GameEvent } from './types';
import { RedisGameStore } from './redis';
import { MoveValidator } from './move-validator';
import { applyMoveOutcome } from './turn';
import { advanceTurnInState } from './player-handler';
import {
  handlePlayerDisconnect,
  handlePlayerReconnect,
  handlePlayerReady,
  handlePlayerExit,
  handlePlayerResign,
} from './player-handler';
import { LobbyManager } from './lobby';
import { ClashManager } from './clash';
import { ClashEngine } from './clash-engine';

// The game engine core: roll/move handling, per-game operation locking,
// player lifecycle (disconnect/ready/exit/resign), and event emission to the
// socket layer. Instantiated by socket/server.ts.
export class LudoEngine {
  // Redis-backed persistence for game states and move history.
  private store: RedisGameStore;
  private eventHandler?: (event: GameEvent) => void;
  private lobbyManager?: LobbyManager;
  private clashManager?: ClashManager;
  private clashEngine?: ClashEngine;
  // Serializes one game's operations so roll/move/etc. never run on top of
  // each other (a bot acting at the same time as a human would otherwise
  // both load the same state and one move gets lost).
  private gameLocks = new Map<string, Promise<unknown>>();

  constructor(store: RedisGameStore, clashManager?: ClashManager) {
    this.store = store;
    this.clashManager = clashManager;
    if (this.clashManager) {
      this.clashEngine = new ClashEngine(
        this.store,
        this.clashManager,
        (event) => this.emit(event),
        this.withGameLock.bind(this),
      );
    }
  }

  setLobbyManager(lobbyManager: LobbyManager): void {
    this.lobbyManager = lobbyManager;
  }

  // Register a callback for game lifecycle events. The engine detects them here,
  // so the socket layer must not detect game end or publish events on its own.
  onEvent(handler: (event: GameEvent) => void): void {
    this.eventHandler = handler;
  }

  private emit(event: GameEvent): void {
    this.eventHandler?.(event);
  }

  // Public wrapper for emitting engine events (used by socket handlers).
  emitEvent(event: GameEvent): void {
    this.emit(event);
  }

  // Serialize a mutating operation per game: the next operation for a game
  // only starts after the previous one resolved (or rejected) against Redis.
  private withGameLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.gameLocks.get(gameId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.gameLocks.set(
      gameId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async getGameState(gameId: string): Promise<GameState | null> {
    return await this.store.loadGameState(gameId);
  }

  // Seeded PRNG (mulberry32): one fresh generator per roll, seeded from
  // Math.random() so the die stream is isolated from other Math.random() use.
  // See docs/ludo-engine/ludo-engine-core-system.md (Dice Roll → The dice math).
  private static seededRand(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      // 0x6d2b79f5: mulberry32's fixed odd accumulator — cycles s through all
      // 2^32 states (full period); `| 0` wraps the sum back into 32-bit range.
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Roll dice for the current player.
  // Sets turnPhase to WAITING_FOR_MOVE and stores pendingLegalMoves and pendingDiceValue.
  // Handles zero legal moves by advancing turn automatically (with bonus roll on 6).
  async rollDice(
    gameId: string,
  ): Promise<{ value: number; legalMoves: LegalMove[]; bonusRoll: boolean }> {
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

      const currentPlayer = state.players.find((p) => p.color === state.currentTurn);
      if (!currentPlayer || currentPlayer.status === 'exited') {
        throw new Error('Current player has exited');
      }

      // Math.random() cannot be seeded directly, so it seeds the per-roll stream.
      const rand = LudoEngine.seededRand(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
      // Single draw from the seeded stream → every face 1..6 is exactly 1/6 (fair
      // die, max entropy ~2.585 bits). No averaging, no middle-face bias.
      const diceValue = Math.floor(rand() * 6) + 1;

      currentPlayer.hasRolled = true;
      // Per-player 6-streak (classic rule): every 6 grants a bonus roll; the
      // third consecutive 6 forfeits the turn. Lives on PlayerMeta so it
      // resets on turn advance.
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
          this.emit({
            type: 'dice_rolled',
            gameId,
            value: diceValue,
            legalMoves: [],
            bonusRoll: false,
            currentTurn: state.currentTurn,
            forfeited: true,
          });
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
        this.emit({
          type: 'dice_rolled',
          gameId,
          value: diceValue,
          legalMoves: [],
          bonusRoll: sixBonus,
          currentTurn: state.currentTurn,
        });
        return { value: diceValue, legalMoves: [], bonusRoll: sixBonus };
      }

      // Set turn phase and store pending legal moves (server-authoritative)
      state.turnPhase = 'WAITING_FOR_MOVE';
      state.pendingLegalMoves = legalMoves;

      await this.store.saveGameState(gameId, state);

      this.emit({
        type: 'dice_rolled',
        gameId,
        value: diceValue,
        legalMoves,
        bonusRoll: sixBonus,
        currentTurn: state.currentTurn,
      });
      return { value: diceValue, legalMoves, bonusRoll: sixBonus };
    });
  }

  // Move a piece: validate against pendingLegalMoves (server-authoritative),
  // apply using the stored pendingDiceValue, and return result + state.
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

      // pieceId must be in pendingLegalMoves, a snapshot taken at roll time: a
      // disconnect between roll and move is rejected here, and the capture is not
      // re-derived. See docs/ludo-engine/ludo-engine-core-system.md (Move validation).
      const pendingMove = state.pendingLegalMoves.find((m) => m.pieceId === pieceId);
      if (!pendingMove) {
        throw new Error('Invalid move: piece not in legal moves');
      }

      // Use the server-authoritative dice value
      const diceValue = state.pendingDiceValue;
      if (diceValue === undefined) {
        throw new Error('No pending dice value : roll first');
      }

      // Clash gate: capture moves are deferred to the QTE : applied only after it resolves.
      if (state.clashMode && pendingMove.isCapture && this.clashEngine) {
        // Find the defender via the SHARED track position : per-color step equality is wrong across colors.
        const capturedPieceIds = MoveValidator.findPiecesAtPosition(state, state.currentTurn, pendingMove.to);
        // No defender on the square → fall through to a normal capture move.
        const defenderPiece = state.pieces.find((p) => p.id === capturedPieceIds[0]);
        if (defenderPiece) {
          const moverColor = state.pieces.find((p) => p.id === pieceId)?.color as PlayerColor;
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

          const attackerIsBot = state.players.find((p) => p.color === moverColor)?.isBot ?? false;
          const defenderIsBot = state.players.find((p) => p.color === defenderColor)?.isBot ?? false;

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

      // Sync frontend-compatible piece fields
      const movedPiece = state.pieces.find((p) => p.id === pieceId);
      if (movedPiece) {
        movedPiece.isInGoal = result.to === 57;
        movedPiece.isInBase = result.to <= 0;
      }
      if (result.captured && result.capturedPieceIds) {
        for (const id of result.capturedPieceIds) {
          const capturedPiece = state.pieces.find((p) => p.id === id);
          if (capturedPiece) {
            capturedPiece.isInGoal = false;
            capturedPiece.isInBase = true;
          }
        }
      }

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
        timestamp: Date.now(),
      });

      // Apply the move outcome: sync piece mirrors, bump the counter, run the
      // win check, update stats/bonus, and hand off the turn (or re-roll on a
      // 6/capture). Returns the winner if the game just finished.
      const winner = applyMoveOutcome(state, result, diceValue);

      await this.store.saveGameState(gameId, state);

      this.emit({ type: 'piece_moved', gameId, result });
      if (winner) {
        this.emit({ type: 'game_ended', gameId, winner, resultDetail: 'four_pieces' });
      }

      return { result, state };
    });
  }

  // ── Clash orchestration facades (logic lives in clash-engine.ts) ──────────
  // Boot-time clash recovery sweep (re-arms stale phase timers).
  startClashRecoverySweep(): void {
    this.clashEngine?.startRecoverySweep();
  }

  // Locked clash press recorder.
  async recordClashPress(gameId: string, color: PlayerColor, key?: string, isBot = false): Promise<number> {
    if (!this.clashEngine) throw new Error('Clash mode not available');
    return this.clashEngine.recordClashPress(gameId, color, key, isBot);
  }

  // Settle a mid-clash disconnect immediately by meters : called after the
  // disconnect lock releases to avoid deadlock.
  async resolveClashOnDisconnect(gameId: string): Promise<void> {
    if (!this.clashEngine) return;
    const state = await this.store.loadGameState(gameId);
    if (!state?.clash) return;
    const clash = state.clash;
    const winner = clash.attackerPresses >= clash.defenderPresses ? clash.attacker : clash.defender;
    await this.clashEngine.resolveClashOutcome(gameId, winner);
  }

  // Update the room rule toggles (clash mode + safe zones).
  async handleUpdateModifiers(gameId: string, userId: string, clashEnabled: boolean, safeZones: boolean): Promise<void> {
    if (!this.lobbyManager || !this.clashEngine) throw new Error('Clash mode not available');
    await this.withGameLock(gameId, () => this.lobbyManager!.updateModifiers(gameId, userId, clashEnabled, safeZones));
  }

  // Broadcast the current rule toggles (clash mode + safe zones) to the room.
  async broadcastModifiers(gameId: string): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state) return;
    this.emit({ type: 'modifiers_updated', gameId, clashEnabled: state.clashMode, safeZones: state.safeZones });
  }

  // Player lifecycle handlers (delegated to player-handler.ts)
  async handlePlayerDisconnect(
    gameId: string,
    color: PlayerColor,
    notifyAbort?: (gameId: string) => void,
  ): Promise<void> {
    return this.withGameLock(gameId, () =>
      handlePlayerDisconnect(this.store, (e) => this.emit(e), gameId, color, notifyAbort),
    );
  }

  async handlePlayerReconnect(gameId: string, color: PlayerColor): Promise<void> {
    return this.withGameLock(gameId, () => handlePlayerReconnect(this.store, gameId, color));
  }

  async handlePlayerReady(gameId: string, color: PlayerColor): Promise<void> {
    await this.withGameLock(gameId, () =>
      handlePlayerReady(this.store, (e) => this.emit(e), gameId, color),
    );
    await this.emitLobbyUpdate(gameId);
  }

  async handlePlayerExit(gameId: string, color: PlayerColor, freeSeat = false): Promise<void> {
    return this.withGameLock(gameId, () =>
      handlePlayerExit(this.store, (e) => this.emit(e), gameId, color, freeSeat),
    );
  }

  async handlePlayerResign(gameId: string, color: PlayerColor): Promise<void> {
    return this.withGameLock(gameId, () =>
      handlePlayerResign(this.store, (e) => this.emit(e), gameId, color),
    );
  }

  async handlePlayerSelectColor(gameId: string, userId: string, color: PlayerColor): Promise<void> {
    if (!this.lobbyManager) {
      throw new Error('Lobby manager not initialized');
    }
    await this.withGameLock(gameId, () =>
      this.lobbyManager!.handleSelectColor(gameId, userId, color),
    );
    await this.emitLobbyUpdate(gameId);
  }

  // Broadcast the waiting-room roster so every client's lobby stays in sync
  // after ready-toggles, color swaps, or joins. socket-handlers.ts calls
  // this after join_game.
  async emitLobbyUpdate(gameId: string): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state) return;
    const players = state.players
      .filter((p) => p.status !== 'inactive')
      .map((p) => ({
        userId: p.userId ?? '',
        username: p.username,
        hasAvatarPhoto: p.hasAvatarPhoto ?? false,
        avatarStyle: p.avatarStyle ?? '',
        color: p.color,
        ready: state.readyPlayers.includes(p.color),
      }));
    this.emit({ type: 'lobby_update', gameId, players });
  }
}
