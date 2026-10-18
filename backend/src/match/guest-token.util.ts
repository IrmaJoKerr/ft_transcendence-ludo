import { createHash, randomBytes } from 'node:crypto';

// Guest tokens are opaque, not JWTs. The engine branches on the `g_` prefix, hashes
// the token and looks the hash up in Redis (`guesttok:<sha256>`); a forged token is
// "not found". Revocation is a DEL.
export const GUEST_TOKEN_PREFIX = 'g_';

export function mintGuestToken(): string {
  return GUEST_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function guestTokenKey(token: string): string {
  return `guesttok:${hashGuestToken(token)}`;
}

// The guest's seat id, unique per mint. Never per-IP: hasLiveMatch scans
// `player1_id`, so a shared id would give a second guest on the same NAT the first
// guest's MATCH_ACTIVE_GAME refusal.
export function guestUserId(token: string): string {
  return `guest-${hashGuestToken(token)}`;
}
