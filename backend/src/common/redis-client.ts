import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { secret } from '../secrets';

// One token and one factory for the process-local Redis clients the backend
// services share. A module that used to open its own client in its constructor
// now provides this once and injects it; the lifecycle provider quits it when the
// module goes down. Redis pub/sub does not need a dedicated connection: ioredis
// enters subscriber mode per client, and every publisher here only calls
// `publish`, which is legal on a normal connection.
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export function createRedisClient(label = 'Redis'): Redis {
  const host = process.env.REDIS_HOST ?? 'redis';
  const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
  const password = secret('REDIS_PASSWORD');
  const client = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
  client.on('error', (error) => {
    console.error(`${label} error:`, error.message);
  });
  return client;
}

// Nest calls `onModuleDestroy` on every provider instance in the module, so this
// closes the connection the factory above opened. A factory provider has no
// lifecycle of its own; this class supplies the one the old `onModuleDestroy`
// methods had.
@Injectable()
export class RedisClientLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onModuleDestroy(): Promise<void> {
    // Match the old per-service teardown: let shutdown wait for the connection
    // to close, but never reject it (an already-closed client is fine).
    await this.client.quit().catch(() => undefined);
  }
}
