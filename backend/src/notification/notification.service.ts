import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { randomUUID } from 'crypto';
import { secret } from '../secrets';
// Types
// notification types.
export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'friend_removed'
  | 'friend_declined'
  | 'game_invite'
  | 'achievement'
  | 'match_finished'
  | 'match_cancelled'
  | 'profile_updated'
  | 'display_name_changed'
  | 'friend_online'
  | 'friend_offline'
  | 'avatar_changed';

// Shape of one frame. Persisted entries and the transient pushes share it: it is
// what the session socket carries and what the bell stores (D12).
export interface NotificationPayload {
  id: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  read: boolean;
  createdAt: string; // ISO string
}

// Where a frame goes: one account, or every connected socket. The gateway owns
// the rooms, so the hub only names the target.
type Deliver = (target: string | 'all', event: NotificationPayload) => void;

// D12: at most 150 unread per account, and both keys idle out after 14 days.
const UNREAD_CAP = 150;
const NOTIFICATION_TTL_S = 14 * 24 * 60 * 60;

// One write: the entry, its unread index, both TTLs and the trim, in one round
// trip. The trim runs server-side, so a second tab cannot push the set past the
// cap between two client calls. The score is createdAt in ms, stamped once, so
// the order and the payload cannot disagree.
const WRITE_NOTIFICATION = `
local hash = KEYS[1]
local unread = KEYS[2]
local id = ARGV[1]
local json = ARGV[2]
local score = ARGV[3]
local ttl = tonumber(ARGV[4])
local cap = tonumber(ARGV[5])
redis.call('HSET', hash, id, json)
redis.call('ZADD', unread, score, id)
redis.call('EXPIRE', hash, ttl)
redis.call('EXPIRE', unread, ttl)
while redis.call('ZCARD', unread) > cap do
  local popped = redis.call('ZPOPMIN', unread)
  if #popped == 0 then break end
  redis.call('HDEL', hash, popped[1])
end
return 1
`;

@Injectable()
// Notification hub: the bell lives in Redis (D12) and frames reach the client
// over the session socket. Called by most services (friends, match,
// achievements, presence, auth, user) and by notification.controller.ts.
export class NotificationService implements OnModuleDestroy {
  // Redis writer: the two `notif:` keys and the publisher.
  private pub: Redis;
  // Redis subscriber: every `notify:*` frame, routed to the deliverer below.
  private sub: Redis;

  // The sink. The gateway sets it at boot: one account's room, or every socket
  // for `notify:all`. Until it is set there are no sockets to deliver to.
  private deliverer: Deliver | null = null;

  constructor() {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    const opts = { host, port, password, retryStrategy: (t: number) => Math.min(t * 50, 2000) };

    this.pub = new Redis(opts);
    this.sub = new Redis(opts);

    this.pub.on('error', (e) => {
      console.error('Notification pub Redis error:', e.message);
    });
    this.sub.on('error', (e) => {
      console.error('Notification sub Redis error:', e.message);
    });

    // One pattern subscription, not per-user subscribe/unsubscribe churn:
    // `notify:<userId>` and `notify:all` are both matched here.
    this.sub.psubscribe('notify:*').catch((err) => {
      console.error('Failed to subscribe to notify:*:', err);
    });
    this.sub.on('pmessage', (_pattern: string, channel: string, message: string) => {
      let target: string;
      let event: NotificationPayload;
      try {
        target = channel.slice('notify:'.length);
        event = JSON.parse(message) as NotificationPayload;
      } catch {
        console.error('Failed to parse notification message:', message);
        return;
      }
      this.deliver(target === 'all' ? 'all' : target, event);
    });
  }

  async onModuleDestroy() {
    await this.pub.quit();
    await this.sub.quit();
  }

  // Set once by the gateway: delivery is the socket's job, while the store and
  // the pub/sub are this service's.
  setDeliverer(deliver: Deliver): void {
    this.deliverer = deliver;
  }

  private deliver(target: string | 'all', event: NotificationPayload): void {
    // No gateway yet means no sockets either: the connect snapshot is what
    // repairs a frame published in that window.
    this.deliverer?.(target, event);
  }

  // `notif:<uid>` is the inbox hash; `notif:<uid>:unread` indexes it. The
  // pub/sub channels keep their own `notify:` prefix.
  private hashKey(userId: string): string {
    return `notif:${userId}`;
  }

