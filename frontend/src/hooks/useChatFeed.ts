import { useCallback, useState } from 'react';

// The transcript both channels paint, in one place (M3/19.8). The lobby and the
// room used to carry the same merge twice (a cap, a `chat:history` replacement and a
// `chat:message` append deduped by id), and two copies of a merge can disagree about
// ordering and about duplicates, which is exactly what a transcript may not do. The
// hook is a state container, not a transport: it knows the wire *frames* by name (the
// history replaces, a live line appends) and nothing about the socket, so the room's
// engine socket and the lobby's session socket can both drive it and the rule that a
// line is painted once lives here.
//
// The cap is the caller's, because the two numbers are not the same fact: the lobby
// keeps `CHAT_HISTORY` lines (a shared constant, because the server also caps the
// ring it stores) and the room keeps `CHAT_LINES_KEPT`, which is what one board can
// hold without growing its state on every frame of a long game.

/** The room's cap: a few hundred lines is scrollback without unbounded state. */
export const CHAT_LINES_KEPT = 200;

export interface ChatFeed<Line> {
  /** Oldest first, the order both surfaces paint. */
  lines: Line[];
  /** A `chat:history` frame: the authority on what was said before the surface
   *  mounted, so it replaces the local copy rather than merging into it. A frame
   *  with no array (or a torn one) is an empty history, never a crash. */
  replace: (lines: ReadonlyArray<Line | null | undefined> | undefined) => void;
  /** A `chat:message` frame: one live line. Dropped when its id is already painted,
   *  because the history's seam and a frame that raced it overlap by exactly the
   *  newest line or two. */
  append: (line: Line | undefined) => void;
  /** A disconnect or an account change: the next connection re-sends the history,
   *  and another tab's channel must not be inherited in the meantime. */
  clear: () => void;
}

/** One line's identity, whatever else it carries: the lobby's `at` is an ISO string
 *  and the room's is ms, and neither matters to the merge. */
type Identified = { id: string };

export function useChatFeed<Line extends Identified>(
  cap: number = CHAT_LINES_KEPT,
): ChatFeed<Line> {
  const [lines, setLines] = useState<Line[]>([]);

  const replace = useCallback(
    (incoming: ReadonlyArray<Line | null | undefined> | undefined) => {
      setLines(
        Array.isArray(incoming)
          ? incoming.filter((line): line is Line => typeof line?.id === 'string').slice(-cap)
          : [],
      );
    },
    [cap],
  );

  const append = useCallback(
    (line: Line | undefined) => {
      // The engine's and the session's frames are both external input: a line with no
      // id cannot be deduped, so it is dropped rather than painted and never merged.
      if (!line || typeof line.id !== 'string') return;
      setLines((previous) =>
        previous.some((existing) => existing.id === line.id)
          ? previous
          : [...previous, line].slice(-cap),
      );
    },
    [cap],
  );

  const clear = useCallback(() => setLines([]), []);

  return { lines, replace, append, clear };
}
