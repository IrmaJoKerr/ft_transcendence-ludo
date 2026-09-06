import { LudoEngine } from '../engine';
import { RedisGameStore } from '../redis';
import { LudoBot } from '../bot';
import { firstActiveColor } from '../player-handler';
import { GameSocket, isBotUserId, BOT_PREFIX } from './auth';
import type { PlayerColor } from '../types';

/**
 * JoinManager owns the join_game flow — historically the largest single
 * handler in the socket layer. It serializes each game's join critical
 * section against Redis, resolves the seat a socket should bind to, creates
 * the game if it doesn't exist yet, handles reconnects, auto-starts
 * PvE/hotseat matches, and re-arms paused bot games on resume.
 */
export class JoinManager {
  // Serializes each game's join_game critical section (load → mutate → save
  // against Redis). Hotseat fires several join_game calls back-to-back on
  // connect (one per local seat); without this, their async load/save cycles
  // interleave and the last save wins, silently dropping the earlier joins.
  private joinLocks = new Map<string, Promise<unknown>>();

  constructor(
    private store: RedisGameStore,
    private engine: LudoEngine,
    private userIdMap: Map<string, Map<PlayerColor, string>>,
    private seatColors: PlayerColor[],
    private getOrCreateBot: (gameId: string, color: PlayerColor, engine: LudoEngine, store: RedisGameStore) => LudoBot,
    private scheduleBotTurn?: (gameId: string) => void,
  ) {}

