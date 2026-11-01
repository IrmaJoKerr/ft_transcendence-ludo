import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AUTH_THROTTLE } from '../common/throttles';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { LoginDto } from './dto/login.dto';
import { TwoFactorDto } from './dto/twofactor.dto';
import { TwoFactorSettingDto } from './dto/two-factor-setting.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleAuthGuard, GithubAuthGuard, FortyTwoAuthGuard } from './oauth.guards';
import { requireSecret, isTunnelRequest } from '../secrets';
import { CSRF_COOKIE, issueCsrfCookie, isValidCsrfToken } from '../common/csrf';
import { ACCESS_COOKIE } from './auth.constants';

const ACCESS_MAX_AGE_MS = 15 * 60 * 1000; // 15 min
// Refresh-token cookie, only the auth routes need it, so it's scoped to
// /api/auth rather than sent on every API call. Long-lived.
const REFRESH_COOKIE = 'refresh_token';
const REFRESH_PATH = '/api/auth';
const REFRESH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days, matches SessionService TTL

const LOCAL_FRONTEND_URL = requireSecret('FRONTEND_URL');
const NGROK_FRONTEND_URL = requireSecret('NGROK_FRONTEND_URL');
// This machine's LAN address (optional; `make lan` writes it) + the published TLS port.
const LAN_IP = process.env.LAN_IP?.trim();
const HTTPS_PORT = process.env.HTTPS_PORT ?? '8443';

