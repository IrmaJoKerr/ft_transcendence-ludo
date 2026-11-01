import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import type { GameState, PlayerColor, Piece, PlayerMeta, ClashState } from './types';
import { STARTING_BUSTER_TOKENS } from './types';

const COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

// --- Guest counters: mirrored from backend/src/match/guest-limit.service.ts ---
// The engine writes counts and decides no limit: the backend reads them at mint
// time. The key shape, counter names and window are shared by both copies.
const GUEST_ABORT_WINDOW_S = 6 * 60 * 60;
const GUEST_ROOMS_LIVE = 'guest:rooms:live';

function guestHashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

function guestCounter(kind: 'abort' | 'live', ipHash: string): string {
  return `guest:${kind}:${ipHash}`;
}

// Clamp at zero: the backend rolls a reservation back when a create fails, and
// that can race this decrement.
const GUEST_DROP_SLOT = `
local left = redis.call('DECR', KEYS[1])
if left <= 0 then
  redis.call('DEL', KEYS[1])
  return 0
end
return left
`;

// --- Lobby invalidation: mirrored from backend/src/common/channels.ts ---
// Every write to a match:* hash below can change the lobby list or somebody's
// rejoin banner, so it publishes here. The backend's broadcaster answers by
// re-reading one snapshot and diffing it per viewer, so the message carries no
// payload; a missed publish is repaired by its 30 s tick.
const ROOMS_CHANGED_CHANNEL = 'rooms:changed';

// A live room survives a redeploy, so a state written before the Wall Breaker
// fields existed can load mid-game. Both fields feed arithmetic, where undefined
// becomes NaN, so normalize them here, at the only read path. Zero means no token.
// One legacy-state default: a game state written before the key-shift mutator
// existed has no count at all, and the engine must read it as the standard room
// rather than an undefined that silently compares unequal to every schedule.
function withBarrierDefaults(state: GameState): GameState {
  for (const player of state.players) {
    if (player.barrierTokens === undefined) player.barrierTokens = 0;
    if (player.stats.barrierBreaks === undefined) player.stats.barrierBreaks = 0;
  }
  if (state.clashKeyShift !== 1 && state.clashKeyShift !== 2) state.clashKeyShift = 0;
  return state;
}

// RedisGameStore is a PERSISTENCE LAYER: one serialized GameState per game
// in Redis. Logic mutates in memory first, then persists here.
export class RedisGameStore {
  private client: Redis;
  public subscriber: Redis;

  constructor(redisUrl?: string) {
    const host = process.env.REDIS_HOST || 'redis';
    const port = parseInt(process.env.REDIS_PORT || '6479', 10);
    const password = process.env.REDIS_PASSWORD;

    this.client = redisUrl
      ? new Redis(redisUrl)
      : new Redis({
          host,
          port,
          password,
          retryStrategy: (t) => Math.min(t * 50, 2000),
          lazyConnect: true,
        });
    this.subscriber = this.client.duplicate();
  }

  async connect(): Promise<void> {
    await this.client.connect();
    await this.subscriber.connect();
  }

  async disconnect(): Promise<void> {
    await this.client.quit();
    await this.subscriber.quit();
  }

  // The wake trigger for a Redis reconnect: a container rebuild resets in-memory
  // timers, while durable deadlines survive, so the engine replays them. The boot
  // connection is not covered: the caller runs the first wake pass after connect().
  onReady(handler: () => void): void {
    this.client.on('ready', handler);
  }

  // The avatar fact the backend caches in Redis. The engine has no database
  // access, so this is how a seat learns whether its player has a photo. A miss
  // means has=false: reading it as maybe would 404 on every render.
  async getAvatarMeta(userId: string): Promise<{ has: boolean; style?: string } | null> {
    if (!userId) return null;
    const data = await this.client.hgetall(`avatar:${userId}`);
    if (data?.has === undefined) return null;
    return { has: data.has === '1', style: data.style || undefined };
  }

