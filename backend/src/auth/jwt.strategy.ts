import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtPayload } from './jwt-payload';
import { requireSecret } from '../secrets';
import { ACCESS_COOKIE, SESSION_TOKEN_AUDIENCE, TOKEN_ISSUER } from './auth.constants';

function extractFromCookie(req: Request): string | null {
  return req.cookies[ACCESS_COOKIE] ?? null;
}

@Injectable()
// Passport strategy that authenticates users from the `token` JWT cookie.
// Used by JwtAuthGuard, which protects every auth-required route.
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: extractFromCookie,
      secretOrKey: requireSecret('JWT_SECRET'),
      issuer: TOKEN_ISSUER,
      audience: SESSION_TOKEN_AUDIENCE,
      algorithms: ['HS256'],
    });
  }

  // Controllers trust req.user.id, so it must be a real id. Without this a
  // token with no `sub` gave `undefined`, and Prisma drops undefined filters:
  // `where: { userId }` then matched every user's rows.
  validate(payload: Partial<JwtPayload>) {
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw new UnauthorizedException();
    }
    return { id: payload.sub, username: payload.username };
  }
}
