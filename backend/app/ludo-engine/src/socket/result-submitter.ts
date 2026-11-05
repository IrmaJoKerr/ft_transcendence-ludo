import type { LudoEngine } from '../engine';
import type { RedisGameStore } from '../redis';
import type { ChatBlock, ChatLine, ExitRecord } from '../types';
import { BACKEND_URL } from './auth';
import type { RoomRegistry } from './room-context';
import { MoveValidator } from '../move-validator';
import { GAME_CHAT_FALLBACK_LINES } from '../__shared__/chat.constants';
import { chatForTransport, normalizeBlocks } from '../game-chat';

// The backend compares this against its own ENGINE_API_KEY, so a fallback would
// only ever be rejected and would hide a misconfigured container. The engine
// refuses to boot without the variable: see SocketServer.start().
function getEngineApiKey(): string {
  const key = process.env.ENGINE_API_KEY;
  if (!key) throw new Error('Missing required env var ENGINE_API_KEY');
  return key;
}

// How long a delivery waits between attempts. A finished room lives
// POST_GAME_TIMEOUT_MS (60 s), so the completion report fits five attempts inside
// it. A departure record has the whole life of the room that kept playing, and the
// wake pass tries again on the next restart or reconnect, so three attempts are
// enough for the live path.
const END_RETRY_MS = [2000, 4000, 8000, 16000, 24000];
const EXIT_RETRY_MS = [1000, 4000, 10000];

// The wire body of one abandonment row: the backend's SeatAbandonPayload. Colours
// travel uppercase, matching the PlayerColor enum.
function abandonBody(record: ExitRecord) {
  return {
    userId: record.userId,
    color: record.color.toUpperCase(),
    rank: record.rank,
    capturedAt: record.capturedAt,
    totalTurns: record.turns,
    piecesCaptured: record.captures,
    piecesInGoal: record.piecesInGoal,
    piecesLost: record.piecesLost,
    diceRolls: record.diceRolls,
    sixes: record.sixes,
    clashDefends: record.clashDefends,
    clashAttacksWon: record.clashAttacksWon,
    clashWallBattlesWon: record.clashWallBattlesWon,
    clashWallsAttacked: record.clashWallsAttacked,
    clashWallsDefended: record.clashWallsDefended,
  };
}

// ResultSubmitter: posts finished-game results to the backend.
export class ResultSubmitter {
  constructor(
    private engine: LudoEngine,
    private store: RedisGameStore,
    private rooms: RoomRegistry,
  ) {}

  // POST the finished game's results to the backend /api/game/end, once per game
  // (idempotent via resultSubmitted) and retrying inside the room's post-game window.
  // Skips hotseat and guest entirely. Called when a game_ended event arrives, and
  // again by the wake pass for a finished room whose delivery never landed.
  async submitGameResult(gameId: string): Promise<void> {
    try {
      const state = await this.engine.getGameState(gameId);
      if (!state) return;

      // Hotseat is demo-and-forget, and so is a guest room: the result is never
      // submitted, so no game rows, counters or leaderboard. A guest room also gives
      // its concurrency slots back here.
      const matchData = await this.store.getMatchData(gameId);
      if (matchData?.gameType === 'HOTSEAT' || matchData?.isGuest === 'true') {
        const kind = matchData?.isGuest === 'true' ? 'GUEST' : 'HOTSEAT';
        console.log(`Game ${gameId} is ${kind} : skipping backend submission (demo-and-forget)`);
        state.resultSubmitted = true;
        await this.store.saveGameState(gameId, state);
        if (matchData?.isGuest === 'true' && matchData.guestIpHash) {
          await this.store.releaseGuestRoom(matchData.guestIpHash);
        }
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

        // Every tally the match row prints. `?? 0` covers a seat record written
        // before a counter existed (a room that outlived a redeploy), where undefined
        // would reach the backend as a hole in the payload.
        participants.push({
          userId,
          color: player.color.toUpperCase(),
          rank: player.color === state.winner ? 1 : 2,
          totalTurns: stats.turns,
          piecesCaptured: stats.captures,
          piecesInGoal,
          piecesLost: stats.piecesLost ?? 0,
          diceRolls: stats.diceRolls ?? 0,
          sixes: stats.sixes ?? 0,
          clashDefends: stats.clashDefends ?? 0,
          clashAttacksWon: stats.clashAttacksWon ?? 0,
          clashWallBattlesWon: stats.clashWallBattlesWon ?? 0,
          clashWallsAttacked: stats.clashWallsAttacked ?? 0,
          clashWallsDefended: stats.clashWallsDefended ?? 0,
        });
      }

      if (participants.length === 0) {
        console.error(`Game ${gameId}: no participant accounts resolved; nothing to submit.`);
        return;
      }

      // The flag is written only after a 2xx (R4). Burning it before the POST loses
      // the result for good when the backend answers 409 (the room is not over yet)
      // or fails: the record is a fact, the delivery is not.
      const room = await this.readChat(gameId);
      // `truncated` starts false: it is only ever set by the fallback below, so a row
      // never claims a cut transcript that was not cut.
      let truncated = false;
      const body = () => ({
        gameId,
        participants,
        status: 'completed',
        ...(room ? { chat: { truncated, lines: room.lines }, blocks: room.blocks } : {}),
      });
      const ok = await this.postWithRetry(`${BACKEND_URL}/api/game/end`, body, END_RETRY_MS, () => {
        if (!room) return;
        room.lines = chatForTransport(room.lines, GAME_CHAT_FALLBACK_LINES);
        truncated = true;
      });
      if (!ok) {
        console.error(`Game ${gameId}: /api/game/end never accepted the result; left unsubmitted`);
        return;
      }
      // Re-read: the room's 60 s post-game window may have deleted the state while the
      // attempts ran, and saving the pre-POST copy would resurrect it.
      const after = await this.engine.getGameState(gameId);
      if (after) {
        after.resultSubmitted = true;
        await this.store.saveGameState(gameId, after);
      }
    } catch (err) {
      console.error('Failed to submit game result:', err);
    }
  }

