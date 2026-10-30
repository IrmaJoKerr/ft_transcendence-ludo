import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { CodedThrottlerGuard } from './throttler.guard';
import { PrismaService } from './prisma.service';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { FriendsModule } from './friends/friends.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { AchievementsModule } from './achievements/achievements.module';
import { StatsModule } from './player-stats/stats.module';
import { MatchModule } from './match/match.module';
import { PresenceModule } from './presence/presence.module';
import { NotificationModule } from './notification/notification.module';
import { RealtimeModule } from './realtime/realtime.module';

// Root NestJS module. Registers every feature module (auth, user, friends,
// leaderboard, achievements, stats, match, presence, notification, realtime) plus
// the global rate-limit guard. NestJS bootstraps this from main.ts.
@Module({
  imports: [
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    AuthModule,
    UserModule,
    FriendsModule,
    LeaderboardModule,
    AchievementsModule,
    StatsModule,
    MatchModule,
    PresenceModule,
    NotificationModule,
    RealtimeModule,
  ],
  providers: [
    PrismaService,
    // APP_GUARD applies the guard to every route. It must be a provider so Nest's DI
    // can construct it: ThrottlerGuard needs its storage and options injected.
    // CodedThrottlerGuard emits a localizable { code, message } 429 body.
    { provide: APP_GUARD, useClass: CodedThrottlerGuard },
  ],
  exports: [PrismaService],
})
export class AppModule {}
