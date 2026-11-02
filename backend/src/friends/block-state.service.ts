import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { pairKey } from './friendship-pair';

// Which side of the pair holds the block. Directional on purpose: the profile
// card renders different copy for each, and only the viewer's own block can be
// lifted from that page.
export type BlockState = 'none' | 'viewer-blocked-target' | 'target-blocked-viewer' | 'both';

// What GET /api/user/:username tells the client. `both` reads as
// blocked-by-you, because the viewer still holds a block they can lift; after
// that unblock the next read reports blocked-by-them (their block survives).
export type ProfileVisibility = 'full' | 'blocked-by-you' | 'blocked-by-them';

export function visibilityFor(state: BlockState): ProfileVisibility {
  if (state === 'none') return 'full';
  if (state === 'target-blocked-viewer') return 'blocked-by-them';
  return 'blocked-by-you';
}

@Injectable()
// The one place a read path asks "is there a block between these two users?".
// Prisma-only on purpose: injecting FriendsService into UserService would drag
// MatchModule in behind it and create a second module cycle.
export class BlockStateService {
  constructor(private readonly prisma: PrismaService) {}

  // One unordered-pair lookup (`pairKey`), no joins and no presence read.
  async between(viewerId: string, targetId: string): Promise<BlockState> {
    if (!viewerId || !targetId || viewerId === targetId) return 'none';

    const pair = await this.prisma.db.friendship.findUnique({
      where: { pairKey: pairKey(viewerId, targetId) },
      select: { user1Id: true, user1Status: true, user2Status: true },
    });
    if (!pair) return 'none';

    const viewerIsUser1 = pair.user1Id === viewerId;
    const viewerBlocked = (viewerIsUser1 ? pair.user1Status : pair.user2Status) === 'blocked';
    const targetBlocked = (viewerIsUser1 ? pair.user2Status : pair.user1Status) === 'blocked';

    if (viewerBlocked) return targetBlocked ? 'both' : 'viewer-blocked-target';
    return targetBlocked ? 'target-blocked-viewer' : 'none';
  }

  // Defence in depth for the collateral reads (games, achievements, friends):
  // 403 FRIEND_BLOCKED, so a deep link or curl cannot render what the UI hides.
  async assertUnblocked(viewerId: string, targetId: string): Promise<void> {
    if ((await this.between(viewerId, targetId)) !== 'none') {
      throw new ForbiddenException({
        code: 'FRIEND_BLOCKED',
        message: 'Content is not available for a blocked user',
      });
    }
  }

  // Every id the viewer has blocked, in one read. The session socket seeds its
  // chat filter from this at connect and keeps it current from
  // `friendship:changed`, so the filter costs no query per message.
  async blockedIds(viewerId: string): Promise<string[]> {
    if (!viewerId) return [];
    const rows = await this.prisma.db.friendship.findMany({
      where: {
        OR: [
          { user1Id: viewerId, user1Status: 'blocked' },
          { user2Id: viewerId, user2Status: 'blocked' },
        ],
      },
      select: { user1Id: true, user2Id: true },
    });
    return rows.map((row) => (row.user1Id === viewerId ? row.user2Id : row.user1Id));
  }
}
