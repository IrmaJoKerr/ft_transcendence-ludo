import type { PlayerColor } from '../game/types';
import { COLOR_KEYS, type ColorKey } from '../theme';

// `PlayerColor` to its localized colour word through the shared `lobby.color*` keys:
//  `red` -> `Rouge` in French, `Merah` in Malay. A label shown in all caps upper-cases
//  the result.
export function localizedColor(
  t: (key: string, options?: Record<string, unknown>) => string,
  color: PlayerColor,
): string {
  return t(COLOR_KEYS[color]);
}

// Engine seat ids are `bot-<color>` or `player-<color>`, optionally with a trailing
// assistant name, e.g. `bot-red (Siri)`. Only the role and colour words are localized;
// any suffix is kept as typed.
const PILOT_ID = /^(bot|player)-(red|green|yellow|blue)(?:\s*\(([^()]*)\))?$/i;

// A seat id to a localized "<role>-<colour>", keeping any "(assistant)" suffix:
//  "bot-red (Siri)" -> "bot-rouge (Siri)", "player-yellow" -> "joueur-jaune".
//  Every other string is returned unchanged, so a typed-in name survives.
export function localizedPilotName(
  t: (key: string, options?: Record<string, unknown>) => string,
  raw?: string,
): string {
  if (!raw) return raw ?? '';
  const m = raw.match(PILOT_ID);
  if (!m) return raw;
  const role = m[1].toLowerCase() === 'bot' ? 'common.bot' : 'common.player';
  const color = m[2].toLowerCase() as ColorKey;
  const label = `${t(role).toLowerCase()}-${t(COLOR_KEYS[color]).toLowerCase()}`;
  // Group 3 exists only when the "(Name)" suffix matched, so it is undefined at
  // runtime although the RegExpMatchArray type reports `string`.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const name = m[3]?.trim();
  return name ? `${label} (${name})` : label;
}

// The seat label every caller uses. Both engine id shapes resolve, so a bot and a
//  local pilot are named the same way; the historical name is kept for those call
//  sites (`Game.tsx`, `ResultsModal.tsx`).
export function localizedBotName(
  t: (key: string, options?: Record<string, unknown>) => string,
  raw?: string,
): string {
  return localizedPilotName(t, raw);
}

// Locale-independent DiceBear seed: a bot seeds from its assistant name so it keeps one
// avatar everywhere; a local pilot seeds from its full `player-<color>` id. See
// docs/frontend/frontend-i18n-utilities-system.md.
export function avatarSeed(name?: string): string {
  const m = (name ?? '').match(PILOT_ID);
  if (!m) return name ?? '';
  // Group 3 exists only when the "(Name)" suffix matched (see localizedPilotName above).
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return m[3]?.trim() || m[0];
}
