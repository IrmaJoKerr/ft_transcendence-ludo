import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createRedis } from '../redis';
import { secret } from '../secrets';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../notification/notification.service';

export type PresenceStatus = 'online' | 'playing' | 'offline';

// Heartbeats land every ~20s from the client (see store.tsx); the TTL covers
// two missed beats before a stale/closed tab reads back as offline.
const PRESENCE_TTL_S = 45;

/**
 * Presence state in Redis, same idiom as LeaderboardRedisService/MatchService:
 *  - `presence:{userId}` -> "online" | "playing", expiring after PRESENCE_TTL_S
 *
 * A missing key IS the offline state — nothing to clean up, TTL does it.
 *
 * Presence changes are also broadcast to the user's friends as transient
 * toasts: the offline→online edge (first heartbeat of a fresh session) is
 * treated as "logged in", and clear() (explicit logout) as "logged out".
 */
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {
    // Host/port stay plain env — they're topology, not secrets.
    this.redis = createRedis();
    this.redis.on('error', (error) => console.error('Redis error:', (error as Error).message));
  }

  onModuleDestroy() {
    this.redis.quit();
  }

  private key(userId: string): string {
    return `presence:${userId}`;
  }

  async heartbeat(userId: string, playing: boolean): Promise<void> {
    // First heartbeat after the key lapsed = a fresh online session. Broadcast
    // "friend online" to the user's friends on this edge (not on every beat —
    // the key stays alive for the full session).
    const wasOffline = (await this.redis.exists(this.key(userId))) === 0;
    await this.redis.set(this.key(userId), playing ? 'playing' : 'online', 'EX', PRESENCE_TTL_S);
    if (wasOffline) {
      this.notifyFriendsPresence(userId, 'online').catch((error) =>
        console.error('Failed to broadcast friend presence:', error),
      );
    }
  }

  /** Immediate offline on logout, rather than waiting out the TTL. */
  async clear(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
    this.notifyFriendsPresence(userId, 'offline').catch((error) =>
      console.error('Failed to broadcast friend presence:', error),
    );
  }

  /** Single-user lookup — e.g. a profile page for one specific account. */
  async getStatus(userId: string): Promise<PresenceStatus> {
    const value = await this.redis.get(this.key(userId));
    return (value as PresenceStatus) ?? 'offline';
  }

  /** Batched lookup for a friends list — a missing key means the TTL lapsed. */
  async getStatuses(userIds: string[]): Promise<Record<string, PresenceStatus>> {
    if (userIds.length === 0) return {};
    const values = await this.redis.mget(userIds.map((id) => this.key(id)));
    const statuses: Record<string, PresenceStatus> = {};
    userIds.forEach((id, i) => {
      statuses[id] = (values[i] as PresenceStatus) ?? 'offline';
    });
    return statuses;
  }

  /** Site-wide online count for the homepage badge — same SCAN idiom as MatchQueryService. */
  async getOnlineCount(): Promise<number> {
    let cursor = '0';
    let count = 0;
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'presence:*', 'COUNT', 100);
      cursor = nextCursor;
      count += keys.length;
    } while (cursor !== '0');
    return count;
  }

  /**
   * Broadcast a transient presence toast to every accepted friend of `userId`
   * when they come online (fresh session heartbeat) or log out (explicit
   * logout). Fire-and-forget — a lookup failure must never block the
   * heartbeat/logout response.
   */
  private async notifyFriendsPresence(userId: string, status: 'online' | 'offline'): Promise<void> {
    try {
      const friends = await this.prisma.db.friendship.findMany({
        where: {
          OR: [
            { userId, status: 'accepted' },
            { friendId: userId, status: 'accepted' },
          ],
        },
        select: { userId: true, friendId: true },
      });
      const friendIds = [
        ...new Set(
          friends.flatMap((f) => (f.userId === userId ? [f.friendId] : [f.userId])),
        ),
      ];
      if (friendIds.length === 0) return;

      const actor = await this.prisma.db.user.findUnique({
        where: { id: userId },
        select: { username: true, displayName: true },
      });

      const type = status === 'online' ? 'friend_online' : 'friend_offline';
      const payload = {
        userId,
        fromUsername: actor?.username ?? 'Pilot',
        displayName: actor?.displayName ?? actor?.username ?? 'Pilot',
      };
      await Promise.all(
        friendIds.map((friendId) => this.notifications.notifyTransient(friendId, type, payload)),
      );
    } catch (error) {
      console.error('Failed to broadcast friend presence:', error);
    }
  }
}
