import { Server } from 'socket.io';
import * as http from 'http';
import { LudoEngine } from '../engine';
import { ClashManager, CLASH_RESULT_FREEZE_MS } from '../clash';
import { RedisGameStore } from '../redis';
import { getOrCreateBot } from '../bot';
import { EventPublisher } from './event-publisher';
import { RedisBroadcaster } from './redis-broadcaster';
import { MatchAbandonSubscriber } from './abandon-subscriber';
import { ResultSubmitter } from './result-submitter';
import { SocketHandlers } from './socket-handlers';
import { RoomChat } from './room-chat';
import { BlockSubscriber } from './block-subscriber';
import { BotTurnScheduler } from './bot-scheduler';
import { PostGameManager } from './post-game';
import type { GameSocket } from './auth';
import { GUEST_EVENTS } from './auth';
import { createHandshakeAuth, MAX_SOCKETS_PER_USER } from './handshake-auth';
import { LobbyManager } from '../lobby';
import type { PlayerColor } from '../types';
import { parseAllowedOrigins } from './allowed-origins';
import { EventRateLimiter } from './event-rate-limiter';
import { IdleLobbyWatcher } from './idle-lobby';
import { RoomRegistry } from './room-context';
import { ConnectionCounter } from './connection-counter';
import { RoomLifecycle } from './room-lifecycle';
import {
  BOT_MOVE_STEP_MS,
  BOT_THINK_MS,
  CLASH_EVENT_WINDOW_MS,
  EVENT_WINDOW_MS,
  IDLE_LOBBY_TIMEOUT_MS,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  POST_GAME_TIMEOUT_MS,
} from '../timing';
import {
  CAPTURE_CARD_GRACE_MS,
  CAPTURE_CARD_MS,
  DICE_ROLL_ANIM_MS,
  GOAL_CARD_TOTAL_MS,
  GOAL_FX_MS,
} from '../__shared__/timing.constants';

