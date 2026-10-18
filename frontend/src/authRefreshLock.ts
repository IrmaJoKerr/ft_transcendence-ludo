// Cross-tab coordination for POST /api/auth/refresh. The refresh token is one
// httpOnly cookie shared by every tab, and rotation consumes it, so two tabs
// refreshing together leave the second with a 401 that reads as signed out.

/** How this tab took part in one refresh round. */
export type RefreshLease<T> =
  | {
      // This tab owns the refresh: post, then publish the result and release.
      role: 'leader';
      publish: (result: T) => void;
      release: () => void;
    }
  | {
      // Another tab owns it: wait for its result. null means nobody reported
      // one (no channel, or the leader died), so refresh here instead.
      role: 'follower';
      awaitResult: () => Promise<T | null>;
    };

/** Per-page view of the cross-tab refresh lock. */
export interface RefreshLock {
  acquire<T>(): RefreshLease<T>;
}

// A refresh round trip is sub-second; the TTL only has to outlast a slow one.
const LOCK_TTL_MS = 10_000;
// How long a follower waits for the leader's result before refreshing itself.
const RESULT_WAIT_MS = 3_000;
const RESULT_POLL_MS = 100;
const LOCK_KEY = 'lr.authRefreshLock';
const CHANNEL_NAME = 'lr.authRefresh';

type LockRecord = { tab: string; ts: number };
type Announcement = { lockTs: number; result: unknown };

export function createRefreshLock(): RefreshLock {
  // Identifies this page among the tabs sharing the storage area.
  const tabId = Math.random().toString(36).slice(2);
  let channel: BroadcastChannel | null = null;
  let announced: Announcement | null = null;

  // Storage access throws outright when it is blocked (private mode), so both
  // halves are guarded: no lock is better than a refresh that cannot run.
  function store(): Storage | null {
    const bag = globalThis as { localStorage?: Storage };
    try {
      return bag.localStorage ?? null;
    } catch {
      return null;
    }
  }

  function readLock(): LockRecord | null {
    const storage = store();
    if (!storage) return null;
    try {
      const raw = storage.getItem(LOCK_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<LockRecord>;
      if (typeof parsed.tab !== 'string' || typeof parsed.ts !== 'number') return null;
      return { tab: parsed.tab, ts: parsed.ts };
    } catch {
      return null;
    }
  }

  function writeLock(lock: LockRecord | null): void {
    const storage = store();
    if (!storage) return;
    try {
      if (lock) storage.setItem(LOCK_KEY, JSON.stringify(lock));
      else storage.removeItem(LOCK_KEY);
    } catch {
      // Full or blocked storage: coordination degrades to the pre-fix
      // behaviour, and the /me probe still recovers that duplicate.
    }
  }

  // A fresh claim held by another tab becomes this tab's follower lease. A claim
  // of our own is ignored here: acquire() is already serialized per page.
  function followerLease<T>(lock: LockRecord | null): RefreshLease<T> | null {
    if (!lock) return null;
    if (lock.tab === tabId) return null;
    if (Date.now() - lock.ts >= LOCK_TTL_MS) return null;
    return { role: 'follower', awaitResult: () => awaitResult<T>(lock.ts) };
  }

  // Claim the refresh. localStorage has no atomic compare-and-set, so write and read
  // back: if another tab wrote after us, its record is the one we see and it keeps the
  // claim. Of two racing claims at most one survives.
  function claim(): LockRecord | null {
    const mine: LockRecord = { tab: tabId, ts: Date.now() };
    writeLock(mine);
    const after = readLock();
    if (!after) return null;
    if (after.tab !== mine.tab || after.ts !== mine.ts) return null;
    return after;
  }

  function openChannel(): BroadcastChannel | null {
    if (channel) return channel;
    // Read as optional: the constructor is absent on older browsers, and the
    // throw when it is missing would land in the middle of an auth retry.
    const bag = globalThis as { BroadcastChannel?: typeof BroadcastChannel };
    try {
      if (!bag.BroadcastChannel) return null;
      channel = new bag.BroadcastChannel(CHANNEL_NAME);
    } catch {
      return null;
    }
    // Remember the latest announcement: a follower can start waiting a moment
    // after the message fired, and the latest record is cheaper than a listener per wait.
    channel.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as Partial<Announcement> | null;
      if (typeof data?.lockTs !== 'number') return;
      if (data.result === undefined) return;
      announced = { lockTs: data.lockTs, result: data.result };
    });
    return channel;
  }

  function awaitResult<T>(lockTs: number): Promise<T | null> {
    // No channel, nothing to hear: do not make the caller wait for a timeout.
    if (!openChannel()) return Promise.resolve(null);
    const deadline = Date.now() + RESULT_WAIT_MS;
    return new Promise((resolve) => {
      const poll = (): void => {
        const seen = announced;
        if (seen !== null && seen.lockTs === lockTs) {
          resolve(seen.result as T);
          return;
        }
        if (Date.now() >= deadline) {
          resolve(null);
          return;
        }
        setTimeout(poll, RESULT_POLL_MS);
      };
      poll();
    });
  }

  return {
    acquire<T>(): RefreshLease<T> {
      const held = followerLease<T>(readLock());
      if (held) return held;
      const mine = claim();
      if (mine) {
        return {
          role: 'leader',
          publish: (result: T): void => {
            const bus = openChannel();
            if (!bus) return;
            bus.postMessage({ lockTs: mine.ts, result });
          },
          release: (): void => {
            // Only clear our own record: a claim that went stale (long block,
            // clock jump) must not drop the new owner's lock.
            const current = readLock();
            if (!current) return;
            if (current.tab !== mine.tab || current.ts !== mine.ts) return;
            writeLock(null);
          },
        };
      }
      const winner = followerLease<T>(readLock());
      if (winner) return winner;
      // No storage, or the record vanished between the two reads: refresh here
      // rather than stall. A duplicate POST is what this module removes, but a
      // request that never completes is worse, and the probe covers that case.
      return { role: 'follower', awaitResult: () => Promise.resolve(null) };
    },
  };
}
