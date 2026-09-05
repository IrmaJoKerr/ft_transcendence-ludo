import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { JwtPayload } from './jwt-payload';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { TwoFactorDto } from './dto/twofactor.dto';
import { TwoFactorSettingDto } from './dto/two-factor-setting.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleAuthGuard, GithubAuthGuard, FortyTwoAuthGuard } from './oauth.guards';
import { secret, isTunnelRequest } from '../secrets';

// Access-token cookie: JwtStrategy reads this exact name. Short-lived.
const ACCESS_COOKIE = 'token';
const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // 15 min, matches JwtModule expiresIn
// Refresh-token cookie: only the auth routes need it, so it's scoped to
// /api/auth rather than sent on every API call. Long-lived.
const REFRESH_COOKIE = 'refresh_token';
const REFRESH_PATH = '/api/auth';
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches SessionService TTL
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

const LOCAL_FRONTEND_URL = secret('FRONTEND_URL') ?? 'https://localhost:8443';
const NGROK_FRONTEND_URL = secret('NGROK_FRONTEND_URL') ?? 'https://polka-bless-wing.ngrok-free.dev';

// Picked per request from the Host header the browser actually connected
// with — a tunnel and a local client can both be live against the same
// backend at once (see oauth.guards.ts, which picks the matching OAuth
// strategy the same way).
function frontendUrlFor(req: Request): string {
  return isTunnelRequest(req.get('host')) ? NGROK_FRONTEND_URL : LOCAL_FRONTEND_URL;
}

