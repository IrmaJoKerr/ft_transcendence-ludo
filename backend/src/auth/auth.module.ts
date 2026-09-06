import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { GoogleStrategy } from './google.strategy';
import { GithubStrategy } from './github.strategy';
import { FortyTwoStrategy } from './fortytwo.strategy';
import { NgrokGoogleStrategy } from './ngrok_google_strategy';
import { NgrokGithubStrategy } from './ngrok_github_strategy';
import { NgrokFortyTwoStrategy } from './ngrok_fortytwo_strategy';
import { MailService } from './mail.service';
import { TwoFactorService } from './twofactor.service';
import { SessionService } from './session.service';
import { PrismaService } from '../prisma.service';
import { requireSecret, secret } from '../secrets';
import { NotificationModule } from '../notification/notification.module';

// Both the localhost and ngrok OAuth apps are registered at once, under
// distinct passport strategy names ('google'/'github'/'42' vs their
// '-tunnel' counterparts). oauth.guards.ts picks which one a given request
// uses based on the Host header it actually arrived on, so a local client and
// a tunnelled one can both complete login against the same running backend.

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: requireSecret('JWT_SECRET'),
      // Access tokens are now short-lived; the refresh token (SessionService)
      // keeps the user signed in for 7 days by minting new access tokens.
      signOptions: { expiresIn: '15m' },
    }),
    NotificationModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    MailService,
    TwoFactorService,
    SessionService,
    JwtStrategy,
    GoogleStrategy,
    GithubStrategy,
    FortyTwoStrategy,
    PrismaService,
    // The ngrok-tunnel OAuth strategies are only registered while a tunnel is
    // actually active (`make tunnel` sets TUNNEL_MODE=true). They call
    // requireSecret('NGROK_*') in their constructors and would otherwise throw
    // at boot on a TUNNEL_MODE-unset instance (e.g. the Render/`supabase-modded`
    // deploy, which deliberately has no ngrok vars). Registration is disabled
    // here because the per-request tunnel routing in oauth.guards.ts already
    // never selects the '-tunnel' strategies unless the Host header is ngrok.
    ...(secret('TUNNEL_MODE') === 'true'
      ? [NgrokGoogleStrategy, NgrokGithubStrategy, NgrokFortyTwoStrategy]
      : []),
  ],
  // Re-exported so feature modules (e.g. MatchModule) get the *configured*
  // JwtModule rather than registering a second, secret-less instance.
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
