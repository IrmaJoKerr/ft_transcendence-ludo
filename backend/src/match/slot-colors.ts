// The four seat colours of a PvP room, in slot order: blue is slot 1, yellow slot 4.
// A seat owns a colour, so this order is the room's own layout and not a palette
// the client may permute.
//
// It is one module because three places ask the same question (the creator, the
// player service and, since 19.6, the challenge accept that seats the invitee) and
// a second copy is a palette that can drift. Untyped on purpose: callers compare
// it against ids and colours off the wire, which are plain strings.
export const SLOT_COLORS: string[] = ['blue', 'red', 'green', 'yellow'];

// The corner a duel's second player takes. The accept route has no palette to ask
// — the invitee answered from a notification — so the room deals them the first
// colour the host is not sitting in. A host whose colour is unknown (an older
// record) still gets a legal corner rather than a refusal.
export function firstFreeColor(hostColor: string | undefined): string {
  return SLOT_COLORS.find((color) => color !== hostColor) ?? SLOT_COLORS[0];
}
