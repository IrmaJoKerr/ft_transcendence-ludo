import type { RedisGameStore } from './redis';
import type { PlayerColor, RoomRules } from './types';

const SLOT_COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

// LobbyManager: color/seat selection for waiting rooms. Keeps the match hash
// and the live engine GameState in sync when players pick or swap colors.
export class LobbyManager {
  // Redis persistence for game/match state. Lobby broadcasts are published by the
  // socket layer from the saved state, so this module needs no publisher.
  constructor(private store: RedisGameStore) {}

  // Assign (or swap) a seat color in a waiting room, keeping the match hash and the
  // live engine state in sync. Thrown messages carry i18n codes, not prose: the socket
  // forwards the code and the client resolves errors.<CODE>.
  async handleSelectColor(gameId: string, userId: string, color: PlayerColor): Promise<void> {
    const data = await this.store.getMatchData(gameId);
    if (data?.status !== 'WAITING') {
      throw new Error('LOBBY_NOT_WAITING');
    }

    // Find which slot this user is in
    const slotIndex = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].indexOf(
      userId,
    );
    if (slotIndex === -1) {
      throw new Error('MATCH_NOT_PLAYER');
    }

    // Unknown colors and colors beyond this match's seat count have no PlayerMeta
    // in the engine state (see redis.ts createGame's activeColors): reject before
    // touching the match hash so it can't drift out of sync with the engine.
    const maxSeats = parseInt(data.playerCount || '4', 10);
    const colorIndex = SLOT_COLORS.indexOf(color);
    if (colorIndex === -1 || colorIndex >= maxSeats) {
      throw new Error('INVALID_COLOR');
    }

    // Check if color is already taken by another player
    const currentColorKey = `player${slotIndex + 1}_color`;
    const currentColor = (data[currentColorKey] as PlayerColor) || SLOT_COLORS[slotIndex];
    if (currentColor === color) return; // already has this color

    const takenBy = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].find(
      (id, idx) => id && id !== userId && data[`player${idx + 1}_color`] === color,
    );

    if (takenBy) {
      // Swap: give requested color to requester, take the other player's color
      const otherSlot = [
        data.player1_id,
        data.player2_id,
        data.player3_id,
        data.player4_id,
      ].indexOf(takenBy);
      const otherColorKey = `player${otherSlot + 1}_color`;
      const otherColor = data[otherColorKey] as PlayerColor;

      await this.store.updateMatchData(gameId, {
        [currentColorKey]: color,
        [otherColorKey]: otherColor,
      });
    } else {
      // The color is unused, so assign it.
      await this.store.updateMatchData(gameId, { [currentColorKey]: color });
    }

    // Mirror the swap into the live engine GameState so display and gameplay stay
    // in sync (turn and move ownership are color-keyed). Pre-game only, so board
    // pieces are untouched: only seat identity moves between the two slots.
    const state = await this.store.loadGameState(gameId);
    if (state) {
      const a = state.players.find((p) => p.color === currentColor);
      const b = state.players.find((p) => p.color === color);
      if (a && b) {
        // Swap the two seats' occupants: each color keeps its own color while
        // taking on the other player's identity fields.
        const aColor = a.color;
        const bColor = b.color;
        const aNew = { ...b, color: aColor };
        const bNew = { ...a, color: bColor };
        Object.assign(a, aNew);
        Object.assign(b, bNew);
      }
      // Readiness is color-keyed (state.readyPlayers) but readying is a per-player
      // intent, so a seat change clears both colors' ready flags: nobody inherits
      // or loses someone else's Ready, and both players confirm Ready again.
      state.readyPlayers = state.readyPlayers.filter((c) => c !== currentColor && c !== color);
      await this.store.saveGameState(gameId, state);
    }
  }

  // Change the room rules before the game starts: clash, star shield, free exit.
  // Host only, WAITING only, because a mid-game flip would invalidate validated
  // moves. The payload replaces all four fields; errors carry i18n codes.
  async updateModifiers(gameId: string, userId: string, rules: RoomRules): Promise<void> {
    const data = await this.store.getMatchData(gameId);
    if (data?.status !== 'WAITING') {
      throw new Error('LOBBY_NOT_WAITING');
    }
    if (data.player1_id !== userId) {
      throw new Error('MODIFIERS_HOST_ONLY');
    }

    // Match hash first (the room's advertised rules), then the live engine state
    // so the very next roll already honours them.
    await this.store.updateMatchData(gameId, {
      clashEnabled: String(rules.clashEnabled),
      noSafeZones: String(rules.noSafeZones),
      freeExit: String(rules.freeExit),
      // Flat hash string; written even when 0 so the hash describes its own room,
      // and the engine treats absence as the standard room all the same.
      clashKeyShift: String(rules.clashKeyShift),
    });
    const state = await this.store.loadGameState(gameId);
    if (state) {
      state.clashMode = rules.clashEnabled;
      state.noSafeZones = rules.noSafeZones;
      state.freeExit = rules.freeExit;
      // The clamp already forced 0 when clash is off, so the two cannot disagree.
      state.clashKeyShift = rules.clashKeyShift;
      await this.store.saveGameState(gameId, state);
    }
  }
}
