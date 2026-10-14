import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { COL, type ColorKey } from '../theme';

const CELL_BG = '#050515';
const LINE = '#00f0ff';

// Track geometry: the engine uses logical steps (0-57); the UI maps them to
// board cells. (15×15 cross board has exact 4-fold symmetry).
type Cell = { r: number; c: number };

const RED_SEGMENT: Cell[] = [
  { r: 6, c: 1 },
  { r: 6, c: 2 },
  { r: 6, c: 3 },
  { r: 6, c: 4 },
  { r: 6, c: 5 },
  { r: 5, c: 6 },
  { r: 4, c: 6 },
  { r: 3, c: 6 },
  { r: 2, c: 6 },
  { r: 1, c: 6 },
  { r: 0, c: 6 },
  { r: 0, c: 7 },
  { r: 0, c: 8 },
];

/** 90° clockwise rotation about the 15×15 grid's center (7,7). */
function rotate90({ r, c }: Cell): Cell {
  return { r: c, c: 14 - r };
}

function rotateN(cell: Cell, n: number): Cell {
  let out = cell;
  for (let i = 0; i < n; i++) out = rotate90(out);
  return out;
}

/** The full 52-cell shared outer loop, track position 1-52 → board cell. */
const TRACK_CELLS: Cell[] = [0, 1, 2, 3].flatMap((rot) =>
  RED_SEGMENT.map((cell) => rotateN(cell, rot)),
);

const RED_HOME_LANE: Cell[] = [
  { r: 7, c: 1 },
  { r: 7, c: 2 },
  { r: 7, c: 3 },
  { r: 7, c: 4 },
  { r: 7, c: 5 },
];

const HOME_LANES: Record<ColorKey, Cell[]> = {
  red: RED_HOME_LANE,
  green: RED_HOME_LANE.map((cell) => rotateN(cell, 1)),
  yellow: RED_HOME_LANE.map((cell) => rotateN(cell, 2)),
  blue: RED_HOME_LANE.map((cell) => rotateN(cell, 3)),
};

const TRACK_OFFSET: Record<ColorKey, number> = { red: 0, green: 13, yellow: 26, blue: 39 };

/** Map a piece's logical step (1-57) to a board cell, or null if not on the board (base/goal). */
function stepToCell(color: ColorKey, step: number): Cell | null {
  if (step >= 52 && step <= 56) return HOME_LANES[color][step - 52];
  if (step >= 1 && step <= 51) {
    const trackPos = ((step + TRACK_OFFSET[color] - 1) % 52) + 1;
    return TRACK_CELLS[trackPos - 1];
  }
  return null;
}

const PATH_MAP: Record<ColorKey, string> = {
  yellow: `
    M2,0 h1 v1 h-1 z  M8,0 h1 v1 h-1 z
    M3,1 h1 v1 h-1 z  M7,1 h1 v1 h-1 z
    M2,2 h7 v1 h-7 z
    M1,3 h2 v1 h-2 z  M4,3 h3 v1 h-3 z  M8,3 h2 v1 h-2 z
    M0,4 h11 v1 h-11 z
    M0,5 h1 v1 h-1 z  M2,5 h7 v1 h-7 z  M10,5 h1 v1 h-1 z
    M0,6 h1 v1 h-1 z  M2,6 h1 v1 h-1 z  M8,6 h1 v1 h-1 z  M10,6 h1 v1 h-1 z
    M3,7 h2 v1 h-2 z  M6,7 h2 v1 h-2 z
  `,
  red: `
    M0,0 h1 v2 h-1 z  M10,0 h1 v2 h-1 z
    M2,1 h7 v1 h-7 z
    M1,2 h2 v1 h-2 z  M4,2 h3 v1 h-3 z  M8,2 h2 v1 h-2 z
    M0,3 h11 v1 h-11 z
    M0,4 h1 v1 h-1 z  M2,4 h7 v1 h-7 z  M10,4 h1 v1 h-1 z
    M0,5 h1 v1 h-1 z  M2,5 h1 v1 h-1 z  M8,5 h1 v1 h-1 z  M10,5 h1 v1 h-1 z
    M3,6 h2 v1 h-2 z  M6,6 h2 v1 h-2 z
    M2,7 h1 v1 h-1 z  M8,7 h1 v1 h-1 z
  `,
  green: `
    M4,0 h3 v1 h-3 z
    M3,1 h5 v1 h-5 z
    M2,2 h7 v1 h-7 z
    M1,3 h2 v1 h-2 z  M4,3 h3 v1 h-3 z  M8,3 h2 v1 h-2 z
    M0,4 h11 v1 h-11 z
    M1,5 h1 v1 h-1 z  M3,5 h5 v1 h-5 z  M9,5 h1 v1 h-1 z
    M0,6 h1 v1 h-1 z  M10,6 h1 v1 h-1 z
    M1,7 h1 v1 h-1 z  M9,7 h1 v1 h-1 z
  `,
  blue: `
    M3,0 h5 v1 h-5 z
    M1,1 h9 v1 h-9 z
    M0,2 h11 v1 h-11 z
    M0,3 h2 v1 h-2 z  M4,3 h3 v1 h-3 z  M9,3 h2 v1 h-2 z
    M0,4 h11 v1 h-11 z
    M2,5 h2 v1 h-2 z  M7,5 h2 v1 h-2 z
    M1,6 h1 v1 h-1 z  M4,6 h1 v1 h-1 z  M6,6 h1 v1 h-1 z  M9,6 h1 v1 h-1 z
    M0,7 h1 v1 h-1 z  M10,7 h1 v1 h-1 z
  `,
};

