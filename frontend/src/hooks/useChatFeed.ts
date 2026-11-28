import { useCallback, useState } from 'react';

// The transcript both channels paint, in one place (M3/19.8).

// The room's cap: a few hundred lines is scrollback without unbounded state.
export const CHAT_LINES_KEPT = 200;

export interface ChatFeed<Line> {
  // Oldest first, the order both surfaces paint.
  lines: Line[];
  // A `chat:history` frame: the authority on what was said before the surface
  //  mounted, so it replaces the local copy rather than merging into it. A frame
  //  with no array (or a torn one) is an empty history, never a crash.
  replace: (lines: ReadonlyArray<Line | null | undefined> | undefined) => void;
  // A `chat:message` frame: one live line. Dropped when its id is already painted,
  //  because the history's seam and a frame that raced it overlap by exactly the
  //  newest line or two.
  append: (line: Line | undefined) => void;
  // A disconnect or an account change: the next connection re-sends the history,
  //  and another tab's channel must not be inherited in the meantime.
  clear: () => void;
}

// One line's identity, whatever else it carries: the lobby's `at` is an ISO string
//  and the room's is ms, and neither matters to the merge.
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
