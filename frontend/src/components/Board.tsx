import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { COL, type ColorKey } from '../theme';
import { PIECE_GLYPH, TRACK_CELLS, stepToCell } from '../game/boardGeometry';
import { CaptureBurst } from './CaptureBurst';

const CELL_BG = '#050515';
const LINE = '#00f0ff';


function Sphere({ ck, isLegal }: { ck: ColorKey; isLegal?: boolean }) {
  const c = COL[ck];
  const d = PIECE_GLYPH[ck];

  return (
    <svg
      viewBox="-1 -1 13 10"
      style={{
        width: '100%',
        height: '100%',
        overflow: 'visible',
        filter: isLegal
          ? 'drop-shadow(0 0 4px #ffe600) drop-shadow(0 0 8px #ffe600)'
          : 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.95))',
      }}
      shapeRendering="crispEdges"
    >
      {/* High-contrast solid black outline tracing the Invader's exact pixel shape */}
      <path
        d={d}
        fill="none"
        stroke="#000000"
        strokeWidth="1"
        strokeLinejoin="miter"
        strokeLinecap="square"
      />
      {/* Original Invader color fill */}
      <path fill={c.base} d={d} />
    </svg>
  );
}

function Ring({ ck }: { ck: ColorKey }) {
  return (
    <div
      style={{
        width: '62%',
        aspectRatio: '1',
        borderRadius: '50%',
        border: `2px dashed ${COL[ck].base}88`,
        boxSizing: 'border-box',
      }}
    />
  );
}

