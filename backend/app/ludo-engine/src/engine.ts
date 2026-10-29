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
import type { ClashManager } from './clash';
import { orderDefenderIds } from './clash';
import { ClashEngine } from './clash-engine';
import { createRng, randInt, seedFrom } from './rng';
import type { Rng } from './rng';

// Room rules from the wire, turned into domain truth: only a literal `true` turns
// a rule on, so `"false"`, `1`, `{}` and an absent field all mean off. Without the
// strict check the string "false" would read as truthy in the match hash.
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
  // The engine's entropy source, the only place randomness enters a game. A
  // harness passes a fixed generator and the whole write path becomes
  // replayable; production keeps Math.random. Seeds are drawn from it, never
  // reused as the die stream itself.
  private random: Rng;

  constructor(store: RedisGameStore, clashManager: ClashManager, random: Rng = Math.random) {
    this.store = store;
    this.random = random;
    this.clashEngine = new ClashEngine(
      store,
      clashManager,
      (e) => {
        this.emit(e);
      },
      (gameId, fn) => this.withGameLock(gameId, fn),
      random,
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

      // Result-card freeze: the clash resolved and the client is showing the
      // outcome, so no roll may land on top of it.
      if (state.resultCardUntil && Date.now() < state.resultCardUntil) {
        throw new Error('Clash result in progress : wait for the card to clear');
      }

      // One entropy draw from the engine's source seeds this roll's own stream, so
      // the die stays isolated from every other draw in the process (keys, jitter,
      // decorators) exactly as it was when it seeded from Math.random().
      const rand = createRng(seedFrom(this.random));
      // Single draw from the seeded stream → every face 1..6 is exactly 1/6 (fair
      // die, max entropy ~2.585 bits). No averaging, no middle-face bias.
      const diceValue = randInt(rand, 1, 6);

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

  // Move a piece: validate against pendingLegalMoves (server-authoritative) and
  // apply the stored pendingDiceValue. `to` names which move of that piece and is
  // optional, since a piece never has two moves to the same square.
  async movePiece(gameId: string, pieceId: PieceId, to?: number): Promise<MovePieceOutput> {
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

      // pieceId (+ `to`, when the client names one) must be in pendingLegalMoves, a
      // snapshot taken at roll time: a disconnect between roll and move is rejected
      // here, and the capture is not re-derived.
      const pendingMove = state.pendingLegalMoves.find(
        (m) => m.pieceId === pieceId && (to === undefined || m.to === to),
      );
      if (!pendingMove) {
        throw new Error('Invalid move: piece not in legal moves');
      }

      // Use the server-authoritative dice value
      const diceValue = state.pendingDiceValue;
      if (diceValue === undefined) {
        throw new Error('No pending dice value : roll first');
      }

      const moverColor = state.pieces.find((p) => p.id === pieceId)?.color;
      // Captured before the move resolves: a turn advance clears every seat's arm switch, so
      // this is what tells the HUD below whether it needs a fresh players[] frame.
      const moverWasArmed =
        state.players.find((p) => p.color === moverColor)?.barrierArmed === true;

      // A Barrier Buster move pays its token here, inside the game lock and once: the
      // pending move is cleared below, so a replay finds nothing and cannot spend a
      // second token. The debit is the attempt; a lost chain keeps the token spent.
      if (pendingMove.spendsBarrierToken) {
        const mover = state.players.find((p) => p.color === moverColor);
        // The arm switch is the player's consent and the engine enforces it here: the
        // move list carries every priced landing whatever the switch says, so an
        // unarmed attempt is refused instead of spending a token.
        if (mover?.barrierArmed !== true) {
          throw new Error('Barrier breaker is not armed');
        }
        if (!mover || (mover.barrierTokens ?? 0) <= 0) {
          throw new Error('No barrier token available');
        }
        mover.barrierTokens = Math.max(0, (mover.barrierTokens ?? 0) - 1);
        // An empty hand cannot be armed (setBarrierArmed refuses it), so the switch does not
        // survive the spend: without this, a seat that KEEPS the turn (a capture re-rolls)
        // would show ARMED beside a hand of zero until some later turn change cleared it.
        if ((mover.barrierTokens ?? 0) <= 0) delete mover.barrierArmed;
      }

      // Clash gate: a capture is deferred to the QTE and applied only once that
      // resolves, so no piece moves yet.
      if (state.clashMode && pendingMove.isCapture) {
        // The defenders of the landing square, the only square a move fights. The
        // square is found by shared track position and ordered by piece id, so the
        // order survives a rebuild and two runs fight the same way.
        const defenderIds = orderDefenderIds(
          MoveValidator.findPiecesAtPosition(state, moverColor, pendingMove.to),
        );
        // A landing square that stood 2 or more defenders is a barrier, and winning
        // its chain credits the attacker once (achTearDownThisWall): a landing on a
        // 2-stack is 1, a lone defender is 0.
        const barrierBattles = defenderIds.length >= 2 ? 1 : 0;
        // No defender behind the move (home/goal): fall through to a normal move.
        const defenderPiece = state.pieces.find((p) => p.id === defenderIds[0]);
        if (defenderPiece) {
          const defenderColor = defenderPiece.color;
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
            barrierBattles,
          };
          state.pendingLegalMoves = [];
          state.pendingDiceValue = undefined;
          state.pendingIsFirstRoll = undefined;
          await this.store.saveGameState(gameId, state);

          const attackerIsBot = state.players.find((p) => p.color === moverColor)?.isBot ?? false;
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

      // Apply the move outcome: sync piece mirrors, bump the counter, run the win
      // check, update stats and hand off the turn. Returns the winner if the game
      // finished; `attackerWon` is true for an already-resolved move.
      const winner = applyMoveOutcome(state, result, diceValue, true);

      await this.store.saveGameState(gameId, state);

      this.emit({ type: 'piece_moved', gameId, result });
      // A token spend or any turn change sends a full-state frame: the count and the
      // arm switch ride players[], and a stale frame would show a token or an arm the
      // seat no longer holds.
      if (pendingMove.spendsBarrierToken || moverWasArmed) {
        this.emit({ type: 'state_update', gameId, state });
      }
      if (winner) {
        this.emit({ type: 'game_ended', gameId, winner, resultDetail: 'four_pieces' });
      }

      return { result, state };
    });
  }

  // Skip on a held turn: every offered move is token-priced, so the seat spends a
  // token or forfeits the turn and keeps it. A pass, not a re-roll: the dice are
  // spent and the turn advances.
  async skipArmedBust(gameId: string): Promise<void> {
    return this.withGameLock(gameId, async () => {
      const state = await this.store.loadGameState(gameId);
      if (state?.status !== 'active') {
        throw new Error('Game not active');
      }
      if (state.paused) {
        throw new Error('Game is paused: waiting for player to reconnect');
      }
      if (state.turnPhase !== 'WAITING_FOR_MOVE') {
        throw new Error('Invalid turn phase: expected WAITING_FOR_MOVE');
      }
      // Skip is valid only when every pending move is token-priced; with an ordinary
      // move available it is refused. A 6 is no exception: an on-board piece can still
      // have a wall as its only destination.
      const priced = state.pendingLegalMoves.filter((m) => m.spendsBarrierToken);
      if (priced.length === 0 || priced.length !== state.pendingLegalMoves.length) {
        throw new Error('Nothing to skip: an ordinary move is available');
      }

      state.pendingLegalMoves = [];
      state.pendingDiceValue = undefined;
      state.pendingIsFirstRoll = undefined;
      state.turnPhase = 'WAITING_FOR_ROLL';
      advanceTurnInState(state);
      await this.store.saveGameState(gameId, state);
      this.emit({ type: 'turn_skipped', gameId, currentTurn: state.currentTurn });
      // The pass cleared every seat's arm switch (advanceTurnInState), so a full-state frame
      // follows the turn_skipped: without it the passing seat's roster cell would keep
      // showing ARMED from the arm frame it sent before the pass.
      this.emit({ type: 'state_update', gameId, state });
    });
  }

  // Barrier Buster arm switch: clash mode grants the chance to break a wall and this
  // is the seat's decision to take it. Refused with an empty hand or out of turn,
  // cleared when the turn moves on, and refused without clash mode.
  async setBarrierArmed(gameId: string, color: PlayerColor, armed: boolean): Promise<void> {
    return this.withGameLock(gameId, async () => {
      const state = await this.store.loadGameState(gameId);
      if (state?.status !== 'active') {
        throw new Error('Game not active');
      }
      if (state.clashMode !== true) {
        throw new Error('No barrier breaker mode in this room');
      }
      if (state.currentTurn !== color) {
        throw new Error('Not your turn');
      }
      const meta = state.players.find((p) => p.color === color);
      if (!meta) {
        throw new Error('No such seat');
      }
      if (armed && (meta.barrierTokens ?? 0) <= 0) {
        throw new Error('No barrier token to arm');
      }
      if (armed) meta.barrierArmed = true;
      else delete meta.barrierArmed;
      // No recompute: the move list is the same armed or not; this switch only decides
      // whether the engine accepts a landing. The frame below tells each client to
      // reveal or hide the priced moves it already holds.
      await this.store.saveGameState(gameId, state);
      // The switch and the hand ride players[], so a full-state frame is what
      // refreshes every client's token column.
      this.emit({ type: 'state_update', gameId, state });
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
    count = 1,
  ): Promise<number> {
    return this.clashEngine.recordClashPress(gameId, color, key, isBot, count);
  }

  // The result-card release handshake: a client's forecast for the card it is
  // showing. Clamped and minimum-only inside ClashEngine, and accepted only from a
  // user that owns a seat in that card. True when the release frame was emitted.
  async holdClashCard(
    gameId: string,
    userId: string,
    cardId: string,
    holdMs: number,
  ): Promise<boolean> {
    return this.clashEngine.holdCard(gameId, userId, cardId, holdMs);
  }

  // Settle a mid-clash disconnect by meters, tie to the attacker, as on timeout. In a
  // chain this settles the round: a win continues, a loss repels the attack. Called
  // after the disconnect lock releases, so it cannot re-enter it.
  async resolveClashOnDisconnect(gameId: string): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state?.clash) return;
    const clash = state.clash;
    const winner = clash.attackerPresses >= clash.defenderPresses ? clash.attacker : clash.defender;
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
    // A chain resumes on the seat that dropped: the reconnect starts the round the
    // pause interrupted. Called after the lock above releases, since startNextRound
    // takes it and a re-entrant lock would deadlock.
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

  // Host-only live update of the room rules. Normalized here, at the boundary where a
  // payload becomes state. LobbyManager mirrors the result and the broadcast carries
  // what was persisted, not what the caller asked for.
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
