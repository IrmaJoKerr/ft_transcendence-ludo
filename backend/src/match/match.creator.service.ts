import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { requireSecret, secret } from '../secrets';
import Redis from 'ioredis';
import { BOT_PREFIX } from '../common/botname-enforce';
import { publishRoomsChanged } from '../common/channels';
import { signEngineToken } from './engine-token.util';
import { isEngineGameStarted, isSeatFinalized } from './seat-finalization';
import { findLiveMatch } from './active-game';
import { GUEST_TOKEN_TTL_S, GuestLimitService, guestIpHash } from './guest-limit.service';
import { guestTokenKey, guestUserId, mintGuestToken } from './guest-token.util';
import type { CreateGuestMatchDto } from './dto/create-guest-match.dto';
import {
  normalizeRoomRules,
  readRoomRules,
  roomRuleHashFields,
  type RoomRules,
} from './room-rules';

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
  // The room's rules as they sit in the match hash, so every handoff (create, reused
  // room, join, rejoin) tells the client which room it is entering. The engine's
  // `game_joined` carries the live flags too; this one is there before a socket exists.
  rules: RoomRules;
  // Only ever true for a guest mint. The client must not infer it from
  // `mode === 'pve'`: a signed-in player's PvE game is that too, and the exits
  // ("Back to login" vs "Back to lobby") branch on this flag.
  isGuest?: boolean;
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// Display label for a bot seat: `bot-<color> (<assistant>)`, from the name the
// lobby assigned that seat. The engine keeps `bot-<color>` as the identity, so
// this label is display only. The client re-localizes the colour word (FR: bot-rouge).
function botLabel(color: string, name?: unknown): string | null {
  const id = BOT_PREFIX + color;
  if (typeof name !== 'string') return null;
  const clean = name.replace(/[()]/g, '').trim().slice(0, 20);
  return clean ? `${id} (${clean})` : null;
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
    // Guest budgets and the mint gate. Injected here because the endpoint's
    // single job is to allocate a room, and a failed allocation must give the
    // reserved slots back in the same call.
    private readonly guests: GuestLimitService,
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
    botNames?: string[],
    seatColors?: string[],
    // The host's own corner. Required at runtime in every mode: a seat owns a colour,
    // and the host picks theirs before anybody else's is decided. Optional in the
    // signature because it follows optional seat params; `createMatchLocked` refuses
    // its absence (MATCH_INVALID_COLOR), so there is still no fallback colour.
    hostColor?: string,
    // The host's room rules from the same create payload as the seats. Normalized
    // here, at the service boundary, so every caller gets the same defaults; the
    // hash write below takes the normalized object only.
    rules: Partial<RoomRules> = {},
  ) {
    if (playerCount < 2 || playerCount > 4) {
      throw new BadRequestException({
        code: 'MATCH_PLAYER_COUNT_RANGE',
        message: 'Player count must be between 2 and 4',
      });
    }
    if (botCount < 0 || botCount >= playerCount) {
      throw new BadRequestException({
        code: 'MATCH_BOT_COUNT_RANGE',
        message: 'Bot count must be between 0 and playerCount - 1',
      });
    }
    if (mode === 'pvp' && botCount > 0) {
      throw new BadRequestException({
        code: 'MATCH_PVP_NO_BOTS',
        message: 'PvP mode cannot have bots',
      });
    }
    if (mode === 'pve' && botCount === 0) {
      throw new BadRequestException({
        code: 'MATCH_PVE_NEEDS_BOT',
        message: 'PvE mode must have at least 1 bot',
      });
    }
    if (mode === 'hotseat' && botCount > 0) {
      throw new BadRequestException({
        code: 'MATCH_HOTSEAT_NO_BOTS',
        message: 'Hot seat mode cannot have bots',
      });
    }
    if (mode === 'pvp' && playerCount < 2) {
      throw new BadRequestException({
        code: 'MATCH_PVP_MIN_PLAYERS',
        message: 'PvP mode requires at least 2 players',
      });
    }

    const roomRules = normalizeRoomRules(rules);
    return this.withUserCreateLock(userId, () =>
      this.createMatchLocked(
        userId,
        mode,
        playerCount,
        botCount,
        botColors,
        botNames,
        seatColors,
        hostColor,
        roomRules,
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
      // findReusableRoom will then find their new room and we return that instead.
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
    botNames?: string[],
    seatColors?: string[],
    // The host's picked corner; refused below when absent, never defaulted.
    hostColor?: string,
    // Always the NORMALIZED rules, never raw wire values: this is the path that
    // writes Redis. The default keeps a caller that has none on the standard room
    // (the public entry point normalizes, so it always passes one).
    rules: RoomRules = normalizeRoomRules(),
    // A guest mint passes its opaque engine token here. Its presence marks the
    // anonymous path: no account lookups, no live-game scan. The hashed address
    // lets the engine release the concurrency slot when the game ends.
    opts: { guestToken?: string; guestIpHash?: string } = {},
  ) {
    // Strict lock: a caller already in a live game must not open a second room,
    // whatever the mode. Checked before the PvP reuse below. Guests skip it: their
    // per-mint id can never match, and the scan would be wasted work.
    if (!opts.guestToken && (await findLiveMatch(this.redis, userId))) {
      throw new ForbiddenException({
        code: 'MATCH_ACTIVE_GAME',
        message:
          'You already have an active game. Leave it before creating or joining a new match.',
      });
    }

    // Idempotent create: a PvP create by a player who already has a seat in one
    // of their own PvP lobby rooms returns that seat instead of opening a second
    // room. Rooms whose game has already started are never reused.
    if (mode === 'pvp') {
      const reusable = await this.findReusableRoom(userId);
      if (reusable) return this.handoffExistingRoom(reusable, userId);
    }

    const gameId = crypto.randomUUID();
    const totalBots = botCount;
    const isPvP = mode === 'pvp';

    // Slot→color mapping is fixed by index (0=blue,1=red,2=green,3=yellow): the
    // slot is the colour's own address in the hash, and a participant is written at
    // the slot of the colour they hold. It is never used to derive a colour back.
    const colorSlot = new Map<string, number>(SLOT_COLORS.map((c, i) => [c, i + 1]));
    // The host picks first, so their seat is their colour's seat: slot 1 is no longer
    // "the host slot", it is blue's slot, and the host lands wherever their pick is.
    // No fallback: a create without a colour is refused here, before anything is written.
    if (!hostColor || !colorSlot.has(hostColor)) {
      throw new BadRequestException({
        code: 'MATCH_INVALID_COLOR',
        message: `hostColor is required and must be one of ${SLOT_COLORS.join(', ')}`,
      });
    }
    const hostSlot = colorSlot.get(hostColor)!;

    const updates: Record<string, string> = {
      id: gameId,
      status: isPvP ? 'WAITING' : 'ACTIVE',
      gameType: mode.toUpperCase(),
      playerCount: playerCount.toString(),
      // The host is its own field: the seat they occupy is their colour's slot, so
      // `player1_id` can no longer stand in for "who created this room".
      hostId: userId,
      [`player${hostSlot}_id`]: userId,
      [`player${hostSlot}_color`]: hostColor,
      createdAt: Date.now().toString(),
    };

    // Persist the exact seat order so the engine creates matching colors :
    // hotseat can skip seats (e.g. blue + green + yellow, no red), and the order is
    // the rotation order. A caller with no explicit order gets the host's corner
    // first, then the free corners in canonical order.
    const resolvedSeatColors =
      Array.isArray(seatColors) && seatColors.length > 0
        ? seatColors
        : [hostColor, ...SLOT_COLORS.filter((c) => c !== hostColor)].slice(0, playerCount);
    if (resolvedSeatColors.length !== playerCount) {
      throw new BadRequestException({
        code: 'MATCH_SEAT_COLORS_LENGTH',
        message: 'seatColors must have exactly playerCount entries',
      });
    }
    for (const c of resolvedSeatColors) {
      if (!colorSlot.has(c)) {
        throw new BadRequestException(`Invalid seat color: ${c}`);
      }
    }
    // The palette cannot produce a duplicate, but the route can be called directly,
    // and two seats on one colour would collide on the same hash slot.
    if (new Set(resolvedSeatColors).size !== resolvedSeatColors.length) {
      throw new BadRequestException({
        code: 'MATCH_DUPLICATE_COLOR',
        message: 'Each seat must have its own color',
      });
    }
    // The engine builds its seats from this list, so a host colour missing from it
    // would seat the host nowhere.
    if (!isPvP && !resolvedSeatColors.includes(hostColor)) {
      throw new BadRequestException({
        code: 'MATCH_INVALID_COLOR',
        message: 'seatColors must include the host color',
      });
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
        throw new BadRequestException({
          code: 'MATCH_BOT_COLORS',
          message: 'botColors must match botCount',
        });
      }
      for (const [index, color] of assignedBotColors.entries()) {
        const slot = colorSlot.get(color);
        // A bot may hold any corner, blue included: the host no longer owns it by
        // construction. What a bot may not do is share one.
        if (!slot) {
          throw new BadRequestException(`Invalid bot color: ${color}`);
        }
        if (color === hostColor || assignedBotColors.indexOf(color) !== index) {
          throw new BadRequestException({
            code: 'MATCH_DUPLICATE_COLOR',
            message: 'Each seat must have its own color',
          });
        }
        updates[`player${slot}_id`] = BOT_PREFIX + color;
        updates[`player${slot}_color`] = color;
        // The seat says what it is. The `bot-` id stays the seat's identity (a bot
        // has no User row, so nothing reads it back through the database), but
        // every reader of a *seat* answers from this flag: the engine's join path,
        // the bot scheduler, the rejoin path and the post-game report. Nothing
        // tests the id's shape, so a room without the flag seats no bot.
        updates[`player${slot}_isBot`] = 'true';
        // Display label only: the bot's identity stays `bot-<color>`. `botNames`
        // is index-aligned with `botColors`, so it carries the name the lobby
        // assigned each seat. A blank or missing name leaves the key out.
        const botName = botLabel(color, botNames?.[index]);
        if (botName) updates[`player${slot}_displayName`] = botName;
      }
    }

    // The room rules, written by the same hset as the seats, so a room never
    // exists without them. Keys and defaults live in room-rules.ts; the engine
    // freezes them at join, and the lobby may change them only while WAITING.
    Object.assign(updates, roomRuleHashFields(rules));

    if (opts.guestToken) {
      // Read by the engine's ResultSubmitter and notifyGameStarted: a guest
      // room never reaches /api/game/*. The address is stored hashed, like the
      // counters, so a Redis dump holds no addresses.
      updates.isGuest = 'true';
      if (opts.guestIpHash) updates.guestIpHash = opts.guestIpHash;
    }

    await this.redis.hset(`match:${gameId}`, updates);
    await this.redis.expire(`match:${gameId}`, 86400);
    // A new room is a lobby change; best effort, the broadcaster's tick repairs a
    // missed publish.
    await publishRoomsChanged(this.redis);

    // A guest gets the opaque token minted for it: no JWT, no account lookups
    // (a `guest-` id has no user row), and the engine resolves it from the
    // registry in Redis instead of verifying a signature.
    let token: string;
    if (opts.guestToken) {
      token = opts.guestToken;
    } else {
      const username = await this.resolveUsername(userId);
      const displayName = await this.resolveDisplayName(userId);
      token = signEngineToken(this.jwt, {
        gameId,
        playerId: userId,
        username: username ?? undefined,
        displayName,
        role: 'player1',
        mode,
        color: hostColor,
      });
    }

    // mode + playerCount are required: the frontend persists activeMatch for
    // refresh/reconnect and branches on mode. Without them a refresh makes
    // hotseat/PvE rejoin as a generic PvP seat.
    const result: MatchRoomHandoff = {
      gameId,
      token,
      engineUrl: ENGINE_WS_URL,
      color: hostColor,
      mode,
      playerCount,
      rules,
    };
    if (isPvP) {
      result.inviteCode = updates.inviteCode;
    }
    return result;
  }

  // The caller's own PvP lobby room, if they still have one: seated, hash still
  // WAITING, engine game not started, and the caller's seat not finalized. Left
  // untouched (the caller is handed their existing seat instead).
  private async findReusableRoom(userId: string): Promise<Record<string, string> | null> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
      cursor = nextCursor;
      for (const key of keys) {
        const data = await this.redis.hgetall(key);
        if (data.status !== 'WAITING' || data.gameType !== 'PVP') continue;
        const seatIds = [data.player1_id, data.player2_id, data.player3_id, data.player4_id];
        const slotIndex = seatIds.indexOf(userId);
        if (slotIndex === -1) continue;
        // A game the engine has already started is not a lobby any more.
        if (await isEngineGameStarted(this.redis, data.id)) continue;
        // Nor is a seat the engine finalized: the player is out of that game.
        const color = data[`player${slotIndex + 1}_color`] || SLOT_COLORS[slotIndex];
        if (await isSeatFinalized(this.redis, data.id, color)) continue;
        return data;
      }
    } while (cursor !== '0');
    return null;
  }

  // Returns the caller's existing seat in a reused room. Writes nothing to the
  // room hash, because updating status/createdAt/inviteCode here is what used to
  // demote a live ACTIVE room back to WAITING.
  private async handoffExistingRoom(
    data: Record<string, string>,
    userId: string,
  ): Promise<MatchRoomHandoff> {
    const gameId = data.id;
    const slotIndex = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].indexOf(
      userId,
    );
    const color = data[`player${slotIndex + 1}_color`] || SLOT_COLORS[slotIndex];
    // Reclaiming the seat clears the reservation flag a "returned to lobby" leave
    // set, so the room counts this player again.
    await this.redis.hdel(`match:${gameId}`, `player${slotIndex + 1}_left`);
    await publishRoomsChanged(this.redis);

    const mode = (data.gameType || 'PVP').toLowerCase();
    const username = await this.resolveUsername(userId);
    const displayName = await this.resolveDisplayName(userId);
    const token = signEngineToken(this.jwt, {
      gameId,
      playerId: userId,
      username: username ?? undefined,
      displayName,
      role: slotIndex === 0 ? 'player1' : 'player',
      color,
      mode,
    });

    return {
      gameId,
      token,
      engineUrl: ENGINE_WS_URL,
      color,
      mode,
      playerCount: parseInt(data.playerCount || '4', 10),
      inviteCode: data.inviteCode || undefined,
      // The room is reused, so its rules are whatever the hash already holds: the
      // client must not assume the ones it just asked for.
      rules: readRoomRules(data),
    };
  }

  // Create a PvP room and return its invite code (alias for createMatch). The room
  // browser asks the host for a corner first: the other three stay free for joiners.
  async createInvite(userId: string, rules: Partial<RoomRules> | undefined, hostColor?: string) {
    // The three `undefined`s are botColors/botNames/seatColors: a PvP room has no
    // bots and takes the dense default seat order.
    const result = await this.createMatch(
      userId,
      'pvp',
      4,
      0,
      undefined,
      undefined,
      undefined,
      hostColor,
      rules,
    );
    return result;
  }

  // Create a PvE match with the specified number of bot opponents. The caller
  // supplies the host's corner; bot colours are dealt below it.
  async playBot(userId: string, playerCount: number, hostColor?: string) {
    if (playerCount !== 2 && playerCount !== 4) {
      throw new BadRequestException({
        code: 'MATCH_PLAYER_COUNT_2_4',
        message: 'Player count must be 2 or 4',
      });
    }
    const botCount = playerCount - 1;
    return this.createMatch(userId, 'pve', playerCount, botCount, undefined, undefined, undefined, hostColor);
  }

  // The guest door: an anonymous, ephemeral PvE room. Not createMatch(): mode is
  // forced, account steps are skipped, and the budgets are charged here. `ip` keys
  // the counters only and is hashed before Redis (trust-proxy is set in main.ts).
  async createGuestMatch(ip: string, dto: CreateGuestMatchDto): Promise<MatchRoomHandoff> {
    const botCount = dto.botCount;
    const playerCount = 1 + botCount;

    // Gate + reserve. Throws GUEST_LIMITED / GUEST_CAPACITY before any key is
    // written; past the soft limit the caller has already waited here.
    await this.guests.acquire(ip);

    const token = mintGuestToken();
    const guestId = guestUserId(token);

    let result: MatchRoomHandoff;
    try {
      // Seat order: the guest's picked corner plus the bot colours in setup order, so
      // a sparse layout is dealt as-is. A botColors/botCount mismatch stays undefined
      // for createMatchLocked to report.
      const hostColor = dto.hostColor;
      const seatColors =
        dto.botColors?.length === botCount ? [hostColor, ...dto.botColors] : undefined;
      result = await this.createMatchLocked(
        guestId,
        'pve',
        playerCount,
        botCount,
        dto.botColors,
        dto.botNames,
        seatColors,
        hostColor,
        normalizeRoomRules(dto),
        { guestToken: token, guestIpHash: guestIpHash(ip) },
      );
    } catch (error) {
      // Nothing was allocated: give the reserved slots back so a rejected
      // payload costs the address no budget.
      await this.guests.release(ip);
      throw error;
    }

    await this.guests.recordMint(ip);
    // The registry the engine's handshake resolves, written only after the room
    // exists. Holds the room, seat, mode and address that keys the abort counter.
    const entry = guestTokenKey(token);
    await this.redis.hset(entry, {
      gameId: result.gameId,
      color: result.color,
      mode: result.mode,
      ip,
    });
    await this.redis.expire(entry, GUEST_TOKEN_TTL_S);

    return { ...result, isGuest: true };
  }

  // Join a PvP room by its 6-character invite code. The claimed `color` rides the
  // joiner closure below, because the seat is written by MatchPlayerService.
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
          // The host is its own field: their seat is their colour's slot, which is
          // not always slot 1.
          if (data.hostId === userId) {
            throw new BadRequestException({
              code: 'MATCH_OWN_INVITE',
              message: 'You cannot join your own invite',
            });
          }
          return joiner(data.id, userId);
        }
      }
    } while (cursor !== '0');
    throw new NotFoundException({
      code: 'MATCH_INVITE_INVALID',
      message: 'Invite code not found or expired',
    });
  }

  // The caller's account name for an engine token. A lookup, not a bot test: these
  // run for the authenticated seat owner (or a friend joining by id), never for a
  // seat read back out of the hash, so a bot id cannot arrive here.
  private async resolveUsername(userId: string): Promise<string | null> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });
    return user?.username ?? null;
  }

  private async resolveDisplayName(userId: string): Promise<string | undefined> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    return user?.displayName ?? undefined;
  }
}