  // Create a new game, all 16 pieces in prison. Only `activeColors` seats get
  // PlayerMeta entries. The three room rules are frozen here: clash off, free exit
  // off, stars protecting. The lobby can change them only while WAITING.
  async createGame(
    gameId: string,
    clashMode = false,
    activeColors: PlayerColor[] = COLORS,
    noSafeZones = false,
    freeExit = false,
    // Sixth rule, last so every existing positional call keeps its meaning: the
    // key-shift mutator's switch count for this room.
    clashKeyShift: 0 | 1 | 2 = 0,
  ): Promise<void> {
    const pieces: Piece[] = [];
    for (const color of COLORS) {
      for (let i = 0; i < 4; i++) {
        pieces.push({ id: `${color}-${i}`, color, step: 0, isInGoal: false, isInBase: true });
      }
    }

    const players: PlayerMeta[] = activeColors.map((color) => ({
      color,
      status: 'inactive',
      username: color === 'blue' ? 'You' : color.charAt(0).toUpperCase() + color.slice(1),
      isBot: false,
      isConnected: false,
      hasAvatarPhoto: false,
      piecesInGoal: 0,
      hasRolled: false,
      consecutiveSixes: 0,
      bonusRoll: false,
      isFinished: false,
      // One Wall Breaker token is dealt at game start: it buys the prison exit's
      // landing on a barrier the roll reaches exactly. A clash won against a single
      // defender pays one back, up to BARRIER_BUSTER_TOKEN_CAP (clash-engine.ts).
      barrierTokens: STARTING_BUSTER_TOKENS,
      stats: {
        turns: 0,
        captures: 0,
        piecesInGoal: 0,
        clashDefends: 0,
        clashAttacksWon: 0,
        barrierBreaks: 0,
      },
    }));

    const state: GameState = {
      id: gameId,
      pieces,
      players,
      currentTurn: activeColors[0] ?? 'blue',
      consecutiveSixes: 0,
      moveCounter: 0,
      turnPhase: 'WAITING_FOR_ROLL',
      firstRollOfTurn: true,
      pendingLegalMoves: [],
      disconnectedPlayers: [],
      status: 'waiting',
      readyPlayers: [],
      clashMode,
      noSafeZones,
      freeExit,
      clashKeyShift,
    };

    await this.saveGameState(gameId, state);
  }

  // Load the entire GameState from Redis (single operation)
  async loadGameState(gameId: string): Promise<GameState | null> {
    const data = await this.client.hget(this.gameKey(gameId), 'state');
    if (!data) return null;
    return withBarrierDefaults(JSON.parse(data) as GameState);
  }

  // Save the entire GameState to Redis (single operation)
  async saveGameState(gameId: string, state: GameState): Promise<void> {
    await this.client.hset(this.gameKey(gameId), 'state', JSON.stringify(state));
    await this.client.expire(this.gameKey(gameId), 86400);
  }

  // Publish state change to all subscribers
  async publish(gameId: string, message: string): Promise<void> {
    await this.client.publish(`game:${gameId}`, message);
  }

  // The live clash QTE, embedded in the game state so a restart replays it (the
  // deadlines inside are absolute timestamps).
  async loadClashState(gameId: string): Promise<ClashState | null> {
    const state = await this.loadGameState(gameId);
    return state?.clash ?? null;
  }

  // Persist an active clash (phase deadlines) into the game state.
  async saveClashState(gameId: string, clash: ClashState): Promise<void> {
    const state = await this.loadGameState(gameId);
    if (!state) return;

    state.clash = clash;
    await this.saveGameState(gameId, state);
  }

