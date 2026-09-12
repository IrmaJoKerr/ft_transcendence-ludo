import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { requireSecret, secret } from '../secrets';
import Redis from 'ioredis';
import { BOT_PREFIX, isBotUserId } from '../common/bot';

const SLOT_COLORS = ['blue', 'red', 'green', 'yellow'];
const FRONTEND_URL = requireSecret('FRONTEND_URL');
export const ENGINE_WS_URL = FRONTEND_URL.replace(/^http/, 'ws');

// Shape handed back to the frontend when a match is created/joined/rejoined.
export interface MatchRoomHandoff {
  gameId: string;
  token: string;
  engineUrl: string;
  color: string;
  mode: string;
  playerCount: number;
  inviteCode?: string;
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

@Injectable()
// Match creation: PvP rooms, PvE bot games, hotseat rooms, invite codes and
// random-match matching. Writes match:* hashes to Redis. Used by
// MatchService (called from match.controller.ts and friends.service.ts).
export class MatchCreatorService {
  // Redis client for match:* game hashes and per-user create locks.
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  // Create a new match room (PvP, PvE, or hotseat). PvP rooms start in WAITING;
  // PvE/hotseat start immediately in ACTIVE with bot slots filled.
  async createMatch(
    userId: string,
    mode: 'pvp' | 'pve' | 'hotseat',
    playerCount: number,
    botCount: number,
    botColors?: string[],
    seatColors?: string[],
    clashEnabled: boolean = false,
    safeZones: boolean = true,
  ) {
    if (playerCount < 2 || playerCount > 4) {
      throw new BadRequestException('Player count must be between 2 and 4');
    }
    if (botCount < 0 || botCount >= playerCount) {
      throw new BadRequestException('Bot count must be between 0 and playerCount - 1');
    }
    if (mode === 'pvp' && botCount > 0) {
      throw new BadRequestException('PvP mode cannot have bots');
    }
    if (mode === 'pve' && botCount === 0) {
      throw new BadRequestException('PvE mode must have at least 1 bot');
    }
    if (mode === 'hotseat' && botCount > 0) {
      throw new BadRequestException('Hot seat mode cannot have bots');
    }
    if (mode === 'pvp' && playerCount < 2) {
      throw new BadRequestException('PvP mode requires at least 2 players');
    }

    return this.withUserCreateLock(userId, () =>
      this.createMatchLocked(
        userId,
        mode,
        playerCount,
        botCount,
        botColors,
        seatColors,
        clashEnabled,
        safeZones,
      ),
    );
  }

