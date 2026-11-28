// PvP seat colours in slot order: blue, red, green, yellow. A seat owns its colour, so
// this is room layout, not a client palette. One module keeps three call sites in step.
export const SLOT_COLORS: string[] = ['blue', 'red', 'green', 'yellow'];

// The duel's second corner: the first colour the host is not in. An unknown host colour
// still yields a legal corner instead of a refusal.
export function firstFreeColor(hostColor: string | undefined): string {
  return SLOT_COLORS.find((color) => color !== hostColor) ?? SLOT_COLORS[0];
}
