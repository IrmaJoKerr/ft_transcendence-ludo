import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../common/redis-client';
import { MatchService } from '../match/match.service';
import { firstFreeColor } from '../match/slot-colors';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { errorCode, FriendshipAccess } from './friendship-access';
import {
  CHALLENGE_TTL_MS,
  isBlockedPair,
  isFriendPair,
  nextRefusal,
  refusalSide,
  type RefusalPairLike,
} from './friendship-pair';

// One offer the caller sent: a challenge, or a seat in the caller's waiting room.
// `sentAt` is the time the reader expires either kind on.
export type SentChallenge = {
  userId: string;
  kind: 'challenge' | 'room';
  gameId?: string;
  inviteCode?: string;
  sentAt: number;
};

// One field of `invite:<userId>`: one offer from one sender. Fields are optional
// because Redis values are claims to verify. Each field's `expiresAt` is its real
// life; the key TTL covers only the newest entry.
type PendingInvite = {
  kind?: 'challenge' | 'room';
  fromUserId?: string;
  fromUsername?: string;
  hostColor?: string;
  gameId?: string;
  inviteCode?: string;
  playerCount?: number;
  // When the sender pressed: the strip's order, newest first.
  sentAt?: number;
  // `sentAt + CHALLENGE_TTL_MS`: this field's own life.
  expiresAt?: number;
  // The bell row that announced it, so accept or decline can delete that row.
  notificationId?: string;
};

// How long and how often an accept waits for the challenger to become free. Polling
// avoids spending a challenge that was one tick from being answered.
const PRESENCE_GATE_MS = 2000;
const PRESENCE_GATE_STEP_MS = 100;

