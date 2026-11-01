import { Server } from 'socket.io';
import * as http from 'http';
import { LudoEngine } from '../engine';
import { ClashManager, CLASH_RESULT_FREEZE_MS } from '../clash';
import { RedisGameStore } from '../redis';
import { getOrCreateBot, isBotSeat } from '../bot';
import { EventPublisher } from './event-publisher';
import { RedisBroadcaster } from './redis-broadcaster';
import { MatchAbandonSubscriber } from './abandon-subscriber';
import { ResultSubmitter } from './result-submitter';
import { SocketHandlers } from './socket-handlers';
import { BotTurnScheduler } from './bot-scheduler';
import { PostGameManager } from './post-game';
import type { GameSocket } from './auth';
import { GUEST_EVENTS, GUEST_TOKEN_PREFIX, verifyToken } from './auth';
import { LobbyManager } from '../lobby';
import { teardownRoom } from '../player-handler';
import type { PlayerColor } from '../types';
import { parseAllowedOrigins } from './allowed-origins';
import { EventRateLimiter } from './event-rate-limiter';
import { IdleLobbyWatcher } from './idle-lobby';
import { RoomRegistry } from './room-context';
import { ConnectionCounter } from './connection-counter';
import {
  BOT_MOVE_STEP_MS,
  BOT_THINK_MS,
  CLASH_EVENT_WINDOW_MS,
  DICE_ROLL_ANIM_MS,
  EVENT_WINDOW_MS,
  IDLE_LOBBY_TIMEOUT_MS,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  POST_GAME_TIMEOUT_MS,
} from '../timing';

// Every delay lives in ../timing; these are socket-wiring limits, exported for the
// contract harness. MAX_EVENT_BYTES is the largest inbound event socket.io buffers
// and parses: 64 KB per OWASP guidance, well above the few-KB join_game payload.
export const MAX_EVENT_BYTES = 64 * 1024;
// One account may hold a handful of sockets: one active per device, one stale while a
// refresh reconnects, one for a clash pipe if that ever ships, and one slack. Four
// covers a reconnect and stays tight; three would break the day a pipe is added.
export const MAX_SOCKETS_PER_USER = 4;
// Inbound event budget per socket: 20 events, refilled over 5 s. The SPA sends a few
// events per turn, so only a loop or a flood drains the bucket, and that socket is
// closed instead of served.
const EVENT_LIMIT = 20;
// Clash presses spend their own bucket: a mash at the 110 ms press cap is about
// 9 presses/s per side, so the shared bucket would close the socket mid-race. 25
// presses/s sustained keeps the press cap and phase checks as the real bound.
const CLASH_EVENT_LIMIT = 125;

// The Origin gate, in one testable place. A browser origin must match the allow-list
// exactly. `undefined` means a non-browser client (curl, the probes) or a same-origin
// navigation, which has no cross-site origin to target, so it is allowed.
export function originAllowed(origin: string | undefined, allowed: string[]): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}