function Yard({
  r,
  c,
  ck,
  basePieces,
  goalCount,
  barrierTokens,
  legalPieceIds,
  onPieceClick,
}: {
  r: number;
  c: number;
  ck: ColorKey;
  basePieces: Array<{ id: string; armed: boolean }>;
  goalCount: number;
  /** Barrier Buster tokens this seat still holds (0 = none, and no chip shows). */
  barrierTokens: number;
  legalPieceIds: Set<string>;
  onPieceClick?: (pieceId: string) => void;
}) {
  const { t } = useTranslation();
  const col = COL[ck];
  const label = t(`board.${ck}Bay`);
  return (
    <div
      style={{
        gridRow: `${r + 1} / span 6`,
        gridColumn: `${c + 1} / span 6`,
        padding: '6% 8%',
        background: 'rgba(10, 2, 28, 0.95)',
        border: '1.5px solid #2121ff',
        borderRadius: 8,
        boxShadow: '0 0 14px rgba(33, 33, 255, 0.45), inset 0 0 10px rgba(0, 240, 255, 0.15)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontSize: '0.62rem',
            fontFamily: 'var(--font-mono)',
            fontWeight: 'bold',
            color: col.base,
            letterSpacing: '0.5px',
            textShadow: `0 0 6px ${col.base}`,
          }}
        >
          // {label}
        </span>
        <span
          style={{
            fontSize: '0.62rem',
            fontFamily: 'var(--font-mono)',
            fontWeight: 'bold',
            color: goalCount > 0 ? '#00ff88' : '#ffffff',
            background: 'rgba(5, 5, 20, 0.9)',
            border: `1px solid ${col.base}`,
            padding: '1px 6px',
            borderRadius: 3,
            boxShadow: `0 0 6px ${col.base}66`,
          }}
        >
          {t('board.goalLabel')} {goalCount}/4
        </span>
      </div>
      {/* Barrier Buster pips: one per token still in hand. Rendered next to the bay
          label (not on a piece) because a token outlives a single piece and the
          seat's whole supply is what the player spends. */}
      {barrierTokens > 0 && (
        <div
          title={t('board.barrierTokensTitle', { count: barrierTokens })}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            marginTop: 2,
          }}
        >
          {Array.from({ length: barrierTokens }, (_, i) => (
            <span
              key={i}
              style={{
                width: 10,
                height: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 2,
                border: '1px solid var(--accent-yellow)',
                background: 'rgba(13, 2, 33, 0.92)',
                color: 'var(--accent-yellow)',
                fontFamily: 'var(--font-mono)',
                fontSize: 8,
                lineHeight: '8px',
                textShadow: '0 0 4px var(--accent-yellow)',
              }}
            >
              🔓
            </span>
          ))}
        </div>
      )}
      <div
        style={{
          width: '100%',
          height: '82%',
          background: 'rgba(10, 2, 28, 0.95)',
          border: `1.5px solid ${col.base}`,
          borderRadius: 8,
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr',
          gap: '8%',
          padding: '10%',
          boxShadow: `inset 0 0 10px ${col.base}33`,
          placeItems: 'center',
        }}
      >
        {[0, 1, 2, 3].map((s) => {
          const piece = basePieces[s];
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!piece)
            return (
              <div
                key={s}
                style={{
                  width: 28,
                  height: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ring ck={ck} />
              </div>
            );
          const isLegal = legalPieceIds.has(piece.id);
          return (
            <div
              key={s}
              onClick={() => isLegal && onPieceClick?.(piece.id)}
              style={{
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: isLegal ? 'pointer' : 'default',
                animation: isLegal ? 'piecePulse 1.2s ease-in-out infinite' : 'none',
                zIndex: isLegal ? 30 : 1,
                position: 'relative',
              }}
            >
              <Sphere ck={ck} isLegal={isLegal} />
              {piece.armed && (
                // The only exit this piece has left is the token-priced one: the
                // badge is the price tag, and the seat's pips above show whether
                // it can pay it.
                <span
                  title={t('board.armedBadgeTitle')}
                  style={{
                    position: 'absolute',
                    top: -8,
                    left: '50%',
                    marginLeft: 4,
                    padding: '0 4px',
                    borderRadius: 6,
                    border: '1px solid var(--accent-yellow)',
                    background: 'rgba(13, 2, 33, 0.92)',
                    color: 'var(--accent-yellow)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 900,
                    lineHeight: '14px',
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    zIndex: 31,
                    textShadow: '0 0 6px var(--accent-yellow)',
                  }}
                >
                  🔓
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** The four start cells, tinted the owner color. Each is also a safe square (SAFE_STAR_CELLS). */
const STARTS: Partial<Record<string, ColorKey>> = {
  '6,1': 'red',
  '1,8': 'green',
  '8,13': 'yellow',
  '13,6': 'blue',
};

// Pre-start safe cells matching the backend's SAFE_TRACK_POSITIONS.
const SAFE_STAR_CELLS: Record<string, boolean> = (() => {
  const SAFE_TRACK_POSITIONS = [1, 9, 14, 22, 27, 35, 40, 48];
  const m: Record<string, boolean> = {};
  for (const tp of SAFE_TRACK_POSITIONS) {
    const cell = TRACK_CELLS[tp - 1];
    m[`${cell.r},${cell.c}`] = true;
  }
  return m;
})();

/**
 * The safe-zone star is drawn as TWO layers, not one color, because one color
 * cannot clear all five cell fills. The core is white and the outline is black,
 * and each layer covers exactly where the other one fails:
 *
 *   against #050515 (plain cell)  white core 20.2:1 — the black ring is invisible, the core carries it
 *   against red #ff007f           core 3.8:1, ring 5.6:1   — both clear the 3:1 graphics threshold
 *   against green #00ff88         core 1.3:1, ring 15.7:1  — the ring carries it
 *   against yellow #ffe600        core 1.3:1, ring 16.6:1  — the ring carries it
 *   against blue #00f0ff          core 1.4:1, ring 14.9:1  — the ring carries it
 *
 * A single deep indigo (#3c0fe6, the "most visible color" candidate) was measured
 * and rejected: 2.3:1 against #050515, so it sinks into the dark cell, and only
 * 2.3:1 against the red start cell, where the previous violet #b14aff looked pale
 * for the same reason. The duplex star is immune to that, and it also matches how
 * the pieces are already drawn: `Sphere` gives every invader a #000000 stroke, so
 * an outlined star reads as part of the same board language.
 */
const SAFE_STAR_COLOR = '#ffffff';
const SAFE_STAR_OUTLINE = '#000000';
/** 10-point star, bbox 21.16 x 20.13 inside the 24 box, so the 2.2 stroke fits. */
const SAFE_STAR_POINTS =
  '12.00,1.93 14.63,9.44 22.58,9.62 16.25,14.45 18.54,22.07 12.00,17.54 5.46,22.07 7.75,14.45 1.42,9.62 9.37,9.44';

/**
 * The safe-zone star. One element for every star square (the four start cells
 * and the four pre-start safe cells) so the eight markers are identical: the
 * start cells used to draw a white star at 44% and the rest a yellow one at
 * 40%, which is what made half the set look like a different feature. SVG rather
 * than a clip-path div because the stroke has to be a real stroke: 2.2 units of
 * the 24 box is ~1.1px at the ~12px the star occupies on a 450px board.
 */
function SafeStar() {
  return (
    <svg viewBox="0 0 24 24" style={{ width: '44%', height: '44%', display: 'block' }}>
      <polygon
        points={SAFE_STAR_POINTS}
        fill={SAFE_STAR_COLOR}
        stroke={SAFE_STAR_OUTLINE}
        strokeWidth={2.2}
        strokeLinejoin="miter"
      />
    </svg>
  );
}

/** Home-stretch lane color for a track cell, or null for a plain cell. */
function laneColor(r: number, c: number): string | null {
  if (r === 7 && c >= 1 && c <= 5) return COL.red.base;
  if (c === 7 && r >= 1 && r <= 5) return COL.green.base;
  if (r === 7 && c >= 9 && c <= 13) return COL.yellow.base;
  if (c === 7 && r >= 9 && r <= 13) return COL.blue.base;
  return null;
}

type BoardProps = {
  pieces?: Array<{ id: string; color: string; step: number; isInGoal: boolean; isInBase: boolean }>;
  players?: Array<{ color: string; status: string; barrierTokens?: number }>;
  legalMoves?: Array<{
    pieceId: string;
    from: number;
    to: number;
    isCapture: boolean;
    isHomeEntry: boolean;
    /** Defenders the move would fight: R ≥ 2 means the attack is a clash chain of R rounds. */
    captureCount?: number;
    /** Barrier Buster exit: the move costs one token, so the piece wears the 🔓 price tag. */
    spendsBarrierToken?: boolean;
  }>;
  onPieceClick?: (pieceId: string) => void;
  /** While set, this piece renders at `step` (box by box) instead of its real logical step: see Game.tsx's move animation. */
  animating?: { pieceId: string; step: number } | null;
  /** Transient capture burst: expanding ring + sparks on the cell the mover landed on. Pure cosmetic overlay. */
  fx?: { color: string; to: number } | null;
  /**
   * Hardcore room rule, stored inverted (false = the variant is off, which is a
   * standard room). While false all eight safe squares wear the violet star,
   * because they still protect; while true every star is withheld — the four
   * start squares as well as the four pre-start cells — because none of them
   * protect any longer.
   */
  noSafeZones?: boolean;
  /**
   * True while the player has armed the Barrier Buster control for this roll: only
   * then is a token-priced exit a tap target (and badged), so tapping a piece can
   * never spend a token by accident. Client-local state, owned by Game.tsx.
   */
  bustArmed?: boolean;
};

/** The classic 15×15 cross board, rendered procedurally: no images. */
export function Board({
  pieces = [],
  players = [],
  legalMoves,
  onPieceClick,
  animating,
  fx,
  noSafeZones = false,
  bustArmed = false,
}: BoardProps = {}) {
  const { t } = useTranslation();
  // A Barrier Buster exit is not a plain tap target: arming it is the player's
  // explicit choice in Game.tsx, so until then the piece is not tappable or badged.
  // The engine offers at most one exit per piece per roll.
  const bustPieceIds = new Set(
    (legalMoves ?? []).filter((m) => m.spendsBarrierToken).map((m) => m.pieceId),
  );
  const legalPieceIds = new Set(
    (legalMoves ?? []).filter((m) => !m.spendsBarrierToken || bustArmed).map((m) => m.pieceId),
  );
  // Clash chain preview: an attack on a stack of defenders costs one QTE round per
  // defender, so the legal piece wears a ×R badge. Plain moves and single defenders
  // show nothing; a Barrier Buster bust shows the size of the wall it lands on.
  const chainCounts = new Map<string, number>();
  for (const m of legalMoves ?? []) {
    if ((m.captureCount ?? 0) >= 2) chainCounts.set(m.pieceId, m.captureCount as number);
  }
  // Barrier Buster exits in the pool: their piece is still in the base but is
  // playable, so it gets the 🔓 price tag only while armed; that is what makes
  // the badge mean "this tap spends the token".
  const armedPieceIds = bustArmed ? bustPieceIds : new Set<string>();
  const activeColors = new Set(
    players.filter((p) => p.status === 'active' || p.status === 'disconnected').map((p) => p.color),
  );
  const barrierTokens = (ck: ColorKey) =>
    players.find((p) => p.color === ck && (p.status === 'active' || p.status === 'disconnected'))
      ?.barrierTokens ?? 0;
  const basePieces = (ck: ColorKey) =>
    activeColors.has(ck)
      ? pieces
          .filter((p) => p.color === ck && p.isInBase && p.id !== animating?.pieceId)
          .map((p) => ({ id: p.id, armed: armedPieceIds.has(p.id) }))
      : [];
  const goalCount = (ck: ColorKey) =>
    pieces.filter((p) => p.color === ck && p.isInGoal && p.id !== animating?.pieceId).length;

  const cells: ReactNode[] = [];
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const inCross = (r >= 6 && r <= 8) || (c >= 6 && c <= 8);
      if (!inCross) continue;
      if (r >= 6 && r <= 8 && c >= 6 && c <= 8) continue; // center handled separately
      const key = `${r},${c}`;
      const startCol = STARTS[key];
      const bg = startCol ? COL[startCol].base : (laneColor(r, c) ?? CELL_BG);
      const style: CSSProperties = {
        gridRow: r + 1,
        gridColumn: c + 1,
        background: bg,
        border: `1px solid ${LINE}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
      };
      let inner: ReactNode = null;
      if (startCol) {
        // A start square is a safe square too, so the hardcore rule takes its
        // star as well; the cell keeps its owner tint either way.
        if (!noSafeZones) inner = <SafeStar />;
      } else if (SAFE_STAR_CELLS[key] && !noSafeZones) {
        inner = <SafeStar />;
      } else if (!laneColor(r, c)) {
        inner = (
          <div
            style={{
              width: 4,
              height: 4,
              borderRadius: '50%',
              background: '#ffb8ae',
              boxShadow: '0 0 4px #ffb8ae',
            }}
          />
        );
      }
      cells.push(
        <div key={`p${key}`} style={style} data-cell={key}>
          {inner}
        </div>,
      );
    }
  }

  // Render engine-driven pieces on the actual track cell their step maps to.
  // Grouped by cell so pieces sharing a square (common near base/captures)
  // fan out into sub-positions instead of fully overlapping.
  const byCell = new Map<
    string,
    Array<{ id: string; ck: ColorKey; isLegal: boolean; chain: number; priced: boolean }>
  >();
  for (const piece of pieces) {
    if (!activeColors.has(piece.color)) continue;
    const isAnimating = animating?.pieceId === piece.id;
    // Mid-animation the piece may already be logically captured/home/goal in
    // state (server applies the full move atomically): render it at its
    // in-transit step regardless so the box-by-box travel stays visible.
    if (!isAnimating && (piece.isInBase || piece.isInGoal || piece.step <= 0)) continue;
    const ck = piece.color as ColorKey;
    const step = (animating?.pieceId === piece.id ? animating.step : undefined) ?? piece.step;
    const cell = stepToCell(ck, step);
    if (!cell) continue;
    const key = `${cell.r},${cell.c}`;
    const list = byCell.get(key) ?? [];
    list.push({
      id: piece.id,
      ck,
      isLegal: legalPieceIds.has(piece.id),
      chain: chainCounts.get(piece.id) ?? 0,
      // Armed wall landings are token-priced, so the piece wears the price tag.
      priced: bustPieceIds.has(piece.id),
    });
    byCell.set(key, list);
  }

  // The wall break token glyph, mirrored from Game.tsx (BUSTER_GLYPH). A ×R badge on a
  // landing that SPENDS a token carries it, so the price of the tap is readable on the
  // piece itself; the base-piece tag already shows it for a prison exit.
  const BUSTER_GLYPH = '🧨';

  // Sub-cell offsets so up to 4 stacked pieces stay individually visible/clickable.
  const SUB_OFFSETS = [
    { x: -22, y: -22 },
    { x: 22, y: -22 },
    { x: -22, y: 22 },
    { x: 22, y: 22 },
  ];

  // Inject halo pulse keyframes once
  const injected = useRef(false);
  useEffect(() => {
    if (injected.current) return;
    injected.current = true;
    const id = 'board-halo-keyframes';
    if (document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = `
      @keyframes piecePulse {
        0%   { transform: scale(1); }
        50%  { transform: scale(1.24); }
        100% { transform: scale(1); }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const enginePieces: ReactNode[] = [];

  // Capture burst FX: transient ring + sparks on the landing cell. The grid cell holds
  // a zero-size, self-centred anchor, which is what puts CaptureBurst's origin exactly
  // on the cell's centre; it sits above the pieces (zIndex 11) and takes no input.
  if (fx && fx.to >= 1 && fx.to <= 57) {
    const ck = fx.color as ColorKey;
    const cell = stepToCell(ck, fx.to);
    if (cell) {
      enginePieces.push(
        <div
          key="fx-ring"
          style={{
            gridRow: cell.r + 1,
            gridColumn: cell.c + 1,
            position: 'relative',
            width: 0,
            height: 0,
            alignSelf: 'center',
            justifySelf: 'center',
            pointerEvents: 'none',
            zIndex: 11,
          }}
        >
          <CaptureBurst color={COL[ck].base} />
        </div>,
      );
    }
  }

  for (const [key, list] of byCell) {
    const [r, c] = key.split(',').map(Number);
    list.forEach((p, i) => {
      const offset = list.length > 1 ? SUB_OFFSETS[i % SUB_OFFSETS.length] : { x: 0, y: 0 };
      enginePieces.push(
        <div
          key={p.id}
          onClick={() => p.isLegal && onPieceClick?.(p.id)}
          style={{
            gridRow: r + 1,
            gridColumn: c + 1,
            position: 'relative',
            width: p.isLegal ? 36 : 30,
            height: p.isLegal ? 36 : 30,
            alignSelf: 'center',
            justifySelf: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            animation: p.isLegal ? 'piecePulse 1.2s ease-in-out infinite' : 'none',
            cursor: p.isLegal ? 'pointer' : 'default',
            zIndex: p.isLegal ? 30 : 10,
            transform: `translate(${offset.x}%, ${offset.y}%)`,
          }}
        >
          <Sphere ck={p.ck} isLegal={p.isLegal} />
          {p.chain >= 2 && (
            // ×R on the attacker: R defenders means R QTE rounds (captureCount).
            // Pointer-events off so the piece underneath stays the click target. A
            // priced wall landing carries the Buster glyph on the piece itself.
            <span
              title={
                p.priced
                  ? t('board.chainPricedBadgeTitle', { rounds: p.chain })
                  : t('board.chainBadgeTitle', { rounds: p.chain })
              }
              style={{
                position: 'absolute',
                top: -13,
                left: '50%',
                marginLeft: 6,
                padding: '0 5px',
                borderRadius: 6,
                border: '1px solid var(--accent-yellow)',
                background: 'rgba(13, 2, 33, 0.92)',
                color: 'var(--accent-yellow)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 900,
                lineHeight: '16px',
                whiteSpace: 'nowrap',
                pointerEvents: 'none',
                zIndex: 31,
                textShadow: '0 0 6px var(--accent-yellow)',
              }}
            >
              {p.priced ? `${BUSTER_GLYPH} ×${p.chain}` : `×${p.chain}`}
            </span>
          )}
        </div>,
      );
    });
  }

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          width: '100%',
          aspectRatio: '1',
          display: 'grid',
          gridTemplateColumns: 'repeat(15,1fr)',
          gridTemplateRows: 'repeat(15,1fr)',
          gap: 1,
          padding: '2.5%',
          borderRadius: 10,
          background: 'rgba(15, 6, 38, 0.95)',
          border: '2px solid #2121ff',
          boxShadow: '0 0 25px rgba(33, 33, 255, 0.6), inset 0 0 20px rgba(0, 240, 255, 0.25)',
        }}
      >
        <Yard
          r={0}
          c={0}
          ck="red"
          basePieces={basePieces('red')}
          goalCount={goalCount('red')}
          barrierTokens={barrierTokens('red')}
          legalPieceIds={legalPieceIds}
          onPieceClick={onPieceClick}
        />
        <Yard
          r={0}
          c={9}
          ck="green"
          basePieces={basePieces('green')}
          goalCount={goalCount('green')}
          barrierTokens={barrierTokens('green')}
          legalPieceIds={legalPieceIds}
          onPieceClick={onPieceClick}
        />
        <Yard
          r={9}
          c={9}
          ck="yellow"
          basePieces={basePieces('yellow')}
          goalCount={goalCount('yellow')}
          barrierTokens={barrierTokens('yellow')}
          legalPieceIds={legalPieceIds}
          onPieceClick={onPieceClick}
        />
        <Yard
          r={9}
          c={0}
          ck="blue"
          basePieces={basePieces('blue')}
          goalCount={goalCount('blue')}
          barrierTokens={barrierTokens('blue')}
          legalPieceIds={legalPieceIds}
          onPieceClick={onPieceClick}
        />
        <div
          style={{
            gridRow: '7 / span 3',
            gridColumn: '7 / span 3',
            background: `conic-gradient(from 45deg, ${COL.yellow.base} 0 90deg, ${COL.blue.base} 90deg 180deg, ${COL.red.base} 180deg 270deg, ${COL.green.base} 270deg 360deg)`,
            border: '2px solid #2121ff',
            boxShadow: '0 0 18px rgba(33, 33, 255, 0.6), inset 0 0 12px rgba(0,0,0,.7)',
          }}
        />
        {cells}
        {enginePieces}
      </div>
    </div>
  );
}
