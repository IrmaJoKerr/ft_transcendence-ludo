import type { LudoEngine } from '../engine';
import type { RedisGameStore } from '../redis';
import type { LudoBot } from '../bot';
import type { GameSocket } from './auth';
import { JoinManager } from './join-manager';
import type { RoomRegistry } from './room-context';
import { finalizeDeparture } from '../player-handler';
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

  // 'clash_input' event: one keypress in the capture QTE. The pressed KEY picks
  // the side, then the room's seat binding proves the caller owns that seat: in
  // PvP only the owner's key lands, while in hotseat one user owns both seats
  // and may mash both keys. A press that fails any check is dropped silently.
  handleClashInput(socket: GameSocket, key: string): void {
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
        if (key === clash.attackerKey && ownsAttacker) {
          pressColor = clash.attacker;
        } else if (key === clash.defenderKey && ownsDefender) {
          pressColor = clash.defender;
        }
        if (!pressColor) return;

        // No ack: the engine broadcasts clash_press, which is the live meter for
        // every client including this one.
        await this.engine.recordClashPress(gameId, pressColor, key);
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

  handleSelectColor(socket: GameSocket, color: string): void {
    const gameId = socket.data.gameId;
    const userId = socket.data.userId;
    if (!gameId || !userId) {
      socket.emit('error', 'Not in a game');
      return;
    }

    void (async () => {
      try {
        const previousColor = socket.data.playerColor;
        await this.engine.handlePlayerSelectColor(gameId, userId, color as PlayerColor);
        // Keep the socket binding and the room's seat bindings in sync with the
        // engine's seat swap: vacate the old seat ONLY if it still maps to this
        // user, since during a swap that color may already belong to the opponent.
        if (
          previousColor &&
          previousColor !== color &&
          this.rooms.get(gameId)?.unbindSeatIf(previousColor, userId)
        ) {
          await this.store.clearSeatUser(gameId, previousColor);
        }
        this.rooms.ensure(gameId).bindSeat(color as PlayerColor, userId);
        await this.store.setSeatUser(gameId, color as PlayerColor, userId);
        socket.data.playerColor = color as PlayerColor;
      } catch (error) {
        // LobbyManager throws i18n codes (lobby.ts); forward the code so the
        // client can localize it. Unmapped messages stay console-only.
        socket.emit('error', error instanceof Error ? error.message : String(error));
      }
    })();
  }

  // 'update_modifiers' event: the host flips the room rules while the room is
  // still waiting. LobbyManager throws i18n codes (LOBBY_NOT_WAITING,
  // MODIFIERS_HOST_ONLY); forward the code so the client can localize it.
  handleUpdateModifiers(socket: GameSocket, clashEnabled: boolean, safeZones: boolean): void {
    const gameId = socket.data.gameId;
    const userId = socket.data.userId;
    if (!gameId || !userId) {
      socket.emit('error', 'Not in a game');
      return;
    }

    void (async () => {
      try {
        await this.engine.handleUpdateModifiers(gameId, userId, clashEnabled, safeZones);
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
        // Settle a mid-clash disconnect at once (higher meter wins, tie goes to
        // the attacker) instead of freezing the QTE for the grace window. This
        // runs after handlePlayerDisconnect released the game lock: the resolve
        // takes that lock itself.
        await this.engine.resolveClashOnDisconnect(gameId);
      } catch (error) {
        console.error('Disconnect handler error:', error);
      }
    })();
  }
}
