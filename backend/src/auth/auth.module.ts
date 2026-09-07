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
import { requireSecret } from '../secrets';
import { NotificationModule } from '../notification/notification.module';

// Both the localhost and ngrok OAuth apps are registered at once under
// distinct passport strategy names. oauth.guards.ts picks per request via
// the Host header, so local and tunnelled clients can log in concurrently.

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
    NgrokGoogleStrategy,
    NgrokGithubStrategy,
    NgrokFortyTwoStrategy,
    PrismaService,
  ],
  // Re-exported so feature modules (e.g. MatchModule) get the *configured*
  // JwtModule rather than registering a second, secret-less instance.
  exports: [AuthService, JwtModule, PassportModule],
})
export class AuthModule {}
