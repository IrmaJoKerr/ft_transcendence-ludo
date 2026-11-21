import type { GameState, PlayerColor, GameEvent, ExitRecord } from '../types';
import type { RedisGameStore } from '../redis';
import { seatDisplayName } from '../game-chat';
import {
  DISCONNECT_GRACE_MS,
  HOTSEAT_DISCONNECT_GRACE_MS,
  SINGLE_SOCKET_DISCONNECT_GRACE_MS,
  WAITING_SEAT_GRACE_MS,
} from '../timing';
import { COLORS, hasChat, writeSystemChat } from './turn';
import { closeRoom, departSeat, isSingleSocketGame } from './departure';

// How long an away seat may stay away, decided by the room it is in: one hour for a PvE
// simulation (the browser tab is the game), 45 s for a live PvP seat, five minutes for a
// waiting-room seat, and five seconds for hotseat. Hotseat takes the shortest window of
// the four because it is the one room that can afford it: one device drives every seat, a
// reload rejoins in about a second, and a closed tab leaves nothing anyone could play, so
// the room closes itself at expiry instead of holding the lobby's lock-out behind it. It
// still never pauses, because `isSingleSocketGame` is unchanged; only the window it waits
// is. The waiting room is deliberately more relaxed (R12/R17): returning to the lobby
// never costs the seat, so the window is there to notice a player who is not coming back,
// not to punish a quick look away.
function reconnectWindowMs(state: GameState, gameType: string | undefined): number {
  if (gameType === 'HOTSEAT') return HOTSEAT_DISCONNECT_GRACE_MS;
  if (isSingleSocketGame(gameType)) return SINGLE_SOCKET_DISCONNECT_GRACE_MS;
  return state.status === 'waiting' ? WAITING_SEAT_GRACE_MS : DISCONNECT_GRACE_MS;
}

// Arm a seat's reconnect window: mark it 'disconnected' with a deadline instead of
// exiting it, and hand the deadline to whichever caller owns the timer. This is
// the only place a window begins, and it never departs anybody: the expiry is
// expireReconnectGrace's job, which is why this name says what it does.
export async function startReconnectGrace(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  color: PlayerColor,
  onExpire: () => void,
): Promise<void> {
  const state = await store.loadGameState(gameId);
  if (!state) return;

  // Check if already disconnected
  const existing = state.disconnectedPlayers.find((d) => d.color === color);
  if (existing) return; // Already in grace period

  // Only a resumable seat gets a window. An exited or finished seat has all
  // pieces parked at step -1, so reviving it would create a seat that can
  // never make a legal move.
  const player = state.players.find((p) => p.color === color);
  if (player?.status !== 'active' || player.isFinished) return;

  // The window is the room's, not the mode's alone: a waiting-room seat gets five
  // minutes, a live PvP seat 45 s, a single-socket seat an hour.
  const matchData = await store.getMatchData(gameId);
  const windowMs = reconnectWindowMs(state, matchData?.gameType);
  const singleSocket = isSingleSocketGame(matchData?.gameType);

  const deadline = Date.now() + windowMs;
  state.disconnectedPlayers.push({
    color,
    disconnectedAt: Date.now(),
    reconnectDeadline: deadline,
  });

  // Mark player as disconnected (not exited : they can still reconnect). The
  // guard above already proved this is a live, unfinished seat.
  player.status = 'disconnected';
  player.isConnected = false;

  // Pause only when the dropped player holds the turn: the game waits there
  // for a reconnect or a prune. PvE and hotseat never pause, and neither does a
  // waiting room, where there is no turn to hold.
  if (!singleSocket && state.currentTurn === color && state.status === 'active') {
    state.paused = true;
    state.pauseTurnOwner = color;
    state.pausedReason = 'disconnect_grace';
  }

  await store.saveGameState(gameId, state);
  // Announce a TEMPORARY disconnect: the player stays visible as
  // 'disconnected' so the host sees "Reconnecting…" : player_exited fires
  // only on genuine permanent exit.
  emit({ type: 'player_disconnected', gameId, color });
  // If the game froze on this seat, push the paused state out so every client
  // shows the pause banner immediately instead of waiting for the next unrelated
  // event to sync them.
  if (state.paused && state.status === 'active') {
    emit({ type: 'state_update', gameId, state });
  }

  // Expiry is a reconnect deadline, not a forfeit. The window lives in Redis,
  // so the server sweep can replay this call after a restart. The timer is armed
  // one second past the deadline, so an expiry that fires early re-reads and waits
  // rather than pruning a seat a client was still reconnecting to.
  setTimeout(onExpire, windowMs + 1000);
}

