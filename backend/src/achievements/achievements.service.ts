import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BlockStateService } from '../friends/block-state.service';
import {
  ACHIEVEMENT_RULES,
  ACHIEVEMENT_KEYS,
  AchKey,
  AchievementRule,
  LifecycleCounts,
  GameParticipantLike,
  GameLike,
} from './achievements.registry';
import type { GameType } from '../../generated/prisma/client';

// Game types that count toward lifetime achievement counters.
const RATED_GAME_TYPES: readonly GameType[] = ['PVP', 'PVE'];

// Structural shapes (kept local / decoupled from generated Prisma payloads).
// An Achievement row exposes one boolean flag per AchKey.
type AchievementFlags = Partial<Record<AchKey, boolean>>;

// A Game row (with optional participants) that the per-game rules evaluate.
interface GameWithParticipants extends GameLike {
  participants?: Array<GameParticipantLike & { user_id: string }>;
}

// The User fields the lifetime counters read.
interface UserStreaks {
  winStreak?: number | null;
  pveGameStreak?: number | null;
}

@Injectable()
// Achievement unlock engine: evaluates the registry rules for a user or a
// finished game, flips Achievement flags, and notifies on unlocks. Used by
// achievements.controller.ts and match.postgame.service.ts.
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly blockState: BlockStateService,
  ) {}

  // Post-game auto-hook from processGameEnd. Never throws : failures log.
  async evaluateAfterGame(gameId: string): Promise<void> {
    try {
      const game = await this.prisma.db.game.findUnique({
        where: { id: gameId },
        include: { participants: true },
      });
      if (!game) return;

      // Every participant row points at a real account: `user_id` is a foreign
      // key onto `User` (random UUIDs), and postgame writes no row for a seat it
      // could not load an account for. There is no bot row to skip.
      for (const p of game.participants) {
        await this.evaluateForUser(p.user_id, game, true);
      }
    } catch (err) {
      this.logger.warn(`evaluateAfterGame failed for game ${gameId}: ${(err as Error).message}`);
    }
  }

  // Full evaluation for a user: lifetime rules from LifecycleCounts, per-game
  // rules from the passed-in game (or a retroactive loop over past games).
  // announce=false = silent backfill (POST /check).
  async evaluateForUser(
    userId: string,
    game?: GameWithParticipants | null,
    announce = true,
  ): Promise<{ unlocked: string[] }> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: { achievement: true },
    });
    if (!user) return { unlocked: [] };

    const unlocked: string[] = [];

    // LifecycleCounts : computed once per evaluation (PVP/PVE only).
    const counts = await this.computeLifecycleCounts(userId, user);

    // Evaluate lifetime rules (registry-driven), then per-game rules.
    for (const rule of ACHIEVEMENT_RULES) {
      if (rule.type === 'lifetime') {
        await this.evaluateRule(userId, user.achievement, rule, counts, null, announce, unlocked);
      }
    }

    // Per-game rules: evaluate the passed-in game, or (silent backfill) run
    // a retroactive loop over all past games so history can unlock them too.
    const perGameRules = ACHIEVEMENT_RULES.filter((r) => r.type === 'per-game');
    if (game) {
      for (const rule of perGameRules) {
        await this.evaluateRule(userId, user.achievement, rule, counts, game, announce, unlocked);
      }
    } else {
      const games = await this.prisma.db.game.findMany({
        where: { status: 'COMPLETED', participants: { some: { user_id: userId } } },
        orderBy: { endedAt: 'desc' },
        include: { participants: true },
      });
      for (const g of games) {
        for (const rule of perGameRules) {
          // Skip rules already unlocked during this evaluation pass.
          if (unlocked.includes(rule.key)) continue;
          await this.evaluateRule(userId, user.achievement, rule, counts, g, announce, unlocked);
        }
      }
    }

    return { unlocked };
  }

  // Evaluate a single rule and unlock+notify if the gate newly flips true.
  private async evaluateRule(
    userId: string,
    flags: AchievementFlags | null,
    rule: AchievementRule,
    counts: LifecycleCounts,
    game: GameWithParticipants | null,
    announce: boolean,
    unlocked: string[],
  ): Promise<void> {
    const alreadyUnlocked = Boolean(flags?.[rule.key]);
    if (alreadyUnlocked) return;

    let progress = 0;
    let target = rule.target ?? 0;

    if (rule.type === 'lifetime' && rule.source) {
      progress = rule.source(counts);
      target = rule.target ?? 0;
    } else if (rule.type === 'per-game' && rule.perGameSource && game) {
      const myParticipation = game.participants?.find((p) => p.user_id === userId);
      if (myParticipation) {
        progress = rule.perGameSource(myParticipation, game);
        target = rule.perGameTarget ?? 0;
      }
    }

    if (target > 0 && progress >= target) {
      const didUnlock = await this.unlock(userId, rule.key);
      if (didUnlock) {
        unlocked.push(rule.key);
        if (announce) {
          await this.notifications.notify(userId, 'achievement', {
            achievementKey: rule.key,
            nameKey: rule.nameKey,
          });
        }
      }
    }
  }

  // GET /api/achievements : report for all 16 achievement keys.
  async getUserAchievements(userId: string, targetUsername?: string) {
    let effectiveUserId = userId;
    if (targetUsername) {
      const targetUser = await this.prisma.db.user.findUnique({
        where: { username: targetUsername },
        select: { id: true },
      });
      if (targetUser) {
        // The profile page skips this read when `visibility !== 'full'`; the
        // 403 is what stops a deep link or curl from reading a blocked user.
        await this.blockState.assertUnblocked(userId, targetUser.id);
        effectiveUserId = targetUser.id;
      }
    }

    const user = await this.prisma.db.user.findUnique({
      where: { id: effectiveUserId },
      include: { achievement: true },
    });
    if (!user) return {};

    const counts = await this.computeLifecycleCounts(effectiveUserId, user);
    const latestGame = await this.prisma.db.game.findFirst({
      where: { status: 'COMPLETED', participants: { some: { user_id: effectiveUserId } } },
      orderBy: { endedAt: 'desc' },
      include: { participants: true },
    });
    const myParticipation = latestGame?.participants.find((p) => p.user_id === effectiveUserId);

    const result: Record<string, { unlocked: boolean; progress: number; target: number }> = {};

    for (const key of ACHIEVEMENT_KEYS) {
      const rule = ACHIEVEMENT_RULES.find((r) => r.key === key);
      if (!rule) continue;
      const unlocked = Boolean(user.achievement?.[key]);

      let progress = 0;
      let target = rule.target ?? 0;

      if (rule.type === 'lifetime' && rule.source) {
        progress = rule.source(counts);
        target = rule.target ?? 0;
      } else if (rule.type === 'per-game' && rule.perGameSource) {
        // Per-game progress = current game value (0 when no game in progress).
        if (myParticipation && latestGame) {
          progress = rule.perGameSource(myParticipation, latestGame);
        }
        target = rule.perGameTarget ?? 0;
      }

      result[key] = { unlocked, progress, target };
    }

    return result;
  }

  // Compute lifetime counters once per evaluation (PVP/PVE games only).
  private async computeLifecycleCounts(
    userId: string,
    user: UserStreaks,
  ): Promise<LifecycleCounts> {
    const participations = await this.prisma.db.gameParticipant.findMany({
      where: { user_id: userId },
      include: { game: { select: { gameType: true, status: true } } },
    });

    // Only COMPLETED PVP/PVE participations count : ABANDONED games have no
    // definitive result, and hotseat is demo-and-forget (never reaches the DB).
    const pvpPve = participations.filter(
      (p) => p.game.status === 'COMPLETED' && RATED_GAME_TYPES.includes(p.game.gameType),
    );

    const wins = pvpPve.filter((p) => p.rank === 1).length;
    const botWins = pvpPve.filter((p) => p.rank === 1 && p.game.gameType === 'PVE').length;
    const humanWins = pvpPve.filter((p) => p.rank === 1 && p.game.gameType === 'PVP').length;

    return {
      wins,
      botWins,
      humanWins,
      totalGames: pvpPve.length,
      winStreak: user.winStreak ?? 0,
      pveGameStreak: user.pveGameStreak ?? 0,
    };
  }

  // Set an achievement flag. Returns true only on first unlock (fire-once).
  private async unlock(userId: string, field: AchKey): Promise<boolean> {
    try {
      const user = await this.prisma.db.user.findUnique({
        where: { id: userId },
        include: { achievement: true },
      });
      if (!user) return false;
      if (user.achievement?.[field]) return false; // already unlocked : no re-notify

      await this.prisma.db.achievement.update({
        where: { userId },
        data: { [field]: true },
      });
      this.logger.log(`Achievement unlocked for user ${userId}: ${field}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to unlock achievement ${field} for user ${userId}`, error);
      return false;
    }
  }
}
