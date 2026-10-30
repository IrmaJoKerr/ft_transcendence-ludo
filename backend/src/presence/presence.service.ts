import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../notification/notification.service';
import { secret } from '../secrets';
import {
  PRESENCE_CONNS_PREFIX,
  PRESENCE_COUNT_CHANNEL,
  PRESENCE_COUNT_COALESCE_MS,
  PRESENCE_REFRESH_MS,
  PRESENCE_TTL_S,
  presenceConnsKey,
} from './presence.constants';

export type PresenceStatus = 'online' | 'playing' | 'offline';

// One live session-socket connection. `playing` is per connection (D3): the row
// takes the union of the local connections, so one tab in a match reads
// "playing" for the account and a close re-derives it from whichever remain.
type Connection = { userId: string; playing: boolean; refresh: NodeJS.Timeout };

// Presence state in Redis: `presence:{userId}` = "online" | "playing",
// expiring after PRESENCE_TTL_S. A missing key IS the offline state : the
// TTL does the cleanup, and the session socket is what keeps it refreshed.
@Injectable()
export class PresenceService implements OnModuleDestroy {
  private redis: Redis;

  // socket.id -> its connection. Every entry owns the refresh timer that keeps
  // its row and its `presence:conns:<userId>` membership alive.
  private connections = new Map<string, Connection>();
  // userId -> the one armed offline-edge check. Fires when the row should have
  // lapsed and re-checks the connection set before publishing anything.
  private offlineTimers = new Map<string, NodeJS.Timeout>();
  // The online count is a SCAN, so edges inside this window share one push.
  private countTimer: NodeJS.Timeout | null = null;
  private lastCountPush = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {
    // Host/port stay plain env : they're topology, not secrets.
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');

    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  async onModuleDestroy() {
    for (const connection of this.connections.values()) clearInterval(connection.refresh);
    this.connections.clear();
    for (const timer of this.offlineTimers.values()) clearTimeout(timer);
    this.offlineTimers.clear();
    if (this.countTimer) clearTimeout(this.countTimer);
    this.countTimer = null;
    await this.redis.quit();
  }

  private key(userId: string): string {
    return `presence:${userId}`;
  }

  // ── the session socket's side of presence (Phase 1) ───────────────────────
  // A session socket connected: join the account's connection set, (re)assert the
  // presence row and start the per-connection refresh that keeps both alive. This
  // is also where the `friend_online` edge now comes from (the heartbeat's
  // `wasOffline` test moved here with the liveness signal).
  async openConnection(userId: string, socketId: string, playing = false): Promise<void> {
    // Register in memory before the first `await`: the client emits
    // `presence:playing` on its own `connect`, which can arrive before these
    // Redis round trips finish, and an event for an unknown socket is dropped.
    this.installRefresh(userId, socketId, playing);

    await this.redis
      .multi()
      .sadd(presenceConnsKey(userId), socketId)
      .expire(presenceConnsKey(userId), PRESENCE_TTL_S)
      .exec();

    // Read before writing: a second tab must not re-toast every friend, and a
    // reconnect inside the TTL finds the row present, so it emits nothing at all.
    const wasOffline = (await this.redis.exists(this.key(userId))) === 0;
    await this.writeStatus(userId, this.playingNow(userId));

    if (wasOffline) {
      this.notifyFriendsPresence(userId, 'online').catch((error) => {
        console.error('Failed to broadcast friend presence:', error);
      });
      this.requestCountPush();
    }
  }

  // `presence:playing` (the only client -> server event): per connection (D3), so
  // a tab leaving a match never clears a sibling tab's flag.
  async setPlaying(userId: string, socketId: string, playing: boolean): Promise<void> {
    const connection = this.connections.get(socketId);
    // A stale event (the close raced it) must not resurrect the row.
    if (!connection || connection.userId !== userId) return;
    connection.playing = playing;
    await this.writeStatus(userId, this.playingNow(userId));
  }

  // A session socket closed: remove only this connection's member, then let the
  // row lapse on its TTL. Never clears the row (D3): a refresh that reconnects
  // inside the TTL finds it present, so no edge is emitted and no flap is seen.
  async closeConnection(userId: string, socketId: string): Promise<void> {
    const connection = this.connections.get(socketId);
    if (connection) {
      clearInterval(connection.refresh);
      this.connections.delete(socketId);
    }
    await this.redis.srem(presenceConnsKey(userId), socketId);

    // Redis is the authority on "any tab left", not this instance's map: that is
    // what keeps a multi-instance setup from flipping an account offline early.
    if ((await this.redis.scard(presenceConnsKey(userId))) > 0) {
      await this.writeStatus(userId, this.playingNow(userId));
      return;
    }
    // Nothing is left: arm the only place `friend_offline` can come from now.
    this.armOfflineEdge(userId);
  }

  // Record a client heartbeat for a non-socket client (the REST fallback kept for
  // first paint and for a browser whose socket cannot be established). The session
  // socket does not use it: there the connection itself is the liveness signal.
  async heartbeat(userId: string, playing: boolean): Promise<void> {
    // First heartbeat after the key lapsed means a new online session, so broadcast
    // "friend online" on this edge only (not on every beat: the key is refreshed
    // for the whole session).
    const wasOffline = (await this.redis.exists(this.key(userId))) === 0;
    await this.writeStatus(userId, playing);
    if (wasOffline) {
      this.notifyFriendsPresence(userId, 'online').catch((error) => {
        console.error('Failed to broadcast friend presence:', error);
      });
      this.requestCountPush();
    }
  }

  // Single-user lookup : e.g. a profile page for one specific account.
  async getStatus(userId: string): Promise<PresenceStatus> {
    const value = await this.redis.get(this.key(userId));
    return (value as PresenceStatus | null) ?? 'offline';
  }

  // Batched lookup for a friends list : a missing key means the TTL lapsed.
  async getStatuses(userIds: string[]): Promise<Record<string, PresenceStatus>> {
    if (userIds.length === 0) return {};
    const values = await this.redis.mget(userIds.map((id) => this.key(id)));
    const statuses: Record<string, PresenceStatus> = {};
    userIds.forEach((id, i) => {
      statuses[id] = (values[i] as PresenceStatus | null) ?? 'offline';
    });
    return statuses;
  }

  // Site-wide online count for the homepage badge : same SCAN idiom as
  // MatchQueryService. The connection sets live under `presence:conns:` for key
  // locality, so they are filtered out here: a set is not an account.
  async getOnlineCount(): Promise<number> {
    let cursor = '0';
    let count = 0;
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'presence:*', 'COUNT', 100);
      cursor = nextCursor;
      count += keys.filter((key) => !key.startsWith(PRESENCE_CONNS_PREFIX)).length;
    } while (cursor !== '0');
    return count;
  }

  // ── connection bookkeeping ────────────────────────────────────────────────
  private installRefresh(userId: string, socketId: string, playing: boolean): void {
    const previous = this.connections.get(socketId);
    if (previous) clearInterval(previous.refresh);
    const refresh = setInterval(() => {
      void this.refreshConnection(socketId);
    }, PRESENCE_REFRESH_MS);
    // A pending session socket must not hold the process open on shutdown.
    refresh.unref?.();
    this.connections.set(socketId, { userId, playing, refresh });
  }

  // Keeps the row and the connection set alive while the socket is open. This is
  // what lets the TTL stay a pure backstop: a live connection never lets its own
  // membership lapse, and a dead one simply stops refreshing.
  private async refreshConnection(socketId: string): Promise<void> {
    const connection = this.connections.get(socketId);
    if (!connection) return;
    try {
      await this.redis
        .multi()
        .expire(presenceConnsKey(connection.userId), PRESENCE_TTL_S)
        .set(this.key(connection.userId), this.playingNow(connection.userId) ? 'playing' : 'online', 'EX', PRESENCE_TTL_S)
        .exec();
    } catch (error) {
      console.error('Failed to refresh presence:', error);
    }
  }

  // The row carries the union of this instance's connections: a tab in a match
  // makes the account read "playing"; closing that tab falls back to "online" as
  // long as any sibling connection survives.
  private playingNow(userId: string): boolean {
    for (const connection of this.connections.values()) {
      if (connection.userId === userId && connection.playing) return true;
    }
    return false;
  }

  private async writeStatus(userId: string, playing: boolean): Promise<void> {
    await this.redis.set(this.key(userId), playing ? 'playing' : 'online', 'EX', PRESENCE_TTL_S);
  }

  // One armed check per account. It re-checks the connection set when it fires,
  // so a reconnect inside the window cancels the edge by construction rather than
  // by cancelling a handle (the reconnect-flap rule).
  private armOfflineEdge(userId: string, delayMs = PRESENCE_TTL_S * 1000): void {
    if (this.offlineTimers.has(userId)) return;
    const timer = setTimeout(() => {
      this.offlineTimers.delete(userId);
      void this.fireOfflineEdge(userId);
    }, delayMs);
    timer.unref?.();
    this.offlineTimers.set(userId, timer);
  }

  // The offline edge, once the row has actually lapsed. The TTL is the authority,
  // so a row still alive (a reconnect, or the REST fallback heartbeating) only
  // re-arms the check: publishing there would contradict the next status read.
  private async fireOfflineEdge(userId: string): Promise<void> {
    try {
      if ((await this.redis.scard(presenceConnsKey(userId))) > 0) return; // reconnected
      const ttlMs = await this.redis.pttl(this.key(userId));
      if (ttlMs >= 0) {
        this.armOfflineEdge(userId, ttlMs + 250);
        return;
      }
      if (ttlMs === -1) await this.redis.del(this.key(userId)); // no TTL: never expected
      await this.notifyFriendsPresence(userId, 'offline');
      this.requestCountPush();
    } catch (error) {
      console.error('Failed to publish the presence offline edge:', error);
    }
  }

  // `counts:online`, coalesced to at most one push per window: getOnlineCount() is
  // a SCAN, and a reconnect flap or two tabs at once must not run it twice. The
  // leading edge keeps the badge immediate; the trailing timer folds the rest.
  private requestCountPush(): void {
    const sinceLast = Date.now() - this.lastCountPush;
    if (sinceLast >= PRESENCE_COUNT_COALESCE_MS) {
      void this.pushCount();
      return;
    }
    if (this.countTimer) return;
    this.countTimer = setTimeout(() => {
      this.countTimer = null;
      void this.pushCount();
    }, PRESENCE_COUNT_COALESCE_MS - sinceLast);
    this.countTimer.unref?.();
  }

  private async pushCount(): Promise<void> {
    this.lastCountPush = Date.now();
    try {
      const count = await this.getOnlineCount();
      await this.redis.publish(PRESENCE_COUNT_CHANNEL, String(count));
    } catch (error) {
      console.error('Failed to publish the online count:', error);
    }
  }

  // Transient presence toast to all accepted friends on coming online or
  // logging out. Fire-and-forget : must never block heartbeat/logout.
  private async notifyFriendsPresence(userId: string, status: 'online' | 'offline'): Promise<void> {
    try {
      const friends = await this.prisma.db.friendship.findMany({
        where: {
          OR: [
            { user1Id: userId, user1Status: 'accepted', user2Status: 'accepted' },
            { user2Id: userId, user1Status: 'accepted', user2Status: 'accepted' },
          ],
        },
        select: { user1Id: true, user2Id: true },
      });
      const friendIds = [
        ...new Set(friends.map((f) => (f.user1Id === userId ? f.user2Id : f.user1Id))),
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
