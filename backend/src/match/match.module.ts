import { Module } from '@nestjs/common';
import { MatchController } from './match.controller';
import { MatchService } from './match.service';
import { MatchCreatorService } from './match.creator.service';
import { MatchPlayerService } from './match.player.service';
import { MatchQueryService } from './match.query.service';
import { MatchPostgameService } from './match.postgame.service';
import { GuestLimitService } from './guest-limit.service';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AchievementsModule } from '../achievements/achievements.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [AuthModule, AchievementsModule, LeaderboardModule, NotificationModule],
  controllers: [MatchController],
  providers: [
    MatchService,
    MatchCreatorService,
    MatchPlayerService,
    MatchQueryService,
    MatchPostgameService,
    GuestLimitService,
    PrismaService,
  ],
  exports: [MatchService, MatchQueryService],
})
export class MatchModule {}