// SocketServer is the orchestration root for the ludo engine: it wires the
// engine, Redis pub/sub, bots, post-game lifecycle, and sockets, routing
// each event to the module that owns it (handlers, joins, bots, end-game).
export class SocketServer {
  private io!: Server;
  private httpServer!: http.Server;
  private store: RedisGameStore;
  private engine: LudoEngine;
  // Owns the clash record's life (create/validate/count). The engine runs the QTE
  // timers and applies the outcome; this is the state side both share.
  private clashManager: ClashManager;
  private publisher: EventPublisher;
  private broadcaster: RedisBroadcaster;
  // Sign-out departures: the backend publishes `match:abandon`, this applies
  // finalizeDeparture in this process (the room state lives here, not there).
  private abandon: MatchAbandonSubscriber;
  private resultSubmitter: ResultSubmitter;
  private handlers: SocketHandlers;
  private botScheduler: BotTurnScheduler;
  private postGame: PostGameManager;
  // Per-process room state (seat bindings + room timers). Every room-scoped
  // deadline is persisted in Redis first, so this is a rebuildable cache: see
  // wake() below, which replays it at boot and after a Redis reconnect.
  private rooms = new RoomRegistry();
  private idleLobby: IdleLobbyWatcher;
  // Guards against overlapping wake passes (a redis reconnect during a boot wake).
  private wakeInFlight = false;
  // Per-user socket cap (see MAX_SOCKETS_PER_USER): counted at the handshake, freed on
  // disconnect. A flood from one account is refused, not served.
  private connections = new ConnectionCounter();
  constructor() {
    this.store = new RedisGameStore();
    this.publisher = new EventPublisher(this.store);
    this.clashManager = new ClashManager(this.store, this.publisher);
    this.engine = new LudoEngine(this.store, this.clashManager);
    const lobbyManager = new LobbyManager(this.store);
    this.engine.setLobbyManager(lobbyManager);
    this.broadcaster = new RedisBroadcaster();
    this.abandon = new MatchAbandonSubscriber(this.store, this.engine, (gameId) => {
      this.cleanupGame(gameId);
    });
    // Idle lobbies: a WAITING room with fewer than 2 seated players is aborted
    // after IDLE_LOBBY_TIMEOUT_MS. Replaces the old 60 s lobby scan.
    this.idleLobby = new IdleLobbyWatcher(this.store, this.rooms, IDLE_LOBBY_TIMEOUT_MS, (gameId) =>
      this.expireIdleLobby(gameId),
    );
    this.resultSubmitter = new ResultSubmitter(this.engine, this.store, this.rooms);
    this.botScheduler = new BotTurnScheduler(this.store, this.engine, getOrCreateBot);
    this.postGame = new PostGameManager(
      () => this.io,
      this.store,
      this.engine,
      this.publisher,
      this.rooms,
      POST_GAME_TIMEOUT_MS,
      (gameId) => {
        this.cleanupGame(gameId);
      },
    );
    this.handlers = new SocketHandlers(
      this.store,
      this.engine,
      this.rooms,
      getOrCreateBot,
      (gameId) => {
        this.botScheduler.schedule(gameId, BOT_THINK_MS);
      },
      (gameId) => {
        // teardownRoom already broadcast game_expired; this clears the engine's
        // in-memory state (room bindings, bots, locks).
        this.cleanupGame(gameId);
      },
      (gameId) => {
        // A refill cancels the idle window; a departure re-arms it.
        void this.idleLobby.refresh(gameId);
      },
    );
    // Subscribe to engine events: the engine detects lifecycle changes once, here.
    this.engine.onEvent((event) => {
      this.publisher.publish(event);

      if (event.type === 'game_ended') {
        this.postGame.onGameEnded(event.gameId);
        void this.resultSubmitter.submitGameResult(event.gameId);
      } else if (event.type === 'player_exited') {
        // Every departure path funnels through this event, so the idle window is
        // re-evaluated here instead of by a periodic lobby scan. Refills cancel it in
        // JoinManager.
        void this.idleLobby.refresh(event.gameId);
      } else if (event.type === 'game_started') {
        this.botScheduler.schedule(event.gameId, BOT_THINK_MS);
        void this.resultSubmitter.notifyGameStarted(event.gameId);
      } else if (event.type === 'piece_moved') {
        // Wait for the box-by-box animation (path.length steps) and a thinking pause.
        // A move that settled a clash is the exception: `clash_result` owns the
        // card's deadline, and one owner keeps the guards from stacking.
        if (!event.result.clashOutcome) {
          const animMs = event.result.path.length * BOT_MOVE_STEP_MS;
          this.botScheduler.schedule(event.gameId, animMs + BOT_THINK_MS);
        }
      } else if (event.type === 'dice_rolled') {
        // Only trigger bot turn if no legal moves (turn auto-advanced)
        // Wait for the 750ms frontend dice-roll animation plus thinking pause
        if (event.legalMoves.length === 0) {
          this.botScheduler.schedule(event.gameId, DICE_ROLL_ANIM_MS + BOT_THINK_MS);
        }
      } else if (event.type === 'turn_skipped') {
        // A held turn passed to the next seat, which a bot may own: the same wake a
        // no-move roll gets.
        this.botScheduler.schedule(event.gameId, BOT_THINK_MS);
      } else if (event.type === 'clash_start') {
        // No bot turn while the QTE runs. Freezing to the press deadline covers the
        // announce, countdown and press phases; freezing to the announce deadline left
        // the countdown and press race unguarded.
        this.botScheduler.setClashFreeze(event.gameId, event.pressDeadline);
      } else if (event.type === 'clash_result') {
        // The card is the pause: freeze to its own deadline (a card nobody human
        // sits on ends at the short ceiling, not the 4 s one) and hand the bot's
        // resume to it. `clash_card_released` re-arms when a receipt shortens it.
        const cardUntil = event.resultCardUntil ?? Date.now() + CLASH_RESULT_FREEZE_MS;
        this.botScheduler.setClashFreeze(event.gameId, cardUntil);
        if (!event.continues) {
          this.botScheduler.schedule(
            event.gameId,
            Math.max(0, cardUntil - Date.now()) + BOT_THINK_MS,
          );
        }
      } else if (event.type === 'clash_card_released') {
        // The card ended early (every client reported it was done): shorten the bots'
        // guard and re-arm their turn against the new deadline. `schedule` reads the
        // seat first, so this is a no-op when a human holds the turn.
        this.botScheduler.setClashFreeze(event.gameId, event.resultCardUntil);
        this.botScheduler.schedule(
          event.gameId,
          Math.max(0, event.resultCardUntil - Date.now()) + BOT_THINK_MS,
        );
      }
    });
  }