  // Count a press for the attacker/defender side; returns that side's new total.
  async recordClashPress(gameId: string, color: PlayerColor, count = 1): Promise<number> {
    const state = await this.loadGameState(gameId);
    if (!state?.clash) return 0;

    const isAttacker = state.clash.attacker === color;
    if (isAttacker) {
      state.clash.attackerPresses += count;
    } else {
      state.clash.defenderPresses += count;
    }
    state.clash.lastPressAt = state.clash.lastPressAt || {};
    state.clash.lastPressAt[color] = Date.now();
    await this.saveGameState(gameId, state);
    return isAttacker ? state.clash.attackerPresses : state.clash.defenderPresses;
  }

  // Get the match metadata hash (for lobby/color selection)
  async getMatchData(gameId: string): Promise<Record<string, string> | null> {
    const data = await this.client.hgetall(this.matchKey(gameId));
    return Object.keys(data).length > 0 ? data : null;
  }

  // Announce a match:* write to the backend's broadcaster. Best effort: the
  // lobby is derived state, and a failed publish must never fail the move or the
  // join that caused it (the broadcaster's repair tick covers the gap).
  private async notifyRoomsChanged(): Promise<void> {
    try {
      await this.client.publish(ROOMS_CHANGED_CHANNEL, '1');
    } catch (error) {
      console.error('Failed to publish rooms:changed:', error);
    }
  }

  // Update specific fields in the match metadata hash
  async updateMatchData(gameId: string, fields: Record<string, string>): Promise<void> {
    await this.client.hmset(this.matchKey(gameId), fields);
    await this.notifyRoomsChanged();
  }

  // SCAN all match metadata hashes.
  async scanMatchKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', 'match:*', 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  // SCAN all game state hashes.
  async scanGameKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.client.scan(cursor, 'MATCH', 'game:*', 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }

  // Stamp the moment a room became idle (< 2 seated), without overwriting an
  // existing stamp. Returns the effective stamp, so the caller can arm its local
  // timer for the remainder of the window instead of restarting it.
  async setIdleSince(gameId: string, now: number): Promise<number> {
    const written = await this.client.hsetnx(this.matchKey(gameId), 'idleSince', now.toString());
    if (written === 1) {
      await this.notifyRoomsChanged();
      return now;
    }
    const existing = await this.client.hget(this.matchKey(gameId), 'idleSince');
    return existing ? parseInt(existing, 10) : now;
  }

  // Clear the idle stamp (room has ≥ 2 seated players again).
  async clearIdleSince(gameId: string): Promise<void> {
    await this.client.hdel(this.matchKey(gameId), 'idleSince');
    await this.notifyRoomsChanged();
  }

  // Who played a colour, used for the end-of-game result
  private seatUserField(color: PlayerColor): string {
    return `seatUser_${color}`;
  }

  async setSeatUser(gameId: string, color: PlayerColor, userId: string): Promise<void> {
    await this.client.hset(this.matchKey(gameId), this.seatUserField(color), userId);
    await this.notifyRoomsChanged();
  }

  async clearSeatUser(gameId: string, color: PlayerColor): Promise<void> {
    await this.client.hdel(this.matchKey(gameId), this.seatUserField(color));
    await this.notifyRoomsChanged();
  }

  seatUserFrom(matchData: Record<string, string> | null, color: PlayerColor): string | undefined {
    return matchData?.[this.seatUserField(color)];
  }

  // FREE a non-host seat on abort: delete the slot from the match hash so the room
  // can hand it to someone else. The host seat is never cleared.
  async clearMatchSeat(gameId: string, color: PlayerColor): Promise<void> {
    const data = await this.getMatchData(gameId);
    if (!data) return;
    if (data.player1_color === color) return; // never clear the host's seat

    const slotIndex = COLORS.indexOf(color);
    if (slotIndex <= 0) return; // unknown color or host slot
    await this.client.hdel(
      this.matchKey(gameId),
      `player${slotIndex + 1}_id`,
      `player${slotIndex + 1}_color`,
      `player${slotIndex + 1}_left`,
      // The seat's kind goes with its identity: a slot that is reused must not
      // inherit "this is a bot" from the occupant it had before.
      `player${slotIndex + 1}_isBot`,
      this.seatUserField(color),
    );
    await this.notifyRoomsChanged();
    await this.setIdleSince(gameId, Date.now());
  }

