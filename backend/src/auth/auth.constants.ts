// Auth tunables: single source of truth. Import where enforced: change once.
export const AUTH = {
  verifyTokenTtlS: 24 * 60 * 60, // signup link (Redis `verify:`)
  resetTokenTtlS: 60 * 60, // password-reset link (Redis `reset:`)
  changeTokenTtlS: 15 * 60, // email-change link (Redis `emailchange:`)
  maxEmailChangesPerHour: 3, // per user
  challenge: {
    ttlS: 5 * 60, // 2FA login code (Redis `2fa:`)
    maxAttempts: 5,
    resendWindowS: 60 * 60,
    maxResends: 3,
  },
  // Per-account login lockout (security-review F-08). The route's @Throttle and
  // nginx's limit_req count the client address, so these count failures per
  // account, in Redis (`login:fail:<sha256(identifier)>`, never the identifier).
  loginLockout: {
    windowS: 15 * 60, // failures older than this start the count again
    softLimit: 5, //     failures that start costing the caller time
    hardLimit: 10, //    failures that refuse the account outright
    hardLockS: 15 * 60, // how long that refusal lasts (equal to windowS today: separate knobs on purpose)
    maxDelayS: 30, //    ceiling on the per-attempt delay
  },
} as const;

// JWT scope claims: a token only works where its audience says it belongs.
// Session tokens bind to the API; oauth-link tokens (their own
// OAUTH_STATE_SECRET) bind to the OAuth callback only.
export const TOKEN_ISSUER = 'ft_transcendence';
export const SESSION_TOKEN_AUDIENCE = 'ft_transcendence-api';
export const OAUTH_LINK_AUDIENCE = 'oauth-link';
export const OAUTH_LINK_TTL = '10m';

// Access-token cookie: JwtStrategy reads it from req.cookies, the session socket
// reads it from the handshake's Cookie header. The refresh token has its own
// cookie in auth.controller.ts (scoped to /api/auth).
export const ACCESS_COOKIE = 'token';

// Published when a user's sessions are revoked: the session socket subscribes to
// `auth:revoked:*` and disconnects that account's sockets by push, so a socket
// cannot outlive the session that opened it. One message per account, no
// session id, so every tab of that account is covered.
export const AUTH_REVOKED_PREFIX = 'auth:revoked:';
