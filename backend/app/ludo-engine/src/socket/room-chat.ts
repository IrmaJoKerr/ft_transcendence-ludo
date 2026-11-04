import type { Server } from 'socket.io';
import type { RedisGameStore } from '../redis';
import type { GameSocket } from './auth';
import type { ChatLine } from '../types';
import { GAME_CHAT_COOLDOWN_MS } from '../timing';
import {
  GAME_CHAT_MAX_CHARS,
  filterChatForSeat,
  normalizeBlocks,
  playerLine,
  seatDisplayName,
  type ChatAck,
} from '../game-chat';

// The room channel's two handlers and its one emission point (M3). The room's own
// socket set is the audience — no pub/sub for a player's line, because a blocked pair
// has to be cut before the frame leaves, and one room-wide emit cannot do that.
// System lines take the other road (`chat_message` on the engine's event bus): they
// carry no speech, so the room-wide publish is safe and every seat sees them in the
// same position.
export class RoomChat {
  // `gameId:userId`, so two tabs of one account share one budget (R6/E10) and the
  // two-second spacing means the same thing however many tabs are open.
  private cooldowns = new Map<string, number>();

  constructor(
    private io: Server,
    private store: RedisGameStore,
  ) {}

  // `chat:send`. Validation, the cooldown, then the line: one refusal code each, so
  // the composer never has to guess why a line stayed in the box.
  async send(socket: GameSocket, raw: unknown, ack?: (reply: ChatAck) => void): Promise<void> {
    const reply = (answer: ChatAck) => {
      if (typeof ack === 'function') ack(answer);
    };
    const gameId = socket.data.gameId;
    const userId = socket.data.userId;
    // A guest room has no channel at all, and a socket with no seat has no business
    // speaking in one.
    if (!gameId || !userId || socket.data.isGuest) {
      return reply({ ok: false, error: 'CHAT_UNAVAILABLE' });
    }

    const state = await this.store.loadGameState(gameId);
    // The room outlives the last move while the result card is up, and the channel
    // ends with the game (E5): a finished room refuses exactly as a torn-down one does.
    if (!state || state.status === 'finished') {
      return reply({ ok: false, error: 'CHAT_UNAVAILABLE' });
    }
    const seat = state.players.find((player) => player.userId === userId && !player.isBot);
    if (!seat || seat.status === 'exited' || seat.status === 'inactive') {
      return reply({ ok: false, error: 'CHAT_UNAVAILABLE' });
    }

    const text = typeof raw === 'string' ? raw.trim() : '';
    // `.length`, the same UTF-16 count the composer's `n / 300` uses, so the two
    // can never disagree about one emoji (E4/R8).
    if (text === '') return reply({ ok: false, error: 'CHAT_EMPTY' });
    if (text.length > GAME_CHAT_MAX_CHARS) return reply({ ok: false, error: 'CHAT_TOO_LONG' });

    const key = `${gameId}:${userId}`;
    const now = Date.now();
    const last = this.cooldowns.get(key) ?? 0;
    if (now - last < GAME_CHAT_COOLDOWN_MS) return reply({ ok: false, error: 'CHAT_COOLDOWN' });

    try {
      const seq = await this.store.nextChatSeq(gameId);
      const line = playerLine(
        gameId,
        seq,
        { id: userId, name: seatDisplayName(state, seat.color) },
        text,
        now,
      );
      await this.store.appendChat(gameId, line);
      // Stamped only after the line is stored: a Redis hiccup must not cost the sender
      // two seconds of silence for a message nobody saw.
      this.cooldowns.set(key, now);
      this.emitLine(gameId, line, normalizeBlocks(state.blockedPairs));
      reply({ ok: true });
    } catch (error) {
      console.error(`Failed to store a chat line for ${gameId}:`, error);
      reply({ ok: false, error: 'CHAT_UNAVAILABLE' });
    }
  }

  // `chat:history`, on join and on rejoin: oldest first, filtered by the same ledger
  // the live path uses (E2), so a rejoin cannot read the lines it was hidden from.
  async history(socket: GameSocket): Promise<void> {
    const gameId = socket.data.gameId;
    if (!gameId) return;
    try {
      const state = await this.store.loadGameState(gameId);
      const lines = await this.store.chatTail(gameId);
      socket.emit('chat:history', {
        lines: filterChatForSeat(lines, normalizeBlocks(state?.blockedPairs), socket.data.userId ?? ''),
      });
    } catch (error) {
      console.error(`Failed to replay the chat for ${gameId}:`, error);
    }
  }

  // Drop a room's cooldown stamps when the room goes: the map is per process state,
  // and a room id is never reused.
  forget(gameId: string): void {
    const prefix = `${gameId}:`;
    for (const key of this.cooldowns.keys()) {
      if (key.startsWith(prefix)) this.cooldowns.delete(key);
    }
  }

  // One player's line, to the sockets that may see it. The block ledger is applied
  // here rather than on the client, so a hidden line never reaches the tab it is
  // hidden from; pre-block lines already in the transcript stay.
  private emitLine(gameId: string, line: ChatLine, blocks: ReturnType<typeof normalizeBlocks>): void {
    for (const socket of this.io.sockets.sockets.values()) {
      const seated = socket.data as Partial<GameSocket['data']>;
      if (seated.gameId !== gameId) continue;
      if (filterChatForSeat([line], blocks, seated.userId ?? '').length === 0) continue;
      socket.emit('chat:message', { line });
    }
  }
}
