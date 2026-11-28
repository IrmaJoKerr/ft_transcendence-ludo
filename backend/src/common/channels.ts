// Pub/sub channels that cross a process boundary. The engine keeps its own copy,
// because it cannot import from the backend. `rooms:changed` carries no payload: the
// broadcaster diffs one snapshot per viewer, and a 30 s tick repairs a missed publish.
export const ROOMS_CHANGED_CHANNEL = 'rooms:changed';

// Publish a rooms change from a service that already holds a Redis client. Best
// effort by contract: the broadcaster's 30 s tick repairs a missed message, and a
// lobby notification must never fail the write that caused it.
export async function publishRoomsChanged(redis: {
  publish(channel: string, message: string): Promise<unknown>;
}): Promise<void> {
  try {
    await redis.publish(ROOMS_CHANGED_CHANNEL, '1');
  } catch (error) {
    console.error('Failed to publish rooms:changed:', error);
  }
}

// `friendship:<recipientId>` carries one `friendship:changed` record, with state
// relative to the recipient. The publisher resolves the audience and the broadcaster
// emits to that account's room. Best effort; screens repair on mount, reconnect and focus.
export const FRIENDSHIP_CHANNEL_PREFIX = 'friendship:';

export function friendshipChannel(userId: string): string {
  return `${FRIENDSHIP_CHANNEL_PREFIX}${userId}`;
}

// `match:abandon` carries { gameId, userId }: the engine resolves the seat colour
// from the match hash and finalizes the departure itself, under the same game lock
// its grace replay takes, because the backend cannot write the engine state. Best
// effort like `rooms:changed`: with the engine down or the message lost, the seat's
// 46 s / 1 h reconnect window still ends it.
export const MATCH_ABANDON_CHANNEL = 'match:abandon';

export async function publishMatchAbandon(
  redis: { publish(channel: string, message: string): Promise<unknown> },
  gameId: string,
  userId: string,
): Promise<void> {
  try {
    await redis.publish(MATCH_ABANDON_CHANNEL, JSON.stringify({ gameId, userId }));
  } catch (error) {
    console.error('Failed to publish match:abandon:', error);
  }
}

// The one public chat channel. Membership is the socket, so there is no join
// event: this name keys the pub/sub channel, the transcript list, the id sequence
// and the payload's `ch`.
export const CHAT_CHANNEL = 'lobby';

export const chatPubSubChannel = (ch: string): string => `chat:${ch}`;
export const chatLogKey = (ch: string): string => `chat:${ch}:log`;
export const chatSeqKey = (ch: string): string => `chat:${ch}:seq`;

// A room's channel name (M3). The engine keeps its own copy of the key helpers in
// `game-chat.ts`; the channel name is the contract between the two builds, and the
// backend reads the same list when it writes a row's transcript.
export const gameChatChannel = (gameId: string): string => `game:${gameId}`;

// `blocks:changed` carries { a, b, blocked }: a block minted here has to be applied
// inside the room, which is where the chat lines and their sequence live. The engine
// stamps the cut with its own sequence, so no clock crosses the wire. Best effort:
// with the engine down or the message lost, the block still hides the pair in every
// live room from the next send on, and nothing is retroactively deleted.
export const BLOCKS_CHANGED_CHANNEL = 'blocks:changed';

export async function publishBlocksChanged(
  redis: { publish(channel: string, message: string): Promise<unknown> },
  a: string,
  b: string,
  blocked: boolean,
): Promise<void> {
  try {
    await redis.publish(BLOCKS_CHANGED_CHANNEL, JSON.stringify({ a, b, blocked }));
  } catch (error) {
    console.error('Failed to publish blocks:changed:', error);
  }
}
