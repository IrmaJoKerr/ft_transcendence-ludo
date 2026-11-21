import { Module } from '@nestjs/common';
import { MatchController } from './match.controller';
import { MatchService } from './match.service';
import { MatchCreatorService } from './match.creator.service';
import { MatchPlayerService } from './match.player.service';
import { MatchQueryService } from './match.query.service';
import { MatchAbandonService } from './match.abandon.service';
import { MatchPostgameService } from './match.postgame.service';
import { GuestLimitService } from './guest-limit.service';
import { PrismaService } from '../prisma.service';
import { REDIS_CLIENT, RedisClientLifecycle, createRedisClient } from '../common/redis-client';
import { AuthModule } from '../auth/auth.module';
import { AchievementsModule } from '../achievements/achievements.module';
import { LeaderboardModule } from '../leaderboard/leaderboard.module';
import { NotificationModule } from '../notification/notification.module';
import { FriendshipEventsModule } from '../friends/friendship-events.module';

@Module({
  imports: [
    AuthModule,
    AchievementsModule,
    LeaderboardModule,
    NotificationModule,
    FriendshipEventsModule,
  ],
  controllers: [MatchController],
  providers: [
    MatchService,
    MatchCreatorService,
    MatchPlayerService,
    MatchQueryService,
    MatchPostgameService,
    MatchAbandonService,
    { provide: REDIS_CLIENT, useFactory: () => createRedisClient('Match Redis') },
    RedisClientLifecycle,
    GuestLimitService,
    PrismaService,
  ],
  exports: [MatchService, MatchQueryService],
})
export class MatchModule {}
