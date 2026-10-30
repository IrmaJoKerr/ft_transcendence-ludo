import Redis from 'ioredis';
import type { LudoEngine } from '../engine';
import type { RedisGameStore } from '../redis';
import type { PlayerColor } from '../types';
import { SLOT_COLORS } from './join-manager';

// The backend publishes `match:abandon { gameId, userId }` when an account signs
// out while seated in a live game (D7). The backend cannot perform the departure
// itself: parking the seat, advancing the turn and emitting `player_exited` is
// finalizeDeparture, and in a 3-4 player room the seat must go while the room lives
// on. So this subscriber hands the room to the engine, which finalizes it under the
// game lock its grace replay already takes.
//
// The channel name is duplicated from backend/src/common/channels.ts: the engine is
// a separate build with no import path into the backend.
export const MATCH_ABANDON_CHANNEL = 'match:abandon';

interface AbandonMessage {
  gameId?: unknown;
  userId?: unknown;
}

export class MatchAbandonSubscriber {
  // A SUBSCRIBE cannot share the command client, so this is a connection of its
  // own, exactly like the rooms broadcaster's.
  private subscriber: Redis;

  constructor(
    private store: RedisGameStore,
    private engine: LudoEngine,
    // Drops the room's in-memory context when the departure tears the room down
    // (PvE, or the survivor of a 2-player room). Same callback the grace replay gets.
    private notifyAbort: (gameId: string) => void,
    redisUrl?: string,
  ) {
    const host = process.env.REDIS_HOST || 'redis';
    const port = parseInt(process.env.REDIS_PORT || '6479', 10);
    const password = process.env.REDIS_PASSWORD;
    this.subscriber = redisUrl
      ? new Redis(redisUrl)
      : new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
  }

  start(): void {
    this.subscriber.subscribe(MATCH_ABANDON_CHANNEL, (err, count) => {
      if (err) {
        console.error('Failed to subscribe to match:abandon:', err);
      } else {
        console.log(`Subscribed to ${count} match:abandon channel(s)`);
      }
    });
    this.subscriber.on('message', (_channel, message) => {
      void this.handle(message);
    });
  }

  async disconnect(): Promise<void> {
    await this.subscriber.quit();
  }

  // A departure is idempotent: an exited seat, a room already torn down and an
  // unknown id are all no-ops, so a redelivered message costs nothing.
  private async handle(message: string): Promise<void> {
    let parsed: AbandonMessage;
    try {
      parsed = JSON.parse(message) as AbandonMessage;
    } catch {
      return;
    }
    const gameId = typeof parsed.gameId === 'string' ? parsed.gameId : '';
    const userId = typeof parsed.userId === 'string' ? parsed.userId : '';
    if (!gameId || !userId) return;

    try {
      const data = await this.store.getMatchData(gameId);
      if (!data) return; // already torn down
      if (data.status === 'ABORTED' || data.status === 'ENDED') return;

      // Only a live room loses a seat: a finished room keeps its state for the
      // post-game window, and a waiting room is the idle watcher's business.
      const state = await this.store.loadGameState(gameId);
      if (!state || state.status !== 'active') return;

      // The hash owns seat -> account: the engine state's userId is absent for
      // hotseat seats, and a hotseat room can never receive this message anyway.
      const slot = [1, 2, 3, 4].find((n) => data[`player${n}_id`] === userId);
      if (!slot) return; // the account is not seated in this room
      const color = (data[`player${slot}_color`] as PlayerColor | undefined) ?? SLOT_COLORS[slot - 1];

      // 'leave' is the reason the shipped leave_game handler passes for an active
      // room, so a sign-out and a manual leave cannot drift apart.
      await this.engine.finalizeSeatDeparture(gameId, color, 'leave', this.notifyAbort);
    } catch (error) {
      console.error(`Failed to finalize the abandoned seat in ${gameId}:`, error);
    }
  }
}