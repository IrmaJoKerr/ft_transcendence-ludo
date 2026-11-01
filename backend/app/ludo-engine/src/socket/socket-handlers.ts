import type { LudoEngine } from '../engine';
import type { RedisGameStore } from '../redis';
import type { LudoBot } from '../bot';
import type { GameSocket } from './auth';
import { JoinManager } from './join-manager';
import type { RoomRegistry } from './room-context';
import { finalizeDeparture } from '../player-handler';
import { keyFor } from '../clash';
import type { PlayerColor, PieceId } from '../types';

// SocketHandlers maps socket events to engine actions; the join_game flow
// is delegated to JoinManager.
export class SocketHandlers {
  // Owns the join_game flow (seat binding, game creation, reconnects).
  private joinManager: JoinManager;

  constructor(
    private store: RedisGameStore,
    private engine: LudoEngine,
    private rooms: RoomRegistry,
    private getOrCreateBot: (
      gameId: string,
      color: PlayerColor,
      engine: LudoEngine,
      store: RedisGameStore,
    ) => LudoBot,
    private scheduleBotTurn?: (gameId: string) => void,
    private notifyAbort?: (gameId: string) => void,
    refreshIdle?: (gameId: string) => void,
  ) {
    this.joinManager = new JoinManager(
      this.store,
      this.engine,
      this.rooms,
      this.getOrCreateBot,
      this.scheduleBotTurn,
      refreshIdle,
    );
  }

  handleJoinGame(
    socket: GameSocket,
    gameId: string,
    playerColor: PlayerColor,
    userId?: string,
    displayName?: string,
  ): void {
    this.joinManager.handleJoinGame(socket, gameId, playerColor, userId, displayName);
  }

  // 'roll_dice' event: validate the caller's turn and roll via the engine.
  // Errors go back to the requesting socket only.
  handleRollDice(socket: GameSocket): void {
    const gameId = socket.data.gameId;
    if (!gameId) {
      socket.emit('error', 'Not in a game');
      return;
    }

    void (async () => {
      try {
        if (socket.data.playerColor) {
          const state = await this.store.loadGameState(gameId);
          if (state?.status === 'active' && state.currentTurn !== socket.data.playerColor) {
            socket.emit('error', 'Not your turn');
            return;
          }
        }
        await this.engine.rollDice(gameId);
      } catch (error) {
        socket.emit('error', `Roll failed: ${error}`);
      }
    })();
  }

