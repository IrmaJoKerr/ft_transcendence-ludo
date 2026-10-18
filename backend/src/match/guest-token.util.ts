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

// The guest's seat id, unique per mint. Never a per-IP id: `player1_id` is
// scanned by hasLiveMatch, so a shared id would hand student #2 on the same
// campus NAT the first student's MATCH_ACTIVE_GAME refusal. A per-mint id also
// gives each guest a genuine "one live room" rule for free.
export function guestUserId(token: string): string {
  return `guest-${hashGuestToken(token)}`;
}