function Sphere({ ck, isLegal }: { ck: ColorKey; isLegal?: boolean }) {
  const c = COL[ck];
  const d = PATH_MAP[ck];

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
  legalPieceIds,
  onPieceClick,
}: {
  r: number;
  c: number;
  ck: ColorKey;
  basePieces: Array<{ id: string }>;
  goalCount: number;
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
              }}
            >
              <Sphere ck={ck} isLegal={isLegal} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Star/safe start cells, tinted the owner color. */
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
  players?: Array<{ color: string; status: string }>;
  legalMoves?: Array<{
    pieceId: string;
    from: number;
    to: number;
    isCapture: boolean;
    isHomeEntry: boolean;
    /** Defenders the move would fight: R ≥ 2 means the attack is a clash chain of R rounds. */
    captureCount?: number;
  }>;
  onPieceClick?: (pieceId: string) => void;
  /** While set, this piece renders at `step` (box by box) instead of its real logical step: see Game.tsx's move animation. */
  animating?: { pieceId: string; step: number } | null;
  /** Transient capture burst: expanding ring + sparks on the cell the mover landed on. Pure cosmetic overlay. */
  fx?: { color: string; to: number } | null;
  /**
   * Hardcore room rule, stored inverted (false = the variant is off, which is a
   * standard room). While false the star squares keep their tint, because they
   * still protect; while true they are plain cells, because they no longer do.
   */
  noSafeZones?: boolean;
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
}: BoardProps = {}) {
  const { t } = useTranslation();
  const legalPieceIds = new Set((legalMoves ?? []).map((m) => m.pieceId));
  // Clash CHAIN preview: an attack onto a STACK of defenders costs one QTE round
  // per defender, so the legal piece wears a ×R badge and the price of the attack
  // is visible before the click. 0/1 (a plain move or a single defender) show
  // nothing: the badge is about walls. Prison exits never attack a wall, so only
  // on-track pieces can carry one.
  const chainCounts = new Map<string, number>();
  for (const m of legalMoves ?? []) {
    if ((m.captureCount ?? 0) >= 2) chainCounts.set(m.pieceId, m.captureCount as number);
  }
  const activeColors = new Set(
    players.filter((p) => p.status === 'active' || p.status === 'disconnected').map((p) => p.color),
  );
  const basePieces = (ck: ColorKey) =>
    activeColors.has(ck)
      ? pieces.filter((p) => p.color === ck && p.isInBase && p.id !== animating?.pieceId)
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
        inner = (
          <div
            style={{
              width: '44%',
              height: '44%',
              clipPath:
                'polygon(50% 0,61% 35%,100% 35%,68% 57%,79% 100%,50% 72%,21% 100%,32% 57%,0 35%,39% 35%)',
              background: '#ffffff',
              filter: 'drop-shadow(0 0 4px #ffffff)',
            }}
          />
        );
      } else if (SAFE_STAR_CELLS[key] && !noSafeZones) {
        inner = (
          <div
            style={{
              width: '40%',
              height: '40%',
              clipPath:
                'polygon(50% 0,61% 35%,100% 35%,68% 57%,79% 100%,50% 72%,21% 100%,32% 57%,0 35%,39% 35%)',
              background: '#ffe600',
              filter: 'drop-shadow(0 0 5px #ffe600)',
            }}
          />
        );
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
        <div key={`p${key}`} style={style}>
          {inner}
        </div>,
      );
    }
  }

  // Render engine-driven pieces on the actual track cell their step maps to.
  // Grouped by cell so pieces sharing a square (common near base/captures)
  // fan out into sub-positions instead of fully overlapping.
  const byCell = new Map<string, Array<{ id: string; ck: ColorKey; isLegal: boolean; chain: number }>>();
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
    list.push({ id: piece.id, ck, isLegal: legalPieceIds.has(piece.id), chain: chainCounts.get(piece.id) ?? 0 });
    byCell.set(key, list);
  }

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
      @keyframes captureRing {
        from { transform: scale(.2); opacity: .9; }
        to   { transform: scale(1.9); opacity: 0; }
      }
      @keyframes captureSpark {
        from { transform: translate(0,0) scale(1); opacity: 1; }
        to   { transform: translate(var(--dx), var(--dy)) scale(.2); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  const enginePieces: ReactNode[] = [];

  // Capture burst FX: transient ring + sparks on the landing cell. Positioned
  // like enginePieces (grid row/col), above them (zIndex 11), non-interactive.
  if (fx && fx.to >= 1 && fx.to <= 57) {
    const ck = fx.color as ColorKey;
    const cell = stepToCell(ck, fx.to);
    if (cell) {
      const col = COL[ck];
      let uid = 0;
      const spark = (dx: number, dy: number, size: number, bg: string) => (
        <div
          key={`fx-s${uid++}`}
          style={
            {
              gridRow: cell.r + 1,
              gridColumn: cell.c + 1,
              width: size,
              height: size,
              alignSelf: 'center',
              justifySelf: 'center',
              borderRadius: '50%',
              background: bg,
              pointerEvents: 'none',
              zIndex: 11,
              '--dx': `${dx}px`,
              '--dy': `${dy}px`,
              animation: 'captureSpark 600ms ease-out forwards',
            } as CSSProperties & Record<'--dx' | '--dy', string>
          }
        />
      );
      enginePieces.push(
        <div
          key="fx-ring"
          style={{
            gridRow: cell.r + 1,
            gridColumn: cell.c + 1,
            width: 34,
            height: 34,
            alignSelf: 'center',
            justifySelf: 'center',
            borderRadius: '50%',
            border: `3px solid ${col.base}`,
            boxShadow: `0 0 12px ${col.base}aa`,
            pointerEvents: 'none',
            zIndex: 11,
            animation: 'captureRing 600ms ease-out forwards',
          }}
        />,
        spark(0, -20, 7, '#ffffff'),
        spark(0, 20, 7, col.base),
        spark(-20, 0, 6, '#ffffff'),
        spark(20, 0, 6, col.base),
        spark(-14, -14, 5, col.base),
        spark(14, -14, 5, '#ffffff'),
        spark(-14, 14, 5, '#ffffff'),
        spark(14, 14, 5, col.base),
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
            // ×R on the attacker: this move fights R defenders back to back, i.e.
            // R QTE rounds (the engine's captureCount). Pointer-events off so the
            // piece underneath stays the click target.
            <span
              title={t('board.chainBadgeTitle', { rounds: p.chain })}
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
              ×{p.chain}
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
          legalPieceIds={legalPieceIds}
          onPieceClick={onPieceClick}
        />
        <Yard
          r={0}
          c={9}
          ck="green"
          basePieces={basePieces('green')}
          goalCount={goalCount('green')}
          legalPieceIds={legalPieceIds}
          onPieceClick={onPieceClick}
        />
        <Yard
          r={9}
          c={9}
          ck="yellow"
          basePieces={basePieces('yellow')}
          goalCount={goalCount('yellow')}
          legalPieceIds={legalPieceIds}
          onPieceClick={onPieceClick}
        />
        <Yard
          r={9}
          c={0}
          ck="blue"
          basePieces={basePieces('blue')}
          goalCount={goalCount('blue')}
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