  // 'move_piece' event: validate turn/ownership, then apply the move via the
  // engine. Errors go back to the requesting socket only.
  handleMovePiece(socket: GameSocket, pieceId: PieceId): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) {
      socket.emit('error', 'Not in a game');
      return;
    }

    void (async () => {
      try {
        const state = await this.store.loadGameState(gameId);
        if (state?.status === 'active') {
          if (state.currentTurn !== color) return;
          const piece = state.pieces.find((p) => p.id === pieceId);
          if (!piece || piece.color !== color) return;
        }
        await this.engine.movePiece(gameId, pieceId);
      } catch (error) {
        socket.emit('error', `Move failed: ${error}`);
      }
    })();
  }

  // 'skip_bust' event: decline the armed Wall Breaker exit holding the turn. The
  // engine owns the rule (the move must be on the table, never on a 6), so this only
  // repeats the turn and ownership pre-check, then passes. Errors go to that socket.
  handleSkipBust(socket: GameSocket): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) {
      socket.emit('error', 'Not in a game');
      return;
    }

    void (async () => {
      try {
        const state = await this.store.loadGameState(gameId);
        if (state?.status === 'active') {
          if (state.currentTurn !== color) return;
        }
        await this.engine.skipArmedBust(gameId);
      } catch (error) {
        // A refused Skip is dropped silently: the intent is a pass, the token is never
        // at risk, and the client sends one only where the engine accepts it, so a
        // refusal means a stale or crafted emit. Log it, never show it to the player.
        console.error('Skip refused:', error);
      }
    })();
  }

  // 'arm_barrier' event: the Wall Breaker switch, clash mode only. Armed means
  // this turn may break a wall, and every wall landing spends a token; disarmed means
  // a wall blocks it. The engine owns the flag; this repeats the ownership check.
  handleArmBarrier(socket: GameSocket, armed: boolean): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) {
      socket.emit('error', 'Not in a game');
      return;
    }

    void (async () => {
      try {
        await this.engine.setBarrierArmed(gameId, color, armed);
      } catch (error) {
        socket.emit('error', `Arm failed: ${error}`);
      }
    })();
  }

  // 'clash_card_hold' event: the result-card release handshake. The client forecasts
  // its own card; the engine clamps it, keeps the smallest deadline, and releases once
  // every participant reports. A stale id or non-participant is dropped.
  handleClashCardHold(socket: GameSocket, cardId: unknown, holdMs: unknown): void {
    const gameId = socket.data.gameId;
    const userId = socket.data.userId;
    if (!gameId || !userId) return;
    if (typeof cardId !== 'string' || cardId.length === 0 || cardId.length > 64) return;
    const hold = Number(holdMs);
    if (!Number.isFinite(hold)) return;

    void (async () => {
      try {
        await this.engine.holdClashCard(gameId, userId, cardId, hold);
      } catch (error) {
        // Logged for the operator, never flashed at the player: a receipt is an
        // optimisation of the card's length, not an action the player took. The
        // message alone is enough; a stack per refusal is noise.
        console.error('Card hold refused:', error instanceof Error ? error.message : String(error));
      }
    })();
  }

  // 'clash_input' event: one keypress in the capture QTE. The key picks the side,
  // then the seat binding proves ownership (hotseat owns both). `count` is the tablet
  // tap weight, clamped to CLASH_TAP_COUNT_MAX; the per-side cap gates events.
  handleClashInput(socket: GameSocket, key: string, count = 1): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) return;

    void (async () => {
      try {
        const clash = await this.store.loadClashState(gameId);
        if (!clash) return;

        const userId = socket.data.userId;
        const seats = this.rooms.get(gameId);
        // A seat with no binding (bot seats) belongs to nobody, so no client key
        // ever registers for it.
        const ownsAttacker = userId
          ? seats?.seat(clash.attacker) === userId
          : clash.attacker === color;
        const ownsDefender = userId
          ? seats?.seat(clash.defender) === userId
          : clash.defender === color;

        let pressColor: PlayerColor | null = null;
        // The live letter per side, not the round's opening one: on a key-shift room
        // the schedule moves underneath the handler, and the press is judged against
        // whichever letter the engine is accepting at this instant.
        if (key === keyFor(clash, clash.attacker) && ownsAttacker) {
          pressColor = clash.attacker;
        } else if (key === keyFor(clash, clash.defender) && ownsDefender) {
          pressColor = clash.defender;
        }
        if (!pressColor) return;

        // No ack: the engine broadcasts clash_press, which is the live meter for
        // every client including this one.
        await this.engine.recordClashPress(gameId, pressColor, key, false, count);
      } catch (error) {
        console.error('Clash input error:', error);
      }
    })();
  }

  handlePlayerReady(socket: GameSocket): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) {
      socket.emit('error', 'Not in a game');
      return;
    }

    void (async () => {
      try {
        await this.engine.handlePlayerReady(gameId, color);
      } catch (error) {
        socket.emit('error', `Ready failed: ${error}`);
      }
    })();
  }

  // 'update_modifiers' event: the host flips the room rules while WAITING. The object
  // passes through as sent; the façade normalizes it (only a literal `true` enables a
  // rule). LobbyManager throws i18n codes, forwarded so the client can localize them.
  handleUpdateModifiers(socket: GameSocket, raw: unknown): void {
    const gameId = socket.data.gameId;
    const userId = socket.data.userId;
    if (!gameId || !userId) {
      socket.emit('error', 'Not in a game');
      return;
    }

    void (async () => {
      try {
        await this.engine.handleUpdateModifiers(gameId, userId, raw);
      } catch (error) {
        socket.emit('error', error instanceof Error ? error.message : String(error));
      }
    })();
  }

  handleLeaveGame(socket: GameSocket): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) return;

    void (async () => {
      try {
        const state = await this.store.loadGameState(gameId);
        if (!state) return;

        if (state.status === 'finished') {
          void socket.leave(gameId);
        } else if (state.status === 'waiting') {
          // Waiting room: reversible leave via the unified chokepoint. The seat
          // is reserved (not freed) so rejoin returns the same colour.
          await finalizeDeparture(
            this.store,
            this.engine.emitEvent.bind(this.engine),
            gameId,
            color,
            'waiting_leave',
          );
          void socket.leave(gameId);
        } else if (state.status === 'active') {
          // Live game: per-player exit via the unified chokepoint.
          await finalizeDeparture(
            this.store,
            this.engine.emitEvent.bind(this.engine),
            gameId,
            color,
            'leave',
          );
          void socket.leave(gameId);
        }
      } catch (error) {
        console.error('Leave game error:', error);
      }
    })();
  }

  // Socket disconnect: start (or ignore, if already running) the reconnect
  // grace period for the player's seat.
  handleDisconnect(socket: GameSocket): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) return;

    void (async () => {
      try {
        await this.engine.handlePlayerDisconnect(gameId, color, this.notifyAbort);
        // Settle a mid-clash disconnect at once (higher meter wins, ties go to the
        // attacker) instead of freezing the QTE for the grace window. This runs after
        // handlePlayerDisconnect released the lock; the resolve takes it again.
        await this.engine.resolveClashOnDisconnect(gameId);
      } catch (error) {
        console.error('Disconnect handler error:', error);
      }
    })();
  }
}
