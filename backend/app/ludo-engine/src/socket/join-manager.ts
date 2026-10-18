import type { LudoEngine } from '../engine';
import type { RedisGameStore } from '../redis';
import type { LudoBot } from '../bot';
import { isBotSeat } from '../bot';
import { firstActiveColor } from '../player-handler';
import type { GameSocket } from './auth';
import { isBotUserId, BOT_PREFIX } from './auth';
import type { RoomRegistry } from './room-context';
import type { PlayerColor } from '../types';

// Shared seat order : used by the join flow to map slots to colors and to
// auto-fill bot seats (the seat order must match the original match).
export const SLOT_COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

// JoinManager owns the join_game flow: serializes each game's join critical
// section against Redis, resolves seats, creates missing games, handles
// reconnects, and auto-starts PvE/hotseat matches.
export class JoinManager {
  // Serializes each game's join_game critical section (load -> mutate -> save).
  // Hotseat fires several joins back-to-back; without this lock the saves
  // interleave and the earlier join is lost.
  private joinLocks = new Map<string, Promise<unknown>>();

  constructor(
    private store: RedisGameStore,
    private engine: LudoEngine,
    private rooms: RoomRegistry,
    private getOrCreateBot: (
      gameId: string,
      color: PlayerColor,
      engine: LudoEngine,
      store: RedisGameStore,
    ) => LudoBot,
    private scheduleBotTurn?: (gameId: string) => void,
    // Re-evaluate a room's idle window: a join can refill a WAITING room that was
    // below quorum, which cancels the abort timer.
    private refreshIdle?: (gameId: string) => void,
  ) {}

  private withGameLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.joinLocks.get(gameId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.joinLocks.set(
      gameId,
      run.catch(() => undefined),
    );
    return run;
  }

