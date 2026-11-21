import { Injectable } from '@nestjs/common';
import { AuthAccessService } from './auth.access.service';
import { AuthOAuthService, type OAuthCallbackRequest } from './auth.oauth.service';
import { AuthProfileService } from './auth.profile.service';
import { AuthRegistrationService, type LoginResult } from './auth.registration.service';
import { BASE_URL } from './auth.shared';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

// Re-exported for oauth.strategies/oauth.guards, which import it from here.
export type { OAuthCallbackRequest } from './auth.oauth.service';

// All account logic: register/login with email verification + 2FA, session
// tokens, OAuth linking, profile/password changes, account deletion. Called
// by auth.controller.ts, oauth.guards.ts and the OAuth strategies. The work lives
// in four focused services; this one keeps the name those callers already inject.
@Injectable()
export class AuthService {
  constructor(
    private readonly registration: AuthRegistrationService,
    private readonly access: AuthAccessService,
    private readonly profile: AuthProfileService,
    private readonly oauth: AuthOAuthService,
  ) {}

  // Create a local (password) account and email its verification link.
  async register(dto: RegisterDto, baseUrl: string = BASE_URL) {
    return this.registration.register(dto, baseUrl);
  }

  // Redeem an emailed verification link and report which kind it was.
  async verifyEmail(token: string) {
    return this.registration.verifyEmail(token);
  }

  // Factor one of password login: identifier + password, then 2FA or a session.
  async login(dto: LoginDto): Promise<LoginResult> {
    return this.registration.login(dto);
  }

  // Start a password reset by emailing a single-use link.
  async forgotPassword(rawEmail: string, baseUrl: string = BASE_URL) {
    return this.registration.forgotPassword(rawEmail, baseUrl);
  }

  // Redeem a password-reset link and revoke every existing session.
  async resetPassword(token: string, newPassword: string) {
    return this.registration.resetPassword(token, newPassword);
  }

  // Re-email the signup verification link.
  async resendSignupVerification(rawEmail: string, baseUrl: string) {
    return this.registration.resendSignupVerification(rawEmail, baseUrl);
  }

  // Re-email a pending email-change link (rotating its token).
  async resendEmailChange(userId: string, baseUrl: string = BASE_URL) {
    return this.registration.resendEmailChange(userId, baseUrl);
  }

  // Factor two: email a one-time code and hand back the challenge reference.
  async startTwoFactor(userId: string, email: string, username?: string, lang = 'en') {
    return this.registration.startTwoFactor(userId, email, username, lang);
  }

  // Re-issue the 2FA login code for a live challenge.
  async resendTwoFactor(pendingToken: string) {
    return this.registration.resendTwoFactor(pendingToken);
  }

  // Factor two of 2FA login: check the code and issue the full session.
  async completeTwoFactor(pendingToken: string, code: string) {
    return this.registration.completeTwoFactor(pendingToken, code);
  }

  // Sign a short-lived access-token JWT.
  signAccess(userId: string, username: string): string {
    return this.access.signAccess(userId, username);
  }

  // Issue a fresh access + refresh session for a user who has passed every factor.
  async issueSession(userId: string, username: string) {
    return this.access.issueSession(userId, username);
  }

  // Trade a refresh token for a rotated pair.
  async refresh(refreshToken?: string) {
    return this.access.refresh(refreshToken);
  }

  // Revoke this device's refresh token and let the engine close a live seat.
  async logout(refreshToken?: string) {
    return this.access.logout(refreshToken);
  }

  // Validate the access-token cookie; returns the user id or null.
  verifyAccessToken(token: string | undefined): string | null {
    return this.access.verifyAccessToken(token);
  }

  // Full profile for the Edit-Profile card (incl. linked OAuth providers).
  async getProfile(userId: string) {
    return this.profile.getProfile(userId);
  }

  // Turn email-code 2FA on or off for the user.
  async setTwoFactorSetting(userId: string, enabled: boolean, currentPassword?: string) {
    return this.profile.setTwoFactorSetting(userId, enabled, currentPassword);
  }

  // Complete profile update: display name, email, 2FA and OAuth methods in one call.
  async updateProfile(
    userId: string,
    dto: {
      displayName?: string;
      email?: string;
      currentPassword?: string;
      twoFactorEnabled?: boolean;
      language?: string;
      oauthToAdd?: string;
      oauthToRemove?: string;
    },
    baseUrl: string = BASE_URL,
  ) {
    return this.profile.updateProfile(userId, dto, baseUrl);
  }

  // Logged-in password change: verify the current one (if any) and revoke others.
  async changePassword(
    userId: string,
    currentPassword: string | undefined,
    newPassword: string,
    currentRefreshToken?: string,
  ) {
    return this.profile.changePassword(userId, currentPassword, newPassword, currentRefreshToken);
  }

  // Permanently delete the account after confirming its password.
  async deleteAccount(userId: string, dto: DeleteAccountDto) {
    return this.profile.deleteAccount(userId, dto);
  }

  // Find/ link/create the account behind a provider identity.
  async validateOAuthLogin(
    input: {
      provider: string;
      providerAccountId: string;
      email?: string;
      usernameSeed: string;
    },
    linkUserId?: string,
  ) {
    return this.oauth.validateOAuthLogin(input, linkUserId);
  }

  // Signed token carried in OAuth `state` when a logged-in user adds a method.
  createOAuthLinkToken(userId: string, provider: string): string {
    return this.oauth.createOAuthLinkToken(userId, provider);
  }

  // Verify the link token and prove the caller is the user named in it.
  resolveOAuthLinkForRequest(
    req: OAuthCallbackRequest | undefined,
    provider: string,
  ): string | undefined {
    return this.oauth.resolveOAuthLinkForRequest(req, provider);
  }

  // Unlink a provider sign-in method, keeping at least one way to sign in.
  async removeOAuthMethod(userId: string, provider: string) {
    return this.oauth.removeOAuthMethod(userId, provider);
  }
}
