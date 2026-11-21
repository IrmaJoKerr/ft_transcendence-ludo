import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AvatarMetaService } from '../avatar/avatar-meta.service';
import { PrismaService } from '../prisma.service';
import { FriendshipAccess } from './friendship-access';
import { FriendshipEventsService } from './friendship-events.service';
import { pairKey } from './friendship-pair';

// The block list and its two writers. A block is directional (only the caller's own
// side moves), but its effect on the lobby and on a live room is shared, so each
// write republishes both views from the publisher that owns them.
@Injectable()
export class FriendsBlocksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly avatars: AvatarMetaService,
    private readonly access: FriendshipAccess,
    private readonly events: FriendshipEventsService,
  ) {}

  // Block a user: set only the caller's own direction to 'blocked' (never
  // rewriting the other side), which hides the pair and cancels any pending
  // requests. Used by POST /api/friends/block/:userId.
  async blockUser(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new BadRequestException({
        code: 'FRIEND_BLOCK_SELF',
        message: 'Cannot block yourself',
      });
    }

    const now = new Date();
    const pair = await this.access.findPair(userId, targetUserId);

    if (!pair) {
      const created = await this.prisma.db.friendship.create({
        data: {
          id: `${userId}-${targetUserId}-blocked`,
          pairKey: pairKey(userId, targetUserId),
          user1Id: userId,
          user2Id: targetUserId,
          user1Status: 'blocked',
          user1StatusAt: now,
          user2Status: 'none',
        },
      });
      // A block created out of nothing still hides whatever the other side had
      // (a pending request, or nothing at all) — both lists update live.
      void this.events.publishPair(userId, targetUserId);
      // And the room list moves with it: a room holding either side stops being a
      // row for the other, so the block needs no reload (queue item 3).
      await this.events.publishRoomsChanged();
      // A live room that seats both is the one place the block has to act at once
      // (M3): the engine stamps the cut with its own chat sequence.
      await this.events.publishBlocksChanged(userId, targetUserId, true);
      return { id: created.id };
    }

    const isUser1 = pair.user1Id === userId;
    // Idempotent: the caller already blocked this user.
    if ((isUser1 ? pair.user1Status : pair.user2Status) === 'blocked') {
      return { ok: true };
    }

    // Clear the other direction (pending/accepted/declined), but never
    // overwrite a block the other user has already placed.
    const otherBlocked = (isUser1 ? pair.user2Status : pair.user1Status) === 'blocked';
    await this.prisma.db.friendship.update({
      where: { id: pair.id },
      data: isUser1
        ? {
            user1Status: 'blocked',
            user1StatusAt: now,
            ...(otherBlocked ? {} : { user2Status: 'none' as const, user2StatusAt: null }),
          }
        : {
            user2Status: 'blocked',
            user2StatusAt: now,
            ...(otherBlocked ? {} : { user1Status: 'none' as const, user1StatusAt: null }),
          },
    });
    // The blocker sees `blocked` (their own list), the other side gets `none`:
    // a block placed against you removes the row rather than announcing it.
    void this.events.publishPair(userId, targetUserId);
    await this.events.publishRoomsChanged();
    // A live room that seats both cuts the pair's speech from the next line on.
    await this.events.publishBlocksChanged(userId, targetUserId, true);

    return { ok: true };
  }

  // Clear the caller's own block. The other side is reset to none as well,
  // unless they hold a block of their own that must survive.
  // Used by POST /api/friends/unblock/:userId.
  async unblockUser(userId: string, targetUserId: string) {
    const pair = await this.access.findPair(userId, targetUserId);
    const isUser1 = pair?.user1Id === userId;

    // Only the caller's own directional block can be lifted.
    if (!pair || (isUser1 ? pair.user1Status : pair.user2Status) !== 'blocked') {
      throw new NotFoundException({
        code: 'FRIEND_BLOCK_NOT_FOUND',
        message: 'Blocked user record not found',
      });
    }

    const otherBlocked = (isUser1 ? pair.user2Status : pair.user1Status) === 'blocked';
    await this.prisma.db.friendship.update({
      where: { id: pair.id },
      data: isUser1
        ? {
            user1Status: 'none',
            user1StatusAt: null,
            ...(otherBlocked ? {} : { user2Status: 'none' as const, user2StatusAt: null }),
          }
        : {
            user2Status: 'none',
            user2StatusAt: null,
            ...(otherBlocked ? {} : { user1Status: 'none' as const, user1StatusAt: null }),
          },
    });
    // Liftable state again: the row comes back as `none` (or `blocked` when the
    // other side still holds its own block), and the profile un-gates with it.
    void this.events.publishPair(userId, targetUserId);
    // The other side's room comes back as a row for this viewer with it.
    await this.events.publishRoomsChanged();
    // The room's ledger drops the pair, so a live room reads like the lobby again:
    // nothing is retroactively hidden, nothing stays cut.
    await this.events.publishBlocksChanged(userId, targetUserId, false);

    return { ok: true };
  }

  // All users the caller has blocked. Used by GET /api/friends/blocked.
  async getBlockedUsers(userId: string) {
    const rows = await this.prisma.db.friendship.findMany({
      where: {
        OR: [
          { user1Id: userId, user1Status: 'blocked' },
          { user2Id: userId, user2Status: 'blocked' },
        ],
      },
      include: {
        user1: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarStyle: true,
            avatarPhotoContentType: true,
            // The rating is the career row's, not the account's: one include, no join.
            stats: { select: { rating: true } },
          },
        },
        user2: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarStyle: true,
            avatarPhotoContentType: true,
            // The rating is the career row's, not the account's: one include, no join.
            stats: { select: { rating: true } },
          },
        },
      },
    });

    const blocked = rows.map((row) => {
      const isUser1 = row.user1Id === userId;
      const other = isUser1 ? row.user2 : row.user1;
      return {
        id: other.id,
        username: other.username,
        displayName: other.displayName,
        avatarStyle: other.avatarStyle,
        hasAvatarPhoto: other.avatarPhotoContentType !== null,
        rating: other.stats?.rating ?? 0,
        blockedSince: (isUser1 ? row.user1StatusAt : row.user2StatusAt) ?? row.createdAt,
      };
    });

    const avatars = await this.avatars.getMany(blocked.map((b) => b.id));
    return blocked.map((b) => ({ ...b, avatarV: avatars[b.id]?.v }));
  }
}
