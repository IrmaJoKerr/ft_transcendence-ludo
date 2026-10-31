import type { Server } from 'socket.io';
import type { LudoEngine } from '../engine';
import type { RedisGameStore } from '../redis';
import type { EventPublisher } from './event-publisher';
import type { GameSocket } from './auth';
import type { RoomRegistry } from './room-context';
import { finalizeDeparture, teardownRoom } from '../player-handler';
import { pushLog } from '../game-log';

// PostGameManager owns the end-of-game lifecycle: the post-game timeout that
// expires a finished room, and the "End Game" button.
export class PostGameManager {
  constructor(
    private getIo: () => Server,
    private store: RedisGameStore,
    private engine: LudoEngine,
    private publisher: EventPublisher,
    private rooms: RoomRegistry,
    private postGameTimeoutMs: number,
    private cleanup: (gameId: string) => void,
  ) {}

  // A game finished: emit game_timeout and tear the room down after the timeout.
  // The timer lives in the room's RoomContext, so the wake pass can re-arm it
  // after a restart (the finished room would otherwise never expire).
  onGameEnded(gameId: string): void {
    this.rooms.ensure(gameId).armPostGame(this.postGameTimeoutMs, () => {
      this.getIo().to(gameId).emit('game_timeout');
      this.cleanup(gameId);
    });
  }

  // Definitive termination via the "End Game" button. PvE/hotseat: abort the
  // whole instance. PvP: prune only this player; if fewer than 2 humans
  // remain, the room is aborted and cleaned up. No result is posted.
  async handleEndGame(socket: GameSocket): Promise<void> {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) return;

    const state = await this.store.loadGameState(gameId);
    if (!state) return;
    const player = state.players.find((p) => p.color === color);
    const username = player?.username || color;
    const match = await this.store.getMatchData(gameId);
    const isSingleSocketMode = match?.gameType === 'PVE' || match?.gameType === 'HOTSEAT';

    if (isSingleSocketMode) {
      // Single-instance mode: tear down the whole room. teardownRoom
      // broadcasts game_expired and runs the cleanup callback.
      await teardownRoom(this.store, this.engine.emitEvent.bind(this.engine), gameId, this.cleanup);
      return;
    }

    // PvP: prune only this player and free the seat. finalizeDeparture tears
    // the room down if the prune leaves it below quorum.
    await finalizeDeparture(
      this.store,
      this.engine.emitEvent.bind(this.engine),
      gameId,
      color,
      'end_game',
      this.cleanup,
    );
    // The departure is game state too, so its line is written into the snapshot (a
    // rejoining client rebuilds the panel from there) and carried by the frame for the
    // clients already watching. A prune that dropped the room below quorum already
    // deleted the state, so there is nothing left to write.
    const after = await this.store.loadGameState(gameId);
    const log = after ? [pushLog(after, { kind: 'playerAborted', color })] : undefined;
    if (after) await this.store.saveGameState(gameId, after);
    this.publisher.publish({ type: 'player_aborted', gameId, color, username, log });
  }
}