  // POST one record per seat that left a room, and mark each one delivered only after
  // its own 2xx. A room that closed passes every seat it held; a room that kept playing
  // passes the seat that left. Whatever fails stays on the seat (`exitRecord`), so the
  // wake pass tries again instead of losing the row.
  async submitExits(gameId: string, records: ExitRecord[]): Promise<void> {
    if (records.length === 0) return;
    try {
      // A room that never started is a room, not a match: the backend refuses every
      // row with MATCH_ABANDON_NEVER_STARTED, so this pass would post one body per
      // seat that is refused by design. The guard reads the same start stamp the
      // backend's own check does (PvE writes it at creation, PvP when the game starts).
      const matchData = await this.store.getMatchData(gameId);
      if (!matchData?.startedAt) return;
      // The room's transcript rides each seat's body: the backend filters it per seat
      // with this same block ledger (M3), so a row holds what that player was shown.
      const room = await this.readChat(gameId);
      for (const record of records) {
        let truncated = false;
        const body = () => ({
          ...abandonBody(record),
          ...(room ? { chat: { truncated, lines: room.lines }, blocks: room.blocks } : {}),
        });
        const ok = await this.postWithRetry(
          `${BACKEND_URL}/api/game/${encodeURIComponent(gameId)}/abandon`,
          body,
          EXIT_RETRY_MS,
          () => {
            if (!room) return;
            room.lines = chatForTransport(room.lines, GAME_CHAT_FALLBACK_LINES);
            truncated = true;
          },
        );
        if (!ok) {
          console.error(
            `Game ${gameId}: seat ${record.color} was never recorded; it stays pending`,
          );
          continue;
        }
        await this.engine.markExitSubmitted(gameId, record.color);
      }
    } catch (err) {
      console.error('Failed to submit a departure record:', err);
    }
  }

  // The room's transcript and its block ledger, read once per delivery: the backend
  // applies the ledger per seat as it builds the rows, so one payload serves all of
  // them. `null` when the room has no channel (PvE, hotseat, guest) or never wrote a
  // line, which is what leaves `chat` null on those rows.
  private async readChat(
    gameId: string,
  ): Promise<{ lines: ChatLine[]; blocks: ChatBlock[] } | null> {
    const state = await this.store.loadGameState(gameId);
    const lines = await this.store.chatTail(gameId);
    if (lines.length === 0) return null;
    return { lines, blocks: normalizeBlocks(state?.blockedPairs) };
  }

  // A POST with a fixed backoff: 2xx is the only success, a 409 ("not yet") and a 5xx
  // are retried, and any other 4xx is a body the backend will never accept. A 413 is
  // the one refusal that is answered rather than retried as-is: `onTooLarge` shrinks
  // the body once (the newest lines only) and the smaller one goes out immediately.
  private async postWithRetry(
    url: string,
    makeBody: () => unknown,
    delays: number[],
    onTooLarge?: () => void,
  ): Promise<boolean> {
    let recovered = false;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Engine-Key': getEngineApiKey(),
          },
          body: JSON.stringify(makeBody()),
        });
        if (res.ok) return true;
        const text = await res.text().catch(() => '');
        if (res.status === 413 && onTooLarge && !recovered) {
          // The transcript outgrew the route's cap. One smaller body, no backoff:
          // this is not the same request failing, it is a different one.
          recovered = true;
          onTooLarge();
          console.error(`${url} refused the transcript (413); re-posting the tail only`);
          continue;
        }
        console.error(`${url} rejected ${res.status}: ${text}`);
        if (res.status !== 409 && res.status < 500) return false;
      } catch (err) {
        console.error(`${url} failed:`, err instanceof Error ? err.message : err);
      }
      const wait = delays[attempt];
      if (wait === undefined) return false;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }

  // Tell the backend a game left the lobby so it flips the Redis match from
  // WAITING to ACTIVE : otherwise it keeps appearing in "open rooms" mid-game.
  async notifyGameStarted(gameId: string): Promise<void> {
    try {
      // The backend never even hears about a guest room: it is ACTIVE from
      // creation, so there is no lobby transition to record.
      const matchData = await this.store.getMatchData(gameId);
      if (matchData?.isGuest === 'true') return;

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