  async start(port: number): Promise<void> {
    // Resolve the CORS allow-list before anything connects. An empty list is a
    // configuration error, never a reason to let every origin through.
    const allowedOrigins = parseAllowedOrigins(process.env.CORS_ORIGIN);
    if (allowedOrigins.length === 0) {
      console.error('CORS_ORIGIN is not set: refusing to allow every origin');
      process.exit(1);
    }
    // Without the key the backend rejects every game-result callback, so a
    // missing value is a boot failure rather than a per-game error.
    if (!process.env.ENGINE_API_KEY) {
      console.error('ENGINE_API_KEY is not set: refusing to start');
      process.exit(1);
    }

    await this.store.connect();

    // Wake trigger: a Redis reconnect. The engine stays alive through a container
    // rebuild, but its room timers do not, so a bot turn would never resume. The
    // durable deadlines survive, so the wake pass replays them.
    this.store.onReady(() => {
      void this.wake('redis reconnect');
    });

    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.io = new Server(this.httpServer, {
      cors: {
        // The gate itself is `originAllowed`, so the rule can be tested without a live
        // handshake: a browser origin must be allow-listed exactly, a client with no
        // Origin header is allowed.
        origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
          cb(null, originAllowed(origin, allowedOrigins));
        },
        methods: ['GET', 'POST'],
      },
      maxHttpBufferSize: MAX_EVENT_BYTES,
      pingInterval: PING_INTERVAL_MS,
      pingTimeout: PING_TIMEOUT_MS,
    });

    this.broadcaster.start(this.io);
    this.abandon.start();
    this.setupSocketHandlers();
    // Boot-time clash recovery: re-arm the persisted QTE phase timers and sweep
    // every 5 s for an orphaned or stalled clash. The wake pass below replays the
    // other durable deadlines.
    this.engine.startClashRecoverySweep();

    this.httpServer.listen(port, () => {
      console.log(`Ludo engine listening on port ${port}`);
    });

