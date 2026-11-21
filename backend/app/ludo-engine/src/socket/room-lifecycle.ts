import type { RedisGameStore } from '../redis';
import type { LudoEngine } from '../engine';
import type { RoomRegistry } from './room-context';
import type { IdleLobbyWatcher } from './idle-lobby';
import type { PostGameManager } from './post-game';
import type { BotTurnScheduler } from './bot-scheduler';
import type { ResultSubmitter } from './result-submitter';
import type { GameSocket } from './auth';
import { closeRoom } from '../player-handler';
import { isBotSeat } from '../bot';
import { BOT_THINK_MS } from '../timing';

interface RoomLifecycleDeps {
  store: RedisGameStore;
  rooms: RoomRegistry;
  idleLobby: IdleLobbyWatcher;
  engine: LudoEngine;
  postGame: PostGameManager;
  botScheduler: BotTurnScheduler;
  resultSubmitter: ResultSubmitter;
  // The room channel is built in start(), after this class; the hook lets its
  // per-room transcript be dropped with the rest of the room state.
  forgetChat: (gameId: string) => void;
}

// The room's in-process lifecycle: what is dropped, what is replayed after a
// restart or a Redis reconnect, and what a guest's exit settles. The socket
// registrations stay in server.ts so the wiring and the harness markers do too.
export class RoomLifecycle {
  // Guards against overlapping wake passes (a Redis reconnect during a boot wake).
  private wakeInFlight = false;

  constructor(private readonly deps: RoomLifecycleDeps) {}

  // Drop a room's in-memory state: its RoomContext (seat bindings + timers), its pending
  // bot turn and the clash engine's own entries for it (a card hold nobody may report and
  // the two chain timers). Called on teardown, and by the wake pass when an entry has no
  // state behind it.
  cleanupGame(gameId: string): void {
    this.deps.rooms.delete(gameId);
    this.deps.botScheduler.clear(gameId);
    this.deps.engine.forgetClash(gameId);
    this.deps.idleLobby.forget(gameId);
    this.deps.forgetChat(gameId);
  }

  // Abort an idle lobby: closeRoom emits game_expired, aborts the match and
  // deletes the game state; its notify callback drops the in-memory context. A
  // waiting room writes no match rows, so the record callback is a no-op here.
  async expireIdleLobby(gameId: string): Promise<void> {
    await closeRoom(
      this.deps.store,
      (event) => {
        this.deps.engine.emitEvent(event);
      },
      gameId,
      (id) => {
        this.cleanupGame(id);
      },
      (id, records) => this.deps.resultSubmitter.submitExits(id, records),
    );
  }

  // The wake pass: one scan of durable deadlines, then sleep. It runs at boot,
  // after store.connect(), and on every Redis reconnect, so a lost timer is
  // replayed instead of leaving its room frozen. Replay re-validates, so it is safe.
  async wake(reason: string): Promise<void> {
    if (this.wakeInFlight) {
      console.log(`[engine] wake pass (${reason}) skipped: another pass is running`);
      return;
    }
    this.wakeInFlight = true;
    try {
      console.log(`[engine] wake pass (${reason}): replaying durable deadlines`);
      const gameKeys = await this.deps.store.scanGameKeys();
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
      await this.deps.idleLobby.sweepAll();
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
  async rebuildRoom(gameId: string): Promise<void> {
    const state = await this.deps.store.loadGameState(gameId);
    if (!state) {
      // Both keys gone: nothing to rebuild, drop the stale entry.
      this.cleanupGame(gameId);
      return;
    }

    // Seat bindings are persisted per player, so they survive a restart too.
    this.deps.rooms.ensure(gameId).rebuild(state);

    for (const disc of state.disconnectedPlayers) {
      const remaining = disc.reconnectDeadline - Date.now();
      if (remaining > 0) {
        // The deadline is durable, the process timer is not: resume the remainder
        // instead of leaving the seat away with nothing left to settle it.
        this.deps.engine.rearmReconnectGrace(gameId, disc.color, remaining, (id) => {
          this.cleanupGame(id);
        });
        continue;
      }
      // Re-checks the deadline itself, so racing an in-flight grace timer is safe.
      // The expiry owns the waiting-room fork too: a released seat, or a closed room
      // when the absent seat was the host's.
      await this.deps.engine.expireReconnectGrace(gameId, disc.color, (id) => {
        this.cleanupGame(id);
      });
    }

    // Reload: an expiry above can advance the turn, end the game, or tear the
    // room down entirely.
    const current = await this.deps.store.loadGameState(gameId);
    if (!current) {
      this.cleanupGame(gameId);
      return;
    }

    // Bot detection reads the persisted seat: the in-memory binding map is empty
    // after a restart, and reading it here is what froze bot games.
    if (current.status === 'active' && isBotSeat(current, current.currentTurn)) {
      this.deps.botScheduler.schedule(gameId, BOT_THINK_MS);
    }

    // The finished room's 60 s expiry timer is in-process only, so re-arm it.
    if (current.status === 'finished') {
      this.deps.postGame.onGameEnded(gameId);
      // A finished room whose report never landed (a crash between the save and the
      // POST, or a backend that refused it) is the one case nothing else retries: the
      // event that started the delivery is long gone, and the state is what the retry
      // validates against. R21's authoritative-state pass.
      if (!current.resultSubmitted) void this.deps.resultSubmitter.submitGameResult(gameId);
    }

    // A departure whose row never landed is retried here: the record is still on the
    // seat, so a restart, a Redis reconnect or the room's next wake finishes the job.
    const pendingExits = current.players
      .map((player) => player.exitRecord)
      .filter((record) => Boolean(record) && !record?.submitted);
    if (pendingExits.length > 0) {
      void this.deps.resultSubmitter.submitExits(
        gameId,
        pendingExits.filter((record) => record !== undefined),
      );
    }

    await this.deps.idleLobby.refresh(gameId);
  }

  // Guest settlement, once per socket: price the abort against the address, give
  // the concurrency slots back, then revoke the token. Runs after teardown on
  // end_game and on leave_game; it never disconnects the socket.
  async settleGuestExit(socket: GameSocket): Promise<void> {
    if (!socket.data.isGuest || socket.data.guestSettled) return;
    socket.data.guestSettled = true;
    try {
      await this.deps.store.settleGuestAbort(socket.data.guestIpHash ?? '');
      await this.deps.store.revokeGuestToken(socket.data.guestTokenHash ?? '');
    } catch (error) {
      console.error('Guest settlement failed:', error instanceof Error ? error.message : error);
    }
  }
}
