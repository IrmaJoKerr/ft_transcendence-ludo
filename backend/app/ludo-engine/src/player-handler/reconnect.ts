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

// Away window by room: one hour for PvE, 45 s for live PvP, five minutes for a waiting
// seat, and five seconds for hotseat. Hotseat never pauses and closes at expiry; the
// waiting room is relaxed so a lobby visit never costs the seat.
function reconnectWindowMs(state: GameState, gameType: string | undefined): number {
  if (gameType === 'HOTSEAT') return HOTSEAT_DISCONNECT_GRACE_MS;
  if (isSingleSocketGame(gameType)) return SINGLE_SOCKET_DISCONNECT_GRACE_MS;
  return state.status === 'waiting' ? WAITING_SEAT_GRACE_MS : DISCONNECT_GRACE_MS;
}

// Arm a reconnect window: mark the seat disconnected with a deadline and return it to
// the caller's timer. Only `expireReconnectGrace` departs the seat.
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

  // Expiry is a deadline, not a forfeit. The Redis window lets a restart replay it; the
  // timer runs one second late so an early fire re-reads instead of pruning.
  setTimeout(onExpire, windowMs + 1000);
}

// Settle an expired window: release a waiting participant, close a waiting host's room,
// or depart a live seat. Idempotent while the deadline has not passed.
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
    // An absent host blocks the start gate, so the host's window closes the room. The
    // hash's seat row identifies the host's corner.
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