// The challenge and room-invite acts: one offer, one pending record, and the
// refusal ladder a declined duel leaves behind. A room invite points at a room
// MatchService already made; a challenge points at none until the accept makes it.
@Injectable()
export class FriendsInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly matchService: MatchService,
    private readonly notificationService: NotificationService,
    private readonly access: FriendshipAccess,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // POST /api/friends/:friendId/challenge
  // A duel: no room is created until the accept, so an unanswered challenge holds no
  // seats and blocks neither player.
  async challengeFriend(userId: string, friendId: string, hostColor?: string) {
    const pair = await this.assertOfferable(userId, friendId);
    this.assertNoRefusalCooldown(pair, friendId);

    if (!hostColor)
      throw new BadRequestException({
        code: 'CHALLENGE_COLOR_REQUIRED',
        message: 'Pick a corner before challenging',
      });

    // The accept seats the challenger first, so a seated challenger would get a room
    // they cannot enter. Refuse here, on the sender's screen.
    if (await this.matchService.seatedMatch(userId))
      throw new ForbiddenException({
        code: 'MATCH_ALREADY_SEATED',
        message:
          'You are already seated in a game. Return to it, or click Abort to leave it before creating or joining another.',
      });

    const fromUsername = await this.access.username(userId);
    const sentAt = Date.now();
    const expiresAt = sentAt + CHALLENGE_TTL_MS;
    const notificationId = await this.notificationService.notify(friendId, 'game_invite', {
      kind: 'challenge',
      fromUserId: userId,
      fromUsername,
      hostColor,
      // The row can print [EXPIRED] without asking anything (22.7 item 2).
      expiresAt,
    });
    await this.rememberPending(friendId, userId, {
      kind: 'challenge',
      fromUserId: userId,
      fromUsername,
      hostColor,
      sentAt,
      expiresAt,
      notificationId,
    });
    await this.recordChallenge(userId, friendId, { kind: 'challenge' });

    // Nothing to hand back: no room exists yet. The sender's screen says the
    // challenge is out, and the room arrives with the `challenge_accepted` frame.
    return { ok: true, kind: 'challenge' as const };
  }

  // POST /api/friends/:friendId/invite
  // A seat, not a duel: the caller offers one free corner of their waiting room. The
  // friend answers by joining, so there is nothing to decline or count.
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
    const fromUsername = await this.access.username(userId);
    const sentAt = Date.now();
    const expiresAt = sentAt + CHALLENGE_TTL_MS;

    // The friend is NOT seated here: a seat owns a colour, so they claim one from
    // the palette when they join. The invite carries the room only.
    const notificationId = await this.notificationService.notify(friendId, 'game_invite', {
      kind: 'room',
      // The sender, in every offer: the strip dismisses one field by its author, so
      // a room invite needs the id as much as a challenge does (22.6).
      fromUserId: userId,
      gameId: room.gameId,
      inviteCode: room.inviteCode,
      fromUsername,
      playerCount: room.playerCount,
      expiresAt,
    });
    await this.rememberPending(friendId, userId, {
      kind: 'room',
      fromUserId: userId,
      gameId: room.gameId,
      inviteCode: room.inviteCode,
      fromUsername,
      playerCount: room.playerCount,
      sentAt,
      expiresAt,
      notificationId,
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
  // The accept creates the room, seats the challenger at the named corner and then the
  // invitee, and returns the invitee's credentials.
  async acceptChallenge(userId: string, fromUserId: string) {
    const pending = await this.readPending(userId, fromUserId);
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

    // Answering resets the accepter's refusal ladder. Spend both offer records and the
    // bell row, so an accepted duel leaves nothing behind on another device.
    await this.resetRefusalStreak(userId, fromUserId);
    await this.redis.hdel(`invite:${userId}`, fromUserId);
    await this.redis.hdel(`challenge:${fromUserId}`, userId);
    if (pending.notificationId)
      await this.notificationService.markRead(pending.notificationId, userId);

    // The challenger is already seated in that room, so the frame carries the code
    // the lobby rejoins by, not a second handoff.
    await this.notificationService.notify(fromUserId, 'challenge_accepted', {
      gameId: seat.gameId,
      // The joiner's handoff carries the room's code, and the creator's is the
      // fallback: the frame has to name the room the challenger rejoins by.
      inviteCode: seat.inviteCode ?? created.inviteCode,
      fromUsername: await this.access.username(userId),
    });

    return seat;
  }

  // POST /api/friends/challenges/:friendId/decline
  //
  // A refusal is the only act the ladder counts. A challenge that simply expires
  // costs nothing: ignoring one is not the same as answering it, so a player who was
  // not looking at the screen is never locked out of the next one.
  async declineChallenge(userId: string, fromUserId: string) {
    const pending = await this.readPending(userId, fromUserId);
    if (pending?.kind !== 'challenge' || pending.fromUserId !== fromUserId)
      throw new NotFoundException({
        code: 'CHALLENGE_NOT_PENDING',
        message: 'That challenge is no longer pending',
      });

    // One field, not the key: another challenger's offer is not this refusal's to
    // spend. The announce row goes with the answer (22.6 item 5).
    await this.redis.hdel(`invite:${userId}`, fromUserId);
    await this.redis.hdel(`challenge:${fromUserId}`, userId);
    if (pending.notificationId)
      await this.notificationService.markRead(pending.notificationId, userId);
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
  // answers it read the same facts. One field per sender, exactly the shape
  // `challenge:<userId>` has had since 19.6: two live offers coexist, and a newer
  // sender can no longer overwrite an older offer's slot (22.6).
  private async rememberPending(userId: string, fromUserId: string, record: PendingInvite) {
    const key = `invite:${userId}`;
    await this.redis.hset(key, fromUserId, JSON.stringify(record));
    // One hash per invitee, so the key's own life is the newest entry's. Each field
    // carries its own `expiresAt`, which is the real expiry.
    await this.redis.expire(key, Math.ceil(CHALLENGE_TTL_MS / 1000) + 60);
  }

  // One field. A field past its own `expiresAt` is dropped here, so the hash cannot
  // accumulate lapsed offers between expiries.
  private async readPending(userId: string, fromUserId: string): Promise<PendingInvite | null> {
    const key = `invite:${userId}`;
    const raw = await this.redis.hget(key, fromUserId);
    if (!raw) return null;
    let parsed: PendingInvite;
    try {
      parsed = JSON.parse(raw) as PendingInvite;
    } catch {
      await this.redis.hdel(key, fromUserId);
      return null;
    }
    if (typeof parsed.expiresAt !== 'number' || Date.now() > parsed.expiresAt) {
      await this.redis.hdel(key, fromUserId);
      return null;
    }
    return { ...parsed, fromUserId };
  }

  // Every live offer, newest first: the strip's list (22.9). Lapsed fields are swept
  // as they are read, and an unreadable one is dropped rather than shown blank.
  private async readPendingAll(userId: string): Promise<PendingInvite[]> {
    const key = `invite:${userId}`;
    const raw = await this.redis.hgetall(key);
    const now = Date.now();
    const rows: PendingInvite[] = [];
    for (const [fromUserId, json] of Object.entries(raw)) {
      let parsed: PendingInvite;
      try {
        parsed = JSON.parse(json) as PendingInvite;
      } catch {
        await this.redis.hdel(key, fromUserId);
        continue;
      }
      if (typeof parsed.expiresAt !== 'number' || now > parsed.expiresAt) {
        await this.redis.hdel(key, fromUserId);
        continue;
      }
      rows.push({ ...parsed, fromUserId });
    }
    return rows.sort((a, b) => (b.sentAt ?? 0) - (a.sentAt ?? 0));
  }

  // The invitee's side of every open offer: each staged record, plus the one fact that
  // cannot be stored — whether the room still waits. `expired` is computed on read
  // because a stored flag would need a writer on every way a room can start or end, and
  // the record itself stays until its TTL so the reader sees EXPIRED rather than
  // nothing at all. A challenge has no room yet, so it cannot be stale: its own TTL is
  // the whole of its life (19.6).
  async getPendingInvites(userId: string) {
    const rows = await this.readPendingAll(userId);
    return Promise.all(
      rows.map(async (offer) => ({
        ...offer,
        expired:
          typeof offer.gameId === 'string' && !(await this.matchService.isWaitingRoom(offer.gameId)),
      })),
    );
  }

  // Hiding an offer is not answering it: that field goes, the others stay, and the
  // ladder does not move.
  async dismissInvite(userId: string, fromUserId: string) {
    await this.redis.hdel(`invite:${userId}`, fromUserId);
    return { ok: true };
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

    const pair = await this.access.findPair(userId, friendId);
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
    const pair = await this.access.findPair(refuserId, otherId);
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
    const pair = await this.access.findPair(accepterId, otherId);
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
}
