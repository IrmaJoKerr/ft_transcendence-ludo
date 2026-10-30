import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { MatchService } from '../match/match.service';
import { NotificationService } from '../notification/notification.service';
import { secret } from '../secrets';
import { BlockStateService } from './block-state.service';
import {
  pairKey,
  isFriendPair,
  isBlockedPair,
  effectiveStatus,
  DECLINE_COOLDOWN_MS,
  type FriendshipStatus,
  type PairLike,
} from './friendship-pair';

// Shape returned for each entry in the sent/received friend-request lists.
type FriendRequestView = {
  id: string;
  userId: string;
  username: string;
  displayName: string;
  avatarStyle: string;
  createdAt: Date;
};

@Injectable()
// Friend system: friend requests/accept/decline, friend list with online
// status, blocking, and game invitations. Called by friends.controller.ts.
export class FriendsService {
  // Redis client (used for pending-invite records, invite:<userId> keys).
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly matchService: MatchService,
    private readonly notificationService: NotificationService,
    private readonly blockState: BlockStateService,
  ) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');

    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  // Create a match room, seat both players and notify the invitee.
  // POST /api/friends/:friendId/invite
  async inviteToGame(userId: string, friendId: string) {
    if (userId === friendId)
      throw new BadRequestException({
        code: 'FRIEND_INVITE_SELF',
        message: 'Cannot invite yourself',
      });

    const pair = await this.findPair(userId, friendId);
    if (pair && isBlockedPair(pair))
      throw new ForbiddenException({
        code: 'FRIEND_BLOCKED',
        message: 'Cannot invite - user is blocked',
      });
    if (!pair || !isFriendPair(pair))
      throw new ForbiddenException({
        code: 'NOT_FRIENDS_WITH_USER',
        message: 'You are not friends with this user',
      });

    const match = await this.matchService.createInvite(userId);
    const inviter = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true },
    });

    // Seat the friend into the room now : they only confirm before entering,
    // they don't have to "accept" first.
    const friendSeat = await this.matchService.joinMatch(match.gameId, friendId);

    // Push a real-time notification to the friend instead of a polled Redis key.
    await this.notificationService.notify(friendId, 'game_invite', {
      gameId: friendSeat.gameId,
      token: friendSeat.token,
      engineUrl: friendSeat.engineUrl,
      color: friendSeat.color,
      inviteCode: match.inviteCode,
      fromUsername: inviter?.username ?? 'A friend',
    });

    // Return the host's own match credentials so the caller can join its own
    // room immediately : the host must be seated before the friend can accept,
    // otherwise the friend's accept could create/join the room alone.
    return {
      gameId: match.gameId,
      token: match.token,
      engineUrl: match.engineUrl,
      color: match.color,
      inviteCode: match.inviteCode,
    };
  }

  async getPendingInvite(userId: string) {
    const raw = await this.redis.get(`invite:${userId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async dismissInvite(userId: string) {
    await this.redis.del(`invite:${userId}`);
    return { ok: true };
  }

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
    const pair = await this.findPair(userId, targetUserId);

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
      await this.notifyFriendRequest(targetUserId, userId, created.id);
      return created;
    }

    const isUser1 = pair.user1Id === userId;
    const callerStatus = this.statusOf(pair, userId, now);
    const otherStatus = this.statusOf(pair, targetUserId, now);

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
      await this.notifyFriendAccepted(targetUserId, userId);
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
    await this.notifyFriendRequest(targetUserId, userId, updated.id);
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
    await this.notifyFriendAccepted(isUser1 ? pair.user2Id : pair.user1Id, userId);

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
    await this.notifyFriendDeclined(isUser1 ? pair.user2Id : pair.user1Id, userId);

    return { ok: true };
  }

  // Delete an accepted friendship and notify the removed friend. Used by
  // DELETE /api/friends/remove/:friendId.
  async removeFriend(userId: string, friendId: string) {
    const pair = await this.findPair(userId, friendId);
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
      fromUsername: remover?.username ?? 'A pilot',
    });

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
            rating: true,
          },
        },
        user2: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarStyle: true,
            avatarPhotoContentType: true,
            rating: true,
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
        rating: friend.rating,
        friendsSince: f.createdAt,
      };
    });

    const statuses = await this.presence.getStatuses(friends.map((f) => f.id));
    return friends.map((f) => ({ ...f, status: statuses[f.id] }));
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
      if (this.statusOf(row, userId, now) === 'pending') {
        sent.push(view);
      } else if (this.statusOf(row, other.id, now) === 'pending') {
        received.push(view);
      }
    }

    return { sent, received };
  }

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
    const pair = await this.findPair(userId, targetUserId);

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

    return { ok: true };
  }

  // Clear the caller's own block. The other side is reset to none as well,
  // unless they hold a block of their own that must survive.
  // Used by POST /api/friends/unblock/:userId.
  async unblockUser(userId: string, targetUserId: string) {
    const pair = await this.findPair(userId, targetUserId);
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
            rating: true,
          },
        },
        user2: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarStyle: true,
            avatarPhotoContentType: true,
            rating: true,
          },
        },
      },
    });

    return rows.map((row) => {
      const isUser1 = row.user1Id === userId;
      const other = isUser1 ? row.user2 : row.user1;
      return {
        id: other.id,
        username: other.username,
        displayName: other.displayName,
        avatarStyle: other.avatarStyle,
        hasAvatarPhoto: other.avatarPhotoContentType !== null,
        rating: other.rating,
        blockedSince: (isUser1 ? row.user1StatusAt : row.user2StatusAt) ?? row.createdAt,
      };
    });
  }

  // Load the single unordered pair row shared by two users, if any.
  private findPair(a: string, b: string) {
    return this.prisma.db.friendship.findUnique({ where: { pairKey: pairKey(a, b) } });
  }

  // Effective status of the row as seen from one user's side (applies expiry).
  private statusOf(pair: PairLike, userId: string, now: number): FriendshipStatus {
    const isUser1 = pair.user1Id === userId;
    return effectiveStatus(
      isUser1 ? pair.user1Status : pair.user2Status,
      isUser1 ? pair.user1StatusAt : pair.user2StatusAt,
      now,
    );
  }

  // Persisted friend_request push (bell + live) with the sender's display data.
  private async notifyFriendRequest(targetUserId: string, senderId: string, requestId: string) {
    const sender = await this.prisma.db.user.findUnique({
      where: { id: senderId },
      select: { username: true, avatarStyle: true },
    });
    await this.notificationService.notify(targetUserId, 'friend_request', {
      requestId,
      fromUserId: senderId,
      fromUsername: sender?.username ?? 'Someone',
      fromAvatarStyle: sender?.avatarStyle ?? 'bottts',
    });
  }

  // Tell a sender their request was accepted.
  private async notifyFriendAccepted(targetUserId: string, accepterId: string) {
    const accepter = await this.prisma.db.user.findUnique({
      where: { id: accepterId },
      select: { username: true, avatarStyle: true },
    });
    await this.notificationService.notify(targetUserId, 'friend_accepted', {
      fromUserId: accepterId,
      fromUsername: accepter?.username ?? 'Someone',
      fromAvatarStyle: accepter?.avatarStyle ?? 'bottts',
    });
  }

  // Tell a sender their request was declined.
  private async notifyFriendDeclined(targetUserId: string, declinerId: string) {
    const decliner = await this.prisma.db.user.findUnique({
      where: { id: declinerId },
      select: { username: true },
    });
    await this.notificationService.notify(targetUserId, 'friend_declined', {
      fromUserId: declinerId,
      fromUsername: decliner?.username ?? 'A pilot',
    });
  }
}
