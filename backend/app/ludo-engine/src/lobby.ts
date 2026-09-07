import { RedisGameStore } from './redis';
import { EventPublisher } from './socket/event-publisher';
import type { PlayerColor } from './types';

const SLOT_COLORS: PlayerColor[] = ['blue', 'red', 'green', 'yellow'];

// Lobby/color-selection manager for waiting rooms: roster reads, color
// picking with swap, and the ready-check gate. Used by LudoEngine and
// socket/server.ts.
export class LobbyManager {
  // Redis persistence for game/match state, and the publisher used to push
  // lobby update events to connected clients.
  constructor(private store: RedisGameStore, private publisher: EventPublisher) {}

  // Read the waiting-room roster from the match hash (seat, color, ready).
  // Used by socket handlers to serve the lobby screen.
  async getLobbyState(gameId: string): Promise<{ players: { userId: string; color: PlayerColor; ready: boolean }[] } | null> {
    const data = await this.store.getMatchData(gameId);
    if (!data) return null;

    const players = [];
    for (let i = 1; i <= 4; i++) {
      const userId = data[`player${i}_id`];
      if (!userId) continue;
      const color = (data[`player${i}_color`] as PlayerColor) || SLOT_COLORS[i - 1];
      const ready = (data.readyPlayers || '').split(',').includes(color);
      players.push({ userId, color, ready });
    }
    return { players };
  }

  // Assign (or swap) a seat color for a player in a waiting room, keeping the
  // match hash and the live engine GameState in sync. Used by
  // LudoEngine.handlePlayerSelectColor.
  async handleSelectColor(gameId: string, userId: string, color: PlayerColor): Promise<void> {
    const data = await this.store.getMatchData(gameId);
    if (!data || data.status !== 'WAITING') {
      throw new Error('Game is not in waiting state');
    }

    // Find which slot this user is in
    const slotIndex = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].indexOf(userId);
    if (slotIndex === -1) {
      throw new Error('You are not a player in this game');
    }

    // Colors beyond this match's seat count have no PlayerMeta in the engine
    // state (see redis.ts createGame's activeColors) : reject before touching
    // the match hash so it can't drift out of sync with the engine.
    const maxSeats = parseInt(data.playerCount || '4', 10);
    if (SLOT_COLORS.indexOf(color) >= maxSeats) {
      throw new Error('Color not available for this match size');
    }

    // Check if color is already taken by another player
    const currentColorKey = `player${slotIndex + 1}_color`;
    const currentColor = (data[currentColorKey] as PlayerColor) || SLOT_COLORS[slotIndex];
    if (currentColor === color) return; // already has this color

    const takenBy = [data.player1_id, data.player2_id, data.player3_id, data.player4_id]
      .find((id, idx) => id && id !== userId && (data[`player${idx + 1}_color`] as string) === color);

    if (takenBy) {
      // Swap: give requested color to requester, take the other player's color.
      // The other slot must get the REQUESTER's old color (currentColor) : not
      // its own stale value : or the match hash ends up with both players on
      // the same color, which then corrupts resolveEffectiveColor seat binding
      // and userIdMap ownership (one player's clash presses get rejected).
      const otherSlot = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].indexOf(takenBy);
      const otherColorKey = `player${otherSlot + 1}_color`;

      await this.store.updateMatchData(gameId, {
        [currentColorKey]: color,
        [otherColorKey]: currentColor,
      });
    } else {
      // Color is free, just assign
      await this.store.updateMatchData(gameId, { [currentColorKey]: color });
    }

    // Mirror the swap into the live engine GameState so display and gameplay
    // (turn/move ownership is color-keyed) stay in sync. This is pre-game only
    // (status === 'WAITING' guard above), so board pieces are untouched : all
    // still sitting in base : only seat *identity* moves between the two slots.
    const state = await this.store.loadGameState(gameId);
    if (state) {
      const a = state.players.find(p => p.color === currentColor);
      const b = state.players.find(p => p.color === color);
      if (a && b) {
        const { color: _colorA, ...aRest } = a;
        const { color: _colorB, ...bRest } = b;
        Object.assign(a, bRest);
        Object.assign(b, aRest);
        await this.store.saveGameState(gameId, state);
      }
    }
  }

  // Host-only live update of the game rules (clash mode + safe zones) while
  // the room is still waiting. Mirrors the change into both the match hash
  // and the engine GameState so the engine's capture logic matches the lobby.
  async updateModifiers(gameId: string, userId: string, clashEnabled: boolean, safeZones: boolean): Promise<void> {
    const data = await this.store.getMatchData(gameId);
    if (!data || data.status !== 'WAITING') {
      throw new Error('Game is not in waiting state');
    }
    if (data.player1_id !== userId) {
      throw new Error('Only the host can change the game rules');
    }
    await this.store.updateMatchData(gameId, {
      clashEnabled: String(clashEnabled),
      safeZones: String(safeZones),
    });
    const state = await this.store.loadGameState(gameId);
    if (state) {
      state.clashMode = clashEnabled;
      state.safeZones = safeZones;
      await this.store.saveGameState(gameId, state);
    }
  }

  // True when the room can start: ≥2 seated players, everyone has a color,
  // and everyone is ready. Used by the socket ready-check flow.
  async handleReadyCheck(gameId: string): Promise<boolean> {
    const data = await this.store.getMatchData(gameId);
    if (!data || data.status !== 'WAITING') return false;

    const activePlayers = [data.player1_id, data.player2_id, data.player3_id, data.player4_id].filter(Boolean);
    if (activePlayers.length < 2) return false;

    // Check all active players have selected colors
    for (let i = 1; i <= 4; i++) {
      const userId = data[`player${i}_id`];
      if (!userId) continue;
      const color = data[`player${i}_color`];
      if (!color) return false; // hasn't selected color
    }

    // Check all active players are ready
    const readyColors = (data.readyPlayers || '').split(',').filter(Boolean);
    for (let i = 1; i <= 4; i++) {
      const userId = data[`player${i}_id`];
      if (!userId) continue;
      const color = data[`player${i}_color`];
      if (!readyColors.includes(color)) return false;
    }

    return true;
  }
}
