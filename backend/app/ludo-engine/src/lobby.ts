import type { RedisGameStore } from './redis';
import type { RoomRules } from './types';

// LobbyManager: rule changes for waiting rooms. Seat colours are not its business:
// a colour is claimed when the seat is taken (the join request), and the swap path
// that used to live here is gone.
export class LobbyManager {
  // Redis persistence for game/match state. Lobby broadcasts are published by the
  // socket layer from the saved state, so this module needs no publisher.
  constructor(private store: RedisGameStore) {}

  // Change the room rules before the game starts: clash, star shield, free exit.
  // Host only, WAITING only, because a mid-game flip would invalidate validated
  // moves. The payload replaces all four fields; errors carry i18n codes.
  async updateModifiers(gameId: string, userId: string, rules: RoomRules): Promise<void> {
    const data = await this.store.getMatchData(gameId);
    if (data?.status !== 'WAITING') {
      throw new Error('LOBBY_NOT_WAITING');
    }
    // The host is its own hash field: their seat is their colour's slot, so
    // `player1_id` is blue's seat holder, not necessarily the room's creator.
    if (data.hostId !== userId) {
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
