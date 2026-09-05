import Redis from 'ioredis';
import { secret } from './secrets';

/**
 * Shared ioredis client factory.
 *
 * Two connection modes, chosen by env:
 *  - REDIS_URL — a single URL, e.g. `rediss://user:pass@host:port` (Upstash and
 *    other managed Redis). ioredis enables TLS automatically for `rediss://`.
 *  - REDIS_HOST / REDIS_PORT / REDIS_PASSWORD — the classic compose form; set
 *    REDIS_TLS=true when the host requires TLS (managed providers).
 *
 * Every backend service that touches Redis goes through here, so switching
 * providers (e.g. Docker Redis → Upstash) is a one-env change, not a code change.
 */
export function createRedis(): Redis {
  const url = secret('REDIS_URL');
  const retryStrategy = (t: number) => Math.min(t * 50, 2000);

  if (url) {
    return new Redis(url, { retryStrategy });
  }

  const host = process.env.REDIS_HOST || 'redis';
  const port = parseInt(process.env.REDIS_PORT || '6479', 10);
  const password = secret('REDIS_PASSWORD');
  const tls = secret('REDIS_TLS') === 'true' ? {} : undefined;

  return new Redis({ host, port, password, tls, retryStrategy });
}
