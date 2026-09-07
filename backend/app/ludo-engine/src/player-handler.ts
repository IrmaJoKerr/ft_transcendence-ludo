import { GameState, PlayerColor, GameEvent } from './types';
import { RedisGameStore } from './redis';

const COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];
const DISCONNECT_GRACE_MS = 45000; // 45 seconds to reconnect before the player is pruned (PvP window)
const BOT_DISCONNECT_GRACE_MS = 60 * 60 * 1000; // 1 hour to reconnect before auto-abort (bot-mode games)
// Extra buffer so the PvP prune timer fires just AFTER the reconnect deadline.
const DISCONNECT_PRUNE_BUFFER_MS = 1000;

/**
 * First active seat in color order. currentTurn defaults to 'blue' but a
 * pre-game seat swap can leave blue empty : pick a color that's actually
 * seated so the game doesn't soft-lock on an inactive seat.
 */
export function firstActiveColor(state: GameState): PlayerColor | undefined {
  return COLORS.find(c => state.players.find(p => p.color === c)?.status === 'active');
}

/**
 * Advance turn to the next seated (active) player.
 * Mutates state in-place.
 */
export function advanceTurnInState(state: GameState): void {
  const currentIndex = COLORS.indexOf(state.currentTurn);
  let nextIndex = (currentIndex + 1) % 4;

  let loopCount = 0;
  while (loopCount < 4) {
    // state.players only holds seats actually in the match (may be < 4), so
    // match by color, not by position into COLORS.
    const p = state.players.find(pl => pl.color === COLORS[nextIndex]);
    // Only *active* seats hold the turn : an inactive seat was never joined
    // and would stall the game.
    if (p?.status === 'active') {
      break;
    }
    nextIndex = (nextIndex + 1) % 4;
    loopCount++;
  }

  if (loopCount >= 4) {
    state.status = 'finished';
  }
  state.currentTurn = COLORS[nextIndex];
  state.firstRollOfTurn = true;
  // Reset the new player's 6-streak so it never leaks across turns.
  const nextPlayer = state.players.find(p => p.color === COLORS[nextIndex]);
  if (nextPlayer) nextPlayer.consecutiveSixes = 0;
}

/**
 * Handle a disconnect with a grace period: mark the player 'disconnected'
 * and forfeit after the window unless they reconnect first.
 */
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
  const existing = state.disconnectedPlayers.find(d => d.color === color);
  if (existing) return; // Already in grace period

  // Ignore sockets closing for already-exited/finished players: re-adding them
  // to the grace list would resurrect pieces the exit already cleared.
  const discPlayer = state.players.find(p => p.color === color);
  if (!discPlayer || discPlayer.status !== 'active') return;

  // Bot-mode games pause and allow a long reconnect window; PvP holds the
  // turn for the short window then prunes on expiry.
  const matchData = await store.getMatchData(gameId);
  const isBotMode = matchData?.gameType === 'PVE' || matchData?.gameType === 'HOTSEAT';
  const graceMs = isBotMode ? BOT_DISCONNECT_GRACE_MS : DISCONNECT_GRACE_MS + DISCONNECT_PRUNE_BUFFER_MS;

  const deadline = Date.now() + (isBotMode ? BOT_DISCONNECT_GRACE_MS : DISCONNECT_GRACE_MS);
  state.disconnectedPlayers.push({
    color,
    disconnectedAt: Date.now(),
    reconnectDeadline: deadline,
  });

  // Mark player as disconnected (not exited : they can still reconnect)
  const player = state.players.find(p => p.color === color);
  if (player && player.status === 'active') {
    player.status = 'disconnected';
    player.isConnected = false;
  }

  // Hold the turn so a mid-turn disconnect can't skip the player; reconnect
  // resumes the exact state. Pruning happens only on grace expiry / end_game.
  if (isBotMode && state.status === 'active') {
    // Pause so bots don't keep playing while the human is away.
    state.paused = true;
    state.pauseTurnOwner = state.currentTurn;
  }

  // Mid-clash disconnects are settled instantly by the caller
  // (engine.resolveClashOnDisconnect : longest bar wins).

  await store.saveGameState(gameId, state);
  // Broadcast a temporary disconnect (not exit) so the room sees
  // "Reconnecting…" instead of the player vanishing.
  emit({ type: 'player_disconnected', gameId, color });

  // On grace expiry: bot-mode aborts the whole instance; PvP prunes the
  // player, and aborts too if fewer than 2 humans remain.
  setTimeout(async () => {
    const currentState = await store.loadGameState(gameId);
    if (!currentState) return;

    const disc = currentState.disconnectedPlayers.find(d => d.color === color);
    if (!disc) return; // Already reconnected

    // Check if deadline has passed
    if (Date.now() >= disc.reconnectDeadline) {
      await handlePlayerExit(store, emit, gameId, color);
      if (isBotMode) {
        // Definitive abort of the whole instance.
        await store.abortMatch(gameId);
        await store.deleteGame(gameId);
        notifyAbort?.(gameId);
      } else {
        // Re-count humans from the fresh state : the stale match hash still
        // lists the pruned user and would mask a <2 human room.
        const after = await store.loadGameState(gameId);
        const humansLeft = (after?.players ?? [])
          .filter(p => p.status === 'active' && !p.isBot).length;
        if (!after || humansLeft < 2) {
          await store.abortMatch(gameId);
          await store.deleteGame(gameId);
          notifyAbort?.(gameId);
        }
      }
    }
  }, graceMs);
}

