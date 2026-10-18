import type { Socket } from 'socket.io';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { PlayerColor } from '../types';

export const BOT_PREFIX = 'bot-';

export function isBotUserId(userId: string | undefined): boolean {
  return !!userId && userId.startsWith(BOT_PREFIX);
}

// Guest tokens are opaque, looked up in Redis, and in their own namespace: a
// forged one is "not found" rather than a signature that must not validate in
// the player branch. The backend mints them (backend/src/match/guest-token.util.ts
// keeps the same prefix and hash); the engine only reads the record.
export const GUEST_TOKEN_PREFIX = 'g_';

export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// The whole surface a guest socket may drive. An allow-list, not a deny-list:
// an event added later is refused for guests until it is added here on purpose.
// The three lobby actions (player_ready, select_color, update_modifiers) are
// absent: a PvE room is ACTIVE from creation, colours are assigned at creation
// and the rules are frozen at creation, so no guest has a legitimate target for
// them. A refused event is logged and dropped, never a disconnect: a stray
// lobby event must not close a socket mid-clash.
export const GUEST_EVENTS = new Set([
  'join_game', // pinned by the registry's gameId
  'roll_dice',
  'move_piece',
  'skip_bust',
  'arm_barrier',
  'clash_card_hold',
  'clash_input',
  'leave_game',
  'end_game',
  'disconnect',
]);

// Audience carried by every engine match token. A token without it is rejected,
// so a session access token can never be used here.
export const ENGINE_TOKEN_AUDIENCE = 'ludo-engine';

// Reads the engine-dedicated signing secret. Throws when it is not configured.
function requireEngineJwtSecret(): string {
  const secret = process.env.ENGINE_JWT_SECRET;
  if (!secret) {
    throw new Error('ENGINE_JWT_SECRET is not set : engine cannot verify tokens');
  }
  return secret;
}

// Verifies a handshake match token: accepts only HS256, checks the signature
// against ENGINE_JWT_SECRET, requires the engine audience, and honours expiry.
export function verifyToken(token: string): {
  gameId: string;
  userId: string;
  username?: string;
  displayName?: string;
  role: string;
  color?: PlayerColor;
  mode?: string;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encHeader, encPayload, encSignature] = parts;

    // 1. Only accept HS256, so an unsigned token is never considered.
    const header = JSON.parse(Buffer.from(encHeader, 'base64url').toString('utf-8'));
    if (header.alg !== 'HS256') return null;

    // 2. Recompute the signature over the exact signing input and compare it in
    //    constant time rather than with a plain equality check.
    const expected = createHmac('sha256', requireEngineJwtSecret())
      .update(`${encHeader}.${encPayload}`)
      .digest();
    const provided = Buffer.from(encSignature, 'base64url');
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(provided, expected)) return null;

    const payload = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf-8'));

    // 3. Reject tokens not addressed to this service: only a match token with
    //    the engine audience is accepted.
    if (payload.aud !== ENGINE_TOKEN_AUDIENCE) return null;

    // 4. Reject an expired token.
    if (typeof payload.exp === 'number' && Date.now() >= payload.exp * 1000) return null;

    return {
      gameId: payload.gameId,
      userId: payload.playerId || payload.sub || payload.userId,
      username: payload.username,
      displayName: payload.displayName,
      role: payload.role || 'player',
      // Server-issued seat. handleJoinGame prefers this over the client's own
      // join_game argument, so a client cannot claim someone else's colour.
      color: payload.color,
      // Needed to know whether seat-from-token can be enforced: hotseat is one
      // socket driving every local seat, so it legitimately joins as colours
      // other than the token's.
      mode: payload.mode,
    };
  } catch {
    return null;
  }
}

// Data stored on each connected socket
export interface SocketData {
  gameId?: string;
  // Match id as issued by the backend in the JWT : authoritative and never
  // cleared. join_game is pinned to this so a client-supplied gameId can never
  // redirect a seat to another game.
  tokenGameId?: string;
  playerColor?: PlayerColor;
  // Seat colour as issued by the backend in the JWT : authoritative.
  tokenColor?: PlayerColor;
  userId?: string;
  username?: string;
  displayName?: string;
  role?: 'player';
  mode?: 'pvp' | 'pve' | 'hotseat';
  // Set only by the guest handshake branch. `isGuest` gates the event
  // allow-list; the two guest fields are what abort settlement needs (the
  // address's counters and the token to revoke).
  isGuest?: boolean;
  guestIpHash?: string;
  guestTokenHash?: string;
  // Exactly-once guard for settlement: a guest can leave and then abort from
  // the end card, and must not be charged twice or decrement a slot twice.
  guestSettled?: boolean;
}

// Custom socket wrapper to provide typed data
export type GameSocket = Socket & { data: SocketData };

export const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3000';