// Settle an expired reconnect window: a waiting-room participant's seat is
// released, a waiting-room host's room is closed, and a live-game seat departs
// through the funnel. Safe to call repeatedly; it no-ops unless the deadline has
// passed.
export async function expireReconnectGrace(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  color: PlayerColor,
  notifyAbort?: (gameId: string) => void,
  submitExits?: (gameId: string, records: ExitRecord[]) => void | Promise<void>,
): Promise<{ closed: boolean }> {
  const state = await store.loadGameState(gameId);
  if (!state) return { closed: false };

  const disc = state.disconnectedPlayers.find((d) => d.color === color);
  if (!disc) return { closed: false }; // Already reconnected or already pruned
  if (Date.now() < disc.reconnectDeadline) return { closed: false }; // Window still open

  const matchData = await store.getMatchData(gameId);

  // A single-socket room belongs to one device: with that device gone there is
  // nothing left to play, whatever the room's status was.
  if (isSingleSocketGame(matchData?.gameType)) {
    await closeRoom(store, emit, gameId, notifyAbort, submitExits);
    return { closed: true };
  }

  if (state.status === 'waiting') {
    const player = state.players.find((p) => p.color === color);
    // An absent host can never start the room: the start gate needs every active
    // seat ready, and only the host's own socket can mark their seat ready. So the
    // host's five minutes close the room, participants present or not (R17). The
    // hash's seat row is the authority for which corner the host sits in.
    const slot = COLORS.indexOf(color) + 1;
    const hostSeat =
      !!matchData?.hostId &&
      (matchData[`player${slot}_id`] === matchData.hostId || player?.userId === matchData.hostId);
    if (hostSeat) {
      await closeRoom(store, emit, gameId, notifyAbort, submitExits);
      return { closed: true };
    }

    // A participant's five minutes release the seat, exactly as an abort would,
    // and clearMatchSeat stamps a fresh idle clock, so a now-lonely host gets its
    // own full window instead of inheriting the old one.
    if (!player) return { closed: false };
    player.status = 'inactive';
    player.isConnected = false;
    state.disconnectedPlayers = state.disconnectedPlayers.filter((d) => d.color !== color);
    await store.saveGameState(gameId, state);
    // The same line a manual Abort writes: the seat is gone, and how it went changes
    // nothing the room can see.
    if (hasChat(matchData)) {
      await writeSystemChat(store, emit, gameId, 'left', seatDisplayName(state, color));
    }
    emit({ type: 'player_exited', gameId, color });
    await store.clearMatchSeat(gameId, color);
    return { closed: false };
  }

  return departSeat(store, emit, gameId, color, 'timeout', notifyAbort, submitExits);
}

// Reconnect inside the grace window. Returns false when the window outlived
// the seat, so the caller must reject the join and tell the client the seat is
// gone. A reported displayName refreshes the shown name.
export async function restoreSeatOnReconnect(
  store: RedisGameStore,
  gameId: string,
  color: PlayerColor,
  displayName?: string,
): Promise<boolean> {
  const state = await store.loadGameState(gameId);
  if (!state) return false;

  const discIndex = state.disconnectedPlayers.findIndex((d) => d.color === color);
  if (discIndex === -1) return false; // Not in grace period

  const disc = state.disconnectedPlayers[discIndex];
  if (Date.now() > disc.reconnectDeadline) {
    // Too late : player is already forfeited
    return false;
  }

  // The window always clears, even when nothing is restored : a stale entry
  // must never linger, or the next join_game would take the reconnect branch
  // again and resurrect this seat.
  state.disconnectedPlayers.splice(discIndex, 1);

  // Restore only a seat a disconnect actually parked; a pruned or finished
  // seat has no pieces left to resume with, so removal stays final.
  const player = state.players.find((p) => p.color === color);
  const revived = !!player && player.status === 'disconnected' && !player.isFinished;
  if (player && revived) {
    player.status = 'active';
    player.isConnected = true;
    if (displayName) player.displayName = displayName;
  }

  // If the game was paused waiting for this player, clear the pause so the
  // game can resume. Without this the game stays paused on a now-active
  // player: no one can end their turn to trigger clearance in advanceTurnInState.
  if (state.paused && state.pauseTurnOwner === color && player?.status === 'active') {
    delete state.paused;
    delete state.pauseTurnOwner;
    delete state.pausedReason;
  }

  await store.saveGameState(gameId, state);
  return revived;
}