  private withGameLock<T>(gameId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.joinLocks.get(gameId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.joinLocks.set(gameId, run.catch(() => undefined));
    return run;
  }

  /**
   * Resolve the seat a socket should bind to when (re)joining a game.
   *
   * The JWT `color` claim is NOT trustworthy for rebinding: game tokens are
   * signed once at join time (24h expiry) and are never re-issued on a lobby
   * seat swap, so `tokenColor` can be stale. Rebinding to it re-populates the
   * player's PREVIOUS seat and leaves their avatar on two slots at once. The
   * match hash is the authoritative source — handleSelectColor updates the
   * user's slot color there before any re-join happens — so prefer it.
   * Guests have no hash slot and fall back to the token claim
   * (then the requested color).
   */
  private async resolveEffectiveColor(
    gameId: string,
    userId: string | undefined,
    isHotseat: boolean,
    tokenColor: PlayerColor | undefined,
    requestedColor: PlayerColor,
  ): Promise<PlayerColor> {
    if (isHotseat || !userId) return requestedColor;
    const data = await this.store.getMatchData(gameId);
    if (data) {
      const ids = [data.player1_id, data.player2_id, data.player3_id, data.player4_id];
      const colors = [data.player1_color, data.player2_color, data.player3_color, data.player4_color];
      const slotIndex = ids.indexOf(userId);
      if (slotIndex !== -1 && colors[slotIndex]) {
        return colors[slotIndex] as PlayerColor;
      }
    }
    return tokenColor || requestedColor;
  }

  handleJoinGame(socket: GameSocket, gameId: string, playerColor: PlayerColor, userId?: string, displayName?: string): void {
    const effectiveGameId = socket.data.gameId || gameId;
    const effectiveUserId = socket.data.userId || userId;
    // Prefer the AUTHENTICATED token's username over the client-supplied
    // displayName: `username` is the immutable identity (used for login/avatar/
    // URLs) and the token is backend-signed, while `displayName` is a label.
    // (Hotseat/local joins have no token — displayName is the fallback.)
    const effectiveUsername = socket.data.username || displayName;
    const isHotseat = socket.data.mode === 'hotseat';

    this.withGameLock(effectiveGameId, async () => {
      try {
        socket.join(effectiveGameId);
        socket.data.gameId = effectiveGameId;
        const effectiveColor = await this.resolveEffectiveColor(
          effectiveGameId,
          effectiveUserId,
          isHotseat,
          socket.data.tokenColor,
          playerColor,
        );
        // Vacate the previous binding when this socket moves seats (e.g. the
        // other player in a color swap rebinding after lobby_update), so the
        // old seat never keeps this user's mapping.
        const previousColor = socket.data.playerColor;
        socket.data.playerColor = effectiveColor;

        if (effectiveUserId) {
          if (!this.userIdMap.has(effectiveGameId)) {
            this.userIdMap.set(effectiveGameId, new Map());
          }
          // Vacate this socket's previous binding — but ONLY if that seat still
          // maps to THIS user. In a color swap the vacating player's old color
          // may now belong to the other player (whose re-join happens on their
          // own lobby_update), and deleting it would wipe the other player's
          // clash ownership entirely (their presses would never register).
          if (
            previousColor &&
            previousColor !== effectiveColor &&
            this.userIdMap.get(effectiveGameId)?.get(previousColor) === effectiveUserId
          ) {
            this.userIdMap.get(effectiveGameId)!.delete(previousColor);
          }
          this.userIdMap.get(effectiveGameId)!.set(effectiveColor, effectiveUserId);
        }

        let state = await this.store.loadGameState(effectiveGameId);
        if (!state) {
          const creationMatchData = await this.store.getMatchData(effectiveGameId);
          const playerCount = parseInt(creationMatchData?.playerCount || '4', 10);
          // Prefer the persisted seatColors (exact ordered seats, including
          // skipped colors in hotseat, e.g. blue + green + yellow with no red).
          // Falls back to the dense slot fill for older rooms / direct engine use.
          const seatColors = creationMatchData?.seatColors
            ? (creationMatchData.seatColors.split(',') as PlayerColor[])
            : this.seatColors.slice(0, playerCount);
          // Clash mode follows the match's clashEnabled flag (set by the host's
          // lobby toggle) rather than being hardcoded on — the engine gate in
          // movePiece checks state.clashMode.
          await this.store.createGame(
            effectiveGameId,
            creationMatchData?.clashEnabled === 'true',
            seatColors,
            creationMatchData?.safeZones !== 'false',
          );
          state = await this.store.loadGameState(effectiveGameId);
        }

        if (state) {
          const discIndex = state.disconnectedPlayers.findIndex(d => d.color === effectiveColor);
          const isReconnectingPlayer = discIndex !== -1;

          // Socket locking: a player may (re)join an in-progress match only if
          // they're already seated in it (or reconnecting). The seat check uses
          // the Redis match record — disconnectedPlayers alone is in-memory and
          // would wrongly reject a refresh/reconnect after an engine restart.
          // hotseat is always the same physical device, so its seat (re)joins are allowed.
          const match = await this.store.getMatchData(effectiveGameId);
          const seatIds = match
            ? [match.player1_id, match.player2_id, match.player3_id, match.player4_id].filter(Boolean)
            : [];
          const isSeatedPlayer = !!effectiveUserId && seatIds.includes(effectiveUserId);
          const isHotseatMatch = match?.gameType === 'HOTSEAT';
          if (state.status !== 'waiting' && !isReconnectingPlayer && !isSeatedPlayer && !isHotseatMatch) {
            socket.emit('error', 'Game already in progress');
            return;
          }

          if (isReconnectingPlayer) {
            await this.engine.handlePlayerReconnect(effectiveGameId, effectiveColor);
            state = await this.store.loadGameState(effectiveGameId);
            // The player is back on their old seat — tell the room so everyone
            // sees them flip from "Reconnecting…" back to active.
            if (state && !state.disconnectedPlayers.some((d) => d.color === effectiveColor)) {
              this.engine.emitEvent({ type: 'player_reconnected', gameId: effectiveGameId, color: playerColor });
            }
          } else {
            const player = state.players.find(p => p.color === effectiveColor);
            if (player) player.status = 'active';
          }

          // Populate PlayerMeta with frontend-compatible fields.
          // `username` is the immutable identity (used for login/avatar/URLs);
          // `displayName` is what the UI actually shows in-game.
          const meta = state.players.find(p => p.color === effectiveColor);
          if (meta) {
            const resolvedUsername = effectiveUsername || effectiveUserId || (effectiveColor.charAt(0).toUpperCase() + effectiveColor.slice(1));
            meta.username = resolvedUsername;
            meta.displayName = displayName || socket.data.displayName || resolvedUsername;
            meta.isBot = isBotUserId(effectiveUserId);
            meta.isConnected = true;
            meta.status = 'active';
          }

          if (state.status === 'waiting') {
            await this.store.saveGameState(effectiveGameId, state);
            // Already-connected clients (e.g. the room host) otherwise never
            // learn a new seat joined — nothing else broadcasts on join, so
            // their local view stays stuck at solo-room state forever and
            // their Ready button never enables. See emitLobbyUpdate in engine.ts.
            await this.engine.emitLobbyUpdate(effectiveGameId);
          }
        }

        if (isBotUserId(effectiveUserId)) {
          this.getOrCreateBot(effectiveGameId, effectiveColor, this.engine, this.store);
        }

        // PvE/Hotseat auto-start: neither has a second real remote player to
        // wait on (PvE's other seats are bots; hotseat's other seats are the
        // same physical device), so skip the manual ready-check entirely.
        const matchData = await this.store.getMatchData(effectiveGameId);
        if (matchData && (matchData.gameType === 'PVE' || matchData.gameType === 'HOTSEAT')) {
          await this.autoStartIfReady(effectiveGameId, matchData);
          // Reload state — autoStartIfReady may have transitioned it to 'active'
          state = await this.store.loadGameState(effectiveGameId);
        }

        // Resume re-arm: any reconnect/join into an ACTIVE game clears the
        // pause flag, and if it's a bot's turn the bot trigger is re-scheduled.
        // This is what un-freezes a bot-mode game the player left mid-game
        // (or refreshed the browser on) — the turn state persisted in Redis,
        // the human just needs a fresh bot kick.
        if (state?.status === 'active' && state.paused) {
          delete state.paused;
          delete state.pauseTurnOwner;
          await this.store.saveGameState(effectiveGameId, state);
        }
        if (state?.status === 'active' && state.currentTurn && isBotUserId(this.userIdMap.get(effectiveGameId)?.get(state.currentTurn))) {
          this.scheduleBotTurn?.(effectiveGameId);
        }

        if (state) {
          // Include the waiting-room host so clients can gate rule toggles.
          const matchData = await this.store.getMatchData(effectiveGameId);
          socket.emit('game_joined', matchData ? { ...state, hostId: matchData.player1_id || '' } : state);
        }
      } catch (error) {
        socket.emit('error', `Failed to join game: ${error}`);
      }
    });
  }

  /**
   * Auto-start PvE and hotseat matches — neither has a genuine second remote
   * player to run a ready-check quorum against, so skip it. PvE registers its
   * bot seats here; hotseat just waits for every local seat (playerCount,
   * since hotseat never populates player2_id../player4_id — one real account
   * plays every seat) to have joined before flipping the game active.
   */
  private async autoStartIfReady(gameId: string, matchData: Record<string, string>): Promise<void> {
    const state = await this.store.loadGameState(gameId);
    if (!state) return;

    // Only auto-fill once — if game already active, seats are already registered
    if (state.status === 'active') return;

    if (matchData.gameType === 'PVE') {
      for (let i = 2; i <= 4; i++) {
        const slotUserId = matchData[`player${i}_id`];
        if (!slotUserId || !isBotUserId(slotUserId)) continue;

        const slotColor = this.seatColors[i - 1];
        const botUserId = `${BOT_PREFIX}${slotColor}`;

        // Mark bot player as active and populate frontend-compatible metadata
        const player = state.players.find(p => p.color === slotColor);
        if (player) {
          player.status = 'active';
          player.username = botUserId;
          player.isBot = true;
          player.isConnected = true;
        }

        // Register in userIdMap
        if (!this.userIdMap.has(gameId)) {
          this.userIdMap.set(gameId, new Map());
        }
        this.userIdMap.get(gameId)!.set(slotColor, botUserId);

        // Instantiate bot
        this.getOrCreateBot(gameId, slotColor, this.engine, this.store);
      }
    }

    // Every seat that has actually joined (human, local hotseat seat, or bot
    // just registered above) is auto-ready — there's nobody real left to wait on.
    for (const p of state.players) {
      if (p.status === 'active' && !state.readyPlayers.includes(p.color)) {
        state.readyPlayers.push(p.color);
      }
    }

    await this.store.saveGameState(gameId, state);

    // Hotseat must wait for every local seat to have joined (they join one at
    // a time, via separate join_game calls on the same socket) before
    // starting — otherwise it'd fire after just the first seat.
    const expectedSeats = matchData.gameType === 'HOTSEAT' ? parseInt(matchData.playerCount || '2', 10) : 0;
    const activePlayers = state.players.filter(p => p.status === 'active');
    const allJoined = activePlayers.length >= expectedSeats;
    const allReady = activePlayers.length > 0 &&
      activePlayers.every(p => state.readyPlayers.includes(p.color));

    if (allJoined && allReady && state.status === 'waiting') {
      state.currentTurn = firstActiveColor(state) ?? state.currentTurn;
      state.status = 'active';
      await this.store.saveGameState(gameId, state);
      this.engine.emitEvent({ type: 'game_started', gameId });
    }
  }
}