// Every delay lives in ../timing; these are socket-wiring limits, exported for the
// contract harness. MAX_EVENT_BYTES is the largest inbound event socket.io buffers
// and parses: 64 KB per OWASP guidance, well above the few-KB join_game payload.
export const MAX_EVENT_BYTES = 64 * 1024;
// The handshake module owns the per-account cap; re-exported here because this is
// the path the socket-side importers and the contract harness already use.
export { MAX_SOCKETS_PER_USER };
// Inbound event budget per socket: 20 events, refilled over 5 s. The SPA sends a few
// events per turn, so only a loop or a flood drains the bucket, and that socket is
// closed instead of served.
const EVENT_LIMIT = 20;
// Clash presses spend their own bucket: a mash at the 110 ms press cap is about
// 9 presses/s per side, so the shared bucket would close the socket mid-race. 25
// presses/s sustained keeps the press cap and phase checks as the real bound.
const CLASH_EVENT_LIMIT = 125;
// Die taps use a separate bucket: one roll carries at most one tap, so ten per window
// covers a hotseat device. Separation keeps taps from draining the turn's budget.
const DICE_TAP_EVENT_LIMIT = 10;

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
  // departSeat in this process (the room state lives here, not there).
  private abandon: MatchAbandonSubscriber;
  // The live block ledger's feed: a block minted in the backend is stamped with this
  // room's chat sequence here, which is the only place that sequence exists.
  private blocks: BlockSubscriber;
  private resultSubmitter: ResultSubmitter;
  // The room channel's handlers. Built in start(), because its fan-out is the socket
  // server itself and that does not exist until then.
  private roomChat?: RoomChat;
  private handlers: SocketHandlers;
  private botScheduler: BotTurnScheduler;
  private postGame: PostGameManager;
  // Per-process room state (seat bindings + room timers). Every room-scoped
  // deadline is persisted in Redis first, so this is a rebuildable cache: see
  // wake() below, which replays it at boot and after a Redis reconnect.
  private rooms = new RoomRegistry();
  private idleLobby: IdleLobbyWatcher;
  // The room's in-process lifecycle: teardown, wake replay and guest settlement.
  private lifecycle: RoomLifecycle;
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
      this.lifecycle.cleanupGame(gameId);
    });
    this.blocks = new BlockSubscriber(this.store);
    // A WAITING room with fewer than two seats aborts after the idle timeout. The same
    // deadline drives the room banner, so the client reads one clock.
    this.idleLobby = new IdleLobbyWatcher(
      this.store,
      this.rooms,
      IDLE_LOBBY_TIMEOUT_MS,
      (gameId) => void this.lifecycle.expireIdleLobby(gameId),
      (gameId, closesAt) => {
        void this.store.publish(gameId, JSON.stringify({ type: 'room_closing', gameId, closesAt }));
      },
    );
    // A departure can free a seat, which leaves the host alone: the engine asks the
    // watcher to re-evaluate instead of duplicating the idle rule.
    this.engine.setIdleRefresher((gameId) => {
      void this.idleLobby.refresh(gameId);
    });
    this.resultSubmitter = new ResultSubmitter(this.engine, this.store, this.rooms);
    // A departure's record: the engine decides who left and what they had done, the
    // submitter holds the backend client. A room that closes posts every seat it held
    // (R25); a room that keeps playing posts the seat that left.
    this.engine.setExitSubmitter((gameId, records) => {
      void this.resultSubmitter.submitExits(gameId, records);
    });
    this.botScheduler = new BotTurnScheduler(this.store, this.engine, getOrCreateBot);
    this.postGame = new PostGameManager(
      () => this.io,
      this.store,
      this.engine,
      this.publisher,
      this.rooms,
      POST_GAME_TIMEOUT_MS,
      (gameId) => {
        this.lifecycle.cleanupGame(gameId);
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
        // closeRoom already broadcast game_expired; this clears the engine's
        // in-memory state (room bindings, bots, locks).
        this.lifecycle.cleanupGame(gameId);
      },
      (gameId) => {
        // A refill cancels the idle window; a departure re-arms it.
        void this.idleLobby.refresh(gameId);
      },
      (socket) => {
        // The room's transcript, replayed to this socket alone (M3).
        void this.roomChat?.history(socket);
      },
    );
    this.lifecycle = new RoomLifecycle({
      store: this.store,
      rooms: this.rooms,
      idleLobby: this.idleLobby,
      engine: this.engine,
      postGame: this.postGame,
      botScheduler: this.botScheduler,
      resultSubmitter: this.resultSubmitter,
      forgetChat: (gameId) => {
        this.roomChat?.forget(gameId);
      },
    });
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
          const baseDelay = animMs + BOT_THINK_MS;
          // What clients paint after the walk. Goal is tested first, and the branches are
          // exclusive, so a goal capture adds one beat. Only the goal square counts.
          const overlay: 'goal' | 'capture' | null = event.result.reachedGoal
            ? 'goal'
            : event.result.captured
              ? 'capture'
              : null;
          if (!overlay) {
            this.botScheduler.schedule(event.gameId, baseDelay);
          } else {
            // A capture card or goal celebration mounts after the walk, so the bot waits
            // the walk and then the overlay: the delays add, not max. The goal uses the
            // room's effects rule; a store miss falls back to the plain delay.
            void this.store
              .loadGameState(event.gameId)
              .then((state) => {
                const cardWait =
                  overlay === 'goal'
                    ? state?.captureFx
                      ? GOAL_CARD_TOTAL_MS
                      : GOAL_FX_MS
                    : state?.captureFx
                      ? CAPTURE_CARD_MS + CAPTURE_CARD_GRACE_MS
                      : 0;
                this.botScheduler.schedule(event.gameId, baseDelay + cardWait);
              })
              .catch(() => this.botScheduler.schedule(event.gameId, baseDelay));
          }
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
        // The card is the pause: freeze to its own deadline, not the ceiling, and hand
        // the bot's resume to it. `clash_card_released` re-arms when a receipt shortens it.
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
      void this.lifecycle.wake('redis reconnect');
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
    this.blocks.start();
    // The room channel: one handler pair, built once the io server exists.
    this.roomChat = new RoomChat(this.io, this.store);
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
    await this.lifecycle.wake('boot');
  }

  async stop(): Promise<void> {
    await this.store.disconnect();
    await this.broadcaster.disconnect();
    await this.abandon.disconnect();
    await this.blocks.disconnect();
    this.httpServer.close();
  }
  // Socket wiring (orchestration only)
  private setupSocketHandlers(): void {
    this.io.use(createHandshakeAuth({ store: this.store, connections: this.connections }));

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
      // Die taps spend their own bucket (see DICE_TAP_EVENT_LIMIT): one per roll is the
      // real rate, so a tap can neither be flooded nor drain the turn's budget.
      const tapLimiter = new EventRateLimiter(DICE_TAP_EVENT_LIMIT, EVENT_WINDOW_MS);
      socket.use(([event], next) => {
        // Guests get an allow-list, not a deny-list: a lobby-only event is logged and
        // dropped, never a disconnect, so a stray event cannot close a socket mid-clash.
        // Checked before the rate bucket, so a refused event spends no budget.
        if (socket.data.isGuest && !GUEST_EVENTS.has(event)) {
          console.warn(`Guest socket ${socket.id}: refused '${event}'.`);
          return;
        }
        const bucket =
          event === 'clash_input'
            ? clashLimiter
            : event === 'dice_tapped'
              ? tapLimiter
              : limiter;
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

      // The roller caught their spinning die: a cosmetic relay of the seat (38.7), so the
      // room plays the same act. No state is read and no lock is taken.
      socket.on('dice_tapped', () => {
        this.handlers.handleDiceTap(socket);
      });

      socket.on('move_piece', (pieceId) => {
        this.handlers.handleMovePiece(socket, pieceId);
      });

      // The Skip button on a held turn: decline the armed Wall Breaker exit.
      socket.on('skip_wall_breaker', () => {
        this.handlers.handleSkipWallBreak(socket);
      });

      // The Wall Breaker arm switch, clash mode only: arm to be allowed to land
      // on (and break) a wall this turn, disarm to be blocked by one. The engine
      // owns the flag, so this is a request, not a local toggle.
      socket.on('arm_wall_breaker', (armed?: boolean) => {
        this.handlers.handleArmWallBreaker(socket, armed === true);
      });

      // The result-card release handshake: the client forecasts how long its own
      // card will run, and the engine answers with the release frame when the last
      // participating user is done (or the ceiling, if a receipt never comes).
      socket.on('clash_card_hold', (cardId?: string, holdMs?: number) => {
        this.handlers.handleClashCardHold(socket, cardId, holdMs);
      });

      // One QTE press. The optional second argument is the tablet's tap weight
      // (clamped inside the press rule to the shared CLASH_TAP_COUNT), so a pad tap
      // is heavier than a keyboard press, which stays 1.
      socket.on('clash_input', (key: string, count?: number) => {
        this.handlers.handleClashInput(socket, key, count ?? 1);
      });

      socket.on('player_ready', () => {
        this.handlers.handlePlayerReady(socket);
      });

      // One object each way: the host's rules panel sends the five rules as
      // `{clashEnabled, noSafeZones, freeExit, clashKeyShift, captureFx}`, never as
      // positional booleans.
      socket.on('update_modifiers', (rules: unknown) => {
        this.handlers.handleUpdateModifiers(socket, rules);
      });

      // The room's channel (M3). `chat:send` carries the line and an ack that says
      // whether it went and, if not, why; `chat:history` is pushed to this socket on
      // join, so there is no client-side request for it. Guests are outside both: a
      // guest room has no channel, and the allow-list above already refuses them.
      socket.on('chat:send', (text: unknown, ack?: (reply: unknown) => void) => {
        void this.roomChat?.send(socket, text, ack);
      });

      socket.on('leave_game', () => {
        // A guest leaving an ephemeral room is an abort in every sense: price it
        // and revoke at once. The room teardown cannot refuse this socket's own
        // later events, and a guest has nothing to reconnect to.
        if (socket.data.isGuest) void this.lifecycle.settleGuestExit(socket);
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
          .then(() => this.lifecycle.settleGuestExit(socket));
      });

      socket.on('disconnect', () => {
        this.handlers.handleDisconnect(socket);
      });
    });
  }
}
