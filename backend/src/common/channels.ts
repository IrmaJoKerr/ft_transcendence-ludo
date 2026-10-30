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
