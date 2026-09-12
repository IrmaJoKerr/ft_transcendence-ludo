import { Server } from 'socket.io';
import * as http from 'http';
import { LudoEngine } from '../engine';
import { RedisGameStore } from '../redis';
import { getOrCreateBot } from '../bot';
import { EventPublisher } from './event-publisher';
import { RedisBroadcaster } from './redis-broadcaster';
import { ResultSubmitter } from './result-submitter';
import { SocketHandlers } from './socket-handlers';
import { BotTurnScheduler } from './bot-scheduler';
import { PostGameManager } from './post-game';
import { verifyToken, GameSocket } from './auth';
import { LobbyManager } from '../lobby';
import { ClashManager, CLASH_RESULT_FREEZE_MS } from '../clash';
import type { PlayerColor } from '../types';

// A WAITING PvP room with fewer than 2 seated players is idle; once it has
// been idle this long the room is aborted (friend on the way? give them time).
const IDLE_LOBBY_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POST_GAME_TIMEOUT_MS = 60 * 1000; // 60 seconds

// Mirrors the frontend's STEP_ANIM_MS : bot turns are paced so their moves
// finish animating on screen before the next bot action fires.
const BOT_STEP_ANIM_MS = 220;
// Flat "thinking" pause before a bot rolls, so bot turns don't feel instant.
const BOT_THINK_MS = 500;

// SocketServer is the orchestration root for the ludo engine: it wires the
// engine, Redis pub/sub, bots, post-game lifecycle, and sockets, routing
// each event to the module that owns it (handlers, joins, bots, end-game).
export class SocketServer {
  private io!: Server;
  private httpServer!: http.Server;
  private store: RedisGameStore;
  private engine: LudoEngine;
  private publisher: EventPublisher;
  private broadcaster: RedisBroadcaster;
  private resultSubmitter: ResultSubmitter;
  private handlers: SocketHandlers;
  private botScheduler: BotTurnScheduler;
  private clashManager: ClashManager;
  private postGame: PostGameManager;
  private userIdMap: Map<string, Map<PlayerColor, string>> = new Map();
  constructor() {
    this.store = new RedisGameStore();
    this.publisher = new EventPublisher(this.store);
    this.clashManager = new ClashManager(this.store, this.publisher);
    this.engine = new LudoEngine(this.store, this.clashManager);
    const lobbyManager = new LobbyManager(this.store, this.publisher);
    this.engine.setLobbyManager(lobbyManager);
    this.broadcaster = new RedisBroadcaster();
    this.resultSubmitter = new ResultSubmitter(this.engine, this.store, this.userIdMap, (gameId) =>
      this.cleanupGame(gameId),
    );
    this.botScheduler = new BotTurnScheduler(
      this.store,
      this.engine,
      this.userIdMap,
      getOrCreateBot,
    );
    this.postGame = new PostGameManager(
      () => this.io,
      this.store,
      this.engine,
      this.publisher,
      POST_GAME_TIMEOUT_MS,
      (gameId) => this.cleanupGame(gameId),
    );
    this.handlers = new SocketHandlers(
      this.store,
      this.engine,
      this.userIdMap,
      getOrCreateBot,
      (gameId) => this.botScheduler.schedule(gameId, BOT_THINK_MS),
      (gameId) => {
        // A grace timeout dropped the room below the minimum human count
        // (or a bot-mode disconnect window fully expired): tell any
        // surviving client the room is gone so they leave cleanly.
        this.io.to(gameId).emit('game_expired');
        this.cleanupGame(gameId);
      },
    );
    // Subscribe to engine events: the engine detects lifecycle changes once, here.
    this.engine.onEvent((event) => {
      this.publisher.publish(event);

      if (event.type === 'game_ended') {
        this.postGame.onGameEnded(event.gameId);
        this.resultSubmitter.submitGameResult(event.gameId);
      } else if (event.type === 'game_started') {
        this.botScheduler.schedule(event.gameId, BOT_THINK_MS);
        this.resultSubmitter.notifyGameStarted(event.gameId);
      } else if (event.type === 'piece_moved') {
        // Wait for the move's box-by-box animation to finish on screen
        // (path.length steps) plus a short thinking pause before acting again.
        // A clash-resolved move keeps the game frozen for the 3s result
        // card, so the bot must stand down for that too.
        const animMs = event.result.path.length * BOT_STEP_ANIM_MS;
        const clashCardMs = event.result.clashOutcome ? CLASH_RESULT_FREEZE_MS : 0;
        this.botScheduler.schedule(event.gameId, animMs + BOT_THINK_MS + clashCardMs);
      } else if (event.type === 'dice_rolled') {
        // Only trigger bot turn if no legal moves (turn auto-advanced)
        // Wait for the 750ms frontend dice-roll animation plus thinking pause
        if (event.legalMoves.length === 0) {
          this.botScheduler.schedule(event.gameId, 750 + BOT_THINK_MS);
        }
      } else if (event.type === 'clash_start') {
        // Bots stand down during the whole QTE (presses are driven by clash_engine).
        this.botScheduler.setClashFreeze(event.gameId, event.announceDeadline);
      } else if (event.type === 'clash_result') {
        // Stand down through the client's result card before resuming turns.
        this.botScheduler.setClashFreeze(event.gameId, Date.now() + CLASH_RESULT_FREEZE_MS);
      }
    });
  }