function originFromRequest(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim()
    || req.protocol || 'https';
  return `${proto}://${req.get('host') || 'localhost:8443'}`;
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
  ) {}

  // No cookie here anymore: the account must be email-verified before its
  // first login, and every login must pass the 2FA code step.
  // Tight: each call sends a real email (via Mailgun when configured), so an open register
  // route is both an account-spam vector and a way to use us as a mail bomb.
  @Throttle({ default: { limit: 3, ttl: HOUR_MS } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, originFromRequest(req));
  }

  // Target of the emailed verification link — lands in a browser tab, so it
  // answers with a redirect to the SPA rather than JSON.
  @Get('verify-email')
  async verifyEmail(@Query('token') token: string, @Req() req: Request, @Res() res: Response) {
    const ok = await this.authService.verifyEmail(token ?? '');
    res.redirect(
      `${originFromRequest(req)}/login?${ok ? 'verified=1' : 'error=invalid-verification-link'}`,
    );
  }

  // Factor one. With 2FA on, answers { twoFactorRequired: true, pendingToken }
  // and no session. With 2FA off, the password is enough: sets the session
  // cookies and answers { twoFactorRequired: false, user }.
  // The password brute-force surface. 5/min still allows a fat-fingered human.
  @Throttle({ default: { limit: 5, ttl: MINUTE_MS } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    if (result.twoFactorRequired) {
      return { twoFactorRequired: true, pendingToken: result.pendingToken };
    }
    // strictNullChecks is off in this project, so the implicit-else branch of a
    // discriminated union doesn't auto-narrow — pin it to the session variant.
    const session = result as {
      accessToken: string;
      refreshToken: string;
      user: { id: string; username: string };
    };
    this.setSessionCookies(res, session.accessToken, session.refreshToken);
    return { twoFactorRequired: false, user: session.user };
  }

  // Factor two: emailed code + pendingToken buy the actual session cookies.
  // twofactor.service.ts caps guesses at 5 *per challenge*, which an attacker
  // sidesteps by starting a new challenge each time. This caps the rate at
  // which they can do that — a 6-digit code needs far more than 5 tries/min.
  @Throttle({ default: { limit: 5, ttl: MINUTE_MS } })
  @Post('2fa/verify')
  @HttpCode(200)
  async verifyTwoFactor(@Body() dto: TwoFactorDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, user } = await this.authService.completeTwoFactor(
      dto.pendingToken,
      dto.code,
    );
    this.setSessionCookies(res, accessToken, refreshToken);
    return { user };
  }

  // Silent re-auth: the browser sends only the refresh cookie and gets a fresh
  // access token (plus a rotated refresh token). No password or 2FA involved.
  // Looser on purpose: apiFetch calls this automatically on any 401, so a user
  // with several tabs open can legitimately burst. Still bounded.
  @Throttle({ default: { limit: 30, ttl: MINUTE_MS } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, user } = await this.authService.refresh(
      req.cookies?.[REFRESH_COOKIE],
    );
    this.setSessionCookies(res, accessToken, refreshToken);
    return { user };
  }

  // Password reset, step one: always answers with the same generic message,
  // whether or not the email is registered (no account enumeration).
  // Also sends a real email, and here the victim is whoever owns the address —
  // without a cap this is a free inbox-flooding tool aimed at someone else.
  @Throttle({ default: { limit: 3, ttl: HOUR_MS } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto.email, originFromRequest(req));
  }

  // Password reset, step two: the emailed token + a new password.
  // The reset token is a 32-byte random value, so guessing it is hopeless
  // anyway — this just removes the option of trying at speed.
  @Throttle({ default: { limit: 5, ttl: 15 * MINUTE_MS } })
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Revoke the refresh token server-side so it can't be reused, then drop
    // both cookies. clearCookie must repeat the path the cookie was set with.
    await this.authService.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
    res.clearCookie('lr_session', { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @Throttle({ default: { limit: 60, ttl: MINUTE_MS } }) // matches nginx's `auth` zone (nginx.conf:38)
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // `/me` is the mount-time "who am I?" probe and must never answer 401: the
    // browser logs a 4xx as a console error regardless of how the SPA handles
    // it, and eval criteria require a clean console. It self-heals instead:
    //   - access token valid     → { user }            (200)
    //   - token stale, refresh   → rotate + fresh cookies + { user } (200)
    //   - genuinely no session   → clear cookies + { user: null }   (200)
    // A 5xx is thrown straight through so a transient backend/Redis blip isn't
    // mistaken for "signed out" — mirroring how apiFetch distinguishes blocked
    // vs expired.

    // 1) Access token valid → return the live profile.
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(
        req.cookies?.[ACCESS_COOKIE] ?? '',
      );
      const profile = await this.authService.getProfile(payload.sub);
      return { user: profile.user };
    } catch {
      // Token missing/expired/invalid (or the account is gone) — fall through
      // to the silent re-auth path below.
    }

    // 2) No refresh cookie at all → genuinely signed out. Fast fail, no Redis
    //    round trip.
    if (!req.cookies?.[REFRESH_COOKIE]) {
      res.clearCookie(ACCESS_COOKIE, { path: '/' });
      return { user: null };
    }

    // 3) Refresh cookie present → rotate it (self-heal) and mint fresh cookies.
    //    This is the same silent re-auth POST /api/auth/refresh performs.
    try {
      const session = await this.authService.refresh(req.cookies?.[REFRESH_COOKIE]);
      this.setSessionCookies(res, session.accessToken, session.refreshToken);
      return { user: session.user };
    } catch (e) {
      if (e instanceof UnauthorizedException) {
        // Refresh token itself is revoked/expired → the session is really over.
        res.clearCookie(ACCESS_COOKIE, { path: '/' });
        res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
        return { user: null };
      }
      throw e; // transient backend failure — surface it, don't call it a logout.
    }
  }


  // ---- Get full profile (used by the Edit-Profile card) ----
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Req() req: Request) {
    return this.authService.getProfile((req.user as { id: string }).id);
  }

  // ---- Complete profile update (username / email / 2FA method) ----
  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  async updateProfile(
    @Req() req: Request,
    @Body() dto: UpdateProfileDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.updateProfile((req.user as { id: string }).id, dto);
    return {
      user: result.user,
      emailVerificationSent: result.emailVerificationSent,
      oauthRedirectUrl: result.oauthRedirectUrl,
    };
  }

  // ---- Change password while logged in ----
  @UseGuards(JwtAuthGuard)
  @Patch('profile/password')
  async changePassword(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      (req.user as { id: string }).id,
      dto.currentPassword,
      dto.newPassword,
      req.cookies?.[REFRESH_COOKIE],
    );
  }

  // ---- Permanently delete the account (password-verified) ----
  @UseGuards(JwtAuthGuard)
  @Delete('profile')
  @HttpCode(200)
  async deleteAccount(@Req() req: Request, @Body() dto: DeleteAccountDto, @Res({ passthrough: true }) res: Response) {
    await this.authService.deleteAccount((req.user as { id: string }).id, dto);
    // Drop both session cookies so the (now-deleted) browser ends logged out.
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
    return { message: 'Account permanently deleted' };
  }

  // ---- 2FA preference (logged-in user toggles their own) ----
  @UseGuards(JwtAuthGuard)
  @Get('2fa')
  getTwoFactor(@Req() req: Request) {
    return this.authService.getTwoFactorSetting((req.user as { id: string }).id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('2fa')
  setTwoFactor(@Req() req: Request, @Body() dto: TwoFactorSettingDto) {
    return this.authService.setTwoFactorSetting((req.user as { id: string }).id, dto.enabled);
  }

  // ---- Google OAuth ----
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  googleCallback(@Req() req: Request, @Res() res: Response) {
    return this.finishOAuth(req, res);
  }

  // ---- GitHub OAuth ----
  @Get('github')
  @UseGuards(GithubAuthGuard)
  githubAuth() {}

  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  githubCallback(@Req() req: Request, @Res() res: Response) {
    return this.finishOAuth(req, res);
  }

  // ---- 42 OAuth ----
  @Get('42')
  @UseGuards(FortyTwoAuthGuard)
  fortyTwoAuth() {}

  @Get('42/callback')
  @UseGuards(FortyTwoAuthGuard)
  fortyTwoCallback(@Req() req: Request, @Res() res: Response) {
    return this.finishOAuth(req, res);
  }

  // OAuth passes factor one (the provider vouched for them). If the user keeps
  // 2FA on, we still email a code and hand off to the SPA's /2fa page; if they
  // turned it off, we set the session here and go straight to the app.
  private async finishOAuth(req: Request, res: Response) {
    const user = req.user as {
      id: string;
      username: string;
      email: string | null;
      twoFactorEnabled: boolean;
    } | undefined;
    const frontendUrl = frontendUrlFor(req);

    if (!user) {
      res.redirect(`${frontendUrl}/login?error=access_denied`);
      return;
    }

    // "Add a sign-in method" flow: the OAuth `state` carried a signed oauth-link
    // token (signed by the guard from the user's access-token cookie). The
    // strategy already linked the provider to that user — just send them back to
    // /profile. No new session is issued, no login/2FA redirect happens, so the
    // user is neither signed out nor logged into a different account.
    const anyReq = req as any;
    const state = typeof anyReq.query?.state === 'string' ? anyReq.query.state : undefined;
    const linkUserId = state
      ? this.authService.resolveOAuthLink(state, this.providerForRoute(req.path))
      : undefined;
    // A link round-trip only counts when the BROWSER that opened the provider
    // login is still authenticated and matches the linked user. On a fresh
    // login (no valid token cookie) — even if GitHub echoes a stale state —
    // fall through to the normal login session flow below. The final
    // `user.id === linkUserId` guard also catches a stale session whose user
    // was wiped by a DB reset: validateOAuthLogin then creates a brand-new
    // user (different id), so this is NOT a link round-trip and the fresh
    // account must get a real session instead of a dead redirect to /profile.
    const sessionUser = this.authService.verifyAccessToken(
      typeof req.cookies?.['token'] === 'string' ? req.cookies['token'] : undefined,
    );
    if (linkUserId && sessionUser && sessionUser === linkUserId && user.id === linkUserId) {
      res.redirect(`${frontendUrl}/profile`);
      return;
    }

    // No-email OAuth (GitHub/42 without a verified address): the account is
    // still created with an empty email. Without a 2FA code destination the
    // user can't get past factor two, so block only that edge case and let
    // everyone else through. They can add an email later via Edit Profile.
    if (user.twoFactorEnabled && !user.email) {
      res.redirect(`${frontendUrl}/login?error=add-email-2fa`);
      return;
    }
    if (!user.twoFactorEnabled) {
      const { accessToken, refreshToken } = await this.authService.issueSession(
        user.id,
        user.username,
      );
      this.setSessionCookies(res, accessToken, refreshToken);
      res.redirect(`${frontendUrl}/home`);
      return;
    }
    const { pendingToken } = await this.authService.startTwoFactor(user.id, user.email!);
    res.redirect(`${frontendUrl}/2fa?token=${pendingToken}`);
  }

  private providerForRoute(path: string): string {
    if (path.includes('/github/')) return 'github';
    if (path.includes('/google/')) return 'google';
    return '42';
  }

  private setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
    const base = {
      httpOnly: true as const,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
    };
    // Access token: path '/' so it rides along on every /api call for verification.
    res.cookie(ACCESS_COOKIE, accessToken, { ...base, path: '/', maxAge: ACCESS_MAX_AGE_MS });
    // Refresh token: path /api/auth so it's only sent to refresh + logout.
    res.cookie(REFRESH_COOKIE, refreshToken, { ...base, path: REFRESH_PATH, maxAge: REFRESH_MAX_AGE_MS });
    // (The lr_session presence-marker cookie was removed: the frontend now
    // restores via /me on every load, and /me's inline session check answers
    // 401 + X-Auth-Session: none when signed out — so a JS-readable marker
    // would only be a second source of truth about the session, for nothing.)
  }
}
