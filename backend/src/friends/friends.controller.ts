import { Controller, Post, Get, Delete, UseGuards, Request, Param, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FRIENDS_THROTTLE } from '../common/throttles';
import { FriendsService } from './friends.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller()
// HTTP routes for the friend system and game invitations. All routes are
// JWT-protected and delegate to FriendsService.
export class FriendsController {
  constructor(private readonly friends: FriendsService) {}

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.request)
  @Post('api/friends/request/:userId')
  sendRequest(@Request() req: { user: { id: string } }, @Param('userId') targetUserId: string) {
    return this.friends.sendFriendRequest(req.user.id, targetUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.accept)
  @Post('api/friends/accept/:requestId')
  acceptRequest(@Request() req: { user: { id: string } }, @Param('requestId') requestId: string) {
    return this.friends.acceptFriendRequest(requestId, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.decline)
  @Post('api/friends/decline/:requestId')
  declineRequest(@Request() req: { user: { id: string } }, @Param('requestId') requestId: string) {
    return this.friends.declineFriendRequest(requestId, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.remove)
  @Delete('api/friends/remove/:friendId')
  removeFriend(@Request() req: { user: { id: string } }, @Param('friendId') friendId: string) {
    return this.friends.removeFriend(req.user.id, friendId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/friends')
  getFriends(@Request() req: { user: { id: string } }, @Query('username') username?: string) {
    return this.friends.getFriends(req.user.id, username);
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/friends/requests')
  getRequests(@Request() req: { user: { id: string } }) {
    return this.friends.getFriendRequests(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/friends/blocked')
  getBlockedUsers(@Request() req: { user: { id: string } }) {
    return this.friends.getBlockedUsers(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.block)
  @Post('api/friends/block/:userId')
  blockUser(@Request() req: { user: { id: string } }, @Param('userId') targetUserId: string) {
    return this.friends.blockUser(req.user.id, targetUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.unblock)
  @Post('api/friends/unblock/:userId')
  unblockUser(@Request() req: { user: { id: string } }, @Param('userId') targetUserId: string) {
    return this.friends.unblockUser(req.user.id, targetUserId);
  }

  // Game Invitations
  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.invite)
  @Post('api/friends/:friendId/invite')
  inviteToGame(@Request() req: { user: { id: string } }, @Param('friendId') friendId: string) {
    return this.friends.inviteToGame(req.user.id, friendId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/friends/invites/pending')
  getPendingInvite(@Request() req: { user: { id: string } }) {
    return this.friends.getPendingInvite(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.dismissInvite)
  @Post('api/friends/invites/dismiss')
  dismissInvite(@Request() req: { user: { id: string } }) {
    return this.friends.dismissInvite(req.user.id);
  }
}