  // RESERVE a non-host seat when a player leaves without aborting: keep the id and
  // colour so a rejoin returns to the same seat, and set `player<N>_left` so the
  // seat is not counted as seated.
  async reserveMatchSeat(gameId: string, color: PlayerColor): Promise<void> {
    const data = await this.getMatchData(gameId);
    if (!data) return;
    if (data.player1_color === color) return; // host keeps a live seat
    const slotIndex = COLORS.indexOf(color);
    if (slotIndex <= 0) return; // unknown colour or host slot
    await this.client.hset(this.matchKey(gameId), `player${slotIndex + 1}_left`, '1');
    await this.notifyRoomsChanged();
    await this.setIdleSince(gameId, Date.now());
  }

  // Mark a match ABORTED with a short TTL so it drops out of open-room listings.
  async abortMatch(gameId: string): Promise<void> {
    await this.client.hset(this.matchKey(gameId), 'status', 'ABORTED');
    await this.client.expire(this.matchKey(gameId), 3600);
    await this.notifyRoomsChanged();
  }

  // Delete the engine-side game state for a match.
  async deleteGame(gameId: string): Promise<void> {
    await this.client.del(this.gameKey(gameId));
  }

  // Resolve a guest handshake token. The backend's record is the authority for the
  // room, seat and mode; nothing comes from the client. Unknown, expired or
  // malformed records are refused, as is any mode other than pve.
  async getGuestSession(token: string): Promise<{
    userId: string;
    gameId: string;
    color: PlayerColor;
    ipHash: string;
    tokenHash: string;
  } | null> {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const data = await this.client.hgetall(`guesttok:${tokenHash}`);
    if (!data.gameId || !data.color || data.mode !== 'pve') return null;
    if (!COLORS.includes(data.color as PlayerColor)) return null;

    return {
      // The same per-mint id the backend seated: unique, so the per-account
      // socket cap and every seat lookup behave normally.
      userId: `guest-${tokenHash}`,
      gameId: data.gameId,
      color: data.color as PlayerColor,
      // The abort counter is keyed by the hashed address, exactly as the
      // backend keys the mint budget.
      ipHash: data.ip ? guestHashIp(data.ip) : '',
      tokenHash,
    };
  }

  // Price one guest abort against the address (the backend weights it at mint
  // time) and give its slots back.
  async settleGuestAbort(ipHash: string): Promise<void> {
    if (!ipHash) return;
    const key = guestCounter('abort', ipHash);
    const aborts = await this.client.incr(key);
    if (aborts === 1) await this.client.expire(key, GUEST_ABORT_WINDOW_S);
    await this.releaseGuestRoom(ipHash);
  }

  // The room is over (an abort, or a game that finished): free the address's
  // concurrency slot and the global live-room slot. Both counters self-heal by
  // TTL, so a missed call cannot wedge an address forever.
  async releaseGuestRoom(ipHash: string): Promise<void> {
    if (!ipHash) return;
    await this.client.eval(GUEST_DROP_SLOT, 1, guestCounter('live', ipHash));
    await this.client.eval(GUEST_DROP_SLOT, 1, GUEST_ROOMS_LIVE);
  }

  // Revocation is a DEL. Capabilities are already bound to the connected
  // socket, so this only stops the next handshake.
  async revokeGuestToken(tokenHash: string): Promise<void> {
    if (!tokenHash) return;
    await this.client.del(`guesttok:${tokenHash}`);
  }

  private matchKey(gameId: string): string {
    return `match:${gameId}`;
  }
  private gameKey(gameId: string): string {
    return `game:${gameId}`;
  }
}
