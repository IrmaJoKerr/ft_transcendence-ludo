import type { GameState, PlayerColor, GameEvent, DepartureReason } from './types';
import type { RedisGameStore } from './redis';
import {
  DISCONNECT_GRACE_MS,
  SINGLE_SOCKET_DISCONNECT_GRACE_MS,
  WAITING_SEAT_GRACE_MS,
} from './timing';

const COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

// PvE and hotseat drive every seat from one device, so the room has no second
// participant to wait for and no quorum to lose.
function isSingleSocketGame(gameType: string | undefined): boolean {
  return gameType === 'PVE' || gameType === 'HOTSEAT';
}

// How long an away seat may stay away, decided by the room it is in: one hour for
// a single-socket room (the browser tab is the game), 45 s for a live PvP seat,
// and five minutes for a waiting-room seat. The waiting room is deliberately more
// relaxed (R12/R17): returning to the lobby never costs the seat, so the window is
// there to notice a player who is not coming back, not to punish a quick look away.
function reconnectWindowMs(state: GameState, gameType: string | undefined): number {
  if (isSingleSocketGame(gameType)) return SINGLE_SOCKET_DISCONNECT_GRACE_MS;
  return state.status === 'waiting' ? WAITING_SEAT_GRACE_MS : DISCONNECT_GRACE_MS;
}

// The first active seat in colour order: the rule the start gate and the turn
// advance share. currentTurn must always point at a seated colour (an inactive
// currentTurn soft-locks the game), and colour order is what decides who moves
// first, so a room seating green and blue opens on blue whatever order its cards
// were filled in.
export function firstActiveColor(state: GameState): PlayerColor | undefined {
  return COLORS.find((c) => state.players.find((p) => p.color === c)?.status === 'active');
}

// Move to the next seat that can play, walking `COLORS` in their canonical order
// (blue → red → green → yellow) whatever index each seat holds in players[].
// Colour order is the whole rule: two rooms seating the same colours rotate
// alike, and a skipped corner is simply not visited. Exited seats are skipped; a
// disconnected seat with an open grace window holds the turn. Clears the paused
// flag once its owner reconnects or is pruned.
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

  // Find the current turn's place in colour order. State arrives as Redis JSON,
  // so the compile-time PlayerColor guarantee does not hold and an unknown
  // currentTurn has to finish the game rather than loop forever.
  const currentIdx = COLORS.indexOf(state.currentTurn);
  if (currentIdx === -1) {
    state.status = 'finished';
    return;
  }

  let loopCount = 0;
  let nextIdx = (currentIdx + 1) % COLORS.length;
  let next: PlayerColor | undefined;
  while (loopCount < COLORS.length) {
    const color = COLORS[nextIdx];
    const p = state.players.find((pl) => pl.color === color);
    if (p?.status === 'active') {
      next = color;
      break;
    }
    if (p?.status === 'disconnected') {
      const disc = state.disconnectedPlayers.find((d) => d.color === color);
      if (disc && Date.now() < disc.reconnectDeadline) {
        // The turn waits on this seat; a reconnect resumes it in place.
        next = color;
        break;
      }
    }
    // No seat on this colour, or 'exited', 'inactive', expired disconnected: skip
    nextIdx = (nextIdx + 1) % COLORS.length;
    loopCount++;
  }

  if (!next) {
    // No colour yielded a playable seat.
    state.status = 'finished';
    return;
  }
  state.currentTurn = next;

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
    await closeRoom(store, emit, gameId, notifyAbort);
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
      await closeRoom(store, emit, gameId, notifyAbort);
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
    emit({ type: 'player_exited', gameId, color });
    await store.clearMatchSeat(gameId, color);
    return { closed: false };
  }

  return departSeat(store, emit, gameId, color, 'timeout', notifyAbort);
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

// The one way a seat leaves a room. The reason selects the per-reason body, and
// the funnel owns the terminal decision: a single-socket room always closes, and
// a PvP room closes when its last second human is confirmed gone. Callers never
// re-derive that, so there is one answer to "is the room still alive".
export async function departSeat(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  color: PlayerColor,
  reason: DepartureReason,
  notifyAbort?: (gameId: string) => void,
): Promise<{ closed: boolean }> {
  const state = await store.loadGameState(gameId);
  if (!state) return { closed: false };

  // Idempotency guard: a seat already terminal is a no-op.
  const player = state.players.find((p) => p.color === color);
  if (!player || player.status === 'exited' || player.status === 'inactive') {
    return { closed: false };
  }

  const matchData = await store.getMatchData(gameId);
  const singleSocket = isSingleSocketGame(matchData?.gameType);

  // A waiting room has no turn to leave. An Abort frees the corner outright (R18:
  // the click is also the permission to play elsewhere, so it must leave nothing
  // behind), the host's own Abort closes the room instead (row 2), and every other
  // reason there is a reconnect window handled by startReconnectGrace.
  if (state.status === 'waiting' && !singleSocket) {
    if (reason !== 'end_game') return { closed: false };
    // The hash's seat row is the authority for who sits in the corner: a host seat is
    // the one whose id is `hostId`, wherever in the state's player list it appears.
    const slot = COLORS.indexOf(color) + 1;
    const hostSeat =
      !!matchData?.hostId &&
      (matchData[`player${slot}_id`] === matchData.hostId || player.userId === matchData.hostId);
    if (hostSeat) {
      await closeRoom(store, emit, gameId, notifyAbort);
      return { closed: true };
    }
    player.status = 'inactive';
    player.isConnected = false;
    state.disconnectedPlayers = state.disconnectedPlayers.filter((d) => d.color !== color);
    await store.saveGameState(gameId, state);
    emit({ type: 'player_exited', gameId, color });
    // The hash is what the lobby's join palette, the seat count and the rejoin
    // door read, so the seat is deleted, never reserved: a reserved corner was
    // never offered again (redis.ts clearMatchSeat).
    await store.clearMatchSeat(gameId, color);
    return { closed: false };
  }

  // Clear any grace entry for this colour.
  state.disconnectedPlayers = state.disconnectedPlayers.filter((d) => d.color !== color);

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

  // The terminal decision, taken here and nowhere else: a single-socket room has
  // nothing left to play, and a PvP room closes when its last second human is gone.
  if (singleSocket || !hasQuorum(state)) {
    await closeRoom(store, emit, gameId, notifyAbort);
    return { closed: true };
  }
  return { closed: false };
}

// The one place a room is closed: write the marker the result route reads, tell
// the room, then drop the engine state and the in-memory context. The marker goes
// first so a client that reloads on `game_expired` can already find the record.
export async function closeRoom(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  notify?: (gameId: string) => void,
): Promise<void> {
  await store.abortMatch(gameId);
  emit({ type: 'game_expired', gameId });
  await store.deleteGame(gameId);
  notify?.(gameId);
}

// A room can continue only with at least two human seats that have not been
// confirmed gone. A seat inside its reconnect window still counts (R23): only
// `exited` and `inactive` are terminal, so the check can never read a grace
// window as an empty chair. That makes this the single definition of "live seats"
// for the whole engine.
export function hasQuorum(state: GameState): boolean {
  return (
    state.players.filter((p) => p.status !== 'exited' && p.status !== 'inactive' && !p.isBot)
      .length >= 2
  );
}
