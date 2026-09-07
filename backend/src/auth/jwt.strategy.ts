import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtPayload } from './jwt-payload';
import { requireSecret } from '../secrets';

function extractFromCookie(req: Request): string | null {
  return req?.cookies?.token ?? null;
}

@Injectable()
// Passport strategy that authenticates users from the `token` JWT cookie.
// Used by JwtAuthGuard, which protects every auth-required route.
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: extractFromCookie,
      secretOrKey: requireSecret('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    return { id: payload.sub, username: payload.username };
  }
}
