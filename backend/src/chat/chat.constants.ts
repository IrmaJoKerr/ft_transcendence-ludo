// The public channel's three limits: one line every 2 s per socket, 300 characters
// (the transport's byte cap is only a backstop), and a 500-row transcript — the
// entry list, trimmed per line, and the exact length of what the card paints on
// connect (`chat:history`). The dock's plate and the in-game compact slot are only
// feeds: they slice the newest `SCREEN_PREVIEW_LINES` / `PREVIEW_LINES` off the top,
// so the transcript length is the one number a reader can scroll to.
export const CHAT_COOLDOWN_MS = 2_000;
export const CHAT_MAX_CHARS = 300;
export const CHAT_HISTORY = 500;
