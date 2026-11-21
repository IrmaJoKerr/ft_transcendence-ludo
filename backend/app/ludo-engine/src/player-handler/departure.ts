import type {
  GameState,
  PlayerColor,
  GameEvent,
  DepartureReason,
  ExitRecord,
} from '../types';
import type { RedisGameStore } from '../redis';
import { MoveValidator } from '../move-validator';
import { seatDisplayName } from '../game-chat';
import { advanceTurnInState, COLORS, hasChat, writeSystemChat } from './turn';

// Whether a room's seats leave a record at all. Hotseat is played on one screen and a
// guest room is demo-and-forget, so neither writes a match row: the same rule the
// finished-game submitter applies, applied at the departure that writes the row.
function writesMatchRows(matchData: Record<string, string> | null | undefined): boolean {
  return matchData?.gameType !== 'HOTSEAT' && matchData?.isGuest !== 'true';
}

// PvE and hotseat drive every seat from one device, so the room has no second
// participant to wait for and no quorum to lose.
export function isSingleSocketGame(gameType: string | undefined): boolean {
  return gameType === 'PVE' || gameType === 'HOTSEAT';
}

// The record of a seat leaving a game, captured **before** its pieces are parked:
// after the parking the board counts zero and the row would claim the seat never
// moved. `rank` is the room's player count, so a seat that left placed last; a bot
// seat and a seat with no account write nothing, because neither can hold a row.
export function captureExitRecord(state: GameState, color: PlayerColor): ExitRecord | undefined {
  const player = state.players.find((p) => p.color === color);
  if (!player || player.isBot || !player.userId) return undefined;
  const stats = player.stats;
  return {
    userId: player.userId,
    color,
    rank: state.players.length,
    capturedAt: Date.now(),
    turns: stats.turns ?? 0,
    captures: stats.captures ?? 0,
    piecesInGoal: MoveValidator.countPiecesInGoal(state, color),
    piecesLost: stats.piecesLost ?? 0,
    threeSixes: stats.threeSixes ?? 0,
    clashDefendsWon: stats.clashDefendsWon ?? 0,
    clashAttacksWon: stats.clashAttacksWon ?? 0,
    clashAttacksLost: stats.clashAttacksLost ?? 0,
    clashDefendsLost: stats.clashDefendsLost ?? 0,
    clashWallBattlesWon: stats.clashWallBattlesWon ?? 0,
    clashWallsAttacked: stats.clashWallsAttacked ?? 0,
    clashWallsDefended: stats.clashWallsDefended ?? 0,
    submitted: false,
  };
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
  submitExits?: (gameId: string, records: ExitRecord[]) => void | Promise<void>,
): Promise<{ closed: boolean; exitRecord?: ExitRecord }> {
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
    // The universal departure line, written before the frame that says the corner is
    // free: a room that keeps its channel keeps the moment it was given up.
    if (hasChat(matchData)) {
      await writeSystemChat(store, emit, gameId, 'left', seatDisplayName(state, color));
    }
    emit({ type: 'player_exited', gameId, color });
    // The hash is what the lobby's join palette, the seat count and the rejoin
    // door read, so the seat is deleted, never reserved: a reserved corner was
    // never offered again (redis.ts clearMatchSeat).
    await store.clearMatchSeat(gameId, color);
    return { closed: false };
  }

  // Clear any grace entry for this colour.
  state.disconnectedPlayers = state.disconnectedPlayers.filter((d) => d.color !== color);

  // The seat's record, captured while the board and the tallies still say what it had
  // done. It stays on the seat as well, so a delivery that fails is retried by the wake
  // pass instead of losing the row (a room that closes posts every seat it holds).
  if (writesMatchRows(matchData)) {
    player.exitRecord = player.exitRecord ?? captureExitRecord(state, color);
  }
  const exitRecord = player.exitRecord;

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
  // The departure line, for the seats that stay: the leaver's own transcript ends on
  // its own line (E8), which is what marks the moment in a stored row.
  if (hasChat(matchData)) {
    await writeSystemChat(store, emit, gameId, 'left', seatDisplayName(state, color));
  }
  emit({ type: 'player_exited', gameId, color });
  // The turn may have moved and the departed seat's pieces are gone; clients
  // need this frame to stop rendering the old turn.
  if (state.status === 'active') {
    emit({ type: 'state_update', gameId, state });
  }

  // The terminal decision, taken here and nowhere else: a single-socket room has
  // nothing left to play, and a PvP room closes when its last second human is gone.
  // A closing room writes its own records, for every seat it holds, so this seat is
  // not posted twice.
  if (singleSocket || !hasQuorum(state)) {
    await closeRoom(store, emit, gameId, notifyAbort, submitExits);
    return { closed: true };
  }
  // The room kept playing, so this seat's row is this departure's own: posted now, and
  // the record stays on the seat until a 2xx says it landed. Not awaited: the caller is
  // holding the game lock, and a backend that keeps refusing must not stall the room.
  if (exitRecord) void submitExits?.(gameId, [exitRecord]);
  return { closed: false, exitRecord };
}

// The one place a room is closed: write the marker the result route reads, write the
// record of every seat it holds, tell the room, then drop the engine state and the
// in-memory context. The marker goes first so a client that reloads on `game_expired`
// can already find the record, and the records follow it because they are the last
// thing that needs the tallies the state is about to lose.
export async function closeRoom(
  store: RedisGameStore,
  emit: (event: GameEvent) => void,
  gameId: string,
  notify?: (gameId: string) => void,
  submitExits?: (gameId: string, records: ExitRecord[]) => void | Promise<void>,
): Promise<void> {
  const records = await captureRoomExits(store, gameId);
  await store.abortMatch(gameId);
  if (records.length > 0 && submitExits) {
    try {
      await submitExits(gameId, records);
    } catch (error) {
      console.error(
        `Failed to record the seats of ${gameId}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  emit({ type: 'game_expired', gameId });
  await store.deleteGame(gameId);
  notify?.(gameId);
}

// Every human seat of a room that is closing, each with its own record: the seat that
// left already has one, and the seats still on the board get theirs here, because a
// room torn down below quorum is a match nobody completed. Captured before the state
// is deleted, which is the only moment the tallies still exist.
async function captureRoomExits(store: RedisGameStore, gameId: string): Promise<ExitRecord[]> {
  const state = await store.loadGameState(gameId);
  if (!state || state.status !== 'active') return [];
  if (!writesMatchRows(await store.getMatchData(gameId))) return [];
  const records: ExitRecord[] = [];
  for (const player of state.players) {
    if (!player.exitRecord) player.exitRecord = captureExitRecord(state, player.color);
    // A seat whose row already landed is not posted twice: the record is the fact,
    // the flag is the delivery.
    if (player.exitRecord && !player.exitRecord.submitted) records.push(player.exitRecord);
  }
  if (records.length > 0) await store.saveGameState(gameId, state);
  return records;
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