  private unreadKey(userId: string): string {
    return `notif:${userId}:unread`;
  }
  // Emit a notification
  // Store a notification for a user (D12) and push it live over Redis Pub/Sub to
  // every socket that account has open.
  async notify(
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // Failure contract: this method NEVER throws. A notification is a
    // non-critical side effect, the stored entry is authoritative for the bell,
    // and failures are only logged.
    const event: NotificationPayload = {
      id: randomUUID(),
      type,
      payload,
      read: false,
      createdAt: new Date().toISOString(),
    };

    // 1. Store it: hash entry, unread index, TTLs and the trim in one EVAL.
    try {
      await this.pub.eval(
        WRITE_NOTIFICATION,
        2,
        this.hashKey(userId),
        this.unreadKey(userId),
        event.id,
        JSON.stringify(event),
        String(Date.parse(event.createdAt)),
        String(NOTIFICATION_TTL_S),
        String(UNREAD_CAP),
      );
    } catch (err) {
      console.error(`[notifications] write failed for ${type} -> user ${userId}:`, err);
      return;
    }

    // 2. Publish: the subscriber handler routes it to the account's room.
    //    Best-effort: a failure here only delays the toast; the stored entry is
    //    in the bell on the next connect.
    try {
      await this.pub.publish(`notify:${userId}`, JSON.stringify(event));
    } catch (err) {
      console.warn(
        `[notifications] live push failed for ${type} -> user ${userId} (stored, shows on next connect):`,
        err,
      );
    }
  }

  // SHORT-LIVED/TRANSIENT global broadcast (toast only, never stored): offline
  // users don't see it and the bell badge is never flooded.
  async broadcast(type: NotificationType, payload: Record<string, unknown>): Promise<void> {
    const event: NotificationPayload = {
      id: randomUUID(),
      type,
      payload,
      read: false,
      createdAt: new Date().toISOString(),
    };
    // Best-effort (transient toast only: nothing stored). Never throws, so
    // callers (avatar upload/delete, display-name change) can't fail because a
    // live broadcast hiccuped.
    try {
      await this.pub.publish('notify:all', JSON.stringify(event));
    } catch (err) {
      console.warn(`[notifications] global broadcast failed for ${type}:`, err);
    }
  }

  // SHORT-LIVED/TRANSIENT per-user notification (same path as notify(), no
  // stored entry) so ephemeral events can't flood the bell.
  async notifyTransient(
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: NotificationPayload = {
      id: randomUUID(),
      type,
      payload,
      read: false,
      createdAt: new Date().toISOString(),
    };
    // Best-effort (transient toast only: nothing stored). Never throws, so a
    // socket open or a sign-out can't be disturbed by a delivery failure.
    try {
      await this.pub.publish(`notify:${userId}`, JSON.stringify(event));
    } catch (err) {
      console.warn(`[notifications] transient push failed for ${type} -> user ${userId}:`, err);
    }
  }
  // Bell reads (the connect snapshot and the write routes)
  // The unread list, newest first. Every id in the index is unread by
  // construction, so there is nothing to filter and the badge is its ZCARD.
  async getUnread(userId: string): Promise<NotificationPayload[]> {
    const ids = await this.pub.zrevrange(this.unreadKey(userId), 0, -1);
    if (ids.length === 0) return [];

    const values = await this.pub.hmget(this.hashKey(userId), ...ids);
    const events: NotificationPayload[] = [];
    const gone: string[] = [];
    ids.forEach((id, index) => {
      const raw = values[index];
      if (!raw) {
        gone.push(id);
        return;
      }
      try {
        events.push(JSON.parse(raw) as NotificationPayload);
      } catch {
        gone.push(id);
      }
    });

    // An id whose entry has gone (a trim, the TTL, a bad value) leaves the index
    // too, so the badge never counts a ghost.
    if (gone.length > 0) {
      await this.pub.zrem(this.unreadKey(userId), ...gone).catch(() => {});
    }
    return events;
  }

  // Reading an entry deletes it: the nudge is spent. A missing id (trimmed,
  // expired, another account's) is a no-op, as updateMany was.
  async markRead(notificationId: string, userId: string): Promise<void> {
    await this.pub
      .multi()
      .hdel(this.hashKey(userId), notificationId)
      .zrem(this.unreadKey(userId), notificationId)
      .exec();
  }

  // Mark all notifications as read for a user: the entries go, not just a flag.
  async markAllRead(userId: string): Promise<void> {
    await this.clear(userId);
  }

  // Both keys, both callers: read-all and account deletion (the `DEL` that
  // replaces the old `onDelete: Cascade`).
  async clear(userId: string): Promise<void> {
    await this.pub.del(this.hashKey(userId), this.unreadKey(userId));
  }
}

