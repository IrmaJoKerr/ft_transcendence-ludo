// Bot ids are `bot-<color>`, owned here for the backend; the engine keeps its own
// copy in socket/auth.ts. The prefix mints an id; what a seat *is* comes from the
// `player<N>_isBot` flag written beside it, so nothing classifies a seat by
// looking at the shape of its id.
export const BOT_PREFIX = 'bot-';

// A human (display) name may not masquerade as a bot: reserve the `bot` stem
// followed by a separator (`bot-`, `bot `, `bot_`), case-insensitive.
export function isReservedBotName(name: string): boolean {
  return /^bot[-\s_]/i.test(name.trim());
}