  async start(port: number): Promise<void> {
    await this.store.connect();

    // Boot-time clash recovery: re-arm phase timers for any persisted
    // clashes and sweep every 5s for orphaned/stalled QTE states.
    this.engine.startClashRecoverySweep();

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
        origin: process.env.CORS_ORIGIN || '*',
        methods: ['GET', 'POST'],
      },
    });

    this.broadcaster.start(this.io);
    this.setupSocketHandlers();

    this.httpServer.listen(port, () => {
      console.log(`Ludo engine listening on port ${port}`);
    });

    // Periodic check for expired lobbies
    setInterval(() => this.checkExpiredLobbies(), 60 * 1000);
  }

  async stop(): Promise<void> {
    await this.store.disconnect();
    await this.broadcaster.disconnect();
    this.httpServer.close();
  }
  private cleanupGame(gameId: string): void {
    this.userIdMap.delete(gameId);
    this.botScheduler.clear(gameId);
  }

  // Periodic sweep (1-minute interval) that aborts WAITING PvP rooms with
  // fewer than 2 seated players after the IDLE_LOBBY_TIMEOUT_MS timeout.
  private async checkExpiredLobbies(): Promise<void> {
    const now = Date.now();
    const matchKeys = await this.store.scanMatchKeys();
    for (const key of matchKeys) {
      const match = await this.store.getMatchData(key.slice('match:'.length));
      if (!match || match.status !== 'WAITING') continue;

      // A seat is seated only while its player is present: a reserved slot
      // (player<N>_left) keeps its row so the owner can reclaim the color, but it
      // must not keep the idle timer running, or an abandoned room never expires.
      const seatedCount = [1, 2, 3, 4].filter(
        (n) => match[`player${n}_id`] && !match[`player${n}_left`],
      ).length;

      if (seatedCount >= 2) {
        // Two or more seated players : the idle timer is inactive.
        await this.store.clearIdleSince(match.id);
        continue;
      }

      // Idle room (< 2 seated). Stamp the idle start on first encounter
      // (hsetnx : a pre-existing stamp is kept), then abort once the
      // room has been idle for the full timeout.
      await this.store.setIdleSince(match.id, now);
      const idleSinceMs = match.idleSince ? parseInt(match.idleSince, 10) : now;
      if (now - idleSinceMs > IDLE_LOBBY_TIMEOUT_MS) {
        this.io.to(match.id).emit('game_expired');
        this.cleanupGame(match.id);
        await this.store.abortMatch(match.id);
        await this.store.deleteGame(match.id);
      }
    }
  }
  // Socket wiring (orchestration only)
  private setupSocketHandlers(): void {
    this.io.use((socket: GameSocket, next) => {
      const token = socket.handshake.auth?.token;
      // A token is mandatory: bots are driven server-side and the SPA always
      // supplies one.
      if (!token) return next(new Error('Authentication required'));

      const payload = verifyToken(token);
      if (!payload) return next(new Error('Invalid token'));

      socket.data.userId = payload.userId;
      socket.data.username = payload.username;
      socket.data.displayName = payload.displayName;
      socket.data.gameId = payload.gameId;
      socket.data.role = payload.role as 'player';
      socket.data.tokenColor = payload.color;
      socket.data.mode = payload.mode as 'pvp' | 'pve' | 'hotseat' | undefined;
      next();
    });

    this.io.on('connection', (socket: GameSocket) => {
      console.log(
        `Client connected: ${socket.id}${socket.data.userId ? ` (user: ${socket.data.userId})` : ''}`,
      );

      socket.on(
        'join_game',
        (gameId: string, playerColor: PlayerColor, userId?: string, displayName?: string) =>
          this.handlers.handleJoinGame(socket, gameId, playerColor, userId, displayName),
      );

      socket.on('roll_dice', () => this.handlers.handleRollDice(socket));

      socket.on('move_piece', (pieceId) => this.handlers.handleMovePiece(socket, pieceId));

      socket.on('player_ready', () => this.handlers.handlePlayerReady(socket));

      socket.on('select_color', (color: string) => this.handlers.handleSelectColor(socket, color));

      socket.on('leave_game', () => this.handlers.handleLeaveGame(socket));

      socket.on('resign', () => this.handlers.handleResign(socket));

      socket.on('end_game', () => this.postGame.handleEndGame(socket));

      socket.on('clash_input', (key: string) => this.handlers.handleClashInput(socket, key));

      socket.on('update_modifiers', (clashEnabled: boolean, safeZones: boolean) =>
        this.handlers.handleUpdateModifiers(socket, clashEnabled, safeZones));

      socket.on('disconnect', () => this.handlers.handleDisconnect(socket));
    });
  }
}