// Public frontend URL for this request: tunnel, LAN, or localhost.
// See docs/backend/backend-auth-module.md (Frontend URL resolution).
function frontendUrlFor(req: Request): string {
  const host = req.get('host') ?? '';
  if (isTunnelRequest(host)) return NGROK_FRONTEND_URL;
  if (LAN_IP && host.split(':')[0] === LAN_IP) return `https://${LAN_IP}:${HTTPS_PORT}`;
  return LOCAL_FRONTEND_URL;
}

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // GET /csrf: the explicit bootstrap of the double-submit token. The middleware
  // sets the cookie on any response; this returns the same token so the client can
  // fill X-CSRF-Token before its first mutating request.
  @Get('csrf')
  @HttpCode(200)
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const existing = (req.cookies as Record<string, unknown> | undefined)?.[CSRF_COOKIE];
    const token = isValidCsrfToken(existing) ? existing : issueCsrfCookie(res);
    return { token };
  }

  @Throttle(AUTH_THROTTLE.register)
  // POST /register
  @Post('register')
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, frontendUrlFor(req));
  }

  // POST /verify-email: redeems a signup or email-change link. The token arrives
  // in the body, never the query string, so it cannot reach any log. The SPA maps
  // `result` to a landing route: see docs/backend/backend-auth-module.md.
  @Post('verify-email')
  @HttpCode(200)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return { result: await this.authService.verifyEmail(dto.token) };
  }

  // POST /resend-verification: public; resends a signup link. Generic response.
  @Throttle(AUTH_THROTTLE.resendVerification)
  @Post('resend-verification')
  @HttpCode(200)
  async resendVerification(@Body() dto: ResendVerificationDto, @Req() req: Request) {
    return this.authService.resendSignupVerification(dto.email, frontendUrlFor(req));
  }

  // POST /login
  @Throttle(AUTH_THROTTLE.login)
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto);
    // 200 with a code, so the browser logs no error for this normal state.
    if ('emailNotVerified' in result) {
      return { code: 'AUTH_EMAIL_NOT_VERIFIED' };
    }
    if (result.twoFactorRequired) {
      return { twoFactorRequired: true, pendingToken: result.pendingToken };
    }
    // The union narrows to the session variant here, the only one left.
    this.setSessionCookies(res, result.accessToken, result.refreshToken);
    return { twoFactorRequired: false, user: result.user };
  }

  // POST /2fa/verify
  @Throttle(AUTH_THROTTLE.twoFactorVerify)
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

  // POST /2fa/resend: re-issue the login code for a live challenge.
  @Throttle(AUTH_THROTTLE.twoFactorResend)
  @Post('2fa/resend')
  @HttpCode(200)
  async resendTwoFactor(@Body('pendingToken') pendingToken?: string) {
    return this.authService.resendTwoFactor(pendingToken ?? '');
  }

  // POST /refresh - swaps a refresh token for new access token
  // Reads the refresh cookie and sets both cookies again
  @Throttle(AUTH_THROTTLE.refresh)
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken, user } = await this.authService.refresh(
      req.cookies[REFRESH_COOKIE],
    );
    this.setSessionCookies(res, accessToken, refreshToken);
    return { user };
  }

  // POST /forgot-password
  @Throttle(AUTH_THROTTLE.forgotPassword)
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    return this.authService.forgotPassword(dto.email, frontendUrlFor(req));
  }

  // POST /reset-password
  @Throttle(AUTH_THROTTLE.resetPassword)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  // POST /logout
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    // Revoke the refresh token server-side so it can't be reused then drop
    // both cookies. clearCookie must repeat the path the cookie was set with.
    await this.authService.logout(req.cookies[REFRESH_COOKIE]);
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
    return { ok: true };
  }

  // useguards(JWT) are for routes that need to be logged in
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@Req() req: Request) {
    // The JWT only carries the immutable username. displayName is editable, so
    // fetch the live value from the DB each time (one indexed row read).
    const profile = await this.authService.getProfile((req.user as { id: string }).id);
    return { user: profile.user };
  }

  // Get full profile (used by the Edit-Profile card)
  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Req() req: Request) {
    return this.authService.getProfile((req.user as { id: string }).id);
  }

  // Complete profile update (username / email / 2FA method)
  @UseGuards(JwtAuthGuard)
  @Throttle(AUTH_THROTTLE.updateProfile)
  @Patch('profile')
  async updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const result = await this.authService.updateProfile(
      (req.user as { id: string }).id,
      dto,
      frontendUrlFor(req),
    );
    return {
      user: result.user,
      emailChangePending: result.emailChangePending,
      pendingEmail: result.pendingEmail,
      oauthRedirectUrl: result.oauthRedirectUrl,
    };
  }

  // POST /profile/resend-email-change: authenticated; resends the pending change link.
  @UseGuards(JwtAuthGuard)
  @Throttle(AUTH_THROTTLE.resendEmailChange)
  @Post('profile/resend-email-change')
  @HttpCode(200)
  async resendEmailChange(@Req() req: Request) {
    return this.authService.resendEmailChange((req.user as { id: string }).id, frontendUrlFor(req));
  }

  // Change password while logged in
  @UseGuards(JwtAuthGuard)
  @Throttle(AUTH_THROTTLE.changePassword)
  @Patch('profile/password')
  async changePassword(@Req() req: Request, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      (req.user as { id: string }).id,
      dto.currentPassword,
      dto.newPassword,
      req.cookies[REFRESH_COOKIE],
    );
  }

  // Permanently delete the account (password-verified)
  @UseGuards(JwtAuthGuard)
  @Throttle(AUTH_THROTTLE.deleteAccount)
  @Delete('profile')
  @HttpCode(200)
  async deleteAccount(
    @Req() req: Request,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.deleteAccount((req.user as { id: string }).id, dto);
    // Drop both session cookies so the (now-deleted) browser ends logged out.
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
    return result;
  }

  // 2FA preference (logged-in user toggles their own). The read has no route:
  // `GET /api/auth/me` and `GET /api/auth/profile` already return `twoFactorEnabled`.
  @UseGuards(JwtAuthGuard)
  @Throttle(AUTH_THROTTLE.setTwoFactor)
  @Patch('2fa')
  setTwoFactor(@Req() req: Request, @Body() dto: TwoFactorSettingDto) {
    return this.authService.setTwoFactorSetting(
      (req.user as { id: string }).id,
      dto.enabled,
      dto.currentPassword,
    );
  }

  // **Google OAuth**
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  googleCallback(@Req() req: Request, @Res() res: Response) {
    return this.finishOAuth(req, res);
  }

  // **GitHub OAuth**
  @Get('github')
  @UseGuards(GithubAuthGuard)
  githubAuth() {}

  @Get('github/callback')
  @UseGuards(GithubAuthGuard)
  githubCallback(@Req() req: Request, @Res() res: Response) {
    return this.finishOAuth(req, res);
  }

  // **42 OAuth**
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
    const user = req.user as
      | {
          id: string;
          username: string;
          email: string | null;
          twoFactorEnabled: boolean;
          language: string;
        }
      | undefined;
    const frontendUrl = frontendUrlFor(req);

    if (!user) {
      res.redirect(`${frontendUrl}/login?error=access_denied`);
      return;
    }

    // "Add a sign-in method" flow: the strategy already linked the provider
    // via the oauth-link `state`. Send the user back to /profile : no new
    // session, nothing logged in or out.
    const linkUserId = this.authService.resolveOAuthLinkForRequest(
      req,
      this.providerForRoute(req.path),
    );
    if (linkUserId && user.id === linkUserId) {
      res.redirect(`${frontendUrl}/profile`);
      return;
    }

    // No-email OAuth (GitHub/42): 2FA needs a code destination, so block only
    // that case : users can add an email later via Edit Profile.
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
    // Reaching here means 2FA is on and the earlier `!user.email` guard passed,
    // so the code destination exists. TS can't infer that across the branches,
    // so guard once more before using it.
    if (!user.email) {
      res.redirect(`${frontendUrl}/login?error=add-email-2fa`);
      return;
    }
    const { pendingToken } = await this.authService.startTwoFactor(
      user.id,
      user.email,
      user.username,
      user.language,
    );
    res.redirect(`${frontendUrl}/2fa?token=${pendingToken}`);
  }

  private providerForRoute(path: string): string {
    if (path.includes('/github/')) return 'github';
    if (path.includes('/google/')) return 'google';
    return '42';
  }

  // Write the access-token (15 min, path /) and refresh-token (7 days,
  // path /api/auth) httpOnly cookies after a successful login.
  private setSessionCookies(res: Response, accessToken: string, refreshToken: string) {
    const base = {
      httpOnly: true as const, // Javascript on page cannot read
      sameSite: 'lax' as const, // other website can't quietly make authenticated requests as us
      secure: process.env.NODE_ENV === 'production', // HTTPS only
    };
    // Access token: path '/' so it rides along on every /api call for verification.
    res.cookie(ACCESS_COOKIE, accessToken, { ...base, path: '/', maxAge: ACCESS_MAX_AGE_MS });
    // Refresh token: path /api/auth so it's only sent to refresh + logout.
    res.cookie(REFRESH_COOKIE, refreshToken, {
      ...base,
      path: REFRESH_PATH,
      maxAge: REFRESH_MAX_AGE_MS,
    });
  }
}
