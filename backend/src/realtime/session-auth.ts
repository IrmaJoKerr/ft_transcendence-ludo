import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// The identity a session socket carries. Both fields come from a verified token
// only; nothing is ever taken from the handshake's query string or payload.
export type SessionUser = { id: string; username?: string };

// One cookie out of a Cookie header, decoded the way cookie-parser decodes
// req.cookies, so a token that was percent-encoded in transit is not corrupted.
// Returns null for a missing header, a missing name, or an empty value.
export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value; // a stray '%' is not a reason to drop an otherwise valid token
    }
  }
  return null;
}

// A verified token must carry a user id. Same rule as JwtStrategy.validate: a
// payload without `sub` would become `userId: undefined`, which Prisma drops
// from a `where` clause, turning a per-user query into an unfiltered one.
export function userFromPayload(payload: unknown): SessionUser | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as { sub?: unknown; username?: unknown };
  if (typeof record.sub !== 'string' || !record.sub) return null;
  return {
    id: record.sub,
    username: typeof record.username === 'string' ? record.username : undefined,
  };
}

// Turns the handshake cookie into a SessionUser. The JwtService injected here
// comes from AuthModule, so the verification rule (issuer, API audience, HS256)
// is the one session-jwt.ts defines for the HTTP strategy: never a relaxed copy.
@Injectable()
export class SessionAuthService {
  constructor(private readonly jwt: JwtService) {}

  async verify(token: string): Promise<SessionUser | null> {
    try {
      return userFromPayload(await this.jwt.verifyAsync(token));
    } catch {
      return null; // expired, wrong audience, wrong issuer, bad signature, alg:none
    }
  }
}
