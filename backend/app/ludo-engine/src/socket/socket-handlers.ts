import { LudoEngine } from '../engine';
import { RedisGameStore } from '../redis';
import { LudoBot } from '../bot';
import { GameSocket } from './auth';
import { JoinManager } from './join-manager';
import type { PlayerColor, PieceId } from '../types';

// SocketHandlers maps socket events to engine actions; the join_game flow
// is delegated to JoinManager.
export class SocketHandlers {
  // Owns the join_game flow (seat binding, game creation, reconnects).
  private joinManager: JoinManager;

  constructor(
    private store: RedisGameStore,
    private engine: LudoEngine,
    private userIdMap: Map<string, Map<PlayerColor, string>>,
    private getOrCreateBot: (
      gameId: string,
      color: PlayerColor,
      engine: LudoEngine,
      store: RedisGameStore,
    ) => LudoBot,
    private scheduleBotTurn?: (gameId: string) => void,
    private notifyAbort?: (gameId: string) => void,
  ) {
    this.joinManager = new JoinManager(
      this.store,
      this.engine,
      this.userIdMap,
      this.getOrCreateBot,
      this.scheduleBotTurn,
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

    (async () => {
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

    (async () => {
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
  handlePlayerReady(socket: GameSocket): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) {
      socket.emit('error', 'Not in a game');
      return;
    }

    (async () => {
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

    (async () => {
      try {
        const previousColor = socket.data.playerColor;
        await this.engine.handlePlayerSelectColor(gameId, userId, color as PlayerColor);
        // Keep socket binding + userIdMap in sync with the engine's seat swap:
        // vacate the old seat ONLY if it still maps to this user, since during
        // a swap that color may already belong to the opponent.
        if (
          previousColor &&
          previousColor !== color &&
          this.userIdMap.get(gameId)?.get(previousColor) === userId
        ) {
          this.userIdMap.get(gameId)?.delete(previousColor);
        }
        this.userIdMap.get(gameId)?.set(color as PlayerColor, userId);
        socket.data.playerColor = color as PlayerColor;
      } catch (error) {
        socket.emit('error', `Color selection failed: ${error}`);
      }
    })();
  }

  handleLeaveGame(socket: GameSocket): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) return;

    (async () => {
      try {
        const state = await this.store.loadGameState(gameId);
        if (!state) return;

        if (state.status === 'finished') {
          socket.leave(gameId);
        } else if (state.status === 'waiting' || state.status === 'active') {
          await this.engine.handlePlayerExit(gameId, color);
          socket.leave(gameId);
        }
      } catch (error) {
        console.error('Leave game error:', error);
      }
    })();
  }

  handleResign(socket: GameSocket): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) return;

    (async () => {
      try {
        // Resign is NOT exit: conceding has to be recorded as a loss, which
        // means ending the game and emitting game_ended so the result actually
        // reaches the backend. handlePlayerExit does neither.
        await this.engine.handlePlayerResign(gameId, color);
      } catch (error) {
        socket.emit('error', `Resign failed: ${error}`);
      }
    })();
  }

  // Clash QTE key press: decide which side (attacker/defender) the pressed
  // key belongs to, verify the socket's user owns that seat, then record the
  // press. In PvP each user owns one seat : only their key works. In hotseat
  // one user owns both seats : the same socket can mash BOTH keys.
  handleClashInput(socket: GameSocket, key: string): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) return;

    (async () => {
      try {
        const clash = await this.store.loadClashState(gameId);
        if (!clash) return;

        const userId = socket.data.userId;
        const attackerUser = this.userIdMap.get(gameId)?.get(clash.attacker);
        const defenderUser = this.userIdMap.get(gameId)?.get(clash.defender);
        const ownsAttacker = userId ? attackerUser === userId : clash.attacker === color;
        const ownsDefender = userId ? defenderUser === userId : clash.defender === color;

        let pressColor: PlayerColor | null = null;
        if (key === clash.attackerKey && ownsAttacker) {
          pressColor = clash.attacker;
        } else if (key === clash.defenderKey && ownsDefender) {
          pressColor = clash.defender;
        }
        if (!pressColor) return;

        await this.engine.recordClashPress(gameId, pressColor, key);
        // Live meter updates flow via the engine's clash_press publish; the
        // per-player ack is no longer needed (clash_press broadcasts to all).
      } catch (error) {
        console.error('Clash input error:', error);
      }
    })();
  }

  // Room rule toggles (clash QTE + safe zones). Host-only, waiting-room-only;
  // validation lives in LobbyManager.updateModifiers.
  handleUpdateModifiers(socket: GameSocket, clashEnabled: boolean, safeZones: boolean): void {
    const gameId = socket.data.gameId;
    const userId = socket.data.userId;
    if (!gameId || !userId) {
      socket.emit('error', 'Not in a game');
      return;
    }

    (async () => {
      try {
        await this.engine.handleUpdateModifiers(gameId, userId, clashEnabled, safeZones);
      } catch (error) {
        socket.emit('error', `Modifiers update failed: ${error}`);
      }
    })();
  }

  // Socket disconnect: start (or ignore, if already running) the reconnect
  // grace period for the player's seat.
  handleDisconnect(socket: GameSocket): void {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) return;

    (async () => {
      try {
        await this.engine.handlePlayerDisconnect(gameId, color, this.notifyAbort);
        // Instant disconnect resolve: settle a mid-clash disconnect IMMEDIATELY
        // by meters (A>=D → attacker; A<D → defender) instead of freezing the
        // QTE for a reconnect window.
        await this.engine.resolveClashOnDisconnect(gameId);
      } catch (error) {
        console.error('Disconnect handler error:', error);
      }
    })();
  }
}