  // The join_game flow: bind socket to room/seat, create the game if needed,
  // resolve reconnects vs fresh joins, seed bot metadata, reply game_joined.
  handleJoinGame(
    socket: GameSocket,
    gameId: string,
    playerColor: PlayerColor,
    userId?: string,
    displayName?: string,
  ): void {
    // The token's match id decides which game is joined; the client-supplied
    // argument is only a fallback and cannot send the socket to another game.
    const effectiveGameId = socket.data.tokenGameId || socket.data.gameId || gameId;
    const effectiveUserId = socket.data.userId || userId;
    const effectiveUsername = displayName || socket.data.username;
    const isHotseat = socket.data.mode === 'hotseat';
    const effectiveColor = (!isHotseat && socket.data.tokenColor) || playerColor;

    void this.withGameLock(effectiveGameId, async () => {
      try {
        // A join is only ever allowed against a room that still exists in Redis.
        // Without this gate a stale token would spawn an orphan game from
        // createGame's defaults, and an aborted room would take fresh seats.
        const matchData = await this.store.getMatchData(effectiveGameId);
        if (!matchData || matchData.status === 'ABORTED') {
          this.detachSocket(socket, effectiveGameId);
          // A code, not English text: the client resolves engine error codes
          // through `errors.<CODE>` (the same key the REST layer uses for a room
          // that no longer exists).
          socket.emit('error', 'MATCH_GAME_NOT_FOUND');
          return;
        }

        void socket.join(effectiveGameId);
        socket.data.gameId = effectiveGameId;
        socket.data.playerColor = effectiveColor;

        if (effectiveUserId) {
          this.rooms.ensure(effectiveGameId).bindSeat(effectiveColor, effectiveUserId);
          await this.store.setSeatUser(effectiveGameId, effectiveColor, effectiveUserId);
        }

        let state = await this.store.loadGameState(effectiveGameId);
        if (!state) {
          const playerCount = parseInt(matchData.playerCount || '4', 10);
          // Prefer the persisted seatColors (exact ordered seats, including
          // skipped colors in hotseat, e.g. blue + green + yellow with no red).
          // Falls back to the dense slot fill for older rooms / direct engine use.
          const seatColors: PlayerColor[] = matchData.seatColors
            ? (matchData.seatColors.split(',') as PlayerColor[])
            : SLOT_COLORS.slice(0, playerCount);
          // The room rules travel with the match hash instead of being hardcoded: the
          // move gate checks clashMode, the star checks noSafeZones and a prison exit
          // checks freeExit. Only a literal 'true' turns a rule on.
          await this.store.createGame(
            effectiveGameId,
            matchData.clashEnabled === 'true',
            seatColors,
            matchData.noSafeZones === 'true',
            matchData.freeExit === 'true',
          );
          state = await this.store.loadGameState(effectiveGameId);
        }
        if (state) {
          const discIndex = state.disconnectedPlayers.findIndex((d) => d.color === effectiveColor);
          const isReconnectingPlayer = discIndex !== -1;
          const seat = state.players.find((p) => p.color === effectiveColor);
          // Seat colours come from the token, so a live seat is always this
          // socket's own seat. Its owner may resume it, so the join is accepted
          // even when the previous socket has not been closed yet.
          const seatResumable =
            !!seat && (seat.status === 'active' || seat.status === 'disconnected');

          // A game in progress accepts no new players: only the owner of a live
          // seat may re-enter. Hotseat is exempt because one socket controls all
          // of its seats.
          if (state.status !== 'waiting' && !isReconnectingPlayer && !isHotseat && !seatResumable) {
            // Detach the refused socket: it must not observe room events, and its
            // later disconnect must not mark a seated player as disconnected.
            this.detachSocket(socket, effectiveGameId);
            // An exited seat belongs to a player removed from the match, so tell
            // the client the seat is gone instead of leaving it on a stale board.
            if (seat?.status === 'exited') {
              socket.emit('seat_expired', { gameId: effectiveGameId, color: effectiveColor });
            } else {
              socket.emit('error', 'Game already in progress');
            }
            return;
          }

          // Unbind any other socket still holding this seat, so an older tab or a
          // socket the server has not closed yet cannot disturb this fresh one.
          this.evictSeatSiblings(socket, effectiveGameId, effectiveColor);

          if (isReconnectingPlayer) {
            const revived = await this.engine.handlePlayerReconnect(
              effectiveGameId,
              effectiveColor,
              displayName,
            );
            state = await this.store.loadGameState(effectiveGameId);
            if (!revived) {
              // The grace window outlived the seat: nothing is left to resume,
              // so detach the socket and tell the client its seat is gone.
              this.detachSocket(socket, effectiveGameId);
              socket.emit('seat_expired', { gameId: effectiveGameId, color: effectiveColor });
              return;
            }
            // The player is back on their old seat: tell the room so every client
            // switches that seat from "Reconnecting…" back to active.
            this.engine.emitEvent({
              type: 'player_reconnected',
              gameId: effectiveGameId,
              color: effectiveColor,
              displayName: displayName || socket.data.displayName,
            });
            // If the revive cleared a pause, push the new state so every client
            // stops showing the pause banner.
            if (state.status === 'active' && !state.paused) {
              this.engine.emitEvent({ type: 'state_update', gameId: effectiveGameId, state });
            }
          } else {
            const player = state.players.find((p) => p.color === effectiveColor);
            if (player) player.status = 'active';
          }

          // Populate PlayerMeta with frontend-compatible fields.
          // `username` is the immutable identity (used for login/avatar/URLs);
          // `displayName` is what the UI actually shows in-game.
          const meta = state.players.find((p) => p.color === effectiveColor);
          if (meta) {
            const resolvedUsername =
              effectiveUsername ||
              effectiveUserId ||
              effectiveColor.charAt(0).toUpperCase() + effectiveColor.slice(1);
            meta.username = resolvedUsername;
            meta.displayName = displayName || socket.data.displayName || resolvedUsername;
            meta.isBot = isBotUserId(effectiveUserId);
            meta.isConnected = true;
            meta.status = 'active';

            // The seat's immutable identity plus its cached avatar facts. Hotseat drives
            // several local seats from one socket and has no per-seat account, so it keeps
            // userId undefined (generated avatar, no request).
            meta.userId = isHotseat ? undefined : effectiveUserId;
            const avatarMeta = meta.userId ? await this.store.getAvatarMeta(meta.userId) : null;
            meta.hasAvatarPhoto = avatarMeta?.has ?? false;
            meta.avatarStyle = avatarMeta?.style;
          }

          if (state.status === 'waiting') {
            await this.store.saveGameState(effectiveGameId, state);
            // A refill cancels the room's idle window: a WAITING room with fewer
            // than two seated players is aborted after IDLE_LOBBY_TIMEOUT_MS.
            this.refreshIdle?.(effectiveGameId);
            // Broadcast the roster so already-connected clients (e.g. the host)
            // learn about the new seat : nothing else does, and their Ready
            // button would never enable. See emitLobbyUpdate in engine.ts.
            await this.engine.emitLobbyUpdate(effectiveGameId);
          }
        }
        if (isBotUserId(effectiveUserId)) {
          this.getOrCreateBot(effectiveGameId, effectiveColor, this.engine, this.store);
        }

        // PvE/Hotseat auto-start: neither has a second real remote player to
        // wait on (PvE's other seats are bots; hotseat's other seats are the
        // same physical device), so skip the manual ready-check entirely.
        if (matchData.gameType === 'PVE' || matchData.gameType === 'HOTSEAT') {
          await this.autoStartIfReady(effectiveGameId, matchData);
          // Reload state : autoStartIfReady may have transitioned it to 'active'
          state = await this.store.loadGameState(effectiveGameId);
        }

        // Unfreeze a paused game only when the seat it is frozen on rejoins.
        // Another player's reconnect must not clear a pause that belongs to a
        // seat still inside its grace window.
        if (state?.status === 'active' && state.paused && state.pauseTurnOwner === effectiveColor) {
          delete state.paused;
          delete state.pauseTurnOwner;
          delete state.pausedReason;
          await this.store.saveGameState(effectiveGameId, state);
        }
        // A bot seat holding the turn is re-armed from the persisted state, so a client
        // rejoin no longer has to carry the in-memory seat map. The wake pass covers
        // rooms that no client rejoins at all.
        if (state?.status === 'active' && isBotSeat(state, state.currentTurn)) {
          this.scheduleBotTurn?.(effectiveGameId);
        }

        if (state) socket.emit('game_joined', state);
      } catch (error) {
        socket.emit('error', `Failed to join game: ${error}`);
      }
    });
  }
  // Removes a socket's room and seat binding without closing the connection.
  // Used when a join is refused. tokenGameId is kept, so the socket stays pinned
  // to its own game.
  private detachSocket(socket: GameSocket, gameId: string): void {
    void socket.leave(gameId);
    delete socket.data.gameId;
    delete socket.data.playerColor;
  }

