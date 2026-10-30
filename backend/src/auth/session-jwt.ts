import type { JwtModuleOptions } from '@nestjs/jwt';
import { SESSION_TOKEN_AUDIENCE, TOKEN_ISSUER } from './auth.constants';

// The session-token rule in one place: issuer, API audience, HS256 only.
// AuthModule registers JwtModule with it, so the HTTP strategy and the session
// socket's handshake verify identically instead of repeating the triple.
export function sessionJwtOptions(secret: string): JwtModuleOptions {
  return {
    secret,
    signOptions: {
      expiresIn: '15m',
      issuer: TOKEN_ISSUER,
      audience: SESSION_TOKEN_AUDIENCE,
    },
    verifyOptions: {
      issuer: TOKEN_ISSUER,
      audience: SESSION_TOKEN_AUDIENCE,
      algorithms: ['HS256'],
    },
  };
}
