import { LOG_CAP, type GameState, type LogEntry } from './types';

// Append one line to the game's log: stamped here, so no call site has to remember
// the clock, and capped here, so no call site has to remember the bound. In place,
// like every other state write, and the caller saves the state afterwards (every
// site that logs is already on a save path). Returns the entry so the frame that
// announces the event can carry the very line that was stored.
export function pushLog(state: GameState, entry: Omit<LogEntry, 'at'>): LogEntry {
  const logged: LogEntry = { ...entry, at: Date.now() };
  const log = state.log ?? [];
  log.push(logged);
  state.log = log.length > LOG_CAP ? log.slice(log.length - LOG_CAP) : log;
  return logged;
}