  // Unbinds any other socket still holding this seat, so an older tab or a socket
  // the server has not closed yet cannot mark the seat as disconnected when it
  // later drops.
  private evictSeatSiblings(socket: GameSocket, gameId: string, color: PlayerColor): void {
    for (const other of socket.nsp.sockets.values()) {
      if (other.id === socket.id) continue;
      if (other.data.gameId === gameId && other.data.playerColor === color) {
        this.detachSocket(other, gameId);
      }
    }
  }

  // Auto-start PvE/hotseat matches : neither has a second remote player for
  // a ready-check quorum. PvE registers its bot seats here; hotseat waits
  // for every local seat to join before flipping the game active.
  private async autoStartIfReady(gameId: string, matchData: Record<string, string>): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state) return;

    // Only auto-fill once : if game already active, seats are already registered
    if (state.status === 'active') return;

    if (matchData.gameType === 'PVE') {
      for (let i = 2; i <= 4; i++) {
        const slotUserId = matchData[`player${i}_id`];
        if (!slotUserId || !isBotUserId(slotUserId)) continue;

        const slotColor = SLOT_COLORS[i - 1];
        const botUserId = `${BOT_PREFIX}${slotColor}`;

        // Mark bot player as active and populate frontend-compatible metadata
        const player = state.players.find((p) => p.color === slotColor);
        if (player) {
          player.status = 'active';
          player.username = botUserId;
          player.isBot = true;
          player.isConnected = true;
          // `username` stays the immutable `bot-<color>` identity; isBotUserId and
          // the persisted `isBot` flag key on it. `displayName` holds the lobby's label
          // and falls back to the id when absent.
          player.displayName = matchData[`player${i}_displayName`] || botUserId;
          // A bot has no photo; hasAvatarPhoto stays false so the client renders
          // the generated avatar instead of requesting one.
          player.hasAvatarPhoto = false;
        }

        // The persisted `seatUser_<color>` field is what the result submitter
        // falls back to; the in-memory bindings hold human seats only, and a bot
        // seat is identified from the state, so it is not registered here.
        await this.store.setSeatUser(gameId, slotColor, botUserId);

        // Instantiate bot
        this.getOrCreateBot(gameId, slotColor, this.engine, this.store);
      }
    }

    // Every seat that has actually joined (human, local hotseat seat, or bot
    // just registered above) is auto-ready : there's nobody real left to wait on.
    for (const p of state.players) {
      if (p.status === 'active' && !state.readyPlayers.includes(p.color)) {
        state.readyPlayers.push(p.color);
      }
    }

    await this.store.saveGameState(gameId, state);

    // Hotseat must wait for every local seat to have joined (they join one at
    // a time, via separate join_game calls on the same socket) before
    // starting : otherwise it'd fire after just the first seat.
    const expectedSeats =
      matchData.gameType === 'HOTSEAT' ? parseInt(matchData.playerCount || '2', 10) : 0;
    const activePlayers = state.players.filter((p) => p.status === 'active');
    const allJoined = activePlayers.length >= expectedSeats;
    const allReady =
      activePlayers.length > 0 && activePlayers.every((p) => state.readyPlayers.includes(p.color));

    if (allJoined && allReady && state.status === 'waiting') {
      state.currentTurn = firstActiveColor(state) ?? state.currentTurn;
      state.status = 'active';
      await this.store.saveGameState(gameId, state);
      this.engine.emitEvent({ type: 'game_started', gameId });
    }
  }
}
