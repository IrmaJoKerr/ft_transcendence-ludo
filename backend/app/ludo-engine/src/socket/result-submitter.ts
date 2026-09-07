import { LudoEngine } from '../engine';
import { RedisGameStore } from '../redis';
import type { PlayerColor } from '../types';
import { BACKEND_URL } from './auth';

function getEngineApiKey(): string {
  return process.env.ENGINE_API_KEY || 'dev-engine-key';
}

/**
 * ResultSubmitter handles game end: submitting results to the backend
 * and cleaning up in-memory state.
 */
export class ResultSubmitter {
  constructor(
    private engine: LudoEngine,
    private store: RedisGameStore,
    private userIdMap: Map<string, Map<PlayerColor, string>>,
    private cleanup: (gameId: string) => void,
  ) {}

  async submitGameResult(gameId: string): Promise<void> {
    try {
      const state = await this.engine.getGameState(gameId);
      if (!state) return;

      // Hotseat is demo-and-forget (achievement-revamp.md §2): the game plays
      // to completion and the frontend shows the end card client-side, but the
      // result is NEVER submitted to the backend : no /api/game/end POST, no
      // Game/participant rows, no lifetime counters, no leaderboard impact.
      // Counters are only derived from PVP/PVE games.
      const matchData = await this.store.getMatchData(gameId);
      if (matchData?.gameType === 'HOTSEAT') {
        console.log(`Game ${gameId} is HOTSEAT : skipping backend submission (demo-and-forget)`);
        state.resultSubmitted = true;
        await this.store.saveGameState(gameId, state);
        return;
      }

      if (state.resultSubmitted) {
        console.log(`Game ${gameId} result already submitted, skipping`);
        return;
      }
      state.resultSubmitted = true;
      await this.store.saveGameState(gameId, state);

      const participants = [];
      for (const player of state.players) {
        // Players who aborted/left via End Game (status 'exited') are pruned
        // from the board and must NOT receive a definitive result or rating :
        // they didn't finish the match, so no outcome is recorded for them.
        if (player.status === 'exited') continue;
        const stats = { ...player.stats };
        const userId = this.userIdMap.get(gameId)?.get(player.color) || `bot-${player.color}`;
        participants.push({
          userId,
          color: player.color.toUpperCase(),
          rank: player.color === state.winner ? 1 : 2,
          totalTurns: stats.turns,
          piecesCaptured: stats.captures,
          piecesInGoal: stats.piecesInGoal,
          clashDefends: stats.clashDefends ?? 0,
          clashAttacksWon: stats.clashAttacksWon ?? 0,
        });
      }

      const engineApiKey = getEngineApiKey();
      await fetch(`${BACKEND_URL}/api/game/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Key': engineApiKey,
        },
        body: JSON.stringify({ gameId, participants }),
      });
    } catch (err) {
      console.error('Failed to submit game result:', err);
    }
  }

  /**
   * Tell the backend a game just left the lobby (ready-check passed / auto-start
   * fired) so it flips the Redis match record from WAITING to ACTIVE : otherwise
   * it keeps showing up in the public "open rooms" list mid-game.
   */
  async notifyGameStarted(gameId: string): Promise<void> {
    try {
      const engineApiKey = getEngineApiKey();
      await fetch(`${BACKEND_URL}/api/game/${gameId}/started`, {
        method: 'POST',
        headers: { 'X-Engine-Key': engineApiKey },
      });
    } catch (err) {
      console.error('Failed to notify game started:', err);
    }
  }
}