import Redis from 'ioredis';
import type { GameState, PlayerColor, PieceId, Piece, PlayerMeta, ClashState } from './types';

const COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

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

  // The avatar fact the backend caches in Redis. The engine has no database
  // access, so this is how a seat learns whether its player has a photo. A miss
  // means has=false: reading it as maybe would 404 on every render.
  async getAvatarMeta(userId: string): Promise<{ has: boolean; style?: string } | null> {
    if (!userId) return null;
    const data = await this.client.hgetall(`avatar:${userId}`);
    if (!data || data.has === undefined) return null;
    return { has: data.has === '1', style: data.style || undefined };
  }

  // Create a new game, all 16 pieces in prison. Only `activeColors` seats
  // get PlayerMeta entries, so unused seats never appear downstream.
  async createGame(
    gameId: string,
    clashMode: boolean = false,
    activeColors: PlayerColor[] = COLORS,
    safeZones: boolean = true,
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
      stats: { turns: 0, captures: 0, piecesInGoal: 0, clashDefends: 0, clashAttacksWon: 0 },
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
      clashMode, // host's lobby toggle (match hash clashEnabled)
      safeZones, // host's lobby toggle (match hash safeZones)
      readyPlayers: [],
    };

    await this.saveGameState(gameId, state);
  }

  // Load the entire GameState from Redis (single operation)
  async loadGameState(gameId: string): Promise<GameState | null> {
    const data = await this.client.hget(this.gameKey(gameId), 'state');
    if (!data) return null;
    return JSON.parse(data) as GameState;
  }

  // Save the entire GameState to Redis (single operation)
  async saveGameState(gameId: string, state: GameState): Promise<void> {
    await this.client.hset(this.gameKey(gameId), 'state', JSON.stringify(state));
    await this.client.expire(this.gameKey(gameId), 86400);
  }

  // Move history (separate, not part of main state)
  async recordMove(
    gameId: string,
    move: {
      ply: number;
      color: PlayerColor;
      diceValue: number;
      pieceId: PieceId;
      from: number;
      to: number;
      captured: boolean;
      enteredHome: boolean;
      timestamp: number;
    },
  ): Promise<void> {
    await this.client.lpush(this.movesKey(gameId), JSON.stringify(move));
    await this.client.ltrim(this.movesKey(gameId), 0, 199);
  }

  // Publish state change to all subscribers
  async publish(gameId: string, message: string): Promise<void> {
    await this.client.publish(`game:${gameId}`, message);
  }

  // Get the live clash (if any) embedded in the game state.
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

  // Remove the clash from the game state (resolved or aborted).
  async clearClashState(gameId: string): Promise<void> {
    const state = await this.loadGameState(gameId);
    if (!state) return;

    delete state.clash;
    await this.saveGameState(gameId, state);
  }

  // Count a press for the attacker/defender side; returns the side's new total.
  async recordClashPress(gameId: string, color: PlayerColor): Promise<number> {
    const state = await this.loadGameState(gameId);
    if (!state?.clash) return 0;

    const isAttacker = state.clash.attacker === color;
    if (isAttacker) {
      state.clash.attackerPresses++;
    } else {
      state.clash.defenderPresses++;
    }
    state.clash.lastPressAt = state.clash.lastPressAt || {};
    state.clash.lastPressAt[color] = Date.now();
    await this.saveGameState(gameId, state);
    return isAttacker ? state.clash.attackerPresses : state.clash.defenderPresses;
  }

  // SCAN all engine game-state keys (used by the clash recovery sweep).
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

  // Get the match metadata hash (for lobby/color selection)
  async getMatchData(gameId: string): Promise<Record<string, string> | null> {
    const data = await this.client.hgetall(this.matchKey(gameId));
    return Object.keys(data).length > 0 ? data : null;
  }

  // Update specific fields in the match metadata hash
  async updateMatchData(gameId: string, fields: Record<string, string>): Promise<void> {
    await this.client.hmset(this.matchKey(gameId), fields);
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

  // Stamp the moment a room became idle (< 2 seated), without overwriting an existing stamp.
  async setIdleSince(gameId: string, now: number): Promise<void> {
    await this.client.hsetnx(this.matchKey(gameId), 'idleSince', now.toString());
  }

  // Clear the idle stamp (room has ≥ 2 seated players again).
  async clearIdleSince(gameId: string): Promise<void> {
    await this.client.hdel(this.matchKey(gameId), 'idleSince');
  }

  // FREE a non-host seat on abort: delete the slot from the match hash so the room
  // can hand it to someone else. The host seat is never cleared.
  // See docs/ludo-engine/ludo-engine-lobby-module.md (Seat reserve and free).
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
    );
    await this.setIdleSince(gameId, Date.now());
  }

  // RESERVE a non-host seat when a player leaves without aborting: keep the id and
  // colour so a rejoin returns to the same seat, and set `player<N>_left` so the
  // seat is not counted as seated. See docs/ludo-engine/ludo-engine-lobby-module.md.
  async reserveMatchSeat(gameId: string, color: PlayerColor): Promise<void> {
    const data = await this.getMatchData(gameId);
    if (!data) return;
    if (data.player1_color === color) return; // host keeps a live seat
    const slotIndex = COLORS.indexOf(color);
    if (slotIndex <= 0) return; // unknown colour or host slot
    await this.client.hset(this.matchKey(gameId), `player${slotIndex + 1}_left`, '1');
    await this.setIdleSince(gameId, Date.now());
  }

  // Mark a match ABORTED with a short TTL so it drops out of open-room listings.
  async abortMatch(gameId: string): Promise<void> {
    await this.client.hset(this.matchKey(gameId), 'status', 'ABORTED');
    await this.client.expire(this.matchKey(gameId), 3600);
  }

  // Delete the engine-side game state/moves for a match.
  async deleteGame(gameId: string): Promise<void> {
    await this.client.del(this.gameKey(gameId), this.movesKey(gameId));
  }

  private matchKey(gameId: string): string {
    return `match:${gameId}`;
  }
  private gameKey(gameId: string): string {
    return `game:${gameId}`;
  }
  private movesKey(gameId: string): string {
    return `game:${gameId}:moves`;
  }
}
