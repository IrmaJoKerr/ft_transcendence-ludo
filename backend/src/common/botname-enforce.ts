// Bot ids use `bot-<color>`; the engine keeps its own copy. The prefix only mints an id:
// a seat's kind comes from `player<N>_isBot`, never from the id shape.
export const BOT_PREFIX = 'bot-';

// A human (display) name may not masquerade as a bot: reserve the `bot` stem
// followed by a separator (`bot-`, `bot `, `bot_`), case-insensitive.
export function isReservedBotName(name: string): boolean {
  return /^bot[-\s_]/i.test(name.trim());
}
