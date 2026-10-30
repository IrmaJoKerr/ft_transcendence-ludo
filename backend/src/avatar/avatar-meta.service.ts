import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';

// Avatar cache shared with the ludo-engine: `avatar:<userId>` = { has, style, v }.
// Postgres stores the photo bytes, so this record is only a cache: write it AFTER
// the Postgres write, and read a miss as has=false.
export interface AvatarMeta {
  has: boolean;
  style?: string;
  /** Change stamp (epoch ms). Lets a reader ignore out-of-order updates. */
  v?: number;
}

// Only the fields needed to derive the record, so callers can pass a row they
// have already loaded instead of paying for another query.
export interface AvatarMetaSource {
  id: string;
  avatarStyle?: string | null;
  avatarPhotoContentType?: string | null;
}

@Injectable()
// Small Redis-backed avatar metadata cache, shared with the ludo-engine: written
// by the user/auth services after their Postgres writes, read by the engine.
export class AvatarMetaService implements OnModuleDestroy {
  private redis: Redis;

  constructor(private readonly prisma: PrismaService) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Avatar meta Redis error:', error.message);
    });
  }

  private key(userId: string): string {
    return `avatar:${userId}`;
  }

  // Write-through; call it only AFTER the Postgres row is committed. Never
  // throws: a Redis failure must not fail an upload/delete. Returns the change
  // stamp, which callers echo into avatar_changed as the client's `?v=`.
  async set(userId: string, meta: { has: boolean; style?: string | null }): Promise<number> {
    const v = Date.now();
    try {
      await this.redis.hset(this.key(userId), {
        has: meta.has ? '1' : '0',
        style: meta.style ?? 'bottts',
        v: v.toString(),
      });
    } catch (error) {
      console.warn(`[avatar-meta] cache write failed for ${userId}:`, error);
    }
    return v;
  }

  // Read-through repair from a row the caller already loaded (no extra query):
  // a missed write or an eviction converges on the next read. Read first and
  // write only when `has`/`style` diverge — a repair, not a touch: `set` mints a
  // new stamp, and a stamp that moved on every profile view would bust the
  // client's avatar cache for no reason (the payload now echoes it as `?v=`).
  // Returns the stamp the record holds (undefined if it was read as absent and
  // the repair write could not land either).
  async syncFromUser(user: AvatarMetaSource): Promise<number | undefined> {
    const has = user.avatarPhotoContentType != null;
    const style = user.avatarStyle ?? 'bottts';

    const current = await this.get(user.id);
    if (current?.has === has && current.style === style) return current.v;

    return this.set(user.id, { has, style });
  }

  async get(userId: string): Promise<AvatarMeta | null> {
    try {
      // hgetall never returns null; a missing hash is `{}`, so an absent `has`
      // field is the "no record" signal. The nullable annotation below keeps the
      // runtime check honest.
      const data: Record<string, string | undefined> = await this.redis.hgetall(this.key(userId));
      if (data.has === undefined) return null;
      return {
        has: data.has === '1',
        style: data.style,
        v: data.v ? parseInt(data.v, 10) : undefined,
      };
    } catch {
      return null;
    }
  }

  // Account deletion: drop the record for the deleted user id.
  async remove(userId: string): Promise<void> {
    try {
      await this.redis.del(this.key(userId));
    } catch (error) {
      console.warn(`[avatar-meta] cache delete failed for ${userId}:`, error);
    }
  }

  onModuleDestroy(): void {
    void this.redis.quit().catch(() => undefined);
  }
}
