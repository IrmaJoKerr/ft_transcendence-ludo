import type { Server } from 'socket.io';
import type { LudoEngine } from '../engine';
import type { RedisGameStore } from '../redis';
import type { EventPublisher } from './event-publisher';
import type { GameSocket } from './auth';
import type { RoomRegistry } from './room-context';
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

  // Definitive termination via the "End Game" button. The departure funnel owns
  // the terminal decision: a single-socket room is closed, and a PvP room is closed
  // when this seat was the last second human in it. So the only thing left here is
  // the record: the log line and the frame for the clients still watching.
  async handleEndGame(socket: GameSocket): Promise<void> {
    const gameId = socket.data.gameId;
    const color = socket.data.playerColor;
    if (!gameId || !color) return;

    const state = await this.store.loadGameState(gameId);
    if (!state) return;
    const player = state.players.find((p) => p.color === color);
    const username = player?.username || color;

    const { closed } = await this.engine.departSeat(
      gameId,
      color,
      'end_game',
      this.cleanup,
    );
    // A closed room already told everyone (`game_expired`) and deleted its state,
    // so there is nothing left to write into a snapshot.
    if (closed) return;

    // The departure is game state too, so its line is written into the snapshot (a
    // rejoining client rebuilds the panel from there) and carried by the frame for the
    // clients already watching.
    const after = await this.store.loadGameState(gameId);
    const log = after ? [pushLog(after, { kind: 'playerAborted', color })] : undefined;
    if (after) await this.store.saveGameState(gameId, after);
    this.publisher.publish({ type: 'player_aborted', gameId, color, username, log });
  }
}
