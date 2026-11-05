import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  HttpException,
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
  refusalSide,
  nextRefusal,
  DECLINE_COOLDOWN_MS,
  CHALLENGE_TTL_MS,
  type FriendshipStatus,
  type PairLike,
  type RefusalPairLike,
} from './friendship-pair';
import { firstFreeColor } from '../match/slot-colors';

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

// One offer the caller has out. Two kinds travel this list because two acts put an
// entry here (19.6): a *challenge*, which is a duel and points at no room until it
// is accepted, and a *room invite*, which offers a seat in the waiting room the
// caller already sits in. `sentAt` is what the reader expires either on.
export type SentChallenge = {
  userId: string;
  kind: 'challenge' | 'room';
  gameId?: string;
  inviteCode?: string;
  sentAt: number;
};

// What the invitee holds in `invite:<userId>`: one offer, either kind. Every field
// is optional because the record is read back off Redis, where each value is a
// claim to verify rather than a value to trust.
type PendingInvite = {
  kind?: 'challenge' | 'room';
  fromUserId?: string;
  fromUsername?: string;
  hostColor?: string;
  gameId?: string;
  inviteCode?: string;
  playerCount?: number;
  createdAt?: number;
};

// How long an accept waits for the challenger to become free, and how often it
// asks. Polled rather than refused on the first tick because the two answers come
// a second or two apart — one player finishing an abort, a socket reconnecting —
// and a refusal there would spend a challenge that was about to be answered.
const PRESENCE_GATE_MS = 2000;
const PRESENCE_GATE_STEP_MS = 100;

