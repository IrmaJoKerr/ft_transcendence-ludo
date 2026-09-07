import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { PresenceService } from '../presence/presence.service';
import { ratingDeltaFor } from '../common/scoring';
import { NotificationService } from '../notification/notification.service';
import { createAvatar } from '@dicebear/core';
import { avataaars, bottts, identicon } from '@dicebear/collection';

// Same mapping + default the frontend uses in src/dicebear.ts, so the
// server-generated fallback looks identical to the client-side one.
const AVATAR_STYLES = { avataaars, bottts, identicon } as const;

@Injectable()
// User profile and avatar logic: public profiles, avatar upload/delete/get,
// and per-user game history. Called by user.controller.ts.
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationService,
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

    const status = await this.presence.getStatus(user.id);
    const { avatarPhotoContentType, ...rest } = user;
    return { ...rest, hasAvatarPhoto: avatarPhotoContentType !== null, status };
  }

  // Store an uploaded avatar image (bytes + content type) on the user row
  // and broadcast avatar_changed so clients refresh. Used by
  // POST /api/user/avatar.
  async uploadAvatar(userId: string, data: Buffer, contentType: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    // Prisma 7 uses Bytes type for avatarPhoto
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { avatarPhoto: data as any, avatarPhotoContentType: contentType },
    });

    await this.notifications
      .notify(userId, 'profile_updated', { items: ['avatar'] })
      .catch(() => {});

    // Live push: broadcast a TRANSIENT event so every connected client busts
    // its cached /api/user/<username>/avatar URL for this user (their own other
    // tabs included). No persistence : the bell stays clean, the photo refreshes.
    await this.notifications
      .broadcast('avatar_changed', {
        userId: user.id,
        username: user.username,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});

    return { message: 'Avatar uploaded', contentType };
  }

  // Fetch a user's stored avatar photo, or generate a dicebear fallback
  // (same seed/style the client uses) when none is set. Used by
  // GET /api/user/:username/avatar.
  async getAvatar(username: string): Promise<{ data: Buffer; contentType: string } | null> {
    const user = await this.prisma.db.user.findUnique({
      where: { username },
      select: { avatarPhoto: true, avatarPhotoContentType: true, avatarStyle: true },
    });
    if (user?.avatarPhoto && user.avatarPhotoContentType) {
      return { data: Buffer.from(user.avatarPhoto), contentType: user.avatarPhotoContentType };
    }
    // No uploaded photo : or no such user at all (bots are named "Red"/"Green"/
    // "Yellow" and hit this endpoint) : silently serve the same generated pixel
    // avatar the UI falls back to (dicebear, seeded by username), so avatar
    // URLs never 404 and never spam the console with failed loads.
    const style = AVATAR_STYLES[(user?.avatarStyle ?? 'bottts') as keyof typeof AVATAR_STYLES] ?? bottts;
    const svg = createAvatar(style as any, { seed: username }).toString();
    return { data: Buffer.from(svg), contentType: 'image/svg+xml' };
  }

  // Clear the user's avatar photo and broadcast avatar_changed so clients
  // fall back to the generated avatar. Used by DELETE /api/user/avatar.
  async deleteAvatar(userId: string) {
    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.db.user.update({
      where: { id: userId },
      data: { avatarPhoto: null, avatarPhotoContentType: null },
    });

    await this.notifications
      .notify(userId, 'profile_updated', { items: ['avatar'] })
      .catch(() => {});

    // Same live push as uploadAvatar : clients showing this user's photo must
    // re-fetch (and correctly fall back to the generated pixel avatar).
    await this.notifications
      .broadcast('avatar_changed', {
        userId: user.id,
        username: user.username,
        updatedAt: new Date().toISOString(),
      })
      .catch(() => {});

    return { message: 'Avatar deleted' };
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
