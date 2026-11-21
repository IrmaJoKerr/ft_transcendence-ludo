import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AvatarMetaService } from '../avatar/avatar-meta.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { BlockStateService } from './block-state.service';
import { FriendshipAccess } from './friendship-access';
import { FriendshipEventsService } from './friendship-events.service';
import {
  DECLINE_COOLDOWN_MS,
  effectiveStatus,
  isBlockedPair,
  isFriendPair,
  pairKey,
} from './friendship-pair';

// Shape returned for each entry in the sent/received friend-request lists.
type FriendRequestView = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarStyle: string;
  avatarV?: number;
  createdAt: Date;
};

// Friend requests, the accepted list and removal. The pair row is the source of
// truth for all three; the live `friendship:changed` publish is what makes the
// other screens agree without a poll.
@Injectable()
export class FriendsRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly blockState: BlockStateService,
    private readonly avatars: AvatarMetaService,
    private readonly notificationService: NotificationService,
    private readonly events: FriendshipEventsService,
    private readonly access: FriendshipAccess,
  ) {}

  // Create a pending friend request (with duplicate/block checks) and notify
  // the target. Used by POST /api/friends/request/:userId.
  async sendFriendRequest(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new BadRequestException({
        code: 'FRIEND_REQUEST_SELF',
        message: 'Cannot send friend request to yourself',
      });
    }

    const targetUser = await this.prisma.db.user.findUnique({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }

    const now = Date.now();
    const pair = await this.access.findPair(userId, targetUserId);

    // First contact: create the single pair row with the caller as initiator.
    if (!pair) {
      const created = await this.prisma.db.friendship.create({
        data: {
          id: `${userId}-${targetUserId}`,
          pairKey: pairKey(userId, targetUserId),
          user1Id: userId,
          user2Id: targetUserId,
          user1Status: 'pending',
          user1StatusAt: new Date(now),
          user2Status: 'none',
          requestCount: 1,
          lastRequestAt: new Date(now),
        },
      });
      await this.access.notifyFriendRequest(targetUserId, userId, created.id);
      // Both sides: the target gets `pending-in`, the sender's other tabs get
      // `pending-out` (D2 — the actor is a recipient too, with no special case).
      void this.events.publishPair(userId, targetUserId);
      return created;
    }

    const isUser1 = pair.user1Id === userId;
    const callerStatus = this.access.statusOf(pair, userId, now);
    const otherStatus = this.access.statusOf(pair, targetUserId, now);

    // A block on either side hides the pair and stops every transition.
    if (callerStatus === 'blocked' || otherStatus === 'blocked') {
      throw new ForbiddenException({
        code: 'FRIEND_BLOCKED',
        message: 'Cannot send request - user is blocked',
      });
    }
    if (callerStatus === 'accepted' && otherStatus === 'accepted') {
      throw new BadRequestException({ code: 'FRIEND_ALREADY', message: 'Already friends' });
    }
    // Caller already has a live outbound request.
    if (callerStatus === 'pending') {
      throw new BadRequestException({
        code: 'FRIEND_REQUEST_PENDING',
        message: 'Friend request already pending',
      });
    }

    // The target declined the caller less than 1h ago: the sender must wait.
    const otherStatusAt = isUser1 ? pair.user2StatusAt : pair.user1StatusAt;
    if (
      otherStatus === 'declined' &&
      otherStatusAt &&
      now - otherStatusAt.getTime() < DECLINE_COOLDOWN_MS
    ) {
      throw new BadRequestException({
        code: 'FRIEND_REQUEST_COOLDOWN',
        message: 'You need to wait 1 hr after your previous friend request',
      });
    }

    // Mutual outstanding requests: accept both directions immediately.
    if (otherStatus === 'pending') {
      const nowDate = new Date(now);
      const updated = await this.prisma.db.friendship.update({
        where: { id: pair.id },
        data: {
          user1Status: 'accepted',
          user2Status: 'accepted',
          user1StatusAt: nowDate,
          user2StatusAt: nowDate,
        },
      });
      await this.access.notifyFriendAccepted(targetUserId, userId);
      void this.events.publishPair(userId, targetUserId);
      return updated;
    }

    // Otherwise (re)send: the caller becomes pending, and a stale target
    // direction (expired pending/declined) is reset to none.
    const rawOtherStatus = isUser1 ? pair.user2Status : pair.user1Status;
    const resetStaleOther =
      otherStatus === 'none' && (rawOtherStatus === 'pending' || rawOtherStatus === 'declined');
    const nowDate = new Date(now);
    const updated = await this.prisma.db.friendship.update({
      where: { id: pair.id },
      data: {
        ...(isUser1
          ? {
              user1Status: 'pending' as const,
              user1StatusAt: nowDate,
              ...(resetStaleOther ? { user2Status: 'none' as const, user2StatusAt: null } : {}),
            }
          : {
              user2Status: 'pending' as const,
              user2StatusAt: nowDate,
              ...(resetStaleOther ? { user1Status: 'none' as const, user1StatusAt: null } : {}),
            }),
        requestCount: { increment: 1 },
        lastRequestAt: nowDate,
      },
    });
    await this.access.notifyFriendRequest(targetUserId, userId, updated.id);
    void this.events.publishPair(userId, targetUserId);
    return updated;
  }

  // Accept a pending request addressed to userId and notify the sender.
  // Used by POST /api/friends/accept/:requestId.
  async acceptFriendRequest(requestId: string, userId: string) {
    const pair = await this.prisma.db.friendship.findUnique({ where: { id: requestId } });
    const now = Date.now();

    if (!pair || (pair.user1Id !== userId && pair.user2Id !== userId)) {
      throw new NotFoundException({
        code: 'FRIEND_REQUEST_NOT_FOUND',
        message: 'Friend request not found',
      });
    }

    const isUser1 = pair.user1Id === userId;
    // The caller can only accept a live inbound request (the other direction).
    const inbound = isUser1
      ? effectiveStatus(pair.user2Status, pair.user2StatusAt, now)
      : effectiveStatus(pair.user1Status, pair.user1StatusAt, now);
    if (inbound !== 'pending') {
      throw new NotFoundException({
        code: 'FRIEND_REQUEST_NOT_FOUND',
        message: 'Friend request not found',
      });
    }
    if (isBlockedPair(pair)) {
      throw new ForbiddenException({
        code: 'FRIEND_BLOCKED',
        message: 'Cannot accept - user is blocked',
      });
    }

    const nowDate = new Date(now);
    const updated = await this.prisma.db.friendship.update({
      where: { id: requestId },
      data: {
        user1Status: 'accepted',
        user2Status: 'accepted',
        user1StatusAt: nowDate,
        user2StatusAt: nowDate,
      },
    });

    // Notify the original sender that their request was accepted.
    await this.access.notifyFriendAccepted(isUser1 ? pair.user2Id : pair.user1Id, userId);
    void this.events.publishPair(pair.user1Id, pair.user2Id);

    return updated;
  }

  // Decline a pending request addressed to userId: store the decline in the
  // caller's own direction (starting the sender's 1h cooldown), withdraw the
  // sender's pending request, and notify them. POST /api/friends/decline/:requestId.
  async declineFriendRequest(requestId: string, userId: string) {
    const pair = await this.prisma.db.friendship.findUnique({ where: { id: requestId } });
    const now = Date.now();

    if (!pair || (pair.user1Id !== userId && pair.user2Id !== userId)) {
      throw new NotFoundException({
        code: 'FRIEND_REQUEST_NOT_FOUND',
        message: 'Friend request not found',
      });
    }

    const isUser1 = pair.user1Id === userId;
    const inbound = isUser1
      ? effectiveStatus(pair.user2Status, pair.user2StatusAt, now)
      : effectiveStatus(pair.user1Status, pair.user1StatusAt, now);
    if (inbound !== 'pending') {
      throw new NotFoundException({
        code: 'FRIEND_REQUEST_NOT_FOUND',
        message: 'Friend request not found',
      });
    }

    const nowDate = new Date(now);
    await this.prisma.db.friendship.update({
      where: { id: requestId },
      data: isUser1
        ? {
            user1Status: 'declined',
            user1StatusAt: nowDate,
            user2Status: 'none',
            user2StatusAt: null,
          }
        : {
            user2Status: 'declined',
            user2StatusAt: nowDate,
            user1Status: 'none',
            user1StatusAt: null,
          },
    });

    // Notify the original sender that their request was declined.
    await this.access.notifyFriendDeclined(isUser1 ? pair.user2Id : pair.user1Id, userId);
    // Both sides drop the row: the sender's pending-out becomes `none`, the
    // decliner's pending-in does too (a decline is not a list entry).
    void this.events.publishPair(pair.user1Id, pair.user2Id);

    return { ok: true };
  }

  // Delete an accepted friendship and notify the removed friend. Used by
  // DELETE /api/friends/remove/:friendId.
  async removeFriend(userId: string, friendId: string) {
    const pair = await this.access.findPair(userId, friendId);
    if (!pair || !isFriendPair(pair)) {
      throw new NotFoundException({ code: 'FRIEND_NOT_FOUND', message: 'Friendship not found' });
    }

    // Reset both directions to none: a valid removal is never a block.
    await this.prisma.db.friendship.update({
      where: { id: pair.id },
      data: {
        user1Status: 'none',
        user1StatusAt: null,
        user2Status: 'none',
        user2StatusAt: null,
      },
    });

    // Notify the removed friend that the link was severed.
    const remover = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    await this.notificationService.notify(friendId, 'friend_removed', {
      fromUserId: userId,
      fromUsername: remover?.username ?? 'A squad leader',
    });
    // The row leaves both lists live, not on the next poll.
    void this.events.publishPair(userId, friendId);

    return { ok: true };
  }

  // Accepted friends of a user (optionally looked up by username instead of
  // the caller) with presence status. Used by GET /api/friends.
  //
  // A block between the caller and a named target is a 403, not a silent fall
  // back to the caller's own list: the profile page skips this read when
  // `visibility !== 'full'`, and the 403 is what stops a deep link.
  async getFriends(userId: string, targetUsername?: string) {
    let effectiveUserId = userId;
    if (targetUsername) {
      const targetUser = await this.prisma.db.user.findUnique({
        where: { username: targetUsername },
        select: { id: true },
      });
      if (targetUser) {
        await this.blockState.assertUnblocked(userId, targetUser.id);
        effectiveUserId = targetUser.id;
      }
    }

    // Both directions accepted is the only friendship state, so this also
    // excludes any pair where either side blocked.
    const friendships = await this.prisma.db.friendship.findMany({
      where: {
        OR: [
          { user1Id: effectiveUserId, user1Status: 'accepted', user2Status: 'accepted' },
          { user2Id: effectiveUserId, user1Status: 'accepted', user2Status: 'accepted' },
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

    const friends = friendships.map((f) => {
      const friend = f.user1Id === effectiveUserId ? f.user2 : f.user1;
      return {
        id: friend.id,
        username: friend.username,
        displayName: friend.displayName,
        avatarStyle: friend.avatarStyle,
        hasAvatarPhoto: friend.avatarPhotoContentType !== null,
        rating: friend.stats?.rating ?? 0,
        friendsSince: f.createdAt,
      };
    });

    // First paint carries the same `?v=` the live record does (D2), through one
    // pipelined read for the whole list instead of a request per avatar.
    const avatars = await this.avatars.getMany(friends.map((f) => f.id));
    const statuses = await this.presence.getStatuses(friends.map((f) => f.id));
    return friends.map((f) => ({
      ...f,
      avatarV: avatars[f.id]?.v,
      status: statuses[f.id],
    }));
  }

  // Pending friend requests sent and received by the user. Used by
  // GET /api/friends/requests.
  async getFriendRequests(userId: string) {
    const now = Date.now();
    // Any pair the caller is in with a pending direction on either side, so
    // both the sent and received lists can be built in one query.
    const rows = await this.prisma.db.friendship.findMany({
      where: {
        OR: [
          { user1Id: userId, user1Status: 'pending' },
          { user2Id: userId, user2Status: 'pending' },
          { user1Id: userId, user2Status: 'pending' },
          { user2Id: userId, user1Status: 'pending' },
        ],
      },
      include: {
        user1: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
        user2: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
      },
    });

    const sent: FriendRequestView[] = [];
    const received: FriendRequestView[] = [];

    for (const row of rows) {
      // A block hides the pair from both lists.
      if (isBlockedPair(row)) continue;

      const isUser1 = row.user1Id === userId;
      const other = isUser1 ? row.user2 : row.user1;
      const view: FriendRequestView = {
        id: row.id,
        userId: other.id,
        username: other.username,
        displayName: other.displayName,
        avatarStyle: other.avatarStyle,
        createdAt: row.createdAt,
      };

      // Caller's own direction pending = a request they sent; the other
      // direction pending = a request they received (both with 24h TTL).
      if (this.access.statusOf(row, userId, now) === 'pending') {
        sent.push(view);
      } else if (this.access.statusOf(row, other.id, now) === 'pending') {
        received.push(view);
      }
    }

    // The request cards paint the same row the live record does: same stamp.
    const avatars = await this.avatars.getMany([...sent, ...received].map((r) => r.userId));
    return {
      sent: sent.map((r) => ({ ...r, avatarV: avatars[r.userId]?.v })),
      received: received.map((r) => ({ ...r, avatarV: avatars[r.userId]?.v })),
    };
  }
}
