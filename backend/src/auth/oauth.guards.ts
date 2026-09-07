import { CanActivate, ConflictException, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Observable } from 'rxjs';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { secret, isTunnelRequest } from '../secrets';

// Builds one passport guard class per OAuth provider. Each picks between the
// localhost and ngrok-tunnel strategies per request via the Host header
// (ngrok forwards the original Host), mirroring the redirect-target logic in
// auth.controller.ts. Used on the /api/auth/<provider> login routes.
function tunnelAwareGuard(localStrategy: string, tunnelStrategy: string, provider: string) {
  const LocalGuard = AuthGuard(localStrategy);
  const TunnelGuard = AuthGuard(tunnelStrategy);

  @Injectable()
  // Guard that runs the right provider strategy and redirects OAuth failures
  // back to the frontend login page with an `error` query param.
  class TunnelAwareAuthGuard implements CanActivate {
    // This class is returned from a factory and used as an exported base :
    // EVERY member must be public or `nest build` fails. (#-private fields and
    // private constructor params both trip the rule.)
    readonly local = new LocalGuard();
    readonly tunnel = new TunnelGuard();

    constructor(public readonly jwt: JwtService) {}

    // Entry point called by Nest on the /api/auth/<provider> route: picks the
    // strategy, injects oauth-link state when needed, and handles rejections.
    canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
      const req = context.switchToHttp().getRequest<Request>();
      const guard = isTunnelRequest(req.get('host')) ? this.tunnel : this.local;
      const frontendUrl = isTunnelRequest(req.get('host'))
        ? (secret('NGROK_FRONTEND_URL') ?? 'https://polka-bless-wing.ngrok-free.dev')
        : (secret('FRONTEND_URL') ?? 'https://localhost:8443');

      // If the provider returned an OAuth error directly (e.g. ?error=access_denied)
      if (req.query?.error) {
        const res = context.switchToHttp().getResponse<Response>();
        const errParam = req.query.error === 'access_denied' ? 'access_denied' : 'oauth_failed';
        res.redirect(`${frontendUrl}/login?error=${errParam}`);
        return false;
      }

      // "Add a sign-in method" intent: with a valid access-token cookie, sign
      // a short-lived oauth-link token into the provider `state` so the
      // callback links the provider to the logged-in user. No cookie = login.
      let state: string | undefined;
      const accessToken = req.cookies?.['token'];
      if (typeof accessToken === 'string') {
        try {
          const payload = this.jwt.verify(accessToken) as { sub?: string };
          if (payload.sub) {
            state = this.jwt.sign(
              { sub: payload.sub, p: provider, purpose: 'oauth-link' },
              { expiresIn: '10m' },
            );
          }
        } catch {
          // invalid/expired access token -> normal login
        }
      }

      if (state) {
        const opts = (guard as any).options ?? {};
        (guard as any).options = { ...opts, state };
      }

      try {
        const result = guard.canActivate(context);

        // Fast paths : a boolean can't carry the strategy rejection; observables
        // are passed through untouched.
        if (typeof result === 'boolean') {
          if (!result) {
            const res = context.switchToHttp().getResponse<Response>();
            res.redirect(`${frontendUrl}/login?error=access_denied`);
            return false;
          }
          return result;
        }
        if (result instanceof Observable) return result;

        // Promise path: handle strategy rejection or conflict exceptions by redirecting to login.
        return result.catch((err: unknown) => {
          const res = context.switchToHttp().getResponse<Response>();
          if (err instanceof ConflictException) {
            res.redirect(`${frontendUrl}/login?error=email-in-use`);
            return false;
          }
          res.redirect(`${frontendUrl}/login?error=access_denied`);
          return false;
        });
      } catch (err: unknown) {
        const res = context.switchToHttp().getResponse<Response>();
        if (err instanceof ConflictException) {
          res.redirect(`${frontendUrl}/login?error=email-in-use`);
          return false;
        }
        res.redirect(`${frontendUrl}/login?error=access_denied`);
        return false;
      }
    }
  }

  return TunnelAwareAuthGuard;
}

@Injectable()
export class GoogleAuthGuard extends tunnelAwareGuard('google', 'google-tunnel', 'google') {}

@Injectable()
export class GithubAuthGuard extends tunnelAwareGuard('github', 'github-tunnel', 'github') {}

@Injectable()
export class FortyTwoAuthGuard extends tunnelAwareGuard('42', '42-tunnel', '42') {}
