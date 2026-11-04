import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { AvatarMetaService } from '../avatar/avatar-meta.service';
import { publishBlocksChanged, publishRoomsChanged } from '../common/channels';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { MatchService } from '../match/match.service';
import { NotificationService } from '../notification/notification.service';
import { secret } from '../secrets';
import { BlockStateService } from './block-state.service';
import { FriendshipEventsService } from './friendship-events.service';
import {
  pairKey,
  isFriendPair,
  isBlockedPair,
  effectiveStatus,
  DECLINE_COOLDOWN_MS,
  CHALLENGE_TTL_MS,
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
  avatarV?: number;
  createdAt: Date;
};

// One challenge the caller has out: the friend, the room it points at, and when it
// was sent. `sentAt` is what the reader expires it on.
export type SentChallenge = {
  userId: string;
  gameId: string;
  inviteCode?: string;
  sentAt: number;
};

@Injectable()
// Friend system: friend requests/accept/decline, friend list with online
// status, blocking, and game invitations. Called by friends.controller.ts.
export class FriendsService {
  // Redis client (used for pending-invite records, invite:<userId> keys, and the
  // challenge:<userId> hashes that say which friends a user has already challenged).
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly matchService: MatchService,
    private readonly notificationService: NotificationService,
    private readonly blockState: BlockStateService,
    private readonly avatars: AvatarMetaService,
    private readonly events: FriendshipEventsService,
  ) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');

    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  // Challenge a friend, in one call with two shapes. With a `gameId` the friend is
  // staged into the room the caller already sits in; without one a room is created
  // for them and the caller is handed its credentials. Both shapes write the same
  // three records (the `game_invite` notification, the invitee's pending invite,
  // and the inviter's `challenge:` entry), so every CHALLENGE button in the app —
  // the friends page, the lobby's name card, the waiting room's column — is this
  // path. POST /api/friends/:friendId/invite
  async inviteToGame(userId: string, friendId: string, hostColor?: string, gameId?: string) {
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

    // One challenge per friend at a time. Without this the create shape would mint
    // a second room on every press, and the friend would hold an invite to a room
    // nobody is sitting in.
    const pending = await this.sentChallenges(userId);
    if (pending.some((row) => row.userId === friendId))
      throw new ConflictException({
        code: 'CHALLENGE_ALREADY_SENT',
        message: 'A challenge to this player is already pending',
      });

    // The room: the caller's own waiting room, or a new one. The match service owns
    // both questions — a room's seat/PvP/WAITING preconditions live with the room,
    // and a create takes the host's corner because the host is seated first.
    const room = gameId
      ? await this.matchService.assertInvitableRoom(gameId, userId)
      : await this.matchService.createInvite(userId, undefined, hostColor);

    const inviter = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { username: true, displayName: true },
    });
    const fromUsername = inviter?.username ?? 'A friend';

    // The friend is NOT seated here: a seat owns a colour, so they claim one from
    // the palette when they accept. The invite carries the room only.
    await this.notificationService.notify(friendId, 'game_invite', {
      gameId: room.gameId,
      inviteCode: room.inviteCode,
      fromUsername,
      playerCount: room.playerCount,
    });

    // The invitee's own record (GET /api/friends/invites/pending, and the bell that
    // re-reads it after a reload) and the inviter's challenge record are the two
    // halves of one send, so they are written together and expire together.
    await this.redis.set(
      `invite:${friendId}`,
      JSON.stringify({
        gameId: room.gameId,
        inviteCode: room.inviteCode,
        fromUsername,
        createdAt: Date.now(),
      }),
      'EX',
      Math.ceil(CHALLENGE_TTL_MS / 1000),
    );
    await this.recordChallenge(userId, friendId, room.gameId, room.inviteCode);

    // A created room also hands the inviter their own credentials, so the caller can
    // join its own room immediately: the host must be seated before the friend can
    // accept, otherwise the friend's accept could create/join the room alone.
    return room;
  }

  // The challenges this caller has out, newest record per friend. Each entry is
  // skipped when its stamp is past CHALLENGE_TTL_MS or when its room is no longer
  // waiting — a friend who already joined, or a room that ended, spends the record
  // early, which is what lets a re-challenge after a join through.
  private async sentChallenges(userId: string): Promise<SentChallenge[]> {
    const raw = await this.redis.hgetall(`challenge:${userId}`);
    const now = Date.now();
    const rows: SentChallenge[] = [];
    for (const [friendId, json] of Object.entries(raw)) {
      let parsed: { gameId?: string; inviteCode?: string; sentAt?: number };
      try {
        parsed = JSON.parse(json) as typeof parsed;
      } catch {
        continue;
      }
      if (!parsed.sentAt || !parsed.gameId) continue;
      if (now - parsed.sentAt > CHALLENGE_TTL_MS) continue;
      if (!(await this.matchService.isWaitingRoom(parsed.gameId))) continue;
      rows.push({
        userId: friendId,
        gameId: parsed.gameId,
        inviteCode: parsed.inviteCode,
        sentAt: parsed.sentAt,
      });
    }
    return rows;
  }

  // GET /api/friends/challenges/sent: what every CHALLENGE button seeds its
  // "already sent" state from, so the greying survives a reload or a second screen.
  async getSentChallenges(userId: string): Promise<SentChallenge[]> {
    return this.sentChallenges(userId);
  }

  private async recordChallenge(
    userId: string,
    friendId: string,
    gameId: string,
    inviteCode?: string,
  ) {
    const key = `challenge:${userId}`;
    await this.redis.hset(
      key,
      friendId,
      JSON.stringify({ gameId, inviteCode, sentAt: Date.now() }),
    );
    // One hash per inviter, so the key's own life is the last entry's: a press
    // refreshes it, and the per-entry stamp above is the real expiry.
    await this.redis.expire(key, Math.ceil(CHALLENGE_TTL_MS / 1000) + 60);
  }

  // The invitee's side of a challenge: the staged record, plus the one fact that
  // cannot be stored — whether the room still waits. `expired` is computed on read
  // because a stored flag would need a writer on every way a room can start or end,
  // and the record itself stays until its TTL so the invitee reads EXPIRED rather
  // than nothing at all.
  async getPendingInvite(userId: string) {
    const raw = await this.redis.get(`invite:${userId}`);
    if (!raw) return null;
    let parsed: { gameId?: string } & Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      return null;
    }
    const open = typeof parsed.gameId === 'string' && (await this.matchService.isWaitingRoom(parsed.gameId));
    return { ...parsed, expired: !open };
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
      // Both sides: the target gets `pending-in`, the sender's other tabs get
      // `pending-out` (D2 — the actor is a recipient too, with no special case).
      void this.events.publishPair(userId, targetUserId);
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
    await this.notifyFriendRequest(targetUserId, userId, updated.id);
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
    await this.notifyFriendAccepted(isUser1 ? pair.user2Id : pair.user1Id, userId);
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
    await this.notifyFriendDeclined(isUser1 ? pair.user2Id : pair.user1Id, userId);
    // Both sides drop the row: the sender's pending-out becomes `none`, the
    // decliner's pending-in does too (a decline is not a list entry).
    void this.events.publishPair(pair.user1Id, pair.user2Id);

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
      if (this.statusOf(row, userId, now) === 'pending') {
        sent.push(view);
      } else if (this.statusOf(row, other.id, now) === 'pending') {
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
      // A block created out of nothing still hides whatever the other side had
      // (a pending request, or nothing at all) — both lists update live.
      void this.events.publishPair(userId, targetUserId);
      // And the room list moves with it: a room holding either side stops being a
      // row for the other, so the block needs no reload (queue item 3).
      await publishRoomsChanged(this.redis);
      // A live room that seats both is the one place the block has to act at once
      // (M3): the engine stamps the cut with its own chat sequence.
      await publishBlocksChanged(this.redis, userId, targetUserId, true);
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
    await publishRoomsChanged(this.redis);
    // A live room that seats both cuts the pair's speech from the next line on.
    await publishBlocksChanged(this.redis, userId, targetUserId, true);

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
    // Liftable state again: the row comes back as `none` (or `blocked` when the
    // other side still holds its own block), and the profile un-gates with it.
    void this.events.publishPair(userId, targetUserId);
    // The other side's room comes back as a row for this viewer with it.
    await publishRoomsChanged(this.redis);
    // The room's ledger drops the pair, so a live room reads like the lobby again:
    // nothing is retroactively hidden, nothing stays cut.
    await publishBlocksChanged(this.redis, userId, targetUserId, false);

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
