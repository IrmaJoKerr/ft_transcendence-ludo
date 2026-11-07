import {
  Controller,
  Post,
  Get,
  Delete,
  UseGuards,
  Request,
  Param,
  Query,
  Body,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FRIENDS_THROTTLE } from '../common/throttles';
import { FriendsService } from './friends.service';
import { ChallengeFriendDto } from './dto/challenge-friend.dto';
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
  //
  // **Two routes, one per act** (19.6). A challenge is a duel: nothing is created
  // until the invitee accepts, and the answer comes back through the same target.
  // A room invite offers a seat in a room the caller already sits in, so it carries
  // that room's id and never creates one.
  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.invite)
  @Post('api/friends/:friendId/challenge')
  challengeFriend(
    @Request() req: { user: { id: string } },
    @Param('friendId') friendId: string,
    // `hostColor` is the corner the challenger will sit in once the duel exists:
    // the room is made at the accept, and the host is seated first.
    @Body() dto: ChallengeFriendDto,
  ) {
    return this.friends.challengeFriend(req.user.id, friendId, dto.hostColor);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.invite)
  @Post('api/friends/:friendId/invite')
  inviteToRoom(
    @Request() req: { user: { id: string } },
    @Param('friendId') friendId: string,
    // `gameId` is the waiting room the caller already sits in: the invite offers a
    // seat in it, and nothing is created.
    @Body() dto: ChallengeFriendDto,
  ) {
    return this.friends.inviteToRoom(req.user.id, friendId, dto.gameId);
  }

  // The two answers to a challenge. ACCEPT creates the room; DECLINE writes the one
  // rung of the refusal ladder that a decline is, and neither is a friend request.
  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.accept)
  @Post('api/friends/challenges/:friendId/accept')
  acceptChallenge(@Request() req: { user: { id: string } }, @Param('friendId') fromUserId: string) {
    return this.friends.acceptChallenge(req.user.id, fromUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.decline)
  @Post('api/friends/challenges/:friendId/decline')
  declineChallenge(
    @Request() req: { user: { id: string } },
    @Param('friendId') fromUserId: string,
  ) {
    return this.friends.declineChallenge(req.user.id, fromUserId);
  }

  // The challenges this caller has out: what every CHALLENGE button greys itself
  // from, so an invite already sent does not read as a fresh one after a reload.
  @UseGuards(JwtAuthGuard)
  @Get('api/friends/challenges/sent')
  getSentChallenges(@Request() req: { user: { id: string } }) {
    return this.friends.getSentChallenges(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('api/friends/invites/pending')
  // Every live offer, newest first. It answered one object until 22.6; the strip is
  // its first caller, and one challenger can no longer hide another.
  getPendingInvites(@Request() req: { user: { id: string } }) {
    return this.friends.getPendingInvites(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle(FRIENDS_THROTTLE.dismissInvite)
  @Post('api/friends/invites/dismiss/:fromUserId')
  // The field is named because hiding one offer must not hide the others (22.6).
  dismissInvite(@Request() req: { user: { id: string } }, @Param('fromUserId') fromUserId: string) {
    return this.friends.dismissInvite(req.user.id, fromUserId);
  }
}
