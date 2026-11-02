import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { AUTH_REVOKED_PREFIX } from '../auth/auth.constants';
import { parseChatRecord } from '../chat/chat.service';
import {
  CHAT_CHANNEL,
  FRIENDSHIP_CHANNEL_PREFIX,
  ROOMS_CHANGED_CHANNEL,
  chatPubSubChannel,
} from '../common/channels';
import { parseFriendshipRecord } from '../friends/friendship-record';
import { MatchQueryService, lobbyRoomsFor, myRoomsFor } from '../match/match.query.service';
import { PRESENCE_COUNT_CHANNEL } from '../presence/presence.constants';
import { secret } from '../secrets';
import { EVENT_ROOMS_LIST, EVENT_ROOMS_MINE } from './realtime.constants';
import { RealtimeGateway } from './realtime.gateway';

// How long a burst of `rooms:changed` publishes is folded into one snapshot read,
// and how often the repair tick recomputes anyway (insurance for a publish a crash
// or a reconnecting subscriber lost). Both are the plan's Phase 2 numbers.
const ROOMS_DEBOUNCE_MS = 500;
const ROOMS_REPAIR_TICK_MS = 30_000;

// The realtime module's own Redis subscriber. It carries five families: session
// revocation (D4), the site-wide online count (Phase 1), rooms changes (Phase 2),
// friendship records (Phase 3) and the public chat channel (queue item 3).
// Notifications join it in Phase 4, which is why it is a service of its own rather
// than a method on the gateway.
@Injectable()
export class RealtimeBroadcaster implements OnModuleInit, OnModuleDestroy {
  // A subscribed ioredis connection cannot run ordinary commands, so it is never
  // the publisher the other services use.
  private redis: Redis | null = null;

  // The debounce handle for rooms changes, and the repair tick's.
  private roomsTimer: NodeJS.Timeout | null = null;
  private roomsTick: NodeJS.Timeout | null = null;
  // userId -> the exact payload pair last emitted to it. Emitting only a changed
  // payload is what the diff is for: a room that changed for somebody else must
  // not repaint this viewer's lobby.
  private lastRooms = new Map<string, string>();

  constructor(
    private readonly gateway: RealtimeGateway,
    private readonly match: MatchQueryService,
  ) {}

  onModuleInit(): void {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
    // Pattern subscriptions: the revocation publisher names the account, not which
    // sockets exist, and a friendship record names its one recipient, so a user
    // with no socket costs nothing and needs no unsubscribe.
    this.redis.on('pmessage', (_pattern, channel, message) => {
      if (channel.startsWith(FRIENDSHIP_CHANNEL_PREFIX)) {
        // Already viewer-relative (the publisher resolved the audience), so this
        // side routes it: room in, frames out. A malformed record is dropped here
        // rather than reaching a client as a shape the reducer cannot read.
        const record = parseFriendshipRecord(message);
        if (!record) return;
        const recipientId = channel.slice(FRIENDSHIP_CHANNEL_PREFIX.length);
        // The chat filter's update path (queue item 3): the record's state is
        // relative to this recipient, so a block of their own is what it carries.
        this.gateway.noteBlockState(recipientId, record.state, record.friend.id);
        this.gateway.emitToFriends(recipientId, record);
        return;
      }
      this.gateway.disconnectUser(channel.slice(AUTH_REVOKED_PREFIX.length));
    });
    this.redis
      .psubscribe(`${AUTH_REVOKED_PREFIX}*`, `${FRIENDSHIP_CHANNEL_PREFIX}*`)
      .catch((error) => {
        console.error('Failed to subscribe to session revocations/friendship records:', error);
      });

    // The online count is one number for the whole site, so it is a plain
    // channel rather than a per-user one; a non-numeric payload is refused here
    // instead of reaching every client as NaN. The rooms channel carries no
    // payload at all: the flush re-reads the snapshot itself.
    this.redis.on('message', (channel, message) => {
      if (channel === PRESENCE_COUNT_CHANNEL) {
        const count = Number(message);
        if (Number.isFinite(count)) this.gateway.emitCountsOnline(count);
        return;
      }
      if (channel === ROOMS_CHANGED_CHANNEL) {
        this.scheduleRooms();
        return;
      }
      if (channel === chatPubSubChannel(CHAT_CHANNEL)) {
        // The frame is fanned out to this instance's own sockets, which is exactly
        // the right set: a plain channel, like the online count, with no room emit
        // and no Redis adapter. The sender's block list is stripped by `emitChat`.
        const record = parseChatRecord(message);
        if (record) this.gateway.emitChat(record.message, record.senderBlocked);
      }
    });
    this.redis
      .subscribe(PRESENCE_COUNT_CHANNEL, ROOMS_CHANGED_CHANNEL, chatPubSubChannel(CHAT_CHANNEL))
      .catch((error) => {
        console.error('Failed to subscribe to the count/rooms/chat channels:', error);
      });

    // The repair tick. It has two jobs, both deliberate: repair a publish that was
    // lost (a crash between write and publish, a subscriber that was reconnecting)
    // and *count* the diffs it had to emit. A steady non-zero count is a coverage
    // hole in the publish sites, which is the only way that failure mode becomes
    // noticeable at all.
    this.roomsTick = setInterval(() => {
      void this.flushRooms(true);
    }, ROOMS_REPAIR_TICK_MS);
    this.roomsTick.unref?.();
  }