  private async withUserCreateLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    const key = `lock:create_match:${userId}`;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      // SET NX is atomic: exactly one caller can hold this at a time.
      const acquired = await this.redis.set(key, '1', 'PX', 5000, 'NX');
      if (acquired) {
        try {
          return await fn();
        } finally {
          await this.redis.del(key);
        }
      }
      // Someone else is mid-create for this user. They finish in ms, and
      // the SCAN will then find their room and we return that instead.
      await new Promise((r) => setTimeout(r, 50));
    }
    // The lock was still held after the retries, so proceed without it rather than
    // failing the request: the worst case is the previous behaviour.
    return fn();
  }

  private async createMatchLocked(
    userId: string,
    mode: 'pvp' | 'pve' | 'hotseat',
    playerCount: number,
    botCount: number,
    botColors?: string[],
    seatColors?: string[],
    clashEnabled: boolean = false,
    safeZones: boolean = true,
  ) {
    // SCAN guard: idempotent room creation : reuse existing WAITING/ACTIVE match if user already seated
    let cursor = '0';
    let foundExisting = false;
    let existingGameId = '';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        const data = await this.redis.hgetall(key);
        if (
          (data.player1_id === userId ||
            data.player2_id === userId ||
            data.player3_id === userId ||
            data.player4_id === userId) &&
          (data.status === 'WAITING' || data.status === 'ACTIVE')
        ) {
          foundExisting = true;
          existingGameId = data.id;
          break;
        }
      }
    } while (!foundExisting && cursor !== '0');
    const gameId = foundExisting ? existingGameId : crypto.randomUUID();
    const totalBots = botCount;
    const isPvP = mode === 'pvp';
    const player1Color = SLOT_COLORS[0];

    const updates: Record<string, string> = {
      id: gameId,
      status: isPvP ? 'WAITING' : 'ACTIVE',
      gameType: mode.toUpperCase(),
      playerCount: playerCount.toString(),
      player1_id: userId,
      player1_color: player1Color,
      // Room rules chosen by the host. The engine reads these back from the
      // match hash when it creates the game state (join-manager), so the
      // toggles must be persisted before any seat joins.
      clashEnabled: clashEnabled.toString(),
      safeZones: safeZones.toString(),
      createdAt: Date.now().toString(),
    };

    // Slot→color mapping is fixed by index (0=blue,1=red,2=green,3=yellow).
    // Persist the exact seat order so the engine creates matching colors :
    // hotseat can skip seats (e.g. blue + green + yellow, no red).
    const colorSlot = new Map<string, number>(SLOT_COLORS.map((c, i) => [c, i + 1]));
    const resolvedSeatColors =
      Array.isArray(seatColors) && seatColors.length > 0
        ? seatColors
        : SLOT_COLORS.slice(0, playerCount);
    if (resolvedSeatColors.length !== playerCount) {
      throw new BadRequestException('seatColors must have exactly playerCount entries');
    }
    for (const c of resolvedSeatColors) {
      if (!colorSlot.has(c)) {
        throw new BadRequestException(`Invalid seat color: ${c}`);
      }
    }
    if (resolvedSeatColors[0] !== SLOT_COLORS[0]) {
      throw new BadRequestException('The host (first seat) must be blue');
    }
    updates.seatColors = resolvedSeatColors.join(',');

    if (isPvP) {
      updates.inviteCode = generateInviteCode();
    } else {
      updates.startedAt = Date.now().toString();
      const assignedBotColors =
        Array.isArray(botColors) && botColors.length > 0
          ? botColors
          : SLOT_COLORS.slice(1, 1 + totalBots);
      if (assignedBotColors.length !== totalBots) {
        throw new BadRequestException('botColors must match botCount');
      }
      for (const color of assignedBotColors) {
        const slot = colorSlot.get(color);
        if (!slot || slot < 2 || slot > 4) {
          throw new BadRequestException(`Invalid bot color: ${color}`);
        }
        updates[`player${slot}_id`] = BOT_PREFIX + color;
        updates[`player${slot}_color`] = color;
      }
    }

    await this.redis.hset(`match:${gameId}`, updates);
    await this.redis.expire(`match:${gameId}`, 86400);

    const username = await this.resolveUsername(userId);
    const displayName = await this.resolveDisplayName(userId);
    const token = this.jwt.sign(
      {
        gameId,
        playerId: userId,
        username: username ?? undefined,
        displayName,
        role: 'player1',
        mode,
        clashEnabled,
        color: player1Color,
      },
      { expiresIn: '24h' },
    );

    // mode + playerCount are required: the frontend persists activeMatch for
    // refresh/reconnect and branches on mode. Without them a refresh makes
    // hotseat/PvE rejoin as a generic PvP seat.
    const result: MatchRoomHandoff = {
      gameId,
      token,
      engineUrl: ENGINE_WS_URL,
      color: player1Color,
      mode,
      playerCount,
    };
    if (isPvP) {
      result.inviteCode = updates.inviteCode;
    }
    return result;
  }

  // Create a PvP room and return its invite code (alias for createMatch).
  async createInvite(userId: string, clashEnabled: boolean = false, safeZones: boolean = true) {
    const result = await this.createMatch(userId, 'pvp', 4, 0, undefined, undefined, clashEnabled, safeZones);
    return result;
  }

  // Create a PvE match with the specified number of bot opponents.
  async playBot(
    userId: string,
    playerCount: number = 2,
    clashEnabled: boolean = false,
    safeZones: boolean = true,
  ) {
    if (playerCount !== 2 && playerCount !== 4) {
      throw new BadRequestException('Player count must be 2 or 4');
    }
    const botCount = playerCount - 1;
    return this.createMatch(userId, 'pve', playerCount, botCount, undefined, undefined, clashEnabled, safeZones);
  }

  // Join a PvP room by its 6-character invite code.
  async joinByInvite(
    inviteCode: string,
    userId: string,
    joiner: (gameId: string, userId: string) => Promise<MatchRoomHandoff>,
  ) {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        const data = await this.redis.hgetall(key);
        if (data.inviteCode === inviteCode && data.status === 'WAITING') {
          if (data.player1_id === userId) {
            throw new BadRequestException('You cannot join your own invite');
          }
          return joiner(data.id, userId);
        }
      }
    } while (cursor !== '0');
    throw new NotFoundException('Invite code not found or expired');
  }

  private async resolveUsername(userId: string): Promise<string | null> {
    if (isBotUserId(userId)) return null;
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return user?.username ?? null;
  }

  private async resolveDisplayName(userId: string): Promise<string | undefined> {
    if (isBotUserId(userId)) return undefined;
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return user?.displayName ?? undefined;
  }
}
