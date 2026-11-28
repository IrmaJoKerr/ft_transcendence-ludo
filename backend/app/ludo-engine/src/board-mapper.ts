import type { PlayerColor, PieceId } from './types';

// Board coordinate math, step-to-position translation, safe zones and blockades.
// These are topology, not tunables, so they stay mirrored with the client geometry;
// the board geometry harness asserts both agree.
export class BoardMapper {
  // Safe zone track positions (shared by all players).
  private static readonly SAFE_TRACK_POSITIONS = [1, 9, 14, 22, 27, 35, 40, 48];

  // Parse piece ID into color and index
  static parsePieceId(pieceId: PieceId): { color: PlayerColor; index: number } {
    const [color, indexStr] = pieceId.split('-');
    return { color: color as PlayerColor, index: parseInt(indexStr, 10) };
  }

  // Check if a move destination (by step) lands on a safe zone.
  static isSafeZoneStep(pieceId: PieceId, step: number): boolean {
    if (step < 1 || step > 51) return false;
    const boardPos = this.toTrackPosition(pieceId, step);
    return this.SAFE_TRACK_POSITIONS.includes(boardPos);
  }

  // Convert a piece step to its effective track position for collision detection.
  // Pieces on the track (not in home) are on a shared 52-position loop.
  static toTrackPosition(pieceId: PieceId, step: number): number {
    const { color } = this.parsePieceId(pieceId);

    if (step < 1 || step > 51) {
      return -1; // Not on track
    }

    const offset = { red: 0, green: 13, yellow: 26, blue: 39 }[color];
    return ((step + offset - 1) % 52) + 1;
  }

  // True when a shared track position (1-52) holds 2+ same-color opponent
  // pieces (a blockade). Only the main track participates; safe zones and
  // home/goal never block via this helper.
  static isBlockadeAtTrackPos(
    pieces: { id: PieceId; color: PlayerColor; step: number }[],
    blockerColor: PlayerColor,
    trackPos: number,
  ): boolean {
    if (trackPos < 1 || trackPos > 52) return false;

    const targetColorPieces = pieces.filter(
      (p) => p.color === blockerColor && p.step >= 1 && p.step <= 51,
    );
    return (
      targetColorPieces.filter((p) => this.toTrackPosition(p.id, p.step) === trackPos).length >= 2
    );
  }
}
