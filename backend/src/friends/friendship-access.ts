import { HttpException, Injectable } from '@nestjs/common';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { effectiveStatus, pairKey, type FriendshipStatus, type PairLike } from './friendship-pair';

// The `code` a service exception carries. Only a couple of places translate one
// failure into another (the challenge accept does it for the challenger's seat), and
// each of them has to read the code rather than the message to do it.
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) return undefined;
  const response = error.getResponse();
  if (typeof response !== 'object') return undefined;
  return (response as { code?: string }).code;
}

// The small reads and notifications every friends screen shares. Kept out of the
// three feature services so a request, an invite and a block all name a pair and a
// person the same way, without one of them owning the other.
@Injectable()
export class FriendshipAccess {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  // Load the single unordered pair row shared by two users, if any.
  async findPair(a: string, b: string) {
    return this.prisma.db.friendship.findUnique({ where: { pairKey: pairKey(a, b) } });
  }

  // The caller's account name for a notification. A row that is somehow missing still
  // names something rather than leaving the frame blank.
  async username(userId: string): Promise<string> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return user?.username ?? 'A friend';
  }

  // Effective status of the row as seen from one user's side (applies expiry).
  statusOf(pair: PairLike, userId: string, now: number): FriendshipStatus {
    const isUser1 = pair.user1Id === userId;
    return effectiveStatus(
      isUser1 ? pair.user1Status : pair.user2Status,
      isUser1 ? pair.user1StatusAt : pair.user2StatusAt,
      now,
    );
  }

  // Persisted friend_request push (bell + live) with the sender's display data.
  async notifyFriendRequest(targetUserId: string, senderId: string, requestId: string) {
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
  async notifyFriendAccepted(targetUserId: string, accepterId: string) {
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
  async notifyFriendDeclined(targetUserId: string, declinerId: string) {
    const decliner = await this.prisma.db.user.findUnique({
      where: { id: declinerId },
      select: { username: true },
    });
    await this.notificationService.notify(targetUserId, 'friend_declined', {
      fromUserId: declinerId,
      fromUsername: decliner?.username ?? 'A squad leader',
    });
  }
}