  async onModuleDestroy(): Promise<void> {
    if (this.roomsTimer) clearTimeout(this.roomsTimer);
    if (this.roomsTick) clearInterval(this.roomsTick);
    this.roomsTimer = null;
    this.roomsTick = null;
    await this.redis?.quit();
    this.redis = null;
  }

  // Fold a burst of publishes into one snapshot read.
  private scheduleRooms(): void {
    if (this.roomsTimer) return;
    this.roomsTimer = setTimeout(() => {
      this.roomsTimer = null;
      void this.flushRooms(false);
    }, ROOMS_DEBOUNCE_MS);
    this.roomsTimer.unref?.();
  }

  // Read one snapshot, then derive each connected viewer's payload from it. The
  // list is per viewer only because a row carries `mySeat` (D1); the snapshot is
  // shared, so a change costs one scan, not one per user.
  private async flushRooms(repair: boolean): Promise<void> {
    let snapshot: Awaited<ReturnType<MatchQueryService['snapshot']>>;
    try {
      snapshot = await this.match.snapshot();
    } catch (error) {
      console.error('Failed to read the rooms snapshot:', error);
      return;
    }

    // One extra read per flush: every blocked pair, folded per account, so each
    // viewer's list can drop a room that holds somebody they blocked without a
    // query of its own (queue item 3's lobby half). A failed read leaves the list
    // unfiltered rather than blank: the join route still refuses the pair.
    let blockedByViewer = new Map<string, Set<string>>();
    try {
      blockedByViewer = await this.match.blockedByViewer();
    } catch (error) {
      console.error('Failed to read blocked pairs:', error);
    }

    const viewers = this.gateway.connectedUserIds();
    let repaired = 0;
    for (const userId of viewers) {
      const list = lobbyRoomsFor(snapshot, userId, blockedByViewer.get(userId));
      const mine = myRoomsFor(snapshot, userId);
      const signature = JSON.stringify([list, mine]);
      if (this.lastRooms.get(userId) === signature) continue;
      this.lastRooms.set(userId, signature);
      this.gateway.emitToUser(userId, EVENT_ROOMS_LIST, list);
      this.gateway.emitToUser(userId, EVENT_ROOMS_MINE, mine);
      if (repair) repaired += 1;
    }

    // Drop the payloads of accounts with no socket left: a reconnect must always
    // receive the current state instead of diffing against a stale cache.
    const alive = new Set(viewers);
    for (const userId of this.lastRooms.keys()) {
      if (!alive.has(userId)) this.lastRooms.delete(userId);
    }

    if (repair && repaired > 0) {
      console.warn(`[rooms] repair tick emitted ${repaired} diff(s)`);
    }
  }
}