// The `code` a service exception carries. Only a couple of places translate one
// failure into another (the challenge accept does it for the challenger's seat), and
// each of them has to read the code rather than the message to do it.
function errorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (typeof response !== 'object') return undefined;
  return (response as { code?: string }).code;
}

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

  // POST /api/friends/:friendId/challenge
  //
  // A duel. Nothing is created here: the room is made by the accept, because a room
  // made at the send holds an id, seats and colours for a challenge that may never
  // be answered, and blocks both players from starting anything else while it waits.
  async challengeFriend(userId: string, friendId: string, hostColor?: string) {
    const pair = await this.assertOfferable(userId, friendId);
    this.assertNoRefusalCooldown(pair, friendId);

    if (!hostColor)
      throw new BadRequestException({
        code: 'CHALLENGE_COLOR_REQUIRED',
        message: 'Pick a corner before challenging',
      });

    // The room the accept will make seats the challenger first, so a challenger who
    // already holds a seat would be handed a room they cannot enter. That is
    // answered here, on the sender's own screen, rather than as a failed accept on
    // the other player's.
    if (await this.matchService.seatedMatch(userId))
      throw new ForbiddenException({
        code: 'MATCH_ALREADY_SEATED',
        message:
          'You are already seated in a game. Return to it, or click Abort to leave it before creating or joining another.',
      });

    const fromUsername = await this.username(userId);
    await this.notificationService.notify(friendId, 'game_invite', {
      kind: 'challenge',
      fromUserId: userId,
      fromUsername,
      hostColor,
    });
    await this.rememberPending(friendId, {
      kind: 'challenge',
      fromUserId: userId,
      fromUsername,
      hostColor,
      createdAt: Date.now(),
    });
    await this.recordChallenge(userId, friendId, { kind: 'challenge' });

    // Nothing to hand back: no room exists yet. The sender's screen says the
    // challenge is out, and the room arrives with the `challenge_accepted` frame.
    return { ok: true, kind: 'challenge' as const };
  }

  // POST /api/friends/:friendId/invite
  //
  // A seat, not a duel: the caller already sits in a waiting room and offers the
  // friend one of its free corners. The friend answers it by joining, so there is
  // nothing here to decline and nothing to count.
  async inviteToRoom(userId: string, friendId: string, gameId?: string) {
    await this.assertOfferable(userId, friendId);

    if (!gameId)
      throw new BadRequestException({
        code: 'FRIEND_INVITE_ROOM_REQUIRED',
        message: 'A room invite needs the room it offers a seat in',
      });

    // The room's own preconditions live with the room: a seat/PvP/WAITING check, and
    // the caller must be one of its players.
    const room = await this.matchService.assertInvitableRoom(gameId, userId);
    const fromUsername = await this.username(userId);

    // The friend is NOT seated here: a seat owns a colour, so they claim one from
    // the palette when they join. The invite carries the room only.
    await this.notificationService.notify(friendId, 'game_invite', {
      kind: 'room',
      gameId: room.gameId,
      inviteCode: room.inviteCode,
      fromUsername,
      playerCount: room.playerCount,
    });
    await this.rememberPending(friendId, {
      kind: 'room',
      gameId: room.gameId,
      inviteCode: room.inviteCode,
      fromUsername,
      playerCount: room.playerCount,
      createdAt: Date.now(),
    });
    await this.recordChallenge(userId, friendId, {
      kind: 'room',
      gameId: room.gameId,
      inviteCode: room.inviteCode,
    });

    // The caller is already in that room, so the answer is the room alone.
    return room;
  }

  // POST /api/friends/challenges/:friendId/accept
  //
  // The accept is where the room is made (19.6). It seats the challenger first, at
  // the corner they named when they sent, then the invitee, and answers with the
  // credentials that put the invitee at that table.
  async acceptChallenge(userId: string, fromUserId: string) {
    const pending = await this.readPending(userId);
    if (pending?.kind !== 'challenge' || pending.fromUserId !== fromUserId)
      throw new NotFoundException({
        code: 'CHALLENGE_NOT_PENDING',
        message: 'That challenge is no longer pending',
      });

    // Both seats have to be present and free, and each failure says which side is
    // missing. None of them is a refusal: nothing below touches the ladder.
    if ((await this.presence.getStatus(userId)) !== 'online')
      throw new ForbiddenException({
        code: 'CHALLENGEE_OFFLINE',
        message: 'You are not connected',
      });
    if (await this.matchService.seatedMatch(userId))
      throw new ForbiddenException({
        code: 'CHALLENGEE_BUSY',
        message: 'You are already seated in a game',
      });
    const challenger = await this.awaitChallengerFree(fromUserId);
    if (challenger !== 'ok')
      throw new ForbiddenException(
        challenger === 'offline'
          ? { code: 'CHALLENGER_OFFLINE', message: 'That player is not connected' }
          : { code: 'CHALLENGER_BUSY', message: 'That player is already seated in a game' },
      );

    const hostColor = pending.hostColor;
    let created;
    try {
      created = await this.matchService.createInvite(fromUserId, undefined, hostColor);
    } catch (error) {
      // The gate above was a poll, so this is the window it cannot close: the
      // challenger took a seat in the same instant. It is still their side that is
      // missing, so the answer is the one the poll would have given.
      if (errorCode(error) === 'MATCH_ALREADY_SEATED')
        throw new ForbiddenException({
          code: 'CHALLENGER_BUSY',
          message: 'That player is already seated in a game',
        });
      throw error;
    }

    let seat;
    try {
      // The invitee's corner is dealt, not asked: the answer arrived from a
      // notification, and the only fact that matters is that it is not the host's.
      seat = await this.matchService.joinMatch(created.gameId, userId, firstFreeColor(hostColor));
    } catch (error) {
      // A room nobody can join would keep the challenger's seat out of every other
      // table: close it rather than leave it waiting.
      await this.matchService.cancelGame(created.gameId, fromUserId).catch(() => undefined);
      throw error;
    }

    // The accepter's own ladder resets: they answered, which is what a streak
    // measures the absence of. The pending record and the challenger's entry are
    // spent either way.
    await this.resetRefusalStreak(userId, fromUserId);
    await this.redis.del(`invite:${userId}`);
    await this.redis.hdel(`challenge:${fromUserId}`, userId);

    // The challenger is already seated in that room, so the frame carries the code
    // the lobby rejoins by, not a second handoff.
    await this.notificationService.notify(fromUserId, 'challenge_accepted', {
      gameId: seat.gameId,
      // The joiner's handoff carries the room's code, and the creator's is the
      // fallback: the frame has to name the room the challenger rejoins by.
      inviteCode: seat.inviteCode ?? created.inviteCode,
      fromUsername: await this.username(userId),
    });

    return seat;
  }

  // POST /api/friends/challenges/:friendId/decline
  //
  // A refusal is the only act the ladder counts. A challenge that simply expires
  // costs nothing: ignoring one is not the same as answering it, so a player who was
  // not looking at the screen is never locked out of the next one.
  async declineChallenge(userId: string, fromUserId: string) {
    const pending = await this.readPending(userId);
    if (pending?.kind !== 'challenge' || pending.fromUserId !== fromUserId)
      throw new NotFoundException({
        code: 'CHALLENGE_NOT_PENDING',
        message: 'That challenge is no longer pending',
      });

    await this.redis.del(`invite:${userId}`);
    await this.redis.hdel(`challenge:${fromUserId}`, userId);
    const ladder = await this.recordRefusal(userId, fromUserId);
    return { ok: true, ...ladder };
  }

  // The offers this caller has out, one entry per friend. Each is skipped when its
  // stamp is past CHALLENGE_TTL_MS, and a room invite is also skipped when its room
  // is no longer waiting — a friend who already joined, or a room that ended, spends
  // the record early, which is what lets a re-challenge after a join through. A
  // challenge has no room to check: its accept or decline deletes the entry, so its
  // own age is the only lifetime it has.
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
      if (!parsed.sentAt || now - parsed.sentAt > CHALLENGE_TTL_MS) continue;
      if (parsed.gameId) {
        if (!(await this.matchService.isWaitingRoom(parsed.gameId))) continue;
        rows.push({
          userId: friendId,
          kind: 'room',
          gameId: parsed.gameId,
          inviteCode: parsed.inviteCode,
          sentAt: parsed.sentAt,
        });
        continue;
      }
      rows.push({ userId: friendId, kind: 'challenge', sentAt: parsed.sentAt });
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
    entry: { kind: 'challenge' } | { kind: 'room'; gameId: string; inviteCode?: string },
  ) {
    const key = `challenge:${userId}`;
    await this.redis.hset(key, friendId, JSON.stringify({ ...entry, sentAt: Date.now() }));
    // One hash per inviter, so the key's own life is the last entry's: a press
    // refreshes it, and the per-entry stamp above is the real expiry.
    await this.redis.expire(key, Math.ceil(CHALLENGE_TTL_MS / 1000) + 60);
  }

  // The invitee's own record of one offer, whichever act sent it. Written with the
  // notification, so the bell that re-reads after a reload and the accept that
  // answers it read the same facts.
  private async rememberPending(userId: string, record: PendingInvite) {
    await this.redis.set(
      `invite:${userId}`,
      JSON.stringify(record),
      'EX',
      Math.ceil(CHALLENGE_TTL_MS / 1000),
    );
  }

  private async readPending(userId: string): Promise<PendingInvite | null> {
    const raw = await this.redis.get(`invite:${userId}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PendingInvite;
    } catch {
      return null;
    }
  }

  // The invitee's side of an offer: the staged record, plus the one fact that cannot
  // be stored — whether the room still waits. `expired` is computed on read because a
  // stored flag would need a writer on every way a room can start or end, and the
  // record itself stays until its TTL so the invitee reads EXPIRED rather than
  // nothing at all. A challenge has no room yet, so it cannot be stale: its own TTL
  // is the whole of its life, and an expiry costs nothing (19.6).
  async getPendingInvite(userId: string) {
    const parsed = await this.readPending(userId);
    if (!parsed) return null;
    const expired =
      typeof parsed.gameId === 'string' && !(await this.matchService.isWaitingRoom(parsed.gameId));
    return { ...parsed, expired };
  }

  // Hiding an offer is not answering it: the record goes, the ladder does not move.
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

  // The gates every offer passes, whichever act it is: not yourself, nothing blocked
  // between the pair, friends, and no offer to this friend still live. The row comes
  // back because the challenge path reads the refusal ladder off it.
  private async assertOfferable(userId: string, friendId: string): Promise<RefusalPairLike> {
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

    // One offer per friend at a time. Without it a press mints a second room (the
    // room invite) or a second pending challenge, and the friend's bell fills with
    // the same person.
    const pending = await this.sentChallenges(userId);
    if (pending.some((row) => row.userId === friendId))
      throw new ConflictException({
        code: 'CHALLENGE_ALREADY_SENT',
        message: 'A challenge to this player is already pending',
      });

    return pair;
  }

  // The ladder, read off the row the gate already loaded, so a refusal costs no extra
  // read on the send path. It gates challenges and not room invites: a decline is an
  // answer to a duel, so a refusal suspends the duels *toward* the refuser — not the
  // offers of a seat, and not the challenges the refuser sends themselves.
  private assertNoRefusalCooldown(pair: RefusalPairLike, friendId: string) {
    const { until } = refusalSide(pair, friendId);
    const wait = until ? until.getTime() - Date.now() : 0;
    if (wait <= 0) return;
    throw new ConflictException({
      code: 'CHALLENGE_COOLDOWN',
      message: 'This player refused a challenge recently',
      retryAfterMs: wait,
    });
  }

  // The other player's half of the accept gate, polled for about two seconds. The
  // accepting player's own seat is not polled: their state is the request itself.
  private async awaitChallengerFree(fromUserId: string): Promise<'ok' | 'offline' | 'busy'> {
    const deadline = Date.now() + PRESENCE_GATE_MS;
    for (;;) {
      const online = (await this.presence.getStatus(fromUserId)) === 'online';
      const seated = await this.matchService.seatedMatch(fromUserId);
      if (online && !seated) return 'ok';
      if (Date.now() >= deadline) return online ? 'busy' : 'offline';
      await new Promise((resolve) => setTimeout(resolve, PRESENCE_GATE_STEP_MS));
    }
  }

  // One rung for a refusal, written on the refuser's own side of the pair row: the
  // streak prices the next rung, so it grows with every refusal and only an accept on
  // that same side resets it.
  private async recordRefusal(refuserId: string, otherId: string) {
    const pair = await this.findPair(refuserId, otherId);
    if (!pair) return { streak: 0, until: null };
    const side = refusalSide(pair, refuserId);
    const next = nextRefusal(side);
    await this.prisma.db.friendship.update({
      where: { id: pair.id },
      data: side.isUser1
        ? { user1RefusalStreak: next.streak, user1RefusalsUntil: next.until }
        : { user2RefusalStreak: next.streak, user2RefusalsUntil: next.until },
    });
    return { streak: next.streak, until: next.until };
  }

  // An accepted challenge clears the accepter's own ladder against that challenger.
  private async resetRefusalStreak(accepterId: string, otherId: string) {
    const pair = await this.findPair(accepterId, otherId);
    if (!pair) return;
    const side = refusalSide(pair, accepterId);
    if (side.streak === 0 && side.until === null) return;
    await this.prisma.db.friendship.update({
      where: { id: pair.id },
      data: side.isUser1
        ? { user1RefusalStreak: 0, user1RefusalsUntil: null }
        : { user2RefusalStreak: 0, user2RefusalsUntil: null },
    });
  }

  // The caller's account name for a notification. A row that is somehow missing still
  // names something rather than leaving the frame blank.
  private async username(userId: string): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return user?.username ?? 'A friend';
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
