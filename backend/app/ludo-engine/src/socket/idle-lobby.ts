import type { RedisGameStore } from '../redis';
import type { RoomRegistry } from './room-context';

// Seats the match hash counts as occupied right now. A seat is seated only while its
// player is present: a reserved slot keeps its row so the owner can reclaim the
// colour, but it must not hold the idle window open.
export function seatedCount(match: Record<string, string>): number {
  return [1, 2, 3, 4].filter((n) => match[`player${n}_id`] && !match[`player${n}_left`]).length;
}

// IdleLobbyWatcher owns one rule: a WAITING room with fewer than two seated
// players is aborted once it has been idle for `timeoutMs`.
//
// It replaces the old 60 s lobby scan. The deadline itself is durable (the
// match hash's `idleSince` stamp), and the local timer lives in the room's
// RoomContext, so:
//   - a refill cancels the window (and clears the stamp);
//   - a departure arms it, at the departure event, without any polling;
//   - a restart or a Redis blip replays the stamp in the wake pass.
export class IdleLobbyWatcher {
  constructor(
    private store: RedisGameStore,
    private rooms: RoomRegistry,
    private timeoutMs: number,
    // How a due room dies: teardownRoom + the server's in-memory cleanup.
    private expireRoom: (gameId: string) => Promise<void>,
  ) {}

  // Re-evaluate one room. Idempotent and cheap (one HGETALL): called on every
  // join, on every departure event, and once per room by the wake pass.
  async refresh(gameId: string): Promise<void> {
    const match = await this.store.getMatchData(gameId);

    // Only WAITING rooms idle. A live game is governed by quorum and the
    // reconnect grace windows, a finished one by the post-game timer, and a
    // missing match hash means the room is gone.
    if (!match || match.status !== 'WAITING') {
      this.rooms.get(gameId)?.cancelIdle();
      if (match) await this.store.clearIdleSince(gameId);
      return;
    }

    if (seatedCount(match) >= 2) {
      // Two or more seated players: the idle window is inactive.
      this.rooms.get(gameId)?.cancelIdle();
      await this.store.clearIdleSince(gameId);
      return;
    }

    // Below quorum: persist the deadline before arming the timer (write-ahead,
    // so a crash in between is replayed at the next wake). hsetnx keeps an
    // existing stamp, so the window never restarts on a repeated refresh.
    const idleSince = await this.store.setIdleSince(gameId, Date.now());
    this.scheduleExpiry(gameId, idleSince);
  }

  // Wake pass: settle every match that exists, including rooms the engine has no
  // game state for (created but never joined, or dropped below quorum by a
  // backend-only departure).
  async sweepAll(): Promise<void> {
    const matchKeys = await this.store.scanMatchKeys();
    for (const key of matchKeys) {
      const gameId = key.slice('match:'.length);
      try {
        await this.refresh(gameId);
      } catch (err) {
        console.error(
          `[idle] failed to evaluate room ${gameId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  private scheduleExpiry(gameId: string, idleSince: number): void {
    const remaining = this.timeoutMs - (Date.now() - idleSince);
    if (remaining <= 0) {
      void this.expireIfDue(gameId);
      return;
    }
    this.rooms.ensure(gameId).armIdle(remaining, () => {
      void this.expireIfDue(gameId);
    });
  }

  // Validate-then-act: a room is re-read before it is aborted, so a refill that
  // landed while the timer fired keeps the room alive. Safe to call repeatedly;
  // it only aborts a room that is still idle past the timeout.
  private async expireIfDue(gameId: string): Promise<void> {
    try {
      const match = await this.store.getMatchData(gameId);
      if (!match || match.status !== 'WAITING' || seatedCount(match) >= 2) {
        this.rooms.get(gameId)?.cancelIdle();
        if (match) await this.store.clearIdleSince(gameId);
        return;
      }

      const idleSince = match.idleSince ? parseInt(match.idleSince, 10) : Date.now();
      if (Date.now() - idleSince >= this.timeoutMs) {
        // Re-read before aborting: the decision must survive one more round trip,
        // so a refill that landed while this callback was waiting keeps the room
        // alive instead of losing it to a race with its own timer.
        const fresh = await this.store.getMatchData(gameId);
        if (fresh && fresh.status === 'WAITING' && fresh.idleSince && seatedCount(fresh) < 2) {
          await this.expireRoom(gameId);
        } else {
          await this.refresh(gameId);
        }
        return;
      }

      // Not due yet (the stamp was refreshed): re-arm for the remainder.
      this.scheduleExpiry(gameId, idleSince);
    } catch (err) {
      // The callback is not awaited by the runtime: an unhandled rejection here
      // would end the engine process, not just this room.
      console.error(
        `[idle] failed to expire idle room ${gameId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
