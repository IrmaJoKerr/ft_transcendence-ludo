import { Server } from 'socket.io';
import * as http from 'http';
import { LudoEngine } from '../engine';
import { ClashManager, CLASH_RESULT_FREEZE_MS } from '../clash';
import { RedisGameStore } from '../redis';
import { getOrCreateBot, isBotSeat } from '../bot';
import { EventPublisher } from './event-publisher';
import { RedisBroadcaster } from './redis-broadcaster';
import { ResultSubmitter } from './result-submitter';
import { SocketHandlers } from './socket-handlers';
import { BotTurnScheduler } from './bot-scheduler';
import { PostGameManager } from './post-game';
import type { GameSocket } from './auth';
import { verifyToken } from './auth';
import { LobbyManager } from '../lobby';
import { teardownRoom } from '../player-handler';
import type { PlayerColor } from '../types';
import { parseAllowedOrigins } from './allowed-origins';
import { EventRateLimiter } from './event-rate-limiter';
import { IdleLobbyWatcher } from './idle-lobby';
import { RoomRegistry } from './room-context';

// A WAITING PvP room with fewer than 2 seated players is idle; once it has
// been idle this long the room is aborted (friend on the way? give them time).
const IDLE_LOBBY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POST_GAME_TIMEOUT_MS = 60 * 1000; // 60 seconds

// Mirrors the frontend's STEP_ANIM_MS : bot turns are paced so their moves
// finish animating on screen before the next bot action fires.
const BOT_STEP_ANIM_MS = 220;
// Flat "thinking" pause before a bot rolls, so bot turns don't feel instant.
const BOT_THINK_MS = 500;

// Largest inbound event socket.io buffers and parses. The biggest legitimate
// payload (join_game carrying the lobby's bot names) is a few KB.
const MAX_EVENT_BYTES = 100 * 1024; // 100 KB
// Liveness: a live browser answers a ping in a few hundred milliseconds, so a
// socket missing an interval plus the timeout is gone, well inside the 45 s
// reconnect window in player-handler.ts (a returning player can still reclaim).
const PING_INTERVAL_MS = 10 * 1000;
const PING_TIMEOUT_MS = 15 * 1000;
// Inbound event budget per socket: 20 events, refilled over 5 s. The SPA sends a
// few events per turn, so only a loop or a flood drains the bucket, and that
// socket is closed instead of served.
const EVENT_LIMIT = 20;
const EVENT_WINDOW_MS = 5 * 1000;
// Clash presses spend their own bucket: a mash at the 110 ms press cap
// (clash.ts) is about 9 presses/s per side, so the shared bucket would close the
// socket mid-race. 25 presses/s sustained keeps the press cap and the phase
// checks as the real bound, while a socket that loops faster still gets closed.
const CLASH_EVENT_LIMIT = 125;
const CLASH_EVENT_WINDOW_MS = 5 * 1000;

