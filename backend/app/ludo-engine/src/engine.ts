import type {
  GameState,
  PlayerColor,
  LegalMove,
  MovePieceOutput,
  PieceId,
  GameEvent,
  RoomRules,
} from './types';
import type { RedisGameStore } from './redis';
import { MoveValidator } from './move-validator';
import { applyMoveOutcome } from './turn';
import { advanceTurnInState } from './player-handler';
import {
  handlePlayerDisconnect,
  handlePlayerReconnect,
  handlePlayerReady,
  expireDisconnectedPlayer,
} from './player-handler';
import type { LobbyManager } from './lobby';
import { ClashManager, orderDefenderIds } from './clash';
import { ClashEngine } from './clash-engine';

// The room rules as they arrive from the wire, turned into domain truth: only a
// literal `true` turns a rule on, so `"false"`, `1`, `{}` and an absent field all
// mean the default (off). The socket layer hands over whatever the client sent,
// and this is where a payload stops being a payload: without the strict check the
// string "false" would reach the match hash and the engine state and be read as
// truthy, turning a rule ON for the rest of the room's life.
function normalizeRoomRules(raw: unknown): RoomRules {
  const input = (raw ?? {}) as Partial<RoomRules>;
  return {
    clashEnabled: input.clashEnabled === true,
    noSafeZones: input.noSafeZones === true,
    freeExit: input.freeExit === true,
  };
}

// The game engine core: roll/move handling, per-game operation locking,
// player lifecycle (disconnect/ready/exit), and event emission to the
// socket layer. Instantiated by socket/server.ts.
export class LudoEngine {
  // Redis-backed persistence for game states and move history.
  private store: RedisGameStore;
  private eventHandler?: (event: GameEvent) => void;
  private lobbyManager?: LobbyManager;
  // Serializes one game's operations so roll/move/etc. never run on top of
  // each other (a bot acting at the same time as a human would otherwise
  // both load the same state and one move gets lost).
  private gameLocks = new Map<string, Promise<unknown>>();
  // Clash QTE: capture deferral, phase timers, recovery sweep, bot pressers.
  // ClashEngine owns the timers, the manager owns the clash record, and the
  // engine owns the lock the clash work runs under.
  private clashEngine: ClashEngine;

