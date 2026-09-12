import { Socket } from 'socket.io';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PlayerColor } from '../types';

export const BOT_PREFIX = 'bot-';

export function isBotUserId(userId: string | undefined): boolean {
  return !!userId && userId.startsWith(BOT_PREFIX);
}

// JWT verification for engine tokens minted by the backend. Checks the
// HS256 signature against JWT_SECRET (constant-time), and honours expiry :
// forged or unsigned tokens are rejected.
function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set : engine cannot verify tokens');
  }
  return secret;
}

export function verifyToken(token: string): {
  gameId: string;
  userId: string;
  username?: string;
  displayName?: string;
  role: string;
  color?: PlayerColor;
  mode?: string;
  clashEnabled?: boolean;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encHeader, encPayload, encSignature] = parts;

    // 1. Only accept HS256 : an attacker must not be able to pick "none".
    const header = JSON.parse(Buffer.from(encHeader, 'base64url').toString('utf-8'));
    if (header.alg !== 'HS256') return null;

    // 2. Recompute the signature over the exact signing input and compare in
    //    constant time (a plain === leaks bytes through timing).
    const expected = createHmac('sha256', requireJwtSecret())
      .update(`${encHeader}.${encPayload}`)
      .digest();
    const provided = Buffer.from(encSignature, 'base64url');
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(provided, expected)) return null;

    const payload = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf-8'));

    // 3. Honour expiry : the backend signs these with expiresIn '24h'.
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
      // Room rules the host chose at creation. The engine uses the persisted
      // match hash as the authority; this copy lets a socket know the rules
      // before its seat's game state exists.
      clashEnabled: payload.clashEnabled,
    };
  } catch {
    return null;
  }
}

// Data stored on each connected socket
export interface SocketData {
  gameId?: string;
  playerColor?: PlayerColor;
  // Seat colour as issued by the backend in the JWT : authoritative.
  tokenColor?: PlayerColor;
  userId?: string;
  username?: string;
  displayName?: string;
  role?: 'player';
  mode?: 'pvp' | 'pve' | 'hotseat';
}

// Custom socket wrapper to provide typed data
export type GameSocket = Socket & { data: SocketData };

export const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3000';
