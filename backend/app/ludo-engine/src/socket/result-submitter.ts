import type { LudoEngine } from '../engine';
import type { RedisGameStore } from '../redis';
import { BACKEND_URL } from './auth';
import type { RoomRegistry } from './room-context';
import { MoveValidator } from '../move-validator';

// The backend compares this against its own ENGINE_API_KEY, so a fallback would
// only ever be rejected and would hide a misconfigured container. The engine
// refuses to boot without the variable: see SocketServer.start().
function getEngineApiKey(): string {
  const key = process.env.ENGINE_API_KEY;
  if (!key) throw new Error('Missing required env var ENGINE_API_KEY');
  return key;
}

// ResultSubmitter: posts finished-game results to the backend and cleans up
// in-memory state.
export class ResultSubmitter {
  constructor(
    private engine: LudoEngine,
    private store: RedisGameStore,
    private rooms: RoomRegistry,
    private cleanup: (gameId: string) => void,
  ) {}

  // POST the finished game's results to the backend /api/game/end exactly
  // once per game (idempotent via resultSubmitted). Skips hotseat entirely.
  // Called by PostGameManager when a game_ended event arrives.
  async submitGameResult(gameId: string): Promise<void> {
    try {
      const state = await this.engine.getGameState(gameId);
      if (!state) return;

      // Hotseat is demo-and-forget: the result is NEVER submitted to the
      // backend : no game/participant rows, no counters, no leaderboard.
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
        // Only seats still in the game are reported, and a bot has no account to
        // record a result for.
        if (player.status === 'exited' || player.status === 'inactive') continue;
        if (player.isBot) continue;

        const stats = { ...player.stats };
        const userId =
          player.userId ||
          this.store.seatUserFrom(matchData, player.color) ||
          this.rooms.get(gameId)?.seat(player.color);

        // No account for a seat that is still in the game: report the rest of
        // the room rather than filing the result against a made-up user.
        if (!userId) {
          console.error(
            `Game ${gameId}: no account recorded for seat ${player.color}; skipping this seat.`,
          );
          continue;
        }

        // The board is the source of truth for the piece count. The seat meta and
        // the per-game tally are caches, so any disagreement is logged.
        const piecesInGoal = MoveValidator.countPiecesInGoal(state, player.color);
        if (piecesInGoal !== stats.piecesInGoal) {
          console.warn(
            `Game ${gameId}: seat ${player.color} pieces-in-goal mismatch ` +
              `(board ${piecesInGoal}, tally ${stats.piecesInGoal})`,
          );
        }

        // The three clash tallies ride along for the clash achievements; a seat
        // record written before they existed reads 0.
        participants.push({
          userId,
          color: player.color.toUpperCase(),
          rank: player.color === state.winner ? 1 : 2,
          totalTurns: stats.turns,
          piecesCaptured: stats.captures,
          piecesInGoal,
          clashDefends: stats.clashDefends ?? 0,
          clashAttacksWon: stats.clashAttacksWon ?? 0,
          barrierBreaks: stats.barrierBreaks ?? 0,
        });
      }

      if (participants.length === 0) {
        console.error(`Game ${gameId}: no participant accounts resolved; nothing to submit.`);
        return;
      }

      const engineApiKey = getEngineApiKey();
      const res = await fetch(`${BACKEND_URL}/api/game/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Engine-Key': engineApiKey,
        },
        body: JSON.stringify({ gameId, participants }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`Game ${gameId}: /api/game/end rejected ${res.status}: ${body}`);
      }
    } catch (err) {
      console.error('Failed to submit game result:', err);
    }
  }

  // Tell the backend a game left the lobby so it flips the Redis match from
  // WAITING to ACTIVE : otherwise it keeps appearing in "open rooms" mid-game.
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