  constructor(store: RedisGameStore, clashManager: ClashManager) {
    this.store = store;
    this.clashEngine = new ClashEngine(
      store,
      clashManager,
      (e) => this.emit(e),
      (gameId, fn) => this.withGameLock(gameId, fn),
    );
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
  private static seededRand(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      // 0x6d2b79f5: mulberry32's fixed odd accumulator, which cycles s through all
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
      if (state?.status !== 'active') {
        throw new Error('Game not active');
      }

      // Only allow roll during WAITING_FOR_ROLL phase
      if (state.turnPhase !== 'WAITING_FOR_ROLL' && state.turnPhase !== undefined) {
        throw new Error('Invalid turn phase: expected WAITING_FOR_ROLL');
      }

      const currentPlayer = state.players.find((p) => p.color === state.currentTurn);
      if (!currentPlayer || currentPlayer.status === 'exited') {
        throw new Error('Current player has exited');
      }

      // Frozen for a disconnect grace window: no rolls until the paused seat
      // reconnects or is pruned.
      if (state.paused) {
        throw new Error('Game is paused: waiting for player to reconnect');
      }

      // Result-card freeze: the clash just resolved and the client is showing
      // the outcome, so no roll may land on top of it.
      if (state.resultCardUntil && Date.now() < state.resultCardUntil) {
        throw new Error('Clash result in progress : wait for the card to clear');
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
      if (state?.status !== 'active') {
        throw new Error('Game not active');
      }

      // Paused for a disconnect grace window: no moves either. The paused seat
      // keeps its pending dice/moves; a reconnect resumes exactly here.
      if (state.paused) {
        throw new Error('Game is paused: waiting for player to reconnect');
      }

      // Result-card freeze: same rule as rollDice, the move waits for the card.
      if (state.resultCardUntil && Date.now() < state.resultCardUntil) {
        throw new Error('Clash result in progress : wait for the card to clear');
      }

      // Validate: must be in WAITING_FOR_MOVE phase
      if (state.turnPhase !== 'WAITING_FOR_MOVE') {
        throw new Error('Invalid turn phase: expected WAITING_FOR_MOVE');
      }

      // pieceId must be in pendingLegalMoves, a snapshot taken at roll time: a
      // disconnect between roll and move is rejected here, and the capture is not
      // re-derived.
      const pendingMove = state.pendingLegalMoves.find((m) => m.pieceId === pieceId);
      if (!pendingMove) {
        throw new Error('Invalid move: piece not in legal moves');
      }

      // Use the server-authoritative dice value
      const diceValue = state.pendingDiceValue;
      if (diceValue === undefined) {
        throw new Error('No pending dice value : roll first');
      }

      const moverColor = state.pieces.find((p) => p.id === pieceId)?.color as PlayerColor;

      // Clash gate: a capture is deferred to the QTE and applied only once that
      // resolves, so no piece moves yet.
      if (state.clashMode && pendingMove.isCapture) {
        // Find the defender via the SHARED track position: comparing per-colour
        // steps would be wrong across colours.
        const capturedPieceIds = MoveValidator.findPiecesAtPosition(
          state,
          moverColor,
          pendingMove.to,
        );
        // No defender on that square (a blockade, or home/goal): fall through to
        // a normal capture move.
        const defenderPiece = state.pieces.find((p) => p.id === capturedPieceIds[0]);
        if (defenderPiece) {
          const defenderColor = defenderPiece.color as PlayerColor;
          // The chain's ledger: EVERY opponent piece on the landing square, one
          // round each, in ascending piece id order. Order is named by piece id
          // rather than read off `state.pieces` so it stays stable if that array is
          // ever rebuilt, and so two runs of the same board fight the same order.
          const defenderIds = orderDefenderIds(capturedPieceIds);
          const totalRounds = defenderIds.length;

          state.pendingCapture = {
            pieceId,
            from: pendingMove.from,
            to: pendingMove.to,
            diceValue,
            attacker: moverColor,
            defender: defenderColor,
            capturedPieceIds: defenderIds,
            enteredHome: pendingMove.isHomeEntry,
            // Round 1 of R, with the ledger the chain advances on every win.
            round: 1,
            totalRounds,
            remainingDefenderIds: [...defenderIds],
            beatenDefenderIds: [],
          };
          state.pendingLegalMoves = [];
          state.pendingDiceValue = undefined;
          state.pendingIsFirstRoll = undefined;
          await this.store.saveGameState(gameId, state);

          const attackerIsBot =
            state.players.find((p) => p.color === moverColor)?.isBot ?? false;
          const defenderIsBot =
            state.players.find((p) => p.color === defenderColor)?.isBot ?? false;

          await this.clashEngine.startClash(
            gameId,
            moverColor,
            defenderColor,
            attackerIsBot,
            defenderIsBot,
            {
              round: 1,
              totalRounds,
              defenderPieceId: defenderIds[0],
              remainingDefenderIds: [...defenderIds],
            },
          );

          // Deferred: no piece_moved yet, the clash outcome emits it afterwards.
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
      // 6/capture). Returns the winner if the game just finished. `attackerWon`
      // is true here: this path is a normal, already-resolved move.
      const winner = applyMoveOutcome(state, result, diceValue, true);

      await this.store.saveGameState(gameId, state);

      this.emit({ type: 'piece_moved', gameId, result });
      if (winner) {
        this.emit({ type: 'game_ended', gameId, winner, resultDetail: 'four_pieces' });
      }

      return { result, state };
    });
  }

  // Clash orchestration facades: the logic lives in ClashEngine (clash-engine.ts).

  // Boot-time clash recovery: re-arm the persisted QTE phase timers and sweep
  // every 5s for orphaned or stalled clashes. Called once by socket/server.ts
  // alongside the engine's other wake-pass recovery.
  startClashRecoverySweep(): void {
    this.clashEngine.startRecoverySweep();
  }

  // A clash press from either side (locked inside ClashEngine). Returns the
  // side's new press total; 0 means the press was rejected.
  async recordClashPress(
    gameId: string,
    color: PlayerColor,
    key?: string,
    isBot = false,
  ): Promise<number> {
    return this.clashEngine.recordClashPress(gameId, color, key, isBot);
  }

  // Settle a mid-clash disconnect immediately by meters (tie goes to the
  // attacker, the same rule as the timeout). Inside a chain this settles the
  // ROUND: a round the attacker takes continues the chain, a round it loses
  // repels the attack and ends the move. Called by socket-handlers AFTER the
  // disconnect's own lock has released, so it cannot re-enter that lock.
  async resolveClashOnDisconnect(gameId: string): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state?.clash) return;
    const clash = state.clash;
    const winner =
      clash.attackerPresses >= clash.defenderPresses ? clash.attacker : clash.defender;
    await this.clashEngine.resolveClashOutcome(gameId, winner);
  }

