import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { secret } from '../secrets';

// Cross-site request forgery protection for mutating API routes.
//
// Two independent controls, both required:
//   1. An allow-list on the Origin the browser reports (Referer is the fallback
//      when Origin is absent). A cross-site form post always carries one of the
//      two, so it can never name a host we trust.
//   2. A signed double-submit token: the browser holds `csrf_token` (readable by
//      script, unlike the session cookies) and must echo it in X-CSRF-Token.
//      An attacker on another origin can make the browser send the cookie but
//      cannot read it to fill the header, and cannot forge the HMAC without the
//      server key.
//
// SameSite=Lax on the session cookies already stops most form posts; this is the
// layer that holds when a browser or a proxy drops that guarantee.

export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Engine callbacks authenticate with the x-engine-key header, never with the
// user's cookies, so CSRF does not apply: there is no browser session to ride.
// Everything else under /api stays covered.
const ENGINE_CALLBACKS = [/^\/api\/game\/end$/, /^\/api\/game\/[^/]+\/started$/];

// Domain separation: derive a CSRF key from the JWT secret instead of adding a
// new required env var. Rotating JWT_SECRET invalidates outstanding CSRF
// tokens too; the middleware reissues one on the next request.
const KEY = createHmac('sha256', secret('JWT_SECRET') ?? '')
  .update('ft-transcendence:csrf-token:v1')
  .digest();

function sign(nonce: string): string {
  return createHmac('sha256', KEY).update(nonce).digest('base64url');
}

// random nonce + HMAC. The signature is what a subdomain that can write cookies
// cannot produce, so a planted cookie still fails validation.
export function mintCsrfToken(): string {
  const nonce = randomBytes(18).toString('base64url');
  return `${nonce}.${sign(nonce)}`;
}

export function isValidCsrfToken(token: unknown): token is string {
  if (typeof token !== 'string') return false;
  const [nonce, signature] = token.split('.');
  if (!nonce || !signature) return false;
  const expected = sign(nonce);
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// Constant-time comparison of the cookie and the header. Both sides are hashed
// first so a length mismatch cannot throw or leak a length.
function sameValue(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

function cookieOptions() {
  return {
    httpOnly: false, // the SPA has to read it to fill the header
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TOKEN_TTL_MS,
  };
}

// Write a fresh token into the response and return it.
export function issueCsrfCookie(res: Response): string {
  const token = mintCsrfToken();
  res.cookie(CSRF_COOKIE, token, cookieOptions());
  return token;
}

// A request's own host is trusted, plus the URLs the app is published on. The
// dev server is included because Vite proxies /api and keeps the browser on
// http://localhost:5173. LAN is only added when `make lan` wrote LAN_IP.
let allowedOrigins: Set<string> | null = null;
function originAllowList(): Set<string> {
  if (allowedOrigins) return allowedOrigins;
  const values = [
    process.env.FRONTEND_URL,
    process.env.NGROK_FRONTEND_URL,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ];
  if (process.env.LAN_IP) {
    values.push(`https://${process.env.LAN_IP}:${process.env.HTTPS_PORT ?? '8443'}`);
  }
  const set = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const origin = originOf(value);
    if (origin) set.add(origin);
  }
  allowedOrigins = set;
  return set;
}

// Returns the serialized origin, or null for a value a browser reports as
// "null" (sandboxed iframe, opaque origin) or an unparseable string.
function originOf(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

function reject(res: Response, code: string, message: string): void {
  res.status(403).json({ code, message });
}

export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  const cookies = (req.cookies ?? {}) as Record<string, unknown>;
  const existing = cookies[CSRF_COOKIE];
  const path = req.originalUrl.split('?')[0];
  // GET /api/auth/csrf mints its own token in the controller; issuing one here
  // too would send two Set-Cookie headers for the same name.
  const isBootstrap = req.method === 'GET' && path === '/api/auth/csrf';

  // Every other response carries a usable token, so the SPA can bootstrap from
  // any call. A token signed with an old key is replaced rather than trusted.
  if (!isBootstrap && !isValidCsrfToken(existing)) issueCsrfCookie(res);

  if (!MUTATING.has(req.method) || !req.originalUrl.startsWith('/api/')) {
    next();
    return;
  }

  if (ENGINE_CALLBACKS.some((pattern) => pattern.test(path))) {
    next();
    return;
  }

  // Control 1: the reported origin must be this host or a published origin.
  // No Origin and no Referer means a non-browser client: it still has to pass
  // the token check below, so nothing is weakened.
  const reported = req.get('origin') ?? req.get('referer');
  if (reported !== undefined) {
    const presented = originOf(reported);
    const host = req.get('host');
    const sameHost =
      presented !== null && host !== undefined ? new URL(presented).host === host : false;
    if (presented === null || (!sameHost && !originAllowList().has(presented))) {
      reject(res, 'CSRF_ORIGIN_REJECTED', 'Cross-site request blocked');
      return;
    }
  }

  // Control 2: cookie and header must match and the token must be signed.
  const header = req.get(CSRF_HEADER) ?? '';
  const cookieToken = typeof existing === 'string' ? existing : '';
  if (!cookieToken || !header || !isValidCsrfToken(cookieToken) || !sameValue(cookieToken, header)) {
    reject(res, 'CSRF_TOKEN_INVALID', 'Missing or invalid CSRF token');
    return;
  }

  next();
}

