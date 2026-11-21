import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AvatarMetaService } from '../avatar/avatar-meta.service';
import { isReservedBotName } from '../common/botname-enforce';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma.service';
import { requireSecret } from '../secrets';
import { AuthAccessService } from './auth.access.service';
import { OAUTH_LINK_AUDIENCE, OAUTH_LINK_TTL } from './auth.constants';
import { normalizeEmail, randomSuffix } from './auth.shared';

// The part of an OAuth callback request that auth code reads: the provider
// `state` query param (a signed oauth-link token) and the access-token cookie.
// `query` stays structural so an Express Request or ParsedQs satisfies it.
export interface OAuthCallbackRequest {
  query?: { state?: unknown };
  cookies?: Record<string, unknown>;
}

// Columns an OAuth strategy may consume after validateOAuthLogin: the session needs
// id/username/language, the 2FA branch needs email/twoFactorEnabled and the create
// branch seeds avatarMeta. Selecting these keeps `password_hash` out of reach.
const OAUTH_USER_FIELDS = {
  id: true,
  username: true,
  email: true,
  twoFactorEnabled: true,
  language: true,
  avatarStyle: true,
} as const;

// OAuth identity: first sign-in creates or links an Account row, an existing one
// logs in, and the "add a method" round-trip travels in a signed `state` token of
// its own. Nothing here mints a session except through AuthAccessService.
@Injectable()
export class AuthOAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly notifications: NotificationService,
    private readonly avatarMeta: AvatarMetaService,
    private readonly access: AuthAccessService,
  ) {}

  // Called after a provider (Google/GitHub) has verified the user.
  // Finds the matching user, or links/creates one, then returns it.
  async validateOAuthLogin(
    input: {
      provider: string;
      providerAccountId: string;
      email?: string;
      usernameSeed: string;
    },
    linkUserId?: string,
  ) {
    // EMAIL OWNERSHIP RULE: a provider's email only sets email/emailVerified
    // on FIRST sign-in. The "add sign-in method" flow (linkUserId) ignores it
    // : linking 42 to a Google account keeps the Google email and its state.

    // If provider account exist just log them in
    const existingAccount = await this.prisma.db.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: input.provider,
          providerAccountId: input.providerAccountId,
        },
      },
      select: { userId: true, user: { select: OAUTH_USER_FIELDS } },
    });
    if (existingAccount) {
      // "Add method" intent: same user -> no-op, different user -> conflict.
      if (linkUserId && existingAccount.userId !== linkUserId) {
        throw new ConflictException({
          code: 'AUTH_PROVIDER_LINKED',
          message: 'This provider account is linked to another user',
        });
      }
      return existingAccount.user;
    }

    // "Add method" intent with a new provider account: link it straight to
    // the requesting user (provider identity is already vouched by OAuth).
    if (linkUserId) {
      const linked = await this.prisma.db.user.findUnique({
        where: { id: linkUserId },
        select: OAUTH_USER_FIELDS,
      });
      if (linked) {
        // The provider's email must not already belong to a different account
        const linkEmail = input.email ? normalizeEmail(input.email) : undefined;
        if (linkEmail) {
          const linkEmailOwner = await this.prisma.db.user.findUnique({
            where: { email: linkEmail },
            select: { id: true },
          });
          if (linkEmailOwner && linkEmailOwner.id !== linkUserId) {
            throw new ConflictException({
              code: 'AUTH_EMAIL_TAKEN',
              message: 'That provider account uses an email already registered to another account',
            });
          }
        }

        await this.prisma.db.account.create({
          data: {
            id: crypto.randomUUID(),
            userId: linkUserId,
            provider: input.provider,
            providerAccountId: input.providerAccountId,
          },
        });

        // Announce the newly linked sign-in method to the user.
        await this.notifications
          .notify(linkUserId, 'profile_updated', { items: ['oauthAdd'] })
          .catch(() => {});

        return linked;
      }
      // The "add method" user can be missing (e.g. session outlived a DB wipe),
      // so fall through to a normal first-time login instead of linking a
      // non-existent userId (FK violation).
    }

    //  First time with this provider and the email already belongs to an
    //  existing user → REJECT. (The "add method" flow above is exempt.)
    const email = input.email ? normalizeEmail(input.email) : undefined;
    if (email) {
      const emailOwner = await this.prisma.db.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (emailOwner) {
        // Don't leak the exact owner : same generic message as register().
        throw new ConflictException(
          'This email is already being used. Use a different email or log in using the same method you used to create this account.',
        );
      }
    }

    // Create new. Provider-verified email fills the email field; without one
    // (GitHub/42), the account starts with an empty email, addable later via
    // Edit Profile.
    const username = await this.generateUniqueUsername(input.usernameSeed);
    const displayName = await this.generateUniqueDisplayName(username);
    const user = await this.prisma.db.user.create({
      data: {
        id: crypto.randomUUID(),
        username,
        displayName,
        email,
        emailVerified: email ? new Date() : null,
        achievement: { create: { id: crypto.randomUUID() } },
        // Every account owns one career row. The postgame write updates it (and
        // upserts it), but a missing row here would mean a new account cannot
        // record its first match.
        stats: { create: {} },
      },
      select: OAUTH_USER_FIELDS,
    });

    await this.prisma.db.account.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        provider: input.provider,
        providerAccountId: input.providerAccountId,
      },
    });

    // Same seeding as register(): a fresh OAuth account has no photo either.
    await this.avatarMeta.set(user.id, { has: false, style: user.avatarStyle });

    return user;
  }

  // Signed 10-minute token carried in the OAuth `state` when a logged-in
  // user wants to ADD a provider sign-in method. It travels in a URL, so it
  // gets its own key and audience: it can never pass as a session token.
  createOAuthLinkToken(userId: string, provider: string): string {
    return this.jwt.sign(
      { sub: userId, p: provider, purpose: 'oauth-link' },
      {
        secret: requireSecret('OAUTH_STATE_SECRET'),
        audience: OAUTH_LINK_AUDIENCE,
        expiresIn: OAUTH_LINK_TTL,
      },
    );
  }

  // Verify a `state` token from the provider callback. Returns the userId
  // when it's ours and matches `provider`; anything else means normal login.
  resolveOAuthLinkForRequest(
    req: OAuthCallbackRequest | undefined,
    provider: string,
  ): string | undefined {
    const linkUserId = this.resolveOAuthLink(req?.query?.state, provider);
    if (!linkUserId) return undefined;
    const sessionUser = this.access.verifyAccessToken(
      typeof req?.cookies?.['token'] === 'string' ? req.cookies['token'] : undefined,
    );
    return sessionUser === linkUserId ? linkUserId : undefined;
  }

  // Signature check only : callers must use resolveOAuthLinkForRequest, which
  // also proves the presenter is the user named in the token.
  private resolveOAuthLink(state: unknown, provider: string): string | undefined {
    if (typeof state !== 'string' || !state) return undefined;
    try {
      const payload = this.jwt.verify<{ sub?: unknown; p?: string; purpose?: string }>(state, {
        secret: requireSecret('OAUTH_STATE_SECRET'),
        audience: OAUTH_LINK_AUDIENCE,
      });
      if (payload.purpose !== 'oauth-link' || payload.p !== provider) return undefined;
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined;
    } catch {
      return undefined;
    }
  }

  // Unlink a provider sign-in method. The user must keep at least one other
  // way to sign in : a password OR another linked provider.
  async removeOAuthMethod(userId: string, provider: string) {
    const account = await this.prisma.db.account.findFirst({ where: { userId, provider } });
    if (!account)
      throw new NotFoundException({
        code: 'AUTH_PROVIDER_NOT_LINKED',
        message: 'That provider is not linked to this account',
      });

    const user = await this.prisma.db.user.findUnique({ where: { id: userId } });
    if (!user)
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'User not found' });

    const remainingAccounts = await this.prisma.db.account.count({
      where: { userId, NOT: { provider } },
    });
    if (!user.password_hash && remainingAccounts === 0) {
      throw new ForbiddenException({
        code: 'AUTH_KEEP_ONE_SIGNIN',
        message: 'You must keep at least one sign-in method',
      });
    }

    await this.prisma.db.account.delete({ where: { id: account.id } });
    return { removed: provider };
  }

  // Turning usernames into unique seeds
  private async generateUniqueUsername(seed: string) {
    const clean = seed.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 16) || 'user';
    // A provider's seed may read as a bot's name (`bot_green`); swap the stem so
    // the minted account never wears one. `bot-` and `bot ` are already gone with
    // the non-alphanumerics.
    const base = isReservedBotName(clean) ? clean.replace(/^bot/i, 'user') : clean;
    let candidate = `${base}${randomSuffix()}`;
    while (await this.prisma.db.user.findUnique({ where: { username: candidate } })) {
      candidate = `${base}${randomSuffix()}`;
    }
    return candidate;
  }

  // Display names are unique too, so a freshly generated display name that
  // collides with an existing one also gets 5 random characters appended.
  private async generateUniqueDisplayName(seed: string) {
    const base = seed.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20) || 'user';
    let candidate = base;
    while (await this.prisma.db.user.findUnique({ where: { displayName: candidate } })) {
      candidate = `${base}_${this.randomChars(5)}`;
    }
    return candidate;
  }

  // 5 random alphanumeric characters (e.g. "3kF9z"). Avoids ambiguous
  // characters (0/O, 1/l/I) so generated suffixes are easy to read aloud.
  private randomChars(length: number): string {
    const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < length; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }
}
