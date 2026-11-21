import { Injectable } from '@nestjs/common';
import { FriendsBlocksService } from './friends.blocks.service';
import { FriendsInvitesService } from './friends.invites.service';
import { FriendsRequestsService } from './friends.requests.service';

export type { SentChallenge } from './friends.invites.service';

// Friend system: friend requests/accept/decline, friend list with online status,
// blocking, and game invitations. Called by friends.controller.ts. Each screen has
// its own service; this one is the stable name the controller and the rest of the
// backend inject, and it only forwards.
@Injectable()
export class FriendsService {
  constructor(
    private readonly requests: FriendsRequestsService,
    private readonly invites: FriendsInvitesService,
    private readonly blocks: FriendsBlocksService,
  ) {}

  // POST /api/friends/:friendId/challenge
  async challengeFriend(userId: string, friendId: string, hostColor?: string) {
    return this.invites.challengeFriend(userId, friendId, hostColor);
  }

  // POST /api/friends/:friendId/invite
  async inviteToRoom(userId: string, friendId: string, gameId?: string) {
    return this.invites.inviteToRoom(userId, friendId, gameId);
  }

  // POST /api/friends/challenge/:fromUserId/accept
  async acceptChallenge(userId: string, fromUserId: string) {
    return this.invites.acceptChallenge(userId, fromUserId);
  }

  // POST /api/friends/challenge/:fromUserId/decline
  async declineChallenge(userId: string, fromUserId: string) {
    return this.invites.declineChallenge(userId, fromUserId);
  }

  // GET /api/friends/challenges/sent
  async getSentChallenges(userId: string) {
    return this.invites.getSentChallenges(userId);
  }

  // GET /api/friends/invites
  async getPendingInvites(userId: string) {
    return this.invites.getPendingInvites(userId);
  }

  // POST /api/friends/invites/:fromUserId/dismiss
  async dismissInvite(userId: string, fromUserId: string) {
    return this.invites.dismissInvite(userId, fromUserId);
  }

  // POST /api/friends/request/:userId
  async sendFriendRequest(userId: string, targetUserId: string) {
    return this.requests.sendFriendRequest(userId, targetUserId);
  }

  // POST /api/friends/request/:requestId/accept
  async acceptFriendRequest(requestId: string, userId: string) {
    return this.requests.acceptFriendRequest(requestId, userId);
  }

  // POST /api/friends/request/:requestId/decline
  async declineFriendRequest(requestId: string, userId: string) {
    return this.requests.declineFriendRequest(requestId, userId);
  }

  // DELETE /api/friends/:friendId
  async removeFriend(userId: string, friendId: string) {
    return this.requests.removeFriend(userId, friendId);
  }

  // GET /api/friends (optionally the friends of one target profile)
  async getFriends(userId: string, targetUsername?: string) {
    return this.requests.getFriends(userId, targetUsername);
  }

  // GET /api/friends/requests
  async getFriendRequests(userId: string) {
    return this.requests.getFriendRequests(userId);
  }

  // POST /api/friends/block/:userId
  async blockUser(userId: string, targetUserId: string) {
    return this.blocks.blockUser(userId, targetUserId);
  }

  // POST /api/friends/unblock/:userId
  async unblockUser(userId: string, targetUserId: string) {
    return this.blocks.unblockUser(userId, targetUserId);
  }

  // GET /api/friends/blocked
  async getBlockedUsers(userId: string) {
    return this.blocks.getBlockedUsers(userId);
  }
}
