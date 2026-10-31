import type { GameState, PlayerColor, GameEvent, DepartureReason } from './types';
import type { RedisGameStore } from './redis';
import { DISCONNECT_GRACE_MS, SINGLE_SOCKET_DISCONNECT_GRACE_MS } from './timing';

const COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

// First active seat in color order. currentTurn must always point at a
// seated color : pre-game color swaps mean 'blue' isn't guaranteed occupied,
// and an inactive currentTurn soft-locks the game.
export function firstActiveColor(state: GameState): PlayerColor | undefined {
  return COLORS.find((c) => state.players.find((p) => p.color === c)?.status === 'active');
}

// Move to the next seat that can play, scanning state.players[] in order.
// Exited seats are skipped; a disconnected seat with an open grace window holds
// the turn. Clears the paused flag once its owner reconnects or is pruned.
export function advanceTurnInState(state: GameState): void {
  // If paused, check if the pause owner has reconnected or been pruned
  if (state.paused) {
    const pausedPlayer = state.players.find((p) => p.color === state.pauseTurnOwner);
    if (pausedPlayer?.status === 'active' || pausedPlayer?.status === 'exited') {
      // Past the grace window: clear the pause and continue advancing
      delete state.paused;
      delete state.pauseTurnOwner;
      delete state.pausedReason;
    } else {
      // Still in grace window: stay paused
      return;
    }
  }

  if (state.players.length === 0) {
    state.status = 'finished';
    return;
  }

  // Find current turn index in players array
  const currentIdx = state.players.findIndex((p) => p.color === state.currentTurn);
  if (currentIdx === -1) {
    state.status = 'finished';
    return;
  }

  let loopCount = 0;
  let nextIdx = (currentIdx + 1) % state.players.length;
  while (loopCount < state.players.length) {
    const p = state.players[nextIdx];
    if (p.status === 'active') {
      state.currentTurn = p.color;
      break;
    }
    if (p.status === 'disconnected') {
      const disc = state.disconnectedPlayers.find((d) => d.color === p.color);
      if (disc && Date.now() < disc.reconnectDeadline) {
        // The turn waits on this seat; a reconnect resumes it in place.
        state.currentTurn = p.color;
        break;
      }
    }
    // 'exited' or 'inactive' or expired disconnected: skip
    nextIdx = (nextIdx + 1) % state.players.length;
    loopCount++;
  }

  if (loopCount >= state.players.length) {
    // No active player found
    state.status = 'finished';
    return;
  }

  state.firstRollOfTurn = true;
  // Clear the previous player's turn snapshot: the pending roll and moves
  // belong to them, and keeping them blocks the next player from acting.
  state.turnPhase = 'WAITING_FOR_ROLL';
  state.pendingLegalMoves = [];
  state.pendingDiceValue = undefined;
  state.pendingIsFirstRoll = undefined;
  // The Wall Breaker arm switch is turn-scoped too: clash mode grants the
  // OPPORTUNITY to break a wall, and each turn the player decides again. A seat
  // that lost the turn cannot leave an arm behind for a later roll.
  for (const p of state.players) delete p.barrierArmed;
  const nextPlayer = state.players.find((p) => p.color === state.currentTurn);
  if (nextPlayer) {
    // Reset the new player's turn-scoped flags so nothing leaks across turns:
    // the 6-streak, the "already rolled" flag, and a bonus roll they never
    // earned.
    nextPlayer.consecutiveSixes = 0;
    nextPlayer.hasRolled = false;
    nextPlayer.bonusRoll = false;
  }
}

