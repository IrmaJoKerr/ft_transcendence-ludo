import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-google-oauth20';
import { AuthService } from './auth.service';
import { requireSecret } from '../secrets';

@Injectable()
// Same as GoogleStrategy but for the ngrok-tunnel OAuth app. Used by the
// '-tunnel' guard in oauth.guards.ts when the request arrives via ngrok.
export class NgrokGoogleStrategy extends PassportStrategy(Strategy, 'google-tunnel') {
  constructor(private readonly authService: AuthService) {
    super({
      clientID: requireSecret('NGROK_GOOGLE_CLIENT_ID'),
      clientSecret: requireSecret('NGROK_GOOGLE_CLIENT_SECRET'),
      callbackURL: requireSecret('NGROK_GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
      passReqToCallback: true,
    });
  }

  // Will run after google redirects back and the code is exchanged for a profile.
  // `req` carries the OAuth `state` : a signed oauth-link token when a logged-in
  // user is ADDING this provider as a sign-in method → linkUserId.
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