import { LudoEngine } from '../engine';
import { RedisGameStore } from '../redis';
import { LudoBot } from '../bot';
import { firstActiveColor } from '../player-handler';
import { GameSocket, isBotUserId, BOT_PREFIX } from './auth';
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
    private userIdMap: Map<string, Map<PlayerColor, string>>,
    private getOrCreateBot: (
      gameId: string,
      color: PlayerColor,
      engine: LudoEngine,
      store: RedisGameStore,
    ) => LudoBot,
    private scheduleBotTurn?: (gameId: string) => void,
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
    const effectiveGameId = socket.data.gameId || gameId;
    const effectiveUserId = socket.data.userId || userId;
    const effectiveUsername = displayName || socket.data.username;
    const isHotseat = socket.data.mode === 'hotseat';
    const effectiveColor = (!isHotseat && socket.data.tokenColor) || playerColor;

    this.withGameLock(effectiveGameId, async () => {
      try {
        socket.join(effectiveGameId);
        socket.data.gameId = effectiveGameId;
        socket.data.playerColor = effectiveColor;

        if (effectiveUserId) {
          if (!this.userIdMap.has(effectiveGameId)) {
            this.userIdMap.set(effectiveGameId, new Map());
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
            : SLOT_COLORS.slice(0, playerCount);
          // Clash mode + safe zones follow the match's lobby toggles (persisted
          // in the match hash by the backend at creation) rather than being
          // hardcoded on: the engine gate in movePiece checks state.clashMode,
          // and safeZones gates captures/blockades in MoveValidator.
          await this.store.createGame(
            effectiveGameId,
            creationMatchData?.clashEnabled === 'true',
            seatColors,
            creationMatchData?.safeZones !== 'false',
          );
          state = await this.store.loadGameState(effectiveGameId);
        }
        if (state) {
          const discIndex = state.disconnectedPlayers.findIndex((d) => d.color === effectiveColor);
          const isReconnectingPlayer = discIndex !== -1;

          // Socket locking: reject non-reconnecting joins to games already in
          // progress : only a player reconnecting to their own seat may re-enter.
          // Hotseat is exempt — only 1 socket used in this game mode.
          if (state.status !== 'waiting' && !isReconnectingPlayer && !isHotseat) {
            socket.emit('error', 'Game already in progress');
            return;
          }

          if (isReconnectingPlayer) {
            await this.engine.handlePlayerReconnect(effectiveGameId, effectiveColor);
            state = await this.store.loadGameState(effectiveGameId);
            // The player is back on their old seat, so tell the room: every client
            // switches that seat from "Reconnecting…" back to active.
            if (state && !state.disconnectedPlayers.some((d) => d.color === effectiveColor)) {
              this.engine.emitEvent({
                type: 'player_reconnected',
                gameId: effectiveGameId,
                color: effectiveColor,
              });
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
        const matchData = await this.store.getMatchData(effectiveGameId);
        if (matchData && (matchData.gameType === 'PVE' || matchData.gameType === 'HOTSEAT')) {
          await this.autoStartIfReady(effectiveGameId, matchData);
          // Reload state : autoStartIfReady may have transitioned it to 'active'
          state = await this.store.loadGameState(effectiveGameId);
        }

        // Resume re-arm: a join into an ACTIVE game clears the pause flag and
        // re-kicks the bot trigger : this unfreezes a bot-mode game the player
        // left mid-game or refreshed.
        if (state?.status === 'active' && state.paused) {
          delete state.paused;
          delete state.pauseTurnOwner;
          await this.store.saveGameState(effectiveGameId, state);
        }
        if (
          state?.status === 'active' &&
          state.currentTurn &&
          isBotUserId(this.userIdMap.get(effectiveGameId)?.get(state.currentTurn))
        ) {
          this.scheduleBotTurn?.(effectiveGameId);
        }

        if (state) {
          // hostId travels with the join payload so the waiting room can tell
          // who may toggle the room rules (clash mode / safe zones).
          const joinMatchData = await this.store.getMatchData(effectiveGameId);
          socket.emit(
            'game_joined',
            joinMatchData ? { ...state, hostId: joinMatchData.player1_id || '' } : state,
          );
        }
      } catch (error) {
        socket.emit('error', `Failed to join game: ${error}`);
      }
    });
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
          // A bot has no photo; hasAvatarPhoto stays false so the client renders
          // the generated avatar instead of requesting one.
          player.hasAvatarPhoto = false;
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
