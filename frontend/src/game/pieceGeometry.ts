// The geometry both piece sets share: a pose is one matrix, and a figure is cut
// at its neck into the runs a pose draws. Nothing here knows a theme's id.

import type { PieceLayers, PiecePart, PiecePose } from './pieceTypes';

// A turned visor's horizontal squash, cos 37 degrees.
export const CREW_TURN = { squash: 0.8, slide: 6 } as const;

// The turn as the one matrix a pose needs: x -> 50 + (x - 50) * squash + dir * slide.
export function poseTurn(pose: PiecePose): string | null {
  const dir = pose === 'left' ? -1 : pose === 'right' ? 1 : 0;
  if (!dir) return null;
  const a = CREW_TURN.squash;
  const e = 50 * (1 - a) + dir * CREW_TURN.slide;
  return `matrix(${a} 0 0 1 ${e} 0)`;
}

// Cut a flat part list into the runs a pose draws: outline, face, outline, body.
export function cutAtNeck(
  parts: PiecePart[],
  headCount: number,
  face: readonly [number, number],
): PieceLayers {
  const [from, to] = face;
  return [
    { parts: parts.slice(0, from), turn: false },
    { parts: parts.slice(from, to), turn: true },
    { parts: parts.slice(to, headCount), turn: false },
    { parts: parts.slice(headCount), turn: false },
  ].filter((run) => run.parts.length > 0);
}
