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
  MatchRowLike,
} from './achievements.registry';

// An Achievement row exposes one boolean flag per AchKey.
type AchievementFlags = Partial<Record<AchKey, boolean>>;

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
      // The rows postgame has just written: one per seat, so each one is already
      // that user's participation. No parent row to load, no join.
      const rows = await this.prisma.db.matchHistory.findMany({ where: { game_id: gameId } });
      for (const row of rows) {
        await this.evaluateForUser(row.user_id, row, true);
      }
    } catch (err) {
      this.logger.warn(`evaluateAfterGame failed for game ${gameId}: ${(err as Error).message}`);
    }
  }

  // Full evaluation for a user: lifetime rules from LifecycleCounts, per-game
  // rules from the passed-in row (or a retroactive loop over retained matches).
  // announce=false = silent backfill (POST /check).
  async evaluateForUser(
    userId: string,
    row?: MatchRowLike | null,
    announce = true,
  ): Promise<{ unlocked: string[] }> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      include: { achievement: true },
    });
    if (!user) return { unlocked: [] };

    const unlocked: string[] = [];

    // LifecycleCounts : one row read per evaluation.
    const counts = await this.computeLifecycleCounts(userId);

    // Evaluate lifetime rules (registry-driven), then per-game rules.
    for (const rule of ACHIEVEMENT_RULES) {
      if (rule.type === 'lifetime') {
        await this.evaluateRule(userId, user.achievement, rule, counts, null, announce, unlocked);
      }
    }

    // Per-game rules: evaluate the row just written, or (silent backfill) run a
    // retroactive loop over the retained matches so history can unlock them too.
    // What the trim costs: only the newest 50 rows are here, so a backfill on an old
    // account cannot see further back. Per-game flags are evaluated at match end
    // anyway, so the loss is confined to `POST /check` on a long-standing account.
    const perGameRules = ACHIEVEMENT_RULES.filter((r) => r.type === 'per-game');
    if (row) {
      for (const rule of perGameRules) {
        await this.evaluateRule(userId, user.achievement, rule, counts, row, announce, unlocked);
      }
    } else {
      const rows = await this.prisma.db.matchHistory.findMany({
        where: { user_id: userId },
        orderBy: { playedAt: 'desc' },
      });
      for (const matchRow of rows) {
        for (const rule of perGameRules) {
          // Skip rules already unlocked during this evaluation pass.
          if (unlocked.includes(rule.key)) continue;
          await this.evaluateRule(
            userId,
            user.achievement,
            rule,
            counts,
            matchRow,
            announce,
            unlocked,
          );
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
    row: MatchRowLike | null,
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
    } else if (rule.type === 'per-game' && rule.perGameSource && row) {
      progress = rule.perGameSource(row);
      target = rule.perGameTarget ?? 0;
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

    const counts = await this.computeLifecycleCounts(effectiveUserId);
    // The newest retained match is what the per-game progress bars report, and it is
    // also the row the "closest to unlocking" numbers come from. Absent (no match
    // yet) reads as 0 progress, never as an error.
    const latestMatch = await this.prisma.db.matchHistory.findFirst({
      where: { user_id: effectiveUserId },
      orderBy: { playedAt: 'desc' },
    });

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
        // Per-game progress = the newest match's own value (0 when there is none).
        if (latestMatch) {
          progress = rule.perGameSource(latestMatch);
        }
        target = rule.perGameTarget ?? 0;
      }

      result[key] = { unlocked, progress, target };
    }

    return result;
  }

  // The lifetime counters, read from the one row that holds them. Nothing is derived
  // from history: history is a trimmed window, PlayerStats is the record, so the
  // numbers can no longer disagree with each other after a bad write.
  private async computeLifecycleCounts(userId: string): Promise<LifecycleCounts> {
    const stats = await this.prisma.db.playerStats.findUnique({ where: { user_id: userId } });
    return {
      wins: stats?.wins ?? 0,
      botWins: stats?.botWins ?? 0,
      humanWins: stats?.humanWins ?? 0,
      totalGames: stats?.gamesPlayed ?? 0,
      winStreak: stats?.winStreak ?? 0,
      pveGameStreak: stats?.pveGameStreak ?? 0,
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
