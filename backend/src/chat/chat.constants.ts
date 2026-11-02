// The public channel's three limits: one line every 2 s per socket, 300 characters
// (the transport's byte cap is only a backstop), and a 50-row transcript, which is
// also what the panel paints.
export const CHAT_COOLDOWN_MS = 2_000;
export const CHAT_MAX_CHARS = 300;
export const CHAT_HISTORY = 50;
