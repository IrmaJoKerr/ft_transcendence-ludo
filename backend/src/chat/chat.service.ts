import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { CHAT_CHANNEL, chatLogKey, chatPubSubChannel, chatSeqKey } from '../common/channels';
import { PrismaService } from '../prisma.service';
import { secret } from '../secrets';
import { CHAT_HISTORY } from './chat.constants';

// One frame of the public channel. `id` is the channel's sequence in string form:
// a total order, a stable React key and the dedupe that stops a reconnect's
// history and the last live frame from painting one line twice.
export type ChatMessage = {
  id: string;
  senderId: string;
  senderName: string;
  senderUsername: string;
  text: string;
  at: string;
  ch: string;
};

// What the pub/sub channel carries: the frame plus the ids the sender has blocked.
// The sender's list travels with it because the recipient's own set cannot answer
// the reverse direction: a block is never announced to the side it hides from.
export type ChatRecord = { message: ChatMessage; senderBlocked: string[] };

// What `chat:send` answers. A refusal is a code rather than silence: the panel
// keeps the text and shows the reason in its one status line, so the sender always
// knows whether the line went out.
export type ChatAck =
  | { ok: true }
  | { ok: false; error: 'CHAT_EMPTY' | 'CHAT_TOO_LONG' | 'CHAT_COOLDOWN' | 'CHAT_UNAVAILABLE' };


const isString = (value: unknown): value is string => typeof value === 'string';

// The broadcaster's guard: a malformed record is dropped here rather than handed
// to every socket as a shape the panel cannot read.
export function parseChatRecord(raw: string): ChatRecord | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as { message?: unknown; senderBlocked?: unknown };
    const message = candidate.message as ChatMessage | undefined;
    if (
      !message ||
      !isString(message.id) ||
      !isString(message.senderId) ||
      !isString(message.text) ||
      !isString(message.at) ||
      !isString(message.ch)
    ) {
      return null;
    }
    if (candidate.senderBlocked !== undefined && !Array.isArray(candidate.senderBlocked)) return null;
    const senderBlocked = (candidate.senderBlocked ?? []).filter(isString);
    return { message, senderBlocked };
  } catch {
    return null;
  }
}

// Storage and fan-out for the one public channel: a Redis list, a sequence key and
// a plain publish. No Prisma model and no migration, and with AOF on the
// transcript survives a container restart for free.
@Injectable()
export class ChatService implements OnModuleDestroy {
  private redis: Redis;

  constructor(private readonly prisma: PrismaService) {
    const host = process.env.REDIS_HOST ?? 'redis';
    const port = parseInt(process.env.REDIS_PORT ?? '6479', 10);
    const password = secret('REDIS_PASSWORD');
    this.redis = new Redis({ host, port, password, retryStrategy: (t) => Math.min(t * 50, 2000) });
    this.redis.on('error', (error) => {
      console.error('Chat Redis error:', error.message);
    });
  }

  onModuleDestroy(): void {
    void this.redis.quit().catch(() => undefined);
  }

  // Append one message: mint the id, push it, trim the list. The display name is
  // read here rather than trusted from the socket, so a rename shows up on the
  // next line and a crafted frame cannot choose its own name.
  async append(
    sender: { id: string; username: string },
    text: string,
  ): Promise<ChatMessage> {
    const seq = await this.redis.incr(chatSeqKey(CHAT_CHANNEL));
    const profile = await this.prisma.db.user.findUnique({
      where: { id: sender.id },
      select: { displayName: true, username: true },
    });
    const message: ChatMessage = {
      id: `${CHAT_CHANNEL}:${seq}`,
      senderId: sender.id,
      senderName: profile?.displayName ?? profile?.username ?? sender.username,
      senderUsername: profile?.username ?? sender.username,
      text,
      at: new Date().toISOString(),
      ch: CHAT_CHANNEL,
    };
    const key = chatLogKey(CHAT_CHANNEL);
    // Push then trim: the list is the transcript and the trim is its retention,
    // so there is no deletion story and no second key to keep in step.
    await this.redis.lpush(key, JSON.stringify(message));
    await this.redis.ltrim(key, 0, CHAT_HISTORY - 1);
    return message;
  }

  // The transcript, oldest first, which is the order a log is painted in. A
  // malformed line is dropped rather than surfaced as an unreadable row.
  async history(): Promise<ChatMessage[]> {
    const lines = await this.redis.lrange(chatLogKey(CHAT_CHANNEL), 0, CHAT_HISTORY - 1);
    const messages: ChatMessage[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as ChatMessage;
        if (isString(parsed?.id) && isString(parsed?.text) && isString(parsed?.senderId)) {
          messages.push(parsed);
        }
      } catch {
        /* one bad line must not cost the transcript */
      }
    }
    return messages.reverse();
  }

  // Best effort by contract: a fan-out outage must never fail the send that
  // caused it. The line is already in the log, so a reconnect repairs it.
  async publish(record: ChatRecord): Promise<void> {
    try {
      await this.redis.publish(chatPubSubChannel(CHAT_CHANNEL), JSON.stringify(record));
    } catch (error) {
      console.error('Failed to publish chat message:', error);
    }
  }
}