// Handle a player disconnect: mark them 'disconnected' with a grace window
// (PvP 45s, bot-mode 1h) instead of an instant exit; reconnect clears it.
export async function handlePlayerDisconnect(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  color: PlayerColor,
  notifyAbort?: (gameId: string) => void,
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

  // Single-instance games (PvE, hotseat) use the long reconnect window; PvP
  // uses the short one.
  const matchData = await store.getMatchData(gameId);
  const isSingleSocketMode = matchData?.gameType === 'PVE' || matchData?.gameType === 'HOTSEAT';
  const graceMs = isSingleSocketMode
    ? SINGLE_SOCKET_DISCONNECT_GRACE_MS
    : DISCONNECT_GRACE_MS + 1000;

  const deadline =
    Date.now() + (isSingleSocketMode ? SINGLE_SOCKET_DISCONNECT_GRACE_MS : DISCONNECT_GRACE_MS);
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
  // for a reconnect or a prune. PvE and hotseat never pause.
  if (!isSingleSocketMode && state.currentTurn === color && state.status === 'active') {
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
  // so the server sweep can replay this call after a restart.
  setTimeout(() => {
    void expireDisconnectedPlayer(store, emit, gameId, color, notifyAbort);
  }, graceMs);
}

// Expire a grace window: prune the seat, or abort the room when too few humans
// remain. Safe to call repeatedly; it no-ops unless the deadline has passed.
export async function expireDisconnectedPlayer(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  color: PlayerColor,
  notifyAbort?: (gameId: string) => void,
): Promise<void> {
  const state = await store.loadGameState(gameId);
  if (!state) return;

  const disc = state.disconnectedPlayers.find((d) => d.color === color);
  if (!disc) return; // Already reconnected or already pruned
  if (Date.now() < disc.reconnectDeadline) return; // Window still open

  const matchData = await store.getMatchData(gameId);
  const isSingleSocketMode = matchData?.gameType === 'PVE' || matchData?.gameType === 'HOTSEAT';

  // Single-instance modes tear the whole room down; PvP relies on the quorum
  // check inside finalizeDeparture.
  await finalizeDeparture(store, emit, gameId, color, 'timeout', notifyAbort);
  if (isSingleSocketMode) {
    await teardownRoom(store, emit, gameId, notifyAbort);
  }
}

// Reconnect inside the grace window. Returns false when the window outlived
// the seat, so the caller must reject the join. A reported displayName
// refreshes the shown name.
export async function handlePlayerReconnect(
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

// Handle a player clicking "ready". When every active seat is ready the
// game transitions to 'active'.
export async function handlePlayerReady(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  color: PlayerColor,
): Promise<void> {
  const state = await store.loadGameState(gameId);
  if (state?.status !== 'waiting') return;

  // Add to ready list if not already there
  if (!state.readyPlayers.includes(color)) {
    state.readyPlayers.push(color);
  }

  await store.saveGameState(gameId, state);

  // Start gate: at least 2 active seats and every one of them ready. A lone
  // host marking themselves ready must not flip a pvp match to 'active' with
  // nobody else in the room.
  const activeCount = state.players.filter((p) => p.status === 'active').length;
  const allReady =
    activeCount >= 2 &&
    state.players
      .filter((p) => p.status === 'active')
      .every((p) => state.readyPlayers.includes(p.color));

  if (allReady) {
    state.currentTurn = firstActiveColor(state) ?? state.currentTurn;
    state.status = 'active';
    await store.saveGameState(gameId, state);
    emit({ type: 'game_started', gameId });
  }
}

// Unified exit-path helper functions

// The one place a seat leaves a game. The reason selects the per-case body:
// a waiting-room leave is reversible, the other reasons mark the seat exited.
export async function finalizeDeparture(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  color: PlayerColor,
  reason: DepartureReason,
  notifyAbort?: (gameId: string) => void,
): Promise<void> {
  const state = await store.loadGameState(gameId);
  if (!state) return;

  // Idempotency guard: a seat already terminal is a no-op.
  const player = state.players.find((p) => p.color === color);
  if (!player || player.status === 'exited' || player.status === 'inactive') return;

  // Clear any grace entry for this colour.
  state.disconnectedPlayers = state.disconnectedPlayers.filter((d) => d.color !== color);

  // Per-reason body.
  if (reason === 'waiting_leave') {
    // Waiting room: reversible leave. Set inactive, keep pieces untouched,
    // keep isFinished untouched (a stale finished flag would make the player look
    // already done at game start). Reserve the seat so rejoin returns the same colour.
    if (state.status === 'waiting') {
      player.status = 'inactive';
      player.isConnected = false;
      await store.saveGameState(gameId, state);
      await store.reserveMatchSeat(gameId, color);
      emit({ type: 'player_exited', gameId, color });
      return;
    }
    // Fall through to live-game handling if the room started while they were leaving.
  }

  // Live-game departure (timeout, leave, end_game): park pieces, mark exited.
  for (const piece of state.pieces.filter((p) => p.color === color)) {
    piece.step = -1;
  }
  player.status = 'exited';
  player.isConnected = false;
  player.isFinished = true;
  // The reason is the seat's record, not a fifth status: a reloaded client labels
  // the seat from it, and three sites branch on status alone.
  player.departedReason = reason;

  // End Game button frees the seat outright so the room can hand it to someone else.
  if (reason === 'end_game') {
    await store.clearMatchSeat(gameId, color);
  }

  // If the game was paused waiting for this player, clear the pause so the
  // game doesn't stall on a pruned seat. advanceTurnInState will move to the
  // next player who can take the turn.
  if (state.paused && state.pauseTurnOwner === color) {
    delete state.paused;
    delete state.pauseTurnOwner;
    delete state.pausedReason;
  }

  // Advance the turn if it was theirs.
  if (state.currentTurn === color && state.status === 'active') {
    advanceTurnInState(state);
  }

  // Cancel any capture race this seat was in. Clearing BOTH halves of the
  // deferred move makes the still-armed clash timer a no-op (resolveClashOutcome
  // returns early without pendingCapture).
  delete state.clash;
  delete state.pendingCapture;

  await store.saveGameState(gameId, state);
  emit({ type: 'player_exited', gameId, color });
  // The turn may have moved and the departed seat's pieces are gone; clients
  // need this frame to stop rendering the old turn.
  if (state.status === 'active') {
    emit({ type: 'state_update', gameId, state });
  }

  // Evaluate quorum; if lost, tear the room down.
  if (!hasQuorum(state)) {
    await teardownRoom(store, emit, gameId, notifyAbort);
  }
}

// The one place a room is torn down: emit game_expired, abort the match, delete
// the game state, and run the in-memory cleanup callback.
export async function teardownRoom(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  notify?: (gameId: string) => void,
): Promise<void> {
  emit({ type: 'game_expired', gameId });
  await store.abortMatch(gameId);
  await store.deleteGame(gameId);
  notify?.(gameId);
}

// A room can continue only with at least two active human seats.
export function hasQuorum(state: GameState): boolean {
  return state.players.filter((p) => p.status === 'active' && !p.isBot).length >= 2;
}