// SocketServer is the orchestration root for the ludo engine: it wires the
// engine, Redis pub/sub, bots, post-game lifecycle, and sockets, routing
// each event to the module that owns it (handlers, joins, bots, end-game).
export class SocketServer {
  private io!: Server;
  private httpServer!: http.Server;
  private store: RedisGameStore;
  private engine: LudoEngine;
  // Owns clash record lifecycle (create/validate/count/clear). The engine runs
  // the QTE timers; this is the state side both share.
  private clashManager: ClashManager;
  private publisher: EventPublisher;
  private broadcaster: RedisBroadcaster;
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
  constructor() {
    this.store = new RedisGameStore();
    this.publisher = new EventPublisher(this.store);
    this.clashManager = new ClashManager(this.store, this.publisher);
    this.engine = new LudoEngine(this.store, this.clashManager);
    const lobbyManager = new LobbyManager(this.store, this.publisher);
    this.engine.setLobbyManager(lobbyManager);
    this.broadcaster = new RedisBroadcaster();
    // Idle lobbies: a WAITING room with fewer than 2 seated players is aborted
    // after IDLE_LOBBY_TIMEOUT_MS. Replaces the old 60 s lobby scan.
    this.idleLobby = new IdleLobbyWatcher(this.store, this.rooms, IDLE_LOBBY_TIMEOUT_MS, (gameId) =>
      this.expireIdleLobby(gameId),
    );
    this.resultSubmitter = new ResultSubmitter(
      this.engine,
      this.store,
      this.rooms,
      (gameId) => {
        this.cleanupGame(gameId);
      },
    );
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
        // Every departure path (waiting-room leave, live leave, End Game, grace
        // expiry, prune) funnels through this event, so the idle window is
        // re-evaluated here instead of by a periodic lobby scan. Refills cancel
        // it in JoinManager.
        void this.idleLobby.refresh(event.gameId);
      } else if (event.type === 'game_started') {
        this.botScheduler.schedule(event.gameId, BOT_THINK_MS);
        void this.resultSubmitter.notifyGameStarted(event.gameId);
      } else if (event.type === 'piece_moved') {
        // Wait for the move's box-by-box animation to finish on screen
        // (path.length steps) plus a short thinking pause before acting again.
        const animMs = event.result.path.length * BOT_STEP_ANIM_MS;
        // A move that settled a clash keeps every input frozen for the result
        // card, so the bot's next action waits that card out too.
        const clashCardMs = event.result.clashOutcome ? CLASH_RESULT_FREEZE_MS : 0;
        this.botScheduler.schedule(event.gameId, animMs + BOT_THINK_MS + clashCardMs);
      } else if (event.type === 'dice_rolled') {
        // Only trigger bot turn if no legal moves (turn auto-advanced)
        // Wait for the 750ms frontend dice-roll animation plus thinking pause
        if (event.legalMoves.length === 0) {
          this.botScheduler.schedule(event.gameId, 750 + BOT_THINK_MS);
        }
      } else if (event.type === 'clash_start') {
        // No bot turn while the QTE runs. The source freed bots only to the
        // announce deadline (1500 ms), which left the countdown and the press
        // race unguarded; freezing to the press deadline covers all three phases
        // and matches that comment's intent.
        this.botScheduler.setClashFreeze(event.gameId, event.pressDeadline);
      } else if (event.type === 'clash_result') {
        // Stay frozen through the result card, then let the bot resume.
        this.botScheduler.setClashFreeze(event.gameId, Date.now() + CLASH_RESULT_FREEZE_MS);
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
    // missing value is a boot failure rather than a silent per-game error.
    if (!process.env.ENGINE_API_KEY) {
      console.error('ENGINE_API_KEY is not set: refusing to start');
      process.exit(1);
    }

    await this.store.connect();

    // Wake trigger: a Redis reconnect. The engine stays alive through a Redis
    // container rebuild, but its room timers do not, and a bot whose turn comes
    // up would never resume (LudoBot.takeTurn swallows a failed state load and is
    // never retried). The durable deadlines in the data survive, so the wake pass
    // replays them. The boot connection calls the same pass below.
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
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
      },
      maxHttpBufferSize: MAX_EVENT_BYTES,
      pingInterval: PING_INTERVAL_MS,
      pingTimeout: PING_TIMEOUT_MS,
    });

    this.broadcaster.start(this.io);
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
      (id) => this.cleanupGame(id),
    );
  }

  // The wake pass: one scan of the durable deadlines, then sleep. It runs once
  // at boot (after store.connect()) and again on every Redis reconnect, so a
  // timer lost with the process (or with Redis) is replayed instead of leaving
  // its room frozen. Every action re-validates against live state, so replaying
  // an already-settled deadline is a no-op.
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

  // Rebuild ONE room from Redis and replay whatever is due:
  //   1. grace windows that expired while the process was down;
  //   2. a bot seat holding the turn (the original freeze: no client has to
  //      rejoin for the bots to resume);
  //   3. a finished room whose post-game timer died with the process;
  //   4. the idle window of a WAITING room below quorum.
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
      await this.engine.expireDisconnectedPlayer(gameId, disc.color, (id) => this.cleanupGame(id));
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

  // Socket wiring (orchestration only)
  private setupSocketHandlers(): void {
    this.io.use((socket: GameSocket, next) => {
      const token = socket.handshake.auth?.token;
      // A token is mandatory: bots are driven server-side and the SPA always
      // supplies one.
      if (!token) {
        next(new Error('Authentication required'));
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
      next();
    });

    this.io.on('connection', (socket: GameSocket) => {
      console.log(
        `Client connected: ${socket.id}${socket.data.userId ? ` (user: ${socket.data.userId})` : ''}`,
      );

      // Every inbound event passes through here before a handler sees it, so one
      // bucket covers all of them. An over-budget socket is closed: a closed
      // socket takes the same disconnect path as a dropped connection.
      const limiter = new EventRateLimiter(EVENT_LIMIT, EVENT_WINDOW_MS);
      // Presses during a clash race spend this bucket instead, so a mash at the
      // 110 ms cap can never close the socket mid-QTE (see CLASH_EVENT_LIMIT).
      const clashLimiter = new EventRateLimiter(CLASH_EVENT_LIMIT, CLASH_EVENT_WINDOW_MS);
      socket.use(([event], next) => {
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

      socket.on('clash_input', (key: string) => {
        this.handlers.handleClashInput(socket, key);
      });

      socket.on('player_ready', () => {
        this.handlers.handlePlayerReady(socket);
      });

      socket.on('select_color', (color: string) => {
        this.handlers.handleSelectColor(socket, color);
      });

      // One object each way: the host's rules panel sends the three rules as
      // `{clashEnabled, noSafeZones, freeExit}`, never as positional booleans.
      socket.on('update_modifiers', (rules: unknown) => {
        this.handlers.handleUpdateModifiers(socket, rules);
      });

      socket.on('leave_game', () => {
        this.handlers.handleLeaveGame(socket);
      });

      socket.on('end_game', () => this.postGame.handleEndGame(socket));

      socket.on('disconnect', () => {
        this.handlers.handleDisconnect(socket);
      });
    });
  }
}
