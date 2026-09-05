import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
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

@Module({
  imports: [
    // Serve the built SPA from backend/public so the SPA and /api share ONE
    // origin — the auth cookies are sameSite: lax, so a split-origin SPA would
    // silently break login. Local/ngrok runs behind nginx (which already serves
    // the SPA), and backend/public doesn't exist there, so express.static serves
    // nothing and the '*' fallback 404s — harmless. See deploy/backend.Dockerfile
    // for where public/ comes from in the deployed image.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/api/*'],
    }),
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
  ],
  providers: [
    PrismaService,
    // APP_GUARD applies the guard to every route. It has to be registered as a
    // provider rather than via app.useGlobalGuards() so Nest's DI container can
    // construct it — ThrottlerGuard needs its storage and options injected.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [PrismaService],
})
export class AppModule {}
