import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { AvatarMetaService } from '../avatar/avatar-meta.service';
import { friendshipChannel } from '../common/channels';
import { PresenceService } from '../presence/presence.service';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import { pairKey } from './friendship-pair';
import {
  stateSince,
  viewerState,
  type FriendshipFriendView,
  type FriendshipRecord,
  type FriendshipRowLike,
  type FriendshipViewState,
} from './friendship-record';

// The profile fields a record carries: the whole row the client keeps, so no
// second request is needed to paint it.
const PROFILE_SELECT = {
  id: true,
  username: true,
  displayName: true,
  avatarStyle: true,
  avatarPhotoContentType: true,
  rating: true,
} as const;

type ProfileRow = {
  id: string;
  username: string;
  displayName: string;
  avatarStyle: string;
  avatarPhotoContentType: string | null;
  rating: number;
};

// The publisher for `friendship:changed` (socket D2). A leaf module on purpose:
// the trigger sites span friends, auth, user and match, and MatchModule already
// imports AuthModule, so a publisher inside FriendsModule would close that cycle.
//
// `publishPair` emits both directions of a changed row; `publishSubject` emits an
// `accepted` record to every accepted friend when the account's own row changes
// (display name, avatar, postgame rating). Both are best effort: a live-update
// failure is logged and never fails the write that caused it. Nothing is built
// when no recipient has a live presence row (D2's zero-watcher rule).
@Injectable()
export class FriendshipEventsService implements OnModuleDestroy {
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly avatars: AvatarMetaService,
  ) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Friendship events Redis error:', error.message);
    });
  }

  onModuleDestroy(): void {
    void this.redis.quit().catch(() => undefined);
  }

  // A membership mutation committed: publish one record per direction, each with
  // that side's own state. Never throws — a live-update failure must not fail the
  // write that caused it.
  async publishPair(aId: string, bId: string): Promise<void> {
    try {
      const pair = await this.prisma.db.friendship.findUnique({
        where: { pairKey: pairKey(aId, bId) },
        include: {
          user1: { select: PROFILE_SELECT },
          user2: { select: PROFILE_SELECT },
        },
      });
      if (!pair) return;

      const watchers = await this.watched([pair.user1Id, pair.user2Id]);
      if (watchers.length === 0) return;

      // One pipelined read for both stamps; each side's record describes the other.
      const avatars = await this.avatars.getMany([pair.user1Id, pair.user2Id]);
      const now = Date.now();

      await Promise.all(
        watchers.map((recipientId) => {
          const other = recipientId === pair.user1Id ? pair.user2 : pair.user1;
          const state = viewerState(pair, recipientId, now);
          return this.publish(
            recipientId,
            this.build(recipientId, state, other, pair, avatars[other.id]?.v),
          );
        }),
      );
    } catch (error) {
      console.warn('[friendship] pair publish failed:', error);
    }
  }

  // The subject's display name, avatar or rating changed: an accepted friend's row
  // carries all three, so each of them needs the new copy. `friendsSince` differs
  // per friend (it is the pair's own age), everything else is shared.
  async publishSubject(userId: string): Promise<void> {
    try {
      const rows = await this.prisma.db.friendship.findMany({
        where: {
          user1Status: 'accepted',
          user2Status: 'accepted',
          OR: [{ user1Id: userId }, { user2Id: userId }],
        },
        select: { id: true, user1Id: true, user2Id: true, createdAt: true },
      });
      if (rows.length === 0) return;

      const recipients = rows.map((row) => (row.user1Id === userId ? row.user2Id : row.user1Id));
      const watchers = new Set(await this.watched(recipients));
      if (watchers.size === 0) return;

      const subject = await this.prisma.db.user.findUnique({
        where: { id: userId },
        select: PROFILE_SELECT,
      });
      if (!subject) return;

      const avatar = await this.avatars.get(userId);

      await Promise.all(
        rows.map((row) => {
          const recipientId = row.user1Id === userId ? row.user2Id : row.user1Id;
          if (!watchers.has(recipientId)) return Promise.resolve();
          const record: FriendshipRecord = {
            state: 'accepted',
            friend: this.friendView(subject, avatar?.v, row.createdAt, null),
          };
          return this.publish(recipientId, record);
        }),
      );
    } catch (error) {
      console.warn('[friendship] subject publish failed:', error);
    }
  }

  // The accounts with a live socket right now. A lapsed presence row is the only
  // reason to skip a build, so an offline friend list costs one mget.
  private async watched(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const statuses = await this.presence.getStatuses(userIds);
    return userIds.filter((id) => statuses[id] !== 'offline');
  }

  private build(
    recipientId: string,
    state: FriendshipViewState,
    other: ProfileRow,
    pair: FriendshipRowLike,
    avatarV: number | undefined,
  ): FriendshipRecord {
    return {
      state,
      friend: this.friendView(
        other,
        avatarV,
        stateSince(pair, recipientId, state),
        state === 'pending-in' || state === 'pending-out' ? pair.id : null,
      ),
    };
  }

  // One row of another account, as the recipient keeps it.
  private friendView(
    user: ProfileRow,
    avatarV: number | undefined,
    since: Date | null,
    requestId: string | null,
  ): FriendshipFriendView {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarStyle: user.avatarStyle,
      // The stamp becomes the photo URL's `?v=` on the client; absent it, the
      // cached bytes are reused, which is exactly what an unchanged avatar wants.
      ...(avatarV === undefined ? {} : { avatarV }),
      hasAvatarPhoto: user.avatarPhotoContentType !== null,
      rating: user.rating,
      friendsSince: since ? since.toISOString() : null,
      ...(requestId ? { requestId } : {}),
    };
  }

  private async publish(recipientId: string, record: FriendshipRecord): Promise<void> {
    await this.redis.publish(friendshipChannel(recipientId), JSON.stringify(record));
  }
}
