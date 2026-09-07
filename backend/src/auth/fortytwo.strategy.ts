import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import Strategy from 'passport-42';
import { Profile } from 'passport';
import { AuthService } from './auth.service';
import { requireSecret } from '../secrets';

@Injectable()
// Passport strategy for 42 (intra) OAuth login on localhost. Used by
// FortyTwoAuthGuard on the /api/auth/42 routes.
export class FortyTwoStrategy extends PassportStrategy(Strategy as any, '42') {
  constructor(private readonly authService: AuthService) {
    super({
      clientID: requireSecret('FORTYTWO_CLIENT_ID'),
      clientSecret: requireSecret('FORTYTWO_CLIENT_SECRET'),
      callbackURL: requireSecret('FORTYTWO_CALLBACK_URL'),
      passReqToCallback: true,
    });
  }

  // Runs after 42 redirects back: log the user in (or link the provider
  // account) via validateOAuthLogin.
  async validate(req: any, _accessToken: string, _refreshToken: string, profile: Profile) {
    const email = profile.emails?.[0]?.value;
    return this.authService.validateOAuthLogin(
      {
        provider: '42',
        providerAccountId: profile.id,
        email,
        usernameSeed: profile.username ?? `ft_${profile.id}`, // 42 intra login
      },
      this.authService.resolveOAuthLink(req?.query?.state, '42'),
    );
  }
}