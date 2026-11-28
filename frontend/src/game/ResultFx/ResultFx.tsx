import { useEffect, useId } from 'react';
import type { CSSProperties } from 'react';
import { COL } from '../../theme';
import { useApp } from '../../store';
import { THEME_BY_ID } from '../../styles/themes';
import type { PlayerColor } from '../types';
import {
  SCENE_ATTACK_MS,
  SCENE_CLOUD_MS,
  RESULT_HEADLINE_READ_MS,
  SCENE_JAIL_MS,
  SCENE_WALL_ATTACK_MS,
} from '../../__shared__/timing.constants';
import { AttackAct } from './AttackAct';
import { CastPiece } from './CastPiece';
import { CloudAct } from './CloudAct';
import { JailAct } from './JailAct';
import {
  CAGE_HALF,
  CAGE_TRAVEL_PX,
  BEAM_TRAVEL_PX,
  CLOUD_TEXT_LEAD_MS,
  ensureKeyframes,
} from './keyframes';
import { resultFxBeats } from './timeline';
import {
  ATTACKER_GLYPH_X,
  BANNER_ADVANCE,
  BANNER_MAX_FS,
  BANNER_MIN_FS,
  BANNER_PAD,
  BANNER_Y,
  BEAM_INSET,
  DEFENDER_GLYPH_X,
  DOME_CX,
  DOME_RADII,
  GLYPH_Y,
  GROUND_Y,
  PIECE_W,
  SHARED_X_MAX,
  STRIKE_Y,
  VB_H,
  VB_W,
  WALL_ATTACKER_X,
  WALL_DY,
  WALL_FRONT_X,
  WALL_MAX,
  WALL_OVERLAP,
  WALL_TAPER,
  starAt,
} from './geometry';

export type ResultFxKind = 'capture' | 'repulse';

// The result card's animation stage, played alongside the text. The winner's colour marks
// beam, strike and bars; the loser stays in the cell. `n` is the defender count, and
// `totalRounds > 1` marks a wall. Cosmetics only; the room's `captureFx` gates it.
export function ResultFx({
  kind,
  attacker,
  defender,
  n,
  totalRounds,
  banner,
  viewBox = `0 0 ${VB_W} ${VB_H}`,
}: {
  kind: ResultFxKind;
  attacker: PlayerColor;
  defender: PlayerColor;
  n: number;
  totalRounds: number;
  banner?: string;
  // The visible window into the stage. The clash card shows all of it; the flash card
  // shows `FLASH_CARD_VIEWBOX`, a 0.8-scaled crop of the same frame at the same pixels
  // per unit, so the two clips are one clip (25.17 item 3).
  viewBox?: string;
}) {
  useEffect(ensureKeyframes, []);
  const { theme } = useApp();
  const pieces = THEME_BY_ID[theme].pieces;
  const attackerColor = COL[attacker].base;
  const defenderColor = COL[defender].base;
  // Who won, and therefore whose colour is on every mark and whose side the cell slams in
  // from: `capture` is the attacker's win, `repulse` the defender's. That is the only
  // thing `kind` decides (25.18).
  const attackerWon = kind === 'capture';
  const winnerColor = attackerWon ? attackerColor : defenderColor;
  const loserColor = attackerWon ? defenderColor : attackerColor;

  // What kind of card this is, first, because two of the three clocks below depend on it:
  // a breach is the only card with a third act, and everything the jail does starts after
  // the cloud when there is one.
  const total = Math.max(1, Math.trunc(totalRounds) || 1);
  const isWall = total > 1;
  const layers = Math.min(Math.max(1, Math.trunc(n) || 1), WALL_MAX);
  // A single-defender round is piece-level in EITHER direction: two glyphs, no shield.
  const isPieceLevel = !isWall;
  // The total breach: the attacker's win against the LAST defender of a wall. It is the one
  // path with a cloud and a sentence, and the longest card there is.
  const isBreach = attackerWon && isWall && layers === 1;
  // A capture subtracts one defender, so the wall is drawn one layer fuller than it is
  // left; a repulse subtracts nothing, and there `n` is the whole set plus the one that
  // would have gone, which is why the total is the ceiling.
  const wallLayers = attackerWon ? layers : Math.min(total, WALL_MAX);
  // The wall's column and the ring the shot meets, both read off `n`. The column: the front box at
  // `WALL_FRONT_X`, and each further defender `WALL_TAPER` of the width, one rung up and left by the
  // rest of its own box — 36, 29.5, 24.2 and 19.8 wide, x 144 back to 59.
  const wallBoxes: { x: number; y: number; size: number }[] = [];
  for (let i = 0; i < wallLayers; i++) {
    const size = +(PIECE_W * WALL_TAPER ** i).toFixed(1);
    const step = i === 0 ? 0 : +((1 - WALL_OVERLAP) * size).toFixed(1);
    const prev = i === 0 ? WALL_FRONT_X : wallBoxes[i - 1].x;
    wallBoxes.push({
      x: +(prev - step).toFixed(1),
      y: +(GLYPH_Y - i * WALL_DY).toFixed(1),
      size,
    });
  }
  const shieldFaceX = +(
    DOME_CX + Math.sqrt(DOME_RADII[wallLayers - 1] ** 2 - (GROUND_Y - STRIKE_Y) ** 2)
  ).toFixed(1);

  // One clock per act (25.8): an element is budgeted in the act it plays in, so nothing can outlive
  // that act and re-timing one act leaves the others' instants alone.
  const attackMs = isWall ? SCENE_WALL_ATTACK_MS : SCENE_ATTACK_MS;
  const fx = (name: string) => `${name} ${SCENE_ATTACK_MS}ms ease-out both`;
  const wallFx = (name: string) => `${name} ${SCENE_WALL_ATTACK_MS}ms ease-out both`;
  const cloudFx = (name: string) => `${name} ${SCENE_CLOUD_MS}ms ease-out ${attackMs}ms both`;
  // The jail is the second act everywhere and the THIRD on a breach, where the cloud sits between
  // the two clears.
  const jailStartMs = attackMs + (isBreach ? SCENE_CLOUD_MS : 0); // 700, 1600 or 3000
  const jailFx = (name: string) => `${name} ${SCENE_JAIL_MS}ms ease-out ${jailStartMs}ms both`;
  // The jail act's clock, held OPEN by its delay rather than by `both`: an element that must
  // not exist before the jail keeps its base style until its own act starts.
  const atJailStart = (name: string) =>
    `${name} ${SCENE_JAIL_MS}ms ease-out ${jailStartMs}ms forwards`;
  const readFx = (name: string, startMs: number) =>
    `${name} ${RESULT_HEADLINE_READ_MS}ms ease-out ${startMs}ms both`;
  // SVG shapes need their own box for `transform-origin` to mean anything.
  const pivot: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };
  // The cloud grows upward out of the ground, so its own box's bottom edge — the stem's base
  // on the ground line — is the point it scales about.
  const growsUp: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center bottom' };

  // The strike: from the winner's front face to whatever takes it. The tail sits 6 units inside the
  // shooter's glyph, so the beam leaves a piece instead of crossing an empty lane (25.17 item 2).
  const beamFrom = attackerWon
    ? isWall
      ? WALL_ATTACKER_X + BEAM_INSET // 202: the attacker's front face, in the wall's bay
      : ATTACKER_GLYPH_X + BEAM_INSET // 138.5
    : isWall
      ? shieldFaceX // the shot returns off the face it struck
      : DEFENDER_GLYPH_X + PIECE_W - BEAM_INSET; // 36.5
  const impactX = attackerWon
    ? isWall
      ? shieldFaceX // the dome's face takes the hit
      : DEFENDER_GLYPH_X + PIECE_W // 42.5: the defender's right flank, the box's own edge
    : isWall
      ? WALL_ATTACKER_X // 196: the reflected shot strikes the attacker's flank
      : ATTACKER_GLYPH_X; // 132.5: the attacker's left flank
  const beamX = Math.min(beamFrom, impactX);
  const beamW = Math.abs(impactX - beamFrom);
  // The white-hot head sits 12 units back toward the shooter on a capture — to the right,
  // where the attacker stands — and 2 units inside the struck piece on a repulse, which is
  // the same relationship the shot had before the pair was mirrored.
  const hotX = attackerWon ? impactX + 12 : impactX + 2;

  // The cell closes on the loser: the defender on a capture (left), the attacker on a
  // repulse (right). Its centre is that piece's, so the bars follow the blow. A wall
  // re-presents prisoner and jailer after the clear.
  const cageBars = 5;
  const defenderCx = DEFENDER_GLYPH_X + PIECE_W / 2; // 24.5
  const attackerCx = ATTACKER_GLYPH_X + PIECE_W / 2; // 150.5
  const loserCx = attackerWon ? defenderCx : attackerCx;
  // Both cell edges are clamped to the window both cards share: the left so the defender's
  // cell is not cut at -3.9, the right against `SHARED_X_MAX` 192 so the flash card never
  // crops what the clash card keeps.
  const cageCx = Math.min(SHARED_X_MAX - CAGE_HALF, Math.max(CAGE_HALF, loserCx));
  const cageTopY = STRIKE_Y - 30; // 54, the top of the cell's box
  const cageH = GROUND_Y - cageTopY; // 66
  // The bars start on the winner's side and travel away from it: right to left on a
  // capture (the attacker is on the right), left to right on a repulse — the same vector
  // as the beam, so the card reads as one sweep repeated.
  const cageFrom = `${attackerWon ? CAGE_TRAVEL_PX : -CAGE_TRAVEL_PX}px`;
  // The beam travels a full stage clear on the pair, and its own width on a wall: the attacker
  // stands beside the dome there, so the shot is a punch at close range rather than a lance across
  // the frame (25.3).
  const beamTravel = isWall ? beamW : BEAM_TRAVEL_PX;
  const beamEntry = `${attackerWon ? beamTravel : -beamTravel}px`;
  // The strike may only exist inside the lane it crosses.
  const beamClipId = useId();
  const beamClipX = Math.min(beamFrom, impactX);
  const beamClipW = Math.abs(impactX - beamFrom) + (attackerWon ? 0 : 16);
  // The floor each composition stands on. The wall's runs from behind the rear-most defender to past
  // the attacker's own bay; the pair's follows the cell and stops at x 192, the widest both cards
  // can show, so the flash card never cuts a mark the clash card keeps.
  const pairFloorX1 = Math.max(0, cageCx - CAGE_HALF - 16);
  const pairFloorX2 = Math.min(SHARED_X_MAX, cageCx + CAGE_HALF + 16);
  const wallFloorX1 = Math.max(4, wallBoxes[wallLayers - 1].x - 12);
  const wallFloorX2 = Math.min(VB_W - 4, WALL_ATTACKER_X + PIECE_W + 8); // 236: the stage's edge

  // The three compositions' gates.
  const wallGate: CSSProperties = { animation: wallFx('fxWallClear') };
  // The dome scales about the ground under its centre, so its rim travels while the
  // column's feet stay put. `view-box` makes that floor point the origin instead of a
  // bounding box that moves with the ring count.
  const domeBeat: CSSProperties = {
    animation: wallFx('fxDomeBeat'),
    transformBox: 'view-box',
    transformOrigin: `${DOME_CX}px ${GROUND_Y}px`,
  };
  const pairGate: CSSProperties = isWall ? { opacity: 0, animation: atJailStart('fxCastIn') } : {};
  const cloudGate: CSSProperties = { animation: cloudFx('fxCloudClear') };

  // The sentence's own numbers, from the string it draws (25.4): the same key carries a player's
  // name now, so 27 — sized for an eleven-character word — is a ceiling and not a constant.
  const sentenceAtMs = attackMs + CLOUD_TEXT_LEAD_MS; // 2000: 400 ms into a breach's cloud
  const sentenceLen = Math.max(1, banner?.length ?? 1);
  const bannerFs = Math.max(
    BANNER_MIN_FS,
    Math.min(BANNER_MAX_FS, Math.floor((VB_W - 2 * BANNER_PAD) / (BANNER_ADVANCE * sentenceLen))),
  );
  const bannerBudget = VB_W - 2 * BANNER_PAD;
  const bannerSqueeze =
    BANNER_ADVANCE * bannerFs * sentenceLen > bannerBudget
      ? { textLength: bannerBudget, lengthAdjust: 'spacingAndGlyphs' as const }
      : {};
  // The halo and the hairline are the two widths that were tuned against a 27 px word, so they
  // follow the size: at the ceiling they land on exactly 6 and 0.75 units, and at the floor they are
  // thin enough to leave the counters of the letters open instead of drowning them in glow.
  const bannerScale = bannerFs / BANNER_MAX_FS;
  const bannerHalo = Math.max(2, Math.round(6 * bannerScale));
  const bannerEdge = Math.max(0.4, +(0.75 * bannerScale).toFixed(2));

  // The soundtrack belongs to the act, not to the host (25.5): both cards mount the same scene, so
  // both play the same beats, and the flash card keeps the laser the walk found missing.
  useEffect(() => {
    const timers = resultFxBeats({
      isWall,
      attackerWon,
      layers,
      isBreach,
      attackMs,
      jailStartMs,
    }).map(({ at, play }) => window.setTimeout(play, at));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [attackMs, isWall, attackerWon, isBreach, layers, jailStartMs]);

  return (
    <svg
      aria-hidden="true"
      viewBox={viewBox}
      width="100%"
      height="100%"
      style={{ display: 'block', overflow: 'hidden', pointerEvents: 'none' }}
    >
      {/* ── the attack act, on a wall: its defenders, the dome over them, and the
             attacker drawn in the right-hand bay ─────────────────────────────────── */}

      {isWall && (
        <AttackAct
          wallGate={wallGate}
          domeBeat={domeBeat}
          wallFloorX1={wallFloorX1}
          wallFloorX2={wallFloorX2}
          wallBoxes={wallBoxes}
          wallLayers={wallLayers}
          defender={defender}
          defenderColor={defenderColor}
          attacker={attacker}
          attackerWon={attackerWon}
          pieces={pieces}
          wallFx={wallFx}
          pivot={pivot}
        />
      )}

      {/* ── the pair stage: every 1v1 act, and the jail act of a wall (25.3) ────────── */}

      <g style={pairGate}>
        {/* the floor the pair stands on */}
        <line
          x1={pairFloorX1}
          y1={GROUND_Y}
          x2={pairFloorX2}
          y2={GROUND_Y}
          stroke={loserColor}
          strokeOpacity=".22"
          strokeWidth="2"
        />

        {/* the cast, at the same two places whichever seat won: the defender on the left,
            the attacker on the right. On a wall this group is the jail act only — the pair
            arrives where the wall stood, one clear later, which is why the wall's prisoner
            is drawn twice and never contradicted (25.4). They face each other, which is the
            same rule the wall's row follows: the seats never swap, so neither does the
            direction each of them looks. */}
        <CastPiece x={DEFENDER_GLYPH_X} y={GLYPH_Y} color={defender} pieces={pieces} pose="right" />
        <CastPiece x={ATTACKER_GLYPH_X} y={GLYPH_Y} color={attacker} pieces={pieces} pose="left" />
      </g>

      {/* the strike lands: the field cracks under the loser. The loser itself never moves
          — it stands where it was struck until the bars close on it (25.18). A wall's
          attack cracks no field: the shield is what takes the hit (25.4). */}
      {isPieceLevel && (
        <g style={{ animation: fx('fxFieldCrack') }}>
          <path
            d={`M ${loserCx - 22} ${GROUND_Y} L ${loserCx - 8} ${GROUND_Y - 8} L ${loserCx - 2} ${GROUND_Y}`}
            fill="none"
            stroke="#e8e2ff"
            strokeOpacity=".85"
            strokeWidth="1.5"
          />
          <path
            d={`M ${loserCx + 4} ${GROUND_Y} L ${loserCx + 14} ${GROUND_Y - 6} L ${loserCx + 24} ${GROUND_Y}`}
            fill="none"
            stroke="#e8e2ff"
            strokeOpacity=".85"
            strokeWidth="1.5"
          />
        </g>
      )}

      {/* the strike: the winner's beam, entering from the winner's own side, on every act's
          one line at `STRIKE_Y`. It is clipped to the lane between the two pieces, so the
          slide is revealed at the shooter's front face instead of painted behind him. */}
      <defs>
        <clipPath id={beamClipId}>
          <rect x={beamClipX} y={STRIKE_Y - 12} width={Math.max(10, beamClipW)} height="24" />
        </clipPath>
      </defs>
      <g
        clipPath={`url(#${beamClipId})`}
        style={{ animation: fx('fxBeam'), '--beamFrom': beamEntry } as CSSProperties}
      >
        <rect
          x={beamX}
          y={STRIKE_Y - 3}
          width={Math.max(10, beamW)}
          height="6"
          rx="3"
          fill={winnerColor}
        />
        <rect x={hotX} y={STRIKE_Y - 5} width="14" height="10" rx="4" fill="#ffffff" opacity=".7" />
      </g>

      {/* where it lands: the puncture star blooms on the piece the shot met — the defender's
          flank on a 1v1 capture, the dome's face on a wall, the attacker himself on
          a repulse — always in the winner's colour */}
      <path
        d={starAt(impactX, STRIKE_Y)}
        fill="#ffffff"
        stroke={winnerColor}
        strokeWidth="1.5"
        style={{ ...pivot, animation: fx('fxPuncture') }}
      />

      {/* the cloud act, on the total breach only: the wall left at 700 (the first clear), so
          the blast stands on the ground where it stood, and the second clear takes it at
          2100 as the jail's pair arrives. Two marks, both in the winner's colour: the
          ground ring (flat, because the frame is a side view) and the mushroom itself —
          stem and head in one group, which is what lets a single scale about its bottom
          edge be "it grows upward from the ground" (25.4). */}
      {isBreach && (
        <CloudAct
          winnerColor={winnerColor}
          cloudGate={cloudGate}
          cloudFx={cloudFx}
          pivot={pivot}
          growsUp={growsUp}
        />
      )}

      {/* the cell slams closed on the loser — on the pair stage, whichever seat lost, and on
          a wall after the clear has re-presented that same piece as the prisoner (25.4) — and
          then holds. The bars are the WINNER's colour, which is also why the prisoner can
          never be lost in them: the prisoner is the loser, so bars and prisoner are always
          two different seats. Two rects per bar, a core and a glow; no filter, because a
          filter is the one thing that costs frames here. */}
      <JailAct
        jailFx={jailFx}
        cageFrom={cageFrom}
        cageCx={cageCx}
        cageTopY={cageTopY}
        cageH={cageH}
        winnerColor={winnerColor}
        cageBars={cageBars}
      />

      {/* the sentence reads only on the total breach, and INSIDE the cloud act: it joins the
          cloud 400 ms in and finishes exactly with the act, so it reads over a blast still
          moving rather than after it (25.4, D34) */}
      {isBreach && banner && (
        <>
          <text
            x={VB_W / 2}
            y={BANNER_Y}
            textAnchor="middle"
            fontSize={bannerFs}
            fontWeight={900}
            fontFamily="var(--font-display)"
            fill="none"
            stroke={winnerColor}
            strokeWidth={bannerHalo}
            strokeOpacity=".35"
            style={{ animation: readFx('fxBannerPulse', sentenceAtMs) }}
            {...bannerSqueeze}
          >
            {banner}
          </text>
          <text
            x={VB_W / 2}
            y={BANNER_Y}
            textAnchor="middle"
            fontSize={bannerFs}
            fontWeight={900}
            fontFamily="var(--font-display)"
            fill={winnerColor}
            stroke="#0b0118"
            strokeWidth={bannerEdge}
            paintOrder="stroke"
            style={{ animation: readFx('fxBannerPulse', sentenceAtMs) }}
            {...bannerSqueeze}
          >
            {banner}
          </text>
        </>
      )}
    </svg>
  );
}