    // Wake pass: replay every durable deadline this process (or a Redis outage)
    // left behind, then sleep. Steady state has no periodic scans: each room arms
    // its own timer from the event that created its deadline.
    await this.wake('boot');
  }

  async stop(): Promise<void> {
    await this.store.disconnect();
    await this.broadcaster.disconnect();
    await this.abandon.disconnect();
    this.httpServer.close();
  }
  // Drop a room's in-memory state: its RoomContext (seat bindings + timers) and
  // its pending bot turn. Called on teardown, and by the wake pass when an entry
  // has no state behind it.
  private cleanupGame(gameId: string): void {
    this.rooms.delete(gameId);
    this.botScheduler.clear(gameId);
  }

  // Abort an idle lobby: teardownRoom emits game_expired, aborts the match and
  // deletes the game state; its notify callback drops the in-memory context.
  private async expireIdleLobby(gameId: string): Promise<void> {
    await teardownRoom(
      this.store,
      (event) => {
        this.engine.emitEvent(event);
      },
      gameId,
      (id) => {
        this.cleanupGame(id);
      },
    );
  }

  // The wake pass: one scan of durable deadlines, then sleep. It runs at boot,
  // after store.connect(), and on every Redis reconnect, so a lost timer is
  // replayed instead of leaving its room frozen. Replay re-validates, so it is safe.
  private async wake(reason: string): Promise<void> {
    if (this.wakeInFlight) {
      console.log(`[engine] wake pass (${reason}) skipped: another pass is running`);
      return;
    }
    this.wakeInFlight = true;
    try {
      console.log(`[engine] wake pass (${reason}): replaying durable deadlines`);
      const gameKeys = await this.store.scanGameKeys();
      let checked = 0;
      for (const key of gameKeys) {
        const gameId = key.slice('game:'.length);
        try {
          await this.rebuildRoom(gameId);
          checked++;
        } catch (err) {
          // One unreadable room must not abort the pass for the others.
          console.error(
            `[engine] wake: failed to rebuild room ${gameId}:`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      // Rooms with no game state (created but never joined, or dropped below
      // quorum by a backend-only departure) still need their idle window settled.
      await this.idleLobby.sweepAll();
      console.log(`[engine] wake pass (${reason}) complete: ${checked} game(s) checked`);
    } catch (err) {
      // Never reject: the boot pass is awaited by start() and a reconnect pass is
      // fire-and-forget, and neither may take the process down.
      console.error(
        `[engine] wake pass (${reason}) failed:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      this.wakeInFlight = false;
    }
  }

  // Rebuild one room from Redis and replay what is due: expired grace windows, a
  // bot seat holding the turn, a finished room whose post-game timer died, and the
  // idle window of a WAITING room below quorum.
  private async rebuildRoom(gameId: string): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state) {
      // Both keys gone: nothing to rebuild, drop the stale entry.
      this.cleanupGame(gameId);
      return;
    }

    // Seat bindings are persisted per player, so they survive a restart too.
    this.rooms.ensure(gameId).rebuild(state);

    for (const disc of state.disconnectedPlayers) {
      if (Date.now() < disc.reconnectDeadline) continue;
      // Re-checks the deadline itself, so racing an in-flight grace timer is safe.
      await this.engine.finalizeSeatDeparture(gameId, disc.color, 'timeout', (id) => {
        this.cleanupGame(id);
      });
    }

    // Reload: an expiry above can advance the turn, end the game, or tear the
    // room down entirely.
    const current = await this.store.loadGameState(gameId);
    if (!current) {
      this.cleanupGame(gameId);
      return;
    }

    // Bot detection reads the persisted seat: the in-memory binding map is empty
    // after a restart, and reading it here is what froze bot games.
    if (current.status === 'active' && isBotSeat(current, current.currentTurn)) {
      this.botScheduler.schedule(gameId, BOT_THINK_MS);
    }

    // The finished room's 60 s expiry timer is in-process only, so re-arm it.
    if (current.status === 'finished') {
      this.postGame.onGameEnded(gameId);
    }

    await this.idleLobby.refresh(gameId);
  }

  // Guest settlement, once per socket: price the abort against the address, give
  // the concurrency slots back, then revoke the token. Runs after teardown on
  // end_game and on leave_game; it never disconnects the socket.
  private async settleGuestExit(socket: GameSocket): Promise<void> {
    if (!socket.data.isGuest || socket.data.guestSettled) return;
    socket.data.guestSettled = true;
    try {
      await this.store.settleGuestAbort(socket.data.guestIpHash ?? '');
      await this.store.revokeGuestToken(socket.data.guestTokenHash ?? '');
    } catch (error) {
      console.error('Guest settlement failed:', error instanceof Error ? error.message : error);
    }
  }

  // Socket wiring (orchestration only)
  private setupSocketHandlers(): void {
    this.io.use(async (socket: GameSocket, next) => {
      try {
        const token = socket.handshake.auth?.token;
        // A token is mandatory: bots are driven server-side and the SPA always
        // supplies one.
        if (!token || typeof token !== 'string') {
          next(new Error('Authentication required'));
          return;
        }

        // Guest branch: an opaque `g_` token resolved from the backend's registry.
        // That record is the authority for the room, seat and mode; none of it comes
        // from the client. A forged token is "not found", not a refused signature.
        if (token.startsWith(GUEST_TOKEN_PREFIX)) {
          const guest = await this.store.getGuestSession(token);
          if (!guest) {
            next(new Error('Invalid token'));
            return;
          }
          socket.data.userId = guest.userId;
          // Display fallback only: the client may send its own localized name
          // in join_game, which the join path prefers.
          socket.data.username = 'Guest';
          socket.data.displayName = 'Guest';
          socket.data.gameId = guest.gameId;
          socket.data.tokenGameId = guest.gameId;
          socket.data.role = 'player';
          socket.data.tokenColor = guest.color;
          socket.data.mode = 'pve';
          socket.data.isGuest = true;
          socket.data.guestIpHash = guest.ipHash;
          socket.data.guestTokenHash = guest.tokenHash;
          // Same per-account cap as a player: a guest id is unique per mint, so
          // this bounds one room's sockets, not the whole guest population.
          if (!this.connections.acquire(guest.userId, MAX_SOCKETS_PER_USER)) {
            next(new Error('Too many connections'));
            return;
          }
          next();
          return;
        }

        const payload = verifyToken(token);
        if (!payload) {
          next(new Error('Invalid token'));
          return;
        }

        socket.data.userId = payload.userId;
        socket.data.username = payload.username;
        socket.data.displayName = payload.displayName;
        socket.data.gameId = payload.gameId;
        // Token-pinned match id: unlike gameId this survives detachSocket(), so a
        // refused socket can never re-join a different game.
        socket.data.tokenGameId = payload.gameId;
        socket.data.role = payload.role as 'player';
        socket.data.tokenColor = payload.color;
        socket.data.mode = payload.mode as 'pvp' | 'pve' | 'hotseat' | undefined;
        // Per-user socket cap. Refusing here reaches the client as `connect_error`, so a
        // flood from one account never becomes dozens of live sockets.
        if (!this.connections.acquire(payload.userId, MAX_SOCKETS_PER_USER)) {
          next(new Error('Too many connections'));
          return;
        }
        next();
      } catch (error) {
        console.error('Socket handshake failed:', error instanceof Error ? error.message : error);
        next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket: GameSocket) => {
      console.log(
        `Client connected: ${socket.id}${socket.data.userId ? ` (user: ${socket.data.userId})` : ''}`,
      );
      // Free this socket's slot on ANY disconnect path (drop, refusal, takeover): the
      // counter must never leak, or a player would be locked out after enough reconnects.
      socket.on('disconnect', () => {
        if (socket.data.userId) this.connections.release(socket.data.userId);
      });

      // Every inbound event passes through here before a handler sees it, so one
      // bucket covers all of them. An over-budget socket is closed: a closed
      // socket takes the same disconnect path as a dropped connection.
      const limiter = new EventRateLimiter(EVENT_LIMIT, EVENT_WINDOW_MS);
      // Presses during a clash race spend this bucket instead, so a mash at the
      // 110 ms cap can never close the socket mid-QTE (see CLASH_EVENT_LIMIT).
      const clashLimiter = new EventRateLimiter(CLASH_EVENT_LIMIT, CLASH_EVENT_WINDOW_MS);
      socket.use(([event], next) => {
        // Guests get an allow-list, not a deny-list: a lobby-only event is logged and
        // dropped, never a disconnect, so a stray event cannot close a socket mid-clash.
        // Checked before the rate bucket, so a refused event spends no budget.
        if (socket.data.isGuest && !GUEST_EVENTS.has(event)) {
          console.warn(`Guest socket ${socket.id}: refused '${event}'.`);
          return;
        }
        const bucket = event === 'clash_input' ? clashLimiter : limiter;
        if (bucket.allow()) {
          next();
          return;
        }
        console.warn(`Socket ${socket.id}: event budget spent on '${event}'; closing socket.`);
        socket.disconnect(true);
      });

      socket.on(
        'join_game',
        (gameId: string, playerColor: PlayerColor, userId?: string, displayName?: string) => {
          this.handlers.handleJoinGame(socket, gameId, playerColor, userId, displayName);
        },
      );

      socket.on('roll_dice', () => {
        this.handlers.handleRollDice(socket);
      });

      socket.on('move_piece', (pieceId) => {
        this.handlers.handleMovePiece(socket, pieceId);
      });

      // The Skip button on a held turn: decline the armed Wall Breaker exit.
      socket.on('skip_bust', () => {
        this.handlers.handleSkipBust(socket);
      });

      // The Wall Breaker arm switch, clash mode only: arm to be allowed to land
      // on (and break) a wall this turn, disarm to be blocked by one. The engine
      // owns the flag, so this is a request, not a local toggle.
      socket.on('arm_barrier', (armed?: boolean) => {
        this.handlers.handleArmBarrier(socket, armed === true);
      });

      // The result-card release handshake: the client forecasts how long its own
      // card will run, and the engine answers with the release frame when the last
      // participating user is done (or the ceiling, if a receipt never comes).
      socket.on('clash_card_hold', (cardId?: string, holdMs?: number) => {
        this.handlers.handleClashCardHold(socket, cardId, holdMs);
      });

      // One QTE press. The optional second argument is the tablet's tap weight
      // (clamped inside the press rule), so a pad tap is worth 2 presses while a
      // keyboard press stays 1.
      socket.on('clash_input', (key: string, count?: number) => {
        this.handlers.handleClashInput(socket, key, count ?? 1);
      });

      socket.on('player_ready', () => {
        this.handlers.handlePlayerReady(socket);
      });

      // One object each way: the host's rules panel sends the four rules as
      // `{clashEnabled, noSafeZones, freeExit}`, never as positional booleans.
      socket.on('update_modifiers', (rules: unknown) => {
        this.handlers.handleUpdateModifiers(socket, rules);
      });

      socket.on('leave_game', () => {
        // A guest leaving an ephemeral room is an abort in every sense: price it
        // and revoke at once. The room teardown cannot refuse this socket's own
        // later events, and a guest has nothing to reconnect to.
        if (socket.data.isGuest) void this.settleGuestExit(socket);
        this.handlers.handleLeaveGame(socket);
      });

      socket.on('end_game', () => {
        // Guests: let the room tear down first, then price the abort and revoke
        // the token. Revoking first would refuse an in-flight reconnect while
        // the teardown is still running.
        void this.postGame
          .handleEndGame(socket)
          .catch((error) => {
            console.error('end_game failed:', error instanceof Error ? error.message : error);
          })
          .then(() => this.settleGuestExit(socket));
      });

      socket.on('disconnect', () => {
        this.handlers.handleDisconnect(socket);
      });
    });
  }
}
