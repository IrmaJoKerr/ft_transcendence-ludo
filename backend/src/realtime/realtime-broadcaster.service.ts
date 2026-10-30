import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AUTH_REVOKED_PREFIX } from '../auth/auth.constants';
import { secret } from '../secrets';
import { RealtimeGateway } from './realtime.gateway';

// The realtime module's own Redis subscriber. Today it carries the one family
// that exists: session revocation (D4). Rooms, friendship and presence families
// join it in Phases 2-3, which is why it is a service of its own rather than a
// method on the gateway.
@Injectable()
export class RealtimeBroadcaster implements OnModuleInit, OnModuleDestroy {
  // A subscribed ioredis connection cannot run ordinary commands, so it is never
  // the publisher the other services use.
  private redis: Redis | null = null;

  constructor(private readonly gateway: RealtimeGateway) {}

  onModuleInit(): void {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
    // Pattern subscription: the publisher names the account, not which sockets
    // exist, so a user with no socket costs nothing and needs no unsubscribe.
    this.redis.on('pmessage', (_pattern, channel) => {
      this.gateway.disconnectUser(channel.slice(AUTH_REVOKED_PREFIX.length));
    });
    this.redis.psubscribe(`${AUTH_REVOKED_PREFIX}*`).catch((error) => {
      console.error('Failed to subscribe to session revocations:', error);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit();
    this.redis = null;
  }
}
