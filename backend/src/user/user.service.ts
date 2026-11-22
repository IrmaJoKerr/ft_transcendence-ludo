import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { NotificationService } from '../notification/notification.service';
import { AvatarMetaService } from '../avatar/avatar-meta.service';
import { AvatarThumbnailService } from '../avatar/avatar-thumbnail.service';
import { BlockStateService, visibilityFor } from '../friends/block-state.service';
import { FriendshipEventsService } from '../friends/friendship-events.service';

@Injectable()
// User profile and avatar logic: pair-gated profiles, avatar upload/delete/get,
// and per-user game history. Called by user.controller.ts.
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationService,
    private readonly avatarMeta: AvatarMetaService,
    private readonly avatarThumbnail: AvatarThumbnailService,
    private readonly blockState: BlockStateService,
    private readonly friendshipEvents: FriendshipEventsService,
  ) {}

  // Profile as the caller may see it. The block gate lives here, not in the client:
  // a block returns 200 with degraded identity and avatar only, because a block hides
  // the relationship, not the person. Stats and presence drop out.
  async getPublicProfile(username: string, viewerId: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        createdAt: true,
        avatarStyle: true,
        avatarPhotoContentType: true,
        // The career is one row (PlayerStats), so the card reads it in the same
        // query instead of loading career columns off the account. Explicit fields:
        // the row's own id/user_id/timestamps are nobody's business here.
        stats: {
          select: {
            rating: true,
            highestRating: true,
            gamesPlayed: true,
            wins: true,
            losses: true,
            winStreak: true,
            bestWinStreak: true,
            botWins: true,
            humanWins: true,
            lastRatingDelta: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User "${username}" not found`);
    }

    // Repair the avatar-meta cache from the loaded row, so a missed write converges on
    // the next read. The stamp is the record's `?v=`, not a new one per view.
    const avatarV = await this.avatarMeta.syncFromUser(user);

    const { avatarPhotoContentType, ...rest } = user;
    const hasAvatarPhoto = avatarPhotoContentType !== null;
    const stamp = avatarV === undefined ? {} : { avatarV };

    const blockState = await this.blockState.between(viewerId, user.id);
    if (blockState !== 'none') {
      return {
        id: rest.id,
        username: rest.username,
        displayName: rest.displayName,
        avatarStyle: rest.avatarStyle,
        hasAvatarPhoto,
        ...stamp,
        visibility: visibilityFor(blockState),
      };
    }

    const status = await this.presence.getStatus(user.id);
    return { ...rest, hasAvatarPhoto, ...stamp, status, visibility: 'full' as const };
  }

  // Store the uploaded bytes on the user row, confirm the change to the user
  // themselves (persisted `profile_updated`, their own bell only) and sync their
  // own clients (transient `avatar_changed`). Used by POST /api/user/avatar.
  async uploadAvatar(userId: string, data: Buffer, contentType: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    // Build the thumbnail before the row write, so one update carries both columns and a
    // reader never sees a new photo beside the old thumbnail. A null result clears the
    // thumbnail and the route falls back to the original.
    const thumb = await this.avatarThumbnail.build(data);

    // Prisma 7 uses Bytes type for avatarPhoto
    await this.prisma.db.user.update({
      where: { id: userId },
      // Prisma 7 types Bytes as Uint8Array<ArrayBuffer>; Buffer is
      // Uint8Array<ArrayBufferLike>, so copy into a fresh Uint8Array.
      data: {
        avatarPhoto: Uint8Array.from(data),
        avatarPhotoContentType: contentType,
        avatarThumb: thumb ? thumb.data : null,
        avatarThumbContentType: thumb ? thumb.contentType : null,
      },
    });

    // Self-confirmation: "You have updated your profile: Avatar". `notify()` writes a
    // row owned by the actor and publishes to `notify:<userId>`, so the bell entry and
    // toast exist in the actor's own account only.
    await this.notifications
      .notify(userId, 'profile_updated', { items: ['avatar'] })
      .catch(() => {});

    // Cache the flag only AFTER the row is committed (see AvatarMetaService):
    // Redis-first could leave has=1 with no bytes behind it.
    const avatarV = await this.avatarMeta.set(userId, { has: true, style: user.avatarStyle });

    // The event carries the new state plus the stamp, so the user's other tabs switch
    // to the photo with no request of their own. Targeted at the owner and transient:
    // no bell entry.
    await this.notifications
      .notifyTransient(userId, 'avatar_changed', {
        userId: user.id,
        username: user.username,
        has: true,
        style: user.avatarStyle,
        v: avatarV,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});

    // The content half of every accepted friend's row (D2): their list carries
    // this account's avatar, so it gets the new style/flags and the stamp.
    void this.friendshipEvents.publishSubject(userId);

    return { contentType };
  }

  // Stored photo by immutable id, or null so the caller falls back to a generated
  // avatar. Serves the thumbnail when present and the original otherwise; the route's
  // stable URL and ETag contract is unchanged.
  async getAvatarById(userId: string): Promise<{ data: Buffer; contentType: string } | null> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: {
        avatarPhoto: true,
        avatarPhotoContentType: true,
        avatarThumb: true,
        avatarThumbContentType: true,
      },
    });
    // The original stays the "has a photo" signal even when the thumbnail is
    // what gets sent: a missing original means no photo at all.
    if (!user?.avatarPhoto || !user.avatarPhotoContentType) return null;
    if (user.avatarThumb && user.avatarThumbContentType) {
      return { data: Buffer.from(user.avatarThumb), contentType: user.avatarThumbContentType };
    }
    return { data: Buffer.from(user.avatarPhoto), contentType: user.avatarPhotoContentType };
  }

  // Clear the photo, confirm the change to the user themselves (persisted
  // `profile_updated`, their own bell only) and sync their own clients so they
  // fall back (transient `avatar_changed`). Used by DELETE /api/user/avatar.
  async deleteAvatar(userId: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    await this.prisma.db.user.update({
      where: { id: userId },
      data: {
        avatarPhoto: null,
        avatarPhotoContentType: null,
        // The derivative goes with the original, or a deleted avatar would keep
        // returning the last picture.
        avatarThumb: null,
        avatarThumbContentType: null,
      },
    });

    // Same ordering rule as uploadAvatar : commit to Postgres first, then cache.
    const avatarV = await this.avatarMeta.set(userId, { has: false, style: user.avatarStyle });

    // Same self-confirmation as uploadAvatar: persisted, and visible only to this
    // user (the bell row is theirs and the live push goes to their tabs only).
    await this.notifications
      .notify(userId, 'profile_updated', { items: ['avatar'] })
      .catch(() => {});

    // `has: false` drops the user's other tabs back to the generated avatar with
    // no request at all; without it they would keep asking for a photo that is
    // gone.
    await this.notifications
      .notifyTransient(userId, 'avatar_changed', {
        userId: user.id,
        username: user.username,
        has: false,
        style: user.avatarStyle,
        v: avatarV,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});

    // Same content push as the upload: friends fall back to the generated avatar.
    void this.friendshipEvents.publishSubject(userId);

    return { ok: true };
  }

  // One page of a user's finished matches, each row carrying its own counters and
  // the room it was played in. Used by GET /api/user/:username/games.
  async getUserGames(username: string, viewerId: string, page: number = 1, limit: number = 20) {
    const user = await this.prisma.db.user.findUnique({ where: { username } });
    if (!user) throw new NotFoundException(`User "${username}" not found`);

    // A block hides the history too: the client skips this read when
    // `visibility !== 'full'`, and the 403 keeps a deep link honest.
    await this.blockState.assertUnblocked(viewerId, user.id);

    const skip = (page - 1) * limit;

    // One indexed read over (user_id, playedAt) and a count: the row carries its
    // participants, so a page needs no join at all.
    const [rows, total] = await Promise.all([
      this.prisma.db.matchHistory.findMany({
        where: { user_id: user.id },
        orderBy: { playedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.db.matchHistory.count({ where: { user_id: user.id } }),
    ]);

    return {
      games: rows.map((row) => ({
        gameId: row.game_id,
        playedAt: row.playedAt,
        durationMs: row.durationMs,
        gameType: row.gameType,
        gameModes: row.gameModes,
        color: row.color,
        rank: row.rank,
        // COMPLETED or ABANDONED: the history row's third state. A win is
        // `rank === 1` on a completed row; an abandoned row is neither a win nor a
        // loss, and the client labels it from here.
        status: row.status,
        ratingDelta: row.ratingDelta,
        totalTurns: row.totalTurns,
        totalCaptures: row.totalCaptures,
        piecesInGoal: row.piecesInGoal,
        piecesLost: row.piecesLost,
        threeSixes: row.threeSixes,
        clashAttacksWon: row.clashAttacksWon,
        clashDefendsWon: row.clashDefendsWon,
        clashAttacksLost: row.clashAttacksLost,
        clashDefendsLost: row.clashDefendsLost,
        clashWallBattlesWon: row.clashWallBattlesWon,
        clashWallsAttacked: row.clashWallsAttacked,
        clashWallsDefended: row.clashWallsDefended,
        participants: row.participants,
        // Transcript is owner-only: another viewer's row omits it, not merely hides it.
        // `chatTruncated` rides with it so a cut transcript never reads as complete.
        ...(viewerId === user.id && row.chat !== null
          ? { chat: row.chat, chatTruncated: row.chatTruncated }
          : {}),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
