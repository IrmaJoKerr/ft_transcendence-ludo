import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { AuthService } from './auth.service';
import { requireSecret } from '../secrets';

@Injectable()
// Passport strategy for Google OAuth login on localhost. Used by
// GoogleAuthGuard on the /api/auth/google routes.
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly authService: AuthService) {
    super({
      clientID: requireSecret('GOOGLE_CLIENT_ID'),
      clientSecret: requireSecret('GOOGLE_CLIENT_SECRET'),
      callbackURL: requireSecret('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
      passReqToCallback: true,
    });
  }

  // Will run after google redirects back and the code is exchanged for a profile.
  // `req` carries the OAuth `state` : when a logged-in user started an "add
  // method" flow, the state holds a signed oauth-link token → linkUserId.
  async validate(req: any, _accessToken: string, _refreshToken: string, profile: Profile) {
    const email = profile.emails?.find((e) => String((e as { verified?: unknown }).verified) === 'true')
      ?.value;
    return this.authService.validateOAuthLogin(
      {
        provider: 'google',
        providerAccountId: profile.id,
        email,
        usernameSeed: email?.split('@')[0] ?? `google_${profile.id}`,
      },
      this.authService.resolveOAuthLink(req?.query?.state, 'google'),
    );
  }
}