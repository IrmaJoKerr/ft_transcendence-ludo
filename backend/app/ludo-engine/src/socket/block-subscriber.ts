import Redis from 'ioredis';
import type { RedisGameStore } from '../redis';
import { withBlock, withoutBlock } from '../game-chat';

// The backend publishes `blocks:changed { a, b, blocked }` when an account blocks or
// unblocks another (M3). The engine holds the room's live ledger, so it is the side
// that has to apply the cut: the block is minted in the backend, the chat lines are
// minted here, and only this process knows the room's chat sequence.
//
// The channel name is duplicated from backend/src/common/channels.ts: the engine is a
// separate build with no import path into the backend.
export const BLOCKS_CHANGED_CHANNEL = 'blocks:changed';

interface BlocksMessage {
  a?: unknown;
  b?: unknown;
  blocked?: unknown;
}

export class BlockSubscriber {
  private subscriber: Redis;

  constructor(
    private store: RedisGameStore,
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
    this.subscriber.subscribe(BLOCKS_CHANGED_CHANNEL, (err, count) => {
      if (err) {
        console.error('Failed to subscribe to blocks:changed:', err);
      } else {
        console.log(`Subscribed to ${count} blocks:changed channel(s)`);
      }
    });
    this.subscriber.on('message', (_channel, message) => {
      void this.handle(message);
    });
  }

  async disconnect(): Promise<void> {
    await this.subscriber.quit();
  }

  // Applies to every live room that seats both accounts. Idempotent by construction:
  // a repeated block writes the same pair again, and an unblock of an unblocked pair
  // is a no-op.
  private async handle(message: string): Promise<void> {
    let parsed: BlocksMessage;
    try {
      parsed = JSON.parse(message) as BlocksMessage;
    } catch {
      return;
    }
    const a = typeof parsed.a === 'string' ? parsed.a : '';
    const b = typeof parsed.b === 'string' ? parsed.b : '';
    if (!a || !b) return;
    const blocked = parsed.blocked === true;

    try {
      for (const key of await this.store.scanGameKeys()) {
        const gameId = key.slice('game:'.length);
        const state = await this.store.loadGameState(gameId);
        // Only a room both accounts are seated in has anything to cut, and a finished
        // room's channel is closed anyway.
        if (!state || state.status === 'finished') continue;
        const seated = new Set(
          state.players.filter((player) => !player.isBot && player.userId).map((p) => p.userId),
        );
        if (!seated.has(a) || !seated.has(b)) continue;

        if (blocked) {
          // The cut is the first line the pair must not see: the counter is
          // incremented before a line is built, so the next line's sequence is this
          // one plus one, and every earlier line stays visible.
          const atSeq = (await this.store.currentChatSeq(gameId)) + 1;
          state.blockedPairs = withBlock(state.blockedPairs, { a, b, atSeq });
        } else {
          state.blockedPairs = withoutBlock(state.blockedPairs, a, b);
        }
        await this.store.saveGameState(gameId, state);
      }
    } catch (error) {
      console.error('Failed to apply a blocks:changed message:', error);
    }
  }
}