  // Player lifecycle handlers (delegated to player-handler.ts)
  async handlePlayerDisconnect(
    gameId: string,
    color: PlayerColor,
    notifyAbort?: (gameId: string) => void,
  ): Promise<void> {
    return this.withGameLock(gameId, () =>
      handlePlayerDisconnect(
        this.store,
        (e) => {
          this.emit(e);
        },
        gameId,
        color,
        notifyAbort,
      ),
    );
  }

  // Returns true only when the seat was genuinely restored (see
  // player-handler.ts) : false means the grace window outlived the seat, so the
  // caller must reject the join rather than revive a seat with no pieces.
  async handlePlayerReconnect(
    gameId: string,
    color: PlayerColor,
    displayName?: string,
  ): Promise<boolean> {
    const revived = await this.withGameLock(gameId, () =>
      handlePlayerReconnect(this.store, gameId, color, displayName),
    );
    // A chain resumes on the seat that dropped: a disconnect froze the game
    // mid-chain, so the reconnect is what starts the round the pause swallowed.
    // Called AFTER the lock above is released: startNextRound takes the game lock
    // itself and a re-entrant self-lock would deadlock.
    if (revived) {
      await this.clashEngine.startNextRound(gameId);
    }
    return revived;
  }

  async handlePlayerReady(gameId: string, color: PlayerColor): Promise<void> {
    await this.withGameLock(gameId, () =>
      handlePlayerReady(
        this.store,
        (e) => {
          this.emit(e);
        },
        gameId,
        color,
      ),
    );
    await this.emitLobbyUpdate(gameId);
  }

  // Replay a grace window expiry under the game lock, so the server sweep can
  // settle windows lost to a restart.
  async expireDisconnectedPlayer(
    gameId: string,
    color: PlayerColor,
    notifyAbort?: (gameId: string) => void,
  ): Promise<void> {
    return this.withGameLock(gameId, () =>
      expireDisconnectedPlayer(
        this.store,
        (e) => {
          this.emit(e);
        },
        gameId,
        color,
        notifyAbort,
      ),
    );
  }

  async handlePlayerSelectColor(gameId: string, userId: string, color: PlayerColor): Promise<void> {
    if (!this.lobbyManager) {
      throw new Error('Lobby manager not initialized');
    }
    await this.withGameLock(gameId, () =>
      this.lobbyManager.handleSelectColor(gameId, userId, color),
    );
    await this.emitLobbyUpdate(gameId);
  }

  // Host-only live update of the room rules. One object in (see RoomRules),
  // normalized right here: this façade is the boundary where a wire payload
  // becomes state, so a sloppy or hostile client cannot write a non-boolean.
  // LobbyManager mirrors the result into the match hash and the engine state;
  // the broadcast then carries what was actually persisted, not what the
  // caller asked for.
  async handleUpdateModifiers(gameId: string, userId: string, raw: unknown): Promise<void> {
    if (!this.lobbyManager) {
      throw new Error('Lobby manager not initialized');
    }
    const rules = normalizeRoomRules(raw);
    await this.withGameLock(gameId, () => this.lobbyManager.updateModifiers(gameId, userId, rules));
    await this.emitModifiersUpdate(gameId);
  }

  // Broadcast the room's current rules (one object, all three) to the room. Read
  // back out of the state, never echoed from the caller: the clients mirror the
  // room itself, so a stored value and a broadcast value cannot disagree.
  async emitModifiersUpdate(gameId: string): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state) return;
    this.emit({
      type: 'modifiers_updated',
      gameId,
      clashEnabled: state.clashMode,
      noSafeZones: state.noSafeZones,
      freeExit: state.freeExit,
    });
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
