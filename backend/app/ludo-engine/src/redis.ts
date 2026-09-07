import Redis from 'ioredis';
import type { GameState, PlayerColor, PieceId, Piece, PlayerMeta, ClashState } from './types';

const COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

// Storage TTLs (seconds): the game-state hash expires 24h after its last save,
// and an aborted match drops out of open-room listings after 1h.
const GAME_STATE_TTL_SECONDS = 86400; // 24h
const ABORTED_MATCH_TTL_SECONDS = 3600; // 1h

/**
 * RedisGameStore is a PERSISTENCE LAYER.
 * All game state is stored as a single serialized GameState object.
 * Game logic operates on in-memory GameState first, then persists.
 */
export class RedisGameStore {
  private client: Redis;
  public subscriber: Redis;

  constructor(redisUrl?: string) {
    const host = process.env.REDIS_HOST || 'redis';
    const port = parseInt(process.env.REDIS_PORT || '6479', 10);
    const password = process.env.REDIS_PASSWORD;

    this.client = redisUrl
      ? new Redis(redisUrl)
      : new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000), lazyConnect: true });
    this.subscriber = this.client.duplicate();
  }

  /** Open both Redis connections (game store + pub/sub subscriber). */
  async connect(): Promise<void> {
    await this.client.connect();
    await this.subscriber.connect();
  }

  /** Close both Redis connections. */
  async disconnect(): Promise<void> {
    await this.client.quit();
    await this.subscriber.quit();
  }

  /** Create a new game with all 16 pieces in prison. `activeColors` are the
   * seats actually in play for this match size : colors outside that set get
   * no PlayerMeta entry at all, so unused seats never appear anywhere
   * downstream (sidebar, color picker, turn order). */
  async createGame(gameId: string, clashMode: boolean = true, activeColors: PlayerColor[] = COLORS, safeZones: boolean = true): Promise<void> {
    // All 16 pieces start in prison (step 0) : 4 per color.
    const pieces: Piece[] = [];
    for (const color of COLORS) {
      for (let i = 0; i < 4; i++) {
        pieces.push({ id: `${color}-${i}`, color, step: 0, isInGoal: false, isInBase: true });
      }
    }

    // One PlayerMeta per seat actually in play; unused seats get no entry.
    const players: PlayerMeta[] = activeColors.map(color => ({
      color,
      status: 'inactive',
      username: color === 'blue' ? 'You' : color.charAt(0).toUpperCase() + color.slice(1),
      isBot: false,
      isConnected: false,
      piecesInGoal: 0,
      hasRolled: false,
      consecutiveSixes: 0,
      bonusRoll: false,
      isFinished: false,
      stats: { turns: 0, captures: 0, piecesInGoal: 0, clashDefends: 0, clashAttacksWon: 0 }
    }));
    
    // Fresh waiting-room state: blue leads turn order until a real player joins.
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
      clashMode,
      safeZones,
      readyPlayers: [],
    };
    
    await this.saveGameState(gameId, state);
  }

  /** Load the entire GameState from Redis (single operation) */
  async loadGameState(gameId: string): Promise<GameState | null> {
    const data = await this.client.hget(this.gameKey(gameId), 'state');
    if (!data) return null;
    return JSON.parse(data) as GameState;
  }

  /** Save the entire GameState to Redis (single operation) */
  async saveGameState(gameId: string, state: GameState): Promise<void> {
    await this.client.hset(this.gameKey(gameId), 'state', JSON.stringify(state));
    await this.client.expire(this.gameKey(gameId), GAME_STATE_TTL_SECONDS);
  }

  /** Move history (separate, not part of main state) */
  async recordMove(gameId: string, move: { ply: number; color: PlayerColor; diceValue: number; pieceId: PieceId; from: number; to: number; captured: boolean; enteredHome: boolean; timestamp: number }): Promise<void> {
    await this.client.lpush(this.movesKey(gameId), JSON.stringify(move));
    await this.client.ltrim(this.movesKey(gameId), 0, 199);
  }

  /** Get the live clash (if any) embedded in the game state. */
  async loadClashState(gameId: string): Promise<ClashState | null> {
    const state = await this.loadGameState(gameId);
    return state?.clash ?? null;
  }

  /** Persist an active clash (phase deadlines) into the game state. */
  async saveClashState(gameId: string, clash: ClashState): Promise<void> {
    const state = await this.loadGameState(gameId);
    if (!state) return;
    
    state.clash = clash;
    await this.saveGameState(gameId, state);
  }

  /** Remove the clash from the game state (resolved or aborted). */
  async clearClashState(gameId: string): Promise<void> {
    const state = await this.loadGameState(gameId);
    if (!state) return;
    
    delete state.clash;
    await this.saveGameState(gameId, state);
  }

  /** Count a press for the attacker/defender side; returns the side's new total. */
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

  /** Publish state change to all subscribers */
  async publish(gameId: string, message: string): Promise<void> {
    await this.client.publish(`game:${gameId}`, message);
  }

   /** Get the match metadata hash (for lobby/color selection) */
   async getMatchData(gameId: string): Promise<Record<string, string> | null> {
     const data = await this.client.hgetall(this.matchKey(gameId));
     return Object.keys(data).length > 0 ? data : null;
   }

   /** Update specific fields in the match metadata hash */
   async updateMatchData(gameId: string, fields: Record<string, string>): Promise<void> {
     await this.client.hmset(this.matchKey(gameId), fields);
   }

   /** SCAN all match metadata hashes. */
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

   /** SCAN all engine game-state hashes (used by the clash recovery sweep). */
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

   /** Stamp the moment a room became idle (< 2 seated), without overwriting an existing stamp. */
   async setIdleSince(gameId: string, now: number): Promise<void> {
     await this.client.hsetnx(this.matchKey(gameId), 'idleSince', now.toString());
   }

   /** Clear the idle stamp (room has ≥ 2 seated players again). */
   async clearIdleSince(gameId: string): Promise<void> {
     await this.client.hdel(this.matchKey(gameId), 'idleSince');
   }

   /**
    * Remove a non-host player's seat from a waiting room's match hash.
    * The host (player1) seat is never cleared : the room stays rejoinable.
    * After clearing, the idle stamp is (re)written so the 5-minute idle
    * countdown restarts from the moment the room dropped back below 2 seats.
    */
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
     );
     await this.setIdleSince(gameId, Date.now());
   }

   /** Mark a match ABORTED with a short TTL so it drops out of open-room listings. */
   async abortMatch(gameId: string): Promise<void> {
     await this.client.hset(this.matchKey(gameId), 'status', 'ABORTED');
     await this.client.expire(this.matchKey(gameId), ABORTED_MATCH_TTL_SECONDS);
   }

   /** Delete the engine-side game state/moves for a match. */
   async deleteGame(gameId: string): Promise<void> {
     await this.client.del(this.gameKey(gameId), this.movesKey(gameId));
   }

   private matchKey(gameId: string): string { return `match:${gameId}`; } // match metadata hash
   private gameKey(gameId: string): string { return `game:${gameId}`; } // game state hash
   private movesKey(gameId: string): string { return `game:${gameId}:moves`; } // move history list
 }
