import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { MatchService } from '../match/match.service';
import { NotificationService } from '../notification/notification.service';
import { secret } from '../secrets';

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
  ) {
    const host = process.env.REDIS_HOST || 'redis';
    const port = parseInt(process.env.REDIS_PORT || '6479', 10);
    const password = secret('REDIS_PASSWORD');

    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => console.error('Redis error:', (error as Error).message));
  }

  // Game Invitations
  // Invite = a short-lived Redis record the invitee's client picks up on its
  // next poll (same idiom as presence:{userId}), plus a real-time notify.
  // Create a match room, seat both players, and notify the friend with the
  // join credentials. Used by POST /api/friends/:friendId/invite.
  async inviteToGame(userId: string, friendId: string) {
    if (userId === friendId) throw new BadRequestException('Cannot invite yourself');

    const friendship = await this.prisma.db.friendship.findFirst({
      where: {
        OR: [
          { userId, friendId, status: 'accepted' },
          { userId: friendId, friendId: userId, status: 'accepted' },
        ],
      },
    });
    if (!friendship) throw new ForbiddenException('You are not friends with this user');

    const match = await this.matchService.createInvite(userId);
    const inviter = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true } });

    // Seat the friend into the room now, the same way online mode's joinMatch
    // seats a player synchronously the moment they join : the friend doesn't
    // have to "accept" before they're actually placed in the room, they just
    // have to confirm before entering it.
    const friendSeat = await this.matchService.joinMatch(match.gameId, friendId);

    // Push a real-time notification to the friend instead of a polled Redis key.
    await this.notificationService.notify(friendId, 'game_invite', {
      gameId: friendSeat.gameId,
      token: friendSeat.token,
      engineUrl: friendSeat.engineUrl,
      color: friendSeat.color,
      inviteCode: match.inviteCode,
      fromUsername: inviter?.username || 'A friend',
    });

    // Return the host's own match credentials so the caller can join its own
    // room immediately : the host must be seated before the friend can accept,
    // otherwise the friend's accept could create/join the room alone.
    return {
      message: 'Invite sent',
      gameId: match.gameId,
      token: match.token,
      engineUrl: match.engineUrl,
      color: match.color,
      inviteCode: match.inviteCode,
      mode: match.mode,
      playerCount: match.playerCount,
    };
  }

  // Read and delete the pending invite for a user (single consume). Used by
  // GET /api/friends/invite/pending.
  async getPendingInvite(userId: string) {
    const raw = await this.redis.get(`invite:${userId}`);
    return raw ? JSON.parse(raw) : null;
  }

  // Delete a pending invite without acting on it. Used by
  // DELETE /api/friends/invite/pending.
  async dismissInvite(userId: string) {
    await this.redis.del(`invite:${userId}`);
    return { message: 'Dismissed' };
  }

  // Create a pending friend request. Used by
  // POST /api/friends/request/:friendId.
  async sendFriendRequest(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new BadRequestException('Cannot send friend request to yourself');
    }

    const targetUser = await this.prisma.db.user.findUnique({
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const existing = await this.prisma.db.friendship.findFirst({
      where: {
        OR: [
          { userId, friendId: targetUserId },
          { userId: targetUserId, friendId: userId },
        ],
      },
    });

    if (existing) {
      if (existing.status === 'accepted') {
        throw new BadRequestException('Already friends');
      } else if (existing.status === 'pending') {
        throw new BadRequestException('Friend request already pending');
      } else if (existing.status === 'blocked') {
        throw new ForbiddenException('Cannot send request - user is blocked');
      }
    }

    const friendship = await (this.prisma.db.friendship.create as any)({
      data: {
        id: `${userId}-${targetUserId}`,
        user: { connect: { id: userId } },
        friend: { connect: { id: targetUserId } },
        status: 'pending',
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
        friend: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
      },
    });

    // Notify the target user that they have a new friend request.
    const sender = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { username: true, displayName: true, avatarStyle: true } });
    await this.notificationService.notify(targetUserId, 'friend_request', {
      requestId: friendship.id,
      fromUserId: userId,
      fromUsername: sender?.username || 'Someone',
      fromAvatarStyle: sender?.avatarStyle || 'bottts',
    });

    return friendship;
  }

  // Accept a pending friend request. Used by
  // POST /api/friends/request/:requestId/accept.
  async acceptFriendRequest(requestId: string, userId: string) {
    const request = await this.prisma.db.friendship.findFirst({
      where: {
        id: requestId,
        friendId: userId,
        status: 'pending',
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
      },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    const updated = await this.prisma.db.friendship.update({
      where: { id: requestId },
      data: { status: 'accepted' },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
        friend: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
      },
    });

    // Notify the original sender that their request was accepted.
    await this.notificationService.notify(request.userId, 'friend_accepted', {
      fromUserId: userId,
      fromUsername: updated.friend.username,
      fromAvatarStyle: updated.friend.avatarStyle,
    });

    return updated;
  // Decline a pending friend request. Used by
  // POST /api/friends/request/:requestId/decline.
  }

  async declineFriendRequest(requestId: string, userId: string) {
    const request = await this.prisma.db.friendship.findFirst({
      where: {
        id: requestId,
        friendId: userId,
        status: 'pending',
      },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    await this.prisma.db.friendship.delete({
      where: { id: requestId },
    });

    // Notify the original sender that their request was declined.
    const decliner = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { username: true } });
    await this.notificationService.notify(request.userId, 'friend_declined', {
      fromUserId: userId,
      fromUsername: decliner?.username || 'A pilot',
    });
  // Remove an existing friend. Used by
  // DELETE /api/friends/:friendId.

    return { message: 'Friend request declined' };
  }

  async removeFriend(userId: string, friendId: string) {
    const friendship = await this.prisma.db.friendship.findFirst({
      where: {
        OR: [
          { userId, friendId },
          { userId: friendId, friendId: userId },
        ],
        status: 'accepted',
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
    }

    await this.prisma.db.friendship.delete({
      where: { id: friendship.id },
    });

    // Notify the removed friend that the link was severed.
    const remover = await this.prisma.db.user.findUnique({ where: { id: userId }, select: { username: true } });
    await this.notificationService.notify(friendId, 'friend_removed', {
      fromUserId: userId,
  // All friends of a user with online status. Used by
  // GET /api/friends.
      fromUsername: remover?.username || 'A pilot',
    });

    return { message: 'Friend removed' };
  }

  async getFriends(userId: string, targetUsername?: string) {
    let effectiveUserId = userId;
    if (targetUsername) {
      const targetUser = await this.prisma.db.user.findUnique({
        where: { username: targetUsername },
        select: { id: true },
      });
      if (targetUser) {
        effectiveUserId = targetUser.id;
      }
    }

    const friendships = await this.prisma.db.friendship.findMany({
      where: {
        OR: [
          { userId: effectiveUserId, status: 'accepted' },
          { friendId: effectiveUserId, status: 'accepted' },
        ],
      },
      include: {
        user: { select: { id: true, username: true, displayName: true, avatarStyle: true, avatarPhotoContentType: true, rating: true } },
        friend: { select: { id: true, username: true, displayName: true, avatarStyle: true, avatarPhotoContentType: true, rating: true } },
      },
    });

    const friends = friendships.map((f) => {
      const friend = f.userId === effectiveUserId ? f.friend : f.user;
      return {
        id: friend.id,
        username: friend.username,
        displayName: friend.displayName,
        avatarStyle: friend.avatarStyle,
        hasAvatarPhoto: friend.avatarPhotoContentType !== null,
        rating: friend.rating,
  // All pending friend requests (sent + received). Used by
  // GET /api/friends/requests.
        friendsSince: f.createdAt,
      };
    });

    const statuses = await this.presence.getStatuses(friends.map((f) => f.id));
    return friends.map((f) => ({ ...f, status: statuses[f.id] }));
  }

  async getFriendRequests(userId: string) {
    const [sent, received] = await Promise.all([
      this.prisma.db.friendship.findMany({
        where: {
          userId,
          status: 'pending',
        },
        include: {
          friend: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
        },
      }),
      this.prisma.db.friendship.findMany({
        where: {
          friendId: userId,
          status: 'pending',
        },
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
        },
      }),
    ]);

    return {
      sent: sent.map((r) => ({
        id: r.id,
        userId: r.friend.id,
        username: r.friend.username,
        displayName: r.friend.displayName,
        avatarStyle: r.friend.avatarStyle,
        createdAt: r.createdAt,
      })),
      received: received.map((r) => ({
  // Block a user: create or flip the friendship row to blocked. Used by
  // POST /api/friends/block/:userId.
        id: r.id,
        userId: r.user.id,
        username: r.user.username,
        displayName: r.user.displayName,
        avatarStyle: r.user.avatarStyle,
        createdAt: r.createdAt,
      })),
    };
  }

  async blockUser(userId: string, targetUserId: string) {
    if (userId === targetUserId) {
      throw new BadRequestException('Cannot block yourself');
    }

    const existing = await this.prisma.db.friendship.findFirst({
      where: {
        OR: [
          { userId, friendId: targetUserId },
          { userId: targetUserId, friendId: userId },
        ],
      },
    });

    if (existing) {
      const updated = await this.prisma.db.friendship.update({
        where: { id: existing.id },
        data: {
          userId,
          friendId: targetUserId,
          status: 'blocked',
        },
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
          friend: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
        },
      });
      return updated;
    } else {
      const blocked = await (this.prisma.db.friendship.create as any)({
        data: {
          id: `${userId}-${targetUserId}-blocked`,
          userId,
  // Remove a blocked friendship row, restoring normal relations. Used by
  // POST /api/friends/unblock/:userId.
          friendId: targetUserId,
          status: 'blocked',
        },
        include: {
          user: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
          friend: { select: { id: true, username: true, displayName: true, avatarStyle: true } },
        },
      });
      return blocked;
    }
  }

  async unblockUser(userId: string, targetUserId: string) {
    const blocked = await this.prisma.db.friendship.findFirst({
      where: {
        userId,
        friendId: targetUserId,
        status: 'blocked',
  // All users the caller has blocked. Used by GET /api/friends/blocked.
      },
    });

    if (!blocked) {
      throw new NotFoundException('Blocked user record not found');
    }

    await this.prisma.db.friendship.delete({
      where: { id: blocked.id },
    });

    return { message: 'User unblocked' };
  }

  async getBlockedUsers(userId: string) {
    const blocked = await this.prisma.db.friendship.findMany({
      where: {
        userId,
        status: 'blocked',
      },
      include: {
        friend: { select: { id: true, username: true, displayName: true, avatarStyle: true, avatarPhotoContentType: true, rating: true } },
      },
    });

    return blocked.map((b) => ({
      id: b.friend.id,
      username: b.friend.username,
      displayName: b.friend.displayName,
      avatarStyle: b.friend.avatarStyle,
      rating: b.friend.rating,
      blockedSince: b.createdAt,
    }));
  }
}