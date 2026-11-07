// The clash QTE's tablet tap weight, shared by its two readers: the engine's
// server-side clamp (`clash.ts`) and the client's touch pad (`ClashOverlay.tsx`).
// One tap on a 3 cm circle is slower and less repeatable than a held key, so a pad
// press is worth this many engine presses; the per-side press cap still gates the
// rate, so the weight buys a heavier press, never a faster one. Written once here so
// the wire and the clamp cannot drift: the tap the client sends is exactly the weight
// the server accepts.
export const CLASH_TAP_COUNT = 2;
