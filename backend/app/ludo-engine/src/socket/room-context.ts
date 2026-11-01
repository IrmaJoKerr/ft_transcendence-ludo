import type { GameState, PlayerColor } from '../types';

// RoomContext is the engine's in-memory owner of one awake room: the human seat
// bindings and the room-scoped timers. Redis stays the system of record for turn,
// seats, pieces and deadlines. The wake pass rebuilds it at boot.
export class RoomContext {
  // Seat identity per colour, for human seats only. A bot seat is identified from the
  // persisted state (`players[].isBot`), never from here: this map is empty after a
  // restart, and reading it to detect bots is what froze bot games.
  readonly seats = new Map<PlayerColor, string>();

  private idleTimer?: NodeJS.Timeout;
  private postGameTimer?: NodeJS.Timeout;

  constructor(readonly gameId: string) {}

  seat(color: PlayerColor): string | undefined {
    return this.seats.get(color);
  }

  bindSeat(color: PlayerColor, userId: string): void {
    this.seats.set(color, userId);
  }

  // Hydrate the human seat bindings from the persisted state, so a rebuilt room
  // knows who held which colour without waiting for a rejoin.
  rebuild(state: GameState): void {
    for (const player of state.players) {
      if (player.isBot) continue;
      if (player.userId) this.seats.set(player.color, player.userId);
    }
  }

  // --- idle-lobby window: a WAITING room with fewer than two seated players is
  //     aborted once its persisted `idleSince` stamp is IDLE_LOBBY_TIMEOUT_MS old.
  armIdle(delayMs: number, onExpire: () => void): void {
    this.cancelIdle();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      onExpire();
    }, delayMs);
  }

  cancelIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
  }

  // --- post-game window: a finished room is expired POST_GAME_TIMEOUT_MS after
  //     the game ended (or after the wake pass re-armed it).
  armPostGame(delayMs: number, onFire: () => void): void {
    this.cancelPostGame();
    this.postGameTimer = setTimeout(() => {
      this.postGameTimer = undefined;
      onFire();
    }, delayMs);
  }

  cancelPostGame(): void {
    if (this.postGameTimer) clearTimeout(this.postGameTimer);
    this.postGameTimer = undefined;
  }

  // Drop every timer this room owns.
  dispose(): void {
    this.cancelIdle();
    this.cancelPostGame();
  }
}

// RoomRegistry: the per-process set of awake rooms, keyed by game id. It
// replaces the bare `Map<gameId, Map<color, userId>>` the socket modules used to
// share, so a room's bindings and timers have one owner and one disposal path.
export class RoomRegistry {
  private rooms = new Map<string, RoomContext>();

  get(gameId: string): RoomContext | undefined {
    return this.rooms.get(gameId);
  }

  // The context for a room, created on first use.
  ensure(gameId: string): RoomContext {
    let ctx = this.rooms.get(gameId);
    if (!ctx) {
      ctx = new RoomContext(gameId);
      this.rooms.set(gameId, ctx);
    }
    return ctx;
  }

  // Forget a room and dispose its timers. Idempotent.
  delete(gameId: string): void {
    this.rooms.get(gameId)?.dispose();
    this.rooms.delete(gameId);
  }

  get size(): number {
    return this.rooms.size;
  }
}
