import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { ratingDeltaFor } from '../common/scoring';
import { NotificationService } from '../notification/notification.service';
import { AvatarMetaService } from '../avatar/avatar-meta.service';

@Injectable()
// User profile and avatar logic: public profiles, avatar upload/delete/get,
// and per-user game history. Called by user.controller.ts.
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationService,
    private readonly avatarMeta: AvatarMetaService,
  ) {}

  // Full public profile of a user (stats, rating, avatar info, online
  // status) with no private data. Used by GET /api/user/:username.
  async getPublicProfile(username: string) {
    const user = await this.prisma.db.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        createdAt: true,
        avatarStyle: true,
        avatarPhotoContentType: true,
        rating: true,
        highestRating: true,
        wins: true,
        losses: true,
        winStreak: true,
        bestWinStreak: true,
        botWins: true,
        humanWins: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User "${username}" not found`);
    }

    // Repair the avatar-meta cache from the row we already loaded (no extra
    // query), so a missed write or an eviction converges on the next read.
    this.avatarMeta.syncFromUser(user);

    const status = await this.presence.getStatus(user.id);
    const { avatarPhotoContentType, ...rest } = user;
    return { ...rest, hasAvatarPhoto: avatarPhotoContentType !== null, status };
  }

  // Store the uploaded bytes on the user row, confirm the change to the user
  // themselves (persisted `profile_updated`, their own bell only) and sync their
  // own clients (transient `avatar_changed`). Used by POST /api/user/avatar.
  async uploadAvatar(userId: string, data: Buffer, contentType: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    // Prisma 7 uses Bytes type for avatarPhoto
    await this.prisma.db.user.update({
      where: { id: userId },
      // Prisma 7 types Bytes as Uint8Array<ArrayBuffer>; Buffer is
      // Uint8Array<ArrayBufferLike>, so copy into a fresh Uint8Array.
      data: { avatarPhoto: Uint8Array.from(data), avatarPhotoContentType: contentType },
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

    return { contentType };
  }

  // The stored photo by immutable id; null when there is none, and the caller
  // falls back to the generated avatar. Used by GET /api/user/id/:userId/avatar.
  async getAvatarById(userId: string): Promise<{ data: Buffer; contentType: string } | null> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { avatarPhoto: true, avatarPhotoContentType: true },
    });
    if (!user?.avatarPhoto || !user.avatarPhotoContentType) return null;
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
      data: { avatarPhoto: null, avatarPhotoContentType: null },
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

    return { ok: true };
  }

  // One page of a user's finished games with per-game participants and
  // rating deltas. Used by GET /api/user/:username/games.
  async getUserGames(username: string, page: number = 1, limit: number = 20) {
    const user = await this.prisma.db.user.findUnique({ where: { username } });
    if (!user) throw new NotFoundException(`User "${username}" not found`);

    const skip = (page - 1) * limit;

    const [participations, total] = await Promise.all([
      this.prisma.db.gameParticipant.findMany({
        where: { user_id: user.id },
        orderBy: { game: { endedAt: 'desc' } },
        skip,
        take: limit,
        include: {
          game: {
            include: {
              participants: {
                include: {
                  user: {
                    select: {
                      username: true,
                      displayName: true,
                      avatarStyle: true,
                      avatarPhotoContentType: true,
                    },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.db.gameParticipant.count({ where: { user_id: user.id } }),
    ]);

    return {
      games: participations.map((p) => ({
        gameId: p.game_id,
        status: p.game.status,
        gameType: p.game.gameType,
        color: p.color,
        rank: p.rank,
        piecesCaptured: p.piecesCaptured,
        piecesInGoal: p.piecesInGoal,
        ratingDelta: ratingDeltaFor({
          piecesInGoal: p.piecesInGoal,
          rank: p.rank,
          gameType: p.game.gameType,
        }),
        startedAt: p.game.startedAt,
        endedAt: p.game.endedAt,
        participants: p.game.participants.map((gp) => ({
          username: gp.user.username,
          displayName: gp.user.displayName,
          avatarStyle: gp.user.avatarStyle,
          hasAvatarPhoto: gp.user.avatarPhotoContentType !== null,
          color: gp.color,
          rank: gp.rank,
          piecesInGoal: gp.piecesInGoal,
        })),
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
