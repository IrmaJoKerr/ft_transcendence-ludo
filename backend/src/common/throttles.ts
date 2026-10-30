import type { ThrottlerOptions } from '@nestjs/throttler';

// Route-level rate limits, grouped by the controller that uses them. One table keeps
// coverage auditable: every mutating route has an entry, and the global 300/min
// default stays the backstop for reads. Caps apply per client IP, not per account.

const MINUTE = 60 * 1000;
const QUARTER_HOUR = 15 * MINUTE;
const HOUR = 60 * 60 * 1000;

// Shape every entry must satisfy before it reaches @Throttle(): one options
// object per named throttler ("default" is the only one this app declares).
type NamedLimits = Record<string, ThrottlerOptions>;
type RouteLimits = Record<string, NamedLimits>;

// auth.controller.ts : credentials, sessions and account security.
export const AUTH_THROTTLE = {
  register: { default: { limit: 5, ttl: HOUR } },
  resendVerification: { default: { limit: 3, ttl: HOUR } },
  login: { default: { limit: 5, ttl: MINUTE } },
  twoFactorVerify: { default: { limit: 5, ttl: MINUTE } },
  twoFactorResend: { default: { limit: 5, ttl: HOUR } },
  refresh: { default: { limit: 30, ttl: MINUTE } },
  forgotPassword: { default: { limit: 3, ttl: HOUR } },
  resetPassword: { default: { limit: 5, ttl: QUARTER_HOUR } },
  updateProfile: { default: { limit: 10, ttl: HOUR } },
  resendEmailChange: { default: { limit: 5, ttl: HOUR } },
  changePassword: { default: { limit: 5, ttl: HOUR } },
  deleteAccount: { default: { limit: 5, ttl: HOUR } },
  setTwoFactor: { default: { limit: 10, ttl: HOUR } },
} satisfies RouteLimits;

// friends.controller.ts : requests, blocks and game invitations.
export const FRIENDS_THROTTLE = {
  request: { default: { limit: 20, ttl: MINUTE } },
  accept: { default: { limit: 30, ttl: MINUTE } },
  decline: { default: { limit: 30, ttl: MINUTE } },
  remove: { default: { limit: 30, ttl: MINUTE } },
  block: { default: { limit: 20, ttl: MINUTE } },
  unblock: { default: { limit: 20, ttl: MINUTE } },
  invite: { default: { limit: 20, ttl: MINUTE } },
  dismissInvite: { default: { limit: 60, ttl: MINUTE } },
} satisfies RouteLimits;

// match.controller.ts : room creation and the in-game HTTP actions. Engine
// callbacks (/api/game/end, /api/game/:id/started) are key-authenticated and
// deliberately absent.
export const MATCH_THROTTLE = {
  pvpInvite: { default: { limit: 10, ttl: MINUTE } },
  join: { default: { limit: 20, ttl: MINUTE } },
  pve: { default: { limit: 10, ttl: MINUTE } },
  create: { default: { limit: 10, ttl: MINUTE } },
  // The guest door's burst backstop (nginx has the same budget one layer out).
  // The budgets that price churn are the GuestLimitService counters, not this.
  guest: { default: { limit: 20, ttl: MINUTE } },
  ready: { default: { limit: 60, ttl: MINUTE } },
  inviteFriend: { default: { limit: 20, ttl: MINUTE } },
  rejoin: { default: { limit: 60, ttl: MINUTE } },
  exit: { default: { limit: 30, ttl: MINUTE } },
  abort: { default: { limit: 30, ttl: MINUTE } },
} satisfies RouteLimits;

// notification.controller.ts : the SSE stream plus the bell's write routes.
export const NOTIFICATION_THROTTLE = {
  stream: { default: { limit: 60, ttl: MINUTE } },
  markRead: { default: { limit: 120, ttl: MINUTE } },
  markAllRead: { default: { limit: 30, ttl: MINUTE } },
} satisfies RouteLimits;

// presence.controller.ts : the REST fallback heartbeat, with headroom for several
// tabs. The shipped client does not call it: presence rides the session socket.
export const PRESENCE_THROTTLE = {
  heartbeat: { default: { limit: 60, ttl: MINUTE } },
} satisfies RouteLimits;

// user.controller.ts : avatar writes are the heaviest mutating requests.
export const USER_THROTTLE = {
  avatarUpload: { default: { limit: 10, ttl: HOUR } },
  avatarDelete: { default: { limit: 10, ttl: HOUR } },
} satisfies RouteLimits;

// achievements.controller.ts : re-evaluation with no notification.
export const ACHIEVEMENTS_THROTTLE = {
  check: { default: { limit: 30, ttl: HOUR } },
} satisfies RouteLimits;
