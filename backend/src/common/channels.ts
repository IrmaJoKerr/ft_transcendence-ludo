// Redis pub/sub channels that cross a process boundary. The ludo-engine keeps its
// own copy of ROOMS_CHANGED_CHANNEL: it is a separate build (backend/app/
// ludo-engine) with no import path into the backend, so this value is the
// contract between them.
//
// `rooms:changed` carries no payload. The backend's broadcaster answers it by
// reading one snapshot and diffing it per viewer, so the publisher cannot get an
// "affected users" hint wrong — and a missed publish is repaired by its 30 s tick.
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

// `friendship:<recipientId>` carries one `friendship:changed` record: `{ state,
// friend }`, with `state` relative to the recipient (socket D2). Per-user, not a
// broadcast: the publisher resolves the audience (both sides of the pair, or every
// accepted friend of a changed profile) and the broadcaster emits it to that
// account's `friends:of:` room. Best effort like `rooms:changed`: the screens'
// repair fetch (mount, reconnect, window focus) is what bounds a lost message.
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
