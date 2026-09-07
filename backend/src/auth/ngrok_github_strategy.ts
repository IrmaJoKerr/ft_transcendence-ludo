import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, Profile } from 'passport-github2';
import { AuthService } from './auth.service';
import { requireSecret } from '../secrets';

@Injectable()
// Same as GithubStrategy but for the ngrok-tunnel OAuth app. Used by the
// '-tunnel' guard in oauth.guards.ts when the request arrives via ngrok.
export class NgrokGithubStrategy extends PassportStrategy(Strategy, 'github-tunnel') {
  constructor(private readonly authService: AuthService) {
    super({
      clientID: requireSecret('NGROK_GITHUB_CLIENT_ID'),
      clientSecret: requireSecret('NGROK_GITHUB_CLIENT_SECRET'),
      callbackURL: requireSecret('NGROK_GITHUB_CALLBACK_URL'),
      scope: ['user:email'],
      // Default mode returns only the primary email and DROPS the verified
      // flag; raw mode keeps { value, verified, primary } for every address.
      allRawEmails: true,
      passReqToCallback: true,
    });
  }

  // Runs after GitHub redirects back: pick a verified email, then log the
  // user in (or link the provider account) via validateOAuthLogin.
  async validate(req: any, _accessToken: string, _refreshToken: string, profile: Profile) {
    const emails = (profile.emails ?? []) as Array<{
      value: string;
      verified?: boolean;
      primary?: boolean;
    }>;
    const email = (emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified))
      ?.value;
    return this.authService.validateOAuthLogin(
      {
        provider: 'github',
        providerAccountId: profile.id,
        email,
        usernameSeed: profile.username ?? `github_${profile.id}`,
      },
      this.authService.resolveOAuthLink(req?.query?.state, 'github'),
    );
  }
}