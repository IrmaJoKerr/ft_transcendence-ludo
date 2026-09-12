const COLOR_KEYS = {
  red: 'lobby.colorRed',
  green: 'lobby.colorGreen',
  yellow: 'lobby.colorYellow',
  blue: 'lobby.colorBlue',
} as const

/**
 * Engine bots are named `${BOT_PREFIX}${color}` (e.g. "bot-red"). Map that to a
 * localized "bot-<translated color>" so rosters/results never show raw English
 * bot ids. Non-matching names are returned unchanged.
 */
export function localizedBotName(
  t: (key: string, options?: Record<string, unknown>) => string,
  raw?: string,
): string {
  if (!raw) return raw ?? ''
  const m = raw.match(/^bot-(red|green|yellow|blue)$/i)
  if (!m) return raw
  const color = m[1].toLowerCase() as keyof typeof COLOR_KEYS
  return `${t('common.bot').toLowerCase()}-${t(COLOR_KEYS[color]).toLowerCase()}`
}
