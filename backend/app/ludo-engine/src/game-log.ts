import { LOG_CAP, type GameState, type LogEntry } from './types';

// Append one log line in place, stamped and capped here. The caller saves the state
// afterwards. Returns the stored entry so the announcing frame carries the same line.
export function pushLog(state: GameState, entry: Omit<LogEntry, 'at'>): LogEntry {
  const logged: LogEntry = { ...entry, at: Date.now() };
  const log = state.log ?? [];
  log.push(logged);
  state.log = log.length > LOG_CAP ? log.slice(log.length - LOG_CAP) : log;
  return logged;
}