/**
 * Handle a player reconnecting within the grace period.
 */
export async function handlePlayerReconnect(
  store: RedisGameStore,
  gameId: string,
  color: PlayerColor,
): Promise<void> {
  const state = await store.loadGameState(gameId);
  if (!state) return;

  const discIndex = state.disconnectedPlayers.findIndex(d => d.color === color);
  if (discIndex === -1) return; // Not in grace period

  const disc = state.disconnectedPlayers[discIndex];
  if (Date.now() > disc.reconnectDeadline) {
    // Too late : player is already forfeited
    return;
  }

  // Remove from disconnect list
  state.disconnectedPlayers.splice(discIndex, 1);

  // Restore player to active
  const player = state.players.find(p => p.color === color);
  if (player) {
    player.status = 'active';
    player.isConnected = true;
  }

  await store.saveGameState(gameId, state);
}

/**
 * Mark a player ready; start the game once all active seats are ready.
 */
export async function handlePlayerReady(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  color: PlayerColor,
): Promise<void> {
  const state = await store.loadGameState(gameId);
  if (!state || state.status !== 'waiting') return;

  // Add to ready list if not already there
  if (!state.readyPlayers.includes(color)) {
    state.readyPlayers.push(color);
  }

  await store.saveGameState(gameId, state);

  // Need >= 2 active seats: a lone host must not start a PvP match alone.
  const activeCount = state.players.filter(p => p.status === 'active').length;
  const allReady = activeCount >= 2 &&
    state.players.filter(p => p.status === 'active').every(p => state.readyPlayers.includes(p.color));

  if (allReady) {
    state.currentTurn = firstActiveColor(state) ?? state.currentTurn;
    state.status = 'active';
    await store.saveGameState(gameId, state);
    emit({ type: 'game_started', gameId });
  }
}

/**
 * Permanently exit a player (forfeit): clear their pieces and mark exited.
 */
export async function handlePlayerExit(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  color: PlayerColor,
): Promise<void> {
  const state = await store.loadGameState(gameId);
  if (!state) return;

  // Remove from disconnect list if present
  state.disconnectedPlayers = state.disconnectedPlayers.filter(d => d.color !== color);

  for (const piece of state.pieces.filter(p => p.color === color)) {
    piece.step = -1;
  }
  
  const player = state.players.find(p => p.color === color);
  if (player) {
    player.status = 'exited';
    player.isConnected = false;
    player.isFinished = true;
  }

  if (state.currentTurn === color && state.status === 'active') {
    advanceTurnInState(state);
  }
  
	// Clear any pending clash state on exit
	if (state.clash) {
		delete state.clash;
	}

	await store.saveGameState(gameId, state);
	emit({ type: 'player_exited', gameId, color });

	// A guest leaving a PvP lobby must vacate their match-hash seat, or the
	// idle-abort countdown never restarts for the host. The host's seat is
	// kept so their room stays rejoinable from the open-rooms list.
	if (state.status === 'waiting') {
		await store.clearMatchSeat(gameId, color);
	}
}
