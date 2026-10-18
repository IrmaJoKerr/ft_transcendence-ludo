import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClashResult, GameViewState } from './reducer';
import type { ClashPhase, PlayerColor } from './types';
import { isMobileOS } from '../utils/device';
import {
  CLASH_ANNOUNCE_MS,
  CLASH_COUNTDOWN_MS,
  CLASH_PRESS_MS,
  CLASH_RESULT_MS,
  CLASH_FIGHT_FLASH_MS,
  CLASH_UI_TICK_MS,
  TOUCH_FLASH_MS,
} from './timing';

// Clash timing lives in ./timing, with every other delay, shared with the engine and
// pinned by the `timing-contract` harness. The overlay's phase transitions come from the
// server-borne deadlines (announce / countdown / press), so these only drive presentation.
const CLASH_TARGET = 42; // must mirror engine CLASH_TARGET
// Bar renders in whole pixels: 168px track / 42 presses = 4px per press, so the
// bar hits exactly full (168px) at 42 presses. Keep width a multiple of target.
const CLASH_BAR_WIDTH_PX = 168;

// ── Touch input (tablet) ───────────────────────────────────────────────────
// Sized in CSS lengths so the pad scales with the device: 3 cm per circle, with a
// 1 cm edge buffer added to the safe-area inset. The gap is inert empty space.
const TOUCH_BUTTON = '3cm';
const TOUCH_GAP = '1cm';
const TOUCH_EDGE_BUFFER = '1cm';
// One tap is worth this many presses (the engine clamps it to CLASH_TAP_COUNT_MAX):
// tapping is slower than holding a key, and the per-side cap still gates the rate.
const TOUCH_TAP_COUNT = 2;

// The two key sets, mirrored from the engine (clash.ts ATTACKER_KEYS /
// DEFENDER_KEYS). The touch pad draws its decoys from the side's OWN set, and
// the sets are disjoint, so a decoy can never be the other side's key.
const ATTACKER_KEYS = ['u', 'i', 'o', 'h', 'j', 'k', 'b', 'n', 'm'];
const DEFENDER_KEYS = ['q', 'w', 'e', 'a', 's', 'd', 'z', 'x', 'c'];

// Player identity colors for the plates/bars. Theme-aware CSS vars (defined in
// retrowave.css) so the clash matches the active theme; the hex fallbacks are
// the synthwave defaults.
const COLORS: Record<PlayerColor, string> = {
  red: 'var(--clash-red, #e05050)',
  green: 'var(--clash-green, #5fd08a)',
  yellow: 'var(--clash-yellow, #f0d18a)',
  blue: 'var(--clash-blue, #4a92e0)',
};

/** Re-render on a fixed tick so phase transitions + countdown derive from SERVER timestamps. */
function useNow(ms = CLASH_UI_TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Portrait only matters where the touch path is active; a desktop window is never gated. */
function useIsPortrait(touchMode: boolean): boolean {
  const [portrait, setPortrait] = useState(() => {
    if (!touchMode || typeof window === 'undefined') return false;
    return window.matchMedia('(orientation: portrait)').matches;
  });
  useEffect(() => {
    if (!touchMode || typeof window === 'undefined') return;
    const mq = window.matchMedia('(orientation: portrait)');
    const onChange = () => setPortrait(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [touchMode]);
  return portrait;
}

function phaseAt(clash: NonNullable<GameViewState['clash']>, now: number): ClashPhase {
  if (now < clash.announceDeadline) return 'announce';
  if (now < clash.countdownDeadline) return 'countdown';
  return 'pressing'; // press window is [countdownDeadline, pressDeadline); after that the result prop shows
}

type Props = {
  clash: NonNullable<GameViewState['clash']>;
  result: ClashResult | null;
  myColor: PlayerColor;
  onKeyPress: (key: string, count?: number) => void;
  onComplete: () => void;
  /** Hotseat only: one device controls both seats, so BOTH sides' inputs must be
   *  accepted at once. PvP/PvE leave this false: each player only presses their
   *  own side's keys. */
  allowBothSides?: boolean;
};

/** Chunky bar: black track that fills with the side's color, whole pixels per press. */
function Bar({ color, presses, target }: { color: PlayerColor; presses: number; target: number }) {
  const fullAt = Math.max(1, target);
  const safe = Number.isFinite(presses) ? presses : 0;
  const widthPx = Math.min(CLASH_BAR_WIDTH_PX, (safe / fullAt) * CLASH_BAR_WIDTH_PX);
  return (
    <div
      style={{
        position: 'relative',
        margin: '10px auto 0',
        height: 50,
        width: CLASH_BAR_WIDTH_PX,
        overflow: 'hidden',
        borderRadius: 10,
        border: '1px solid var(--border-color)',
        background: 'var(--bg-secondary)',
      }}
    >
      <div
        style={{
          height: '100%',
          borderRadius: 8,
          width: `${widthPx}px`,
          background: COLORS[color],
          boxShadow: `0 0 12px color-mix(in srgb, ${COLORS[color]} 40%, transparent)`,
          transition: 'width 90ms linear',
        }}
      />
    </div>
  );
}

/** Name-plate — Defender sits LEFT (QWESADZXC), Attacker RIGHT (UIOHJKNBM). */
function Plate({ role, color, isMe }: { role: 'defender' | 'attacker'; color: PlayerColor; isMe: boolean }) {
  const { t } = useTranslation();
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          margin: '0 auto 8px',
          display: 'grid',
          placeItems: 'center',
          height: 76,
          width: 120,
          borderRadius: 18,
          padding: '0 12px',
          fontSize: 28,
          fontWeight: 900,
          letterSpacing: '0.12em',
          color: '#12100a',
          background: COLORS[color],
          boxShadow: `0 0 18px color-mix(in srgb, ${COLORS[color]} 33%, transparent)`,
        }}
      >
        {(color ?? '').slice(0, 2).toUpperCase() || '?'}
      </div>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-main)' }}>
        {role === 'defender' ? t('game.clashDefenderRole') : t('game.clashAttackerRole')}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: isMe ? 'var(--accent-yellow)' : 'var(--text-muted)',
        }}
      >
        {isMe ? t('game.clashYou') : color.toUpperCase()}
      </div>
    </div>
  );
}

// Static clash key box — identical for every key so the border doesn't hug the
// glyph. Sized from Atkinson Hyperlegible Bold metrics at 54px so the WIDEST
// character used (W, advance 47.7px) and the TALLEST (Q, 39.7px incl. descender)
// always keep ≥2mm clearance (2mm ≈ 7.56px) from the 2px border on all sides:
//   width  = widestAdvance + 4mm + 2×2px border = 47.7 + 15.1 + 4 = 67px
//   height = line-box baseline model (half-leading) + 2×2px border = 61px
const KEY_BADGE_W = 67;
const KEY_BADGE_H = 61;

/**
 * Round pill for a clash CHAIN: "ROUND 2 / 3". A stacked square costs one round
 * per defender, and each round is a fresh race with fresh keys, so the player
 * must be able to see how far the attack has come. Absent (null) on a
 * single-defender clash, which stays exactly the card it always was.
 */
function RoundBadge({ round, total }: { round: number; total: number }) {
  const { t } = useTranslation();
  if (total <= 1) return null;
  return (
    <div
      style={{
        display: 'inline-block',
        padding: '3px 14px',
        borderRadius: 999,
        border: '1px solid var(--accent-yellow)',
        background: 'rgba(255, 214, 0, 0.08)',
        fontFamily: 'var(--font-mono)',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '.16em',
        color: 'var(--accent-yellow)',
      }}
    >
      {t('game.clashRoundBadge', { round, total })}
    </div>
  );
}

/** Large bold key chip — fixed static border, highlighted for the owning player, dimmed otherwise. */
function KeyBadge({ label, emphasized }: { label: string; emphasized: boolean }) {
  return (
    <div
      style={{
        marginTop: 12,
        display: 'inline-grid',
        placeItems: 'center',
        borderRadius: 10,
        fontSize: 54,
        fontWeight: 700,
        textTransform: 'uppercase',
        lineHeight: 1,
        width: KEY_BADGE_W,
        height: KEY_BADGE_H,
        fontFamily: "'Atkinson Hyperlegible', sans-serif",
        border: `2px solid ${emphasized ? 'var(--accent-yellow)' : 'var(--text-muted)'}`,
        color: emphasized ? 'var(--text-main)' : 'var(--text-muted)',
        boxShadow: emphasized ? '0 0 14px var(--accent-yellow)' : 'none',
      }}
    >
      {label === 'Space' ? 'SPACE' : label.toUpperCase()}
    </div>
  );
}

/**
 * Draw one side's four circles: the side's own required key plus three decoys
 * from the same nine-key set. Pure module scope, so the draw is not an impure
 * call made during render, and the component memoises it per round.
 *
 * `round` rotates the pool before the shuffle, so a chain's consecutive rounds
 * cannot draw the same layout even if the engine happened to pick the same key.
 */
function drawPad(side: 'defender' | 'attacker', acceptKey: string, round: number): string[] {
  const pool = [...(side === 'attacker' ? ATTACKER_KEYS : DEFENDER_KEYS)];
  const shift = ((round % pool.length) + pool.length) % pool.length;
  for (let i = 0; i < shift; i++) {
    const head = pool.shift();
    if (head != null) pool.push(head);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = [acceptKey, ...pool.filter((k) => k !== acceptKey).slice(0, 3)];
  for (let i = picked.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  return picked;
}

/**
 * One side's 2x2 pad of 3 cm circles. The side's OWN required key is one of
 * the four; the other three are random decoys from the same nine-key set, so
 * mashing blind lands the right circle about a quarter of the time. Reading
 * stays the skill — and it stays that way on a keyboard too, where mashing all
 * nine keys needs ~378 presses inside the window.
 */
function TouchPad({
  side,
  color,
  acceptKey,
  round,
  active,
  onPress,
}: {
  side: 'defender' | 'attacker';
  color: PlayerColor;
  acceptKey: string;
  round: number;
  active: boolean;
  /** The click handler. `count` is the tap weight (1 = one press). */
  onPress: (key: string, count: number) => void;
}) {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState<string | null>(null);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-drawn every round, so muscle memory cannot replace reading the correct
  // circle. The decoys can never be the other side's key, because the two key
  // sets are disjoint.
  const keys = useMemo(
    () => drawPad(side, acceptKey, round),
    [acceptKey, side, round],
  );

  useEffect(
    () => () => {
      if (flashRef.current) clearTimeout(flashRef.current);
    },
    [],
  );

  const tap = (key: string) => {
    if (!active) return;
    setPressed(key);
    if (flashRef.current) clearTimeout(flashRef.current);
    flashRef.current = setTimeout(() => setPressed(null), TOUCH_FLASH_MS);
    // Cheap extra, not a requirement: Android honours this, iOS ignores it.
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(8);
    // A pad tap is worth TOUCH_TAP_COUNT presses: the engine clamps the weight
    // and still caps the event rate, so this is a heavier press, not a faster one.
    onPress(key, TOUCH_TAP_COUNT);
  };

  // The buffer is additive to the safe area, so the visible gap is never
  // smaller than either one and a resting thumb stays off the home indicator.
  const edge: CSSProperties =
    side === 'defender'
      ? { paddingLeft: `calc(${TOUCH_EDGE_BUFFER} + env(safe-area-inset-left))` }
      : { paddingRight: `calc(${TOUCH_EDGE_BUFFER} + env(safe-area-inset-right))` };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, ...edge }}>
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
          letterSpacing: '0.18em',
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
        }}
      >
        {side === 'attacker' ? t('game.clashAttackerRole') : t('game.clashDefenderRole')}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(2, ${TOUCH_BUTTON})`,
          // Inert dead space between the circles: a near miss must not land on
          // a decoy.
          gap: TOUCH_GAP,
        }}
      >
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onPointerDown={(e) => {
              e.preventDefault();
              tap(k);
            }}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              width: TOUCH_BUTTON,
              height: TOUCH_BUTTON,
              borderRadius: '50%',
              border: `2px solid ${pressed === k ? 'var(--accent-yellow)' : COLORS[color]}`,
              background: pressed === k ? COLORS[color] : 'rgba(13, 2, 33, 0.85)',
              color: pressed === k ? '#12100a' : 'var(--text-main)',
              fontFamily: 'var(--font-mono)',
              fontSize: 40,
              fontWeight: 900,
              lineHeight: 1,
              display: 'grid',
              placeItems: 'center',
              // pointerdown, not click: no 300 ms delay and no ghost click.
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
              userSelect: 'none',
              cursor: active ? 'pointer' : 'default',
              opacity: active ? 1 : 0.75,
              transform: pressed === k ? 'scale(0.94)' : 'none',
              transition: 'transform 90ms linear, background 90ms linear',
              boxShadow: pressed === k ? `0 0 16px ${COLORS[color]}` : 'none',
            }}
          >
            {k.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The clash QTE. One overlay serves keyboard and touch: `isMobileOS()` picks the
 * input mechanism (2x2 circles against keydown) and arms the portrait gate, and
 * everything else — phases, meters, result card — is identical on both. The
 * keydown listener stays live even in touch mode, so a tablet with a keyboard
 * case gets both.
 */
export function ClashOverlay({ clash, result, myColor, onKeyPress, onComplete, allowBothSides = false }: Props) {
  const { t } = useTranslation();
  const now = useNow(CLASH_UI_TICK_MS);
  const phase = phaseAt(clash, now);
  const touchMode = useMemo(() => isMobileOS(), []);
  const portrait = useIsPortrait(touchMode);
  const rootRef = useRef<HTMLDivElement>(null);

  const attackerIsMe = clash.attacker === myColor;
  const defenderIsMe = clash.defender === myColor;
  const iAmInClash = attackerIsMe || defenderIsMe || allowBothSides;
  const myKey = attackerIsMe ? clash.attackerKey : clash.defenderKey;
  // Hotseat: a single device owns BOTH seats, so both sides' keys are accepted.
  const listenerKeys = useMemo(
    () => (allowBothSides ? [clash.attackerKey, clash.defenderKey] : [myKey]),
    [allowBothSides, clash.attackerKey, clash.defenderKey, myKey],
  );
  // One clash is one round today; a chain re-randomises the pad per round.
  const round = clash.round ?? 1;
  // Clash CHAIN: a stacked square costs one round per defender. The engine stamps
  // the round on every clash_start of a chain, so a single clash reads 1/1 and
  // the badge below renders nothing: this card is unchanged for it.
  const totalRounds = clash.totalRounds ?? 1;
  // Chain copy for the result card. A round the attacker took while defenders
  // remain says how many are left (the next round is coming); the round that ends
  // the attack says which way it ended. A single clash gets no line at all.
  const chainLine = !result || (result.totalRounds ?? 1) <= 1
    ? null
    : result.continues
      ? t('game.clashRoundWon', { left: result.remainingDefenderIds?.length ?? 0 })
      : result.winner === clash.attacker
        ? t('game.clashChainBroken')
        : t('game.clashChainRepulsed');

  // The overlay swallows every tap. A stray tap must not reach the board and
  // emit a roll or a move: the server rejects both during the press window (the
  // phase is still WAITING_FOR_MOVE and pendingLegalMoves is empty), so this is
  // defence in depth — but a rejected emit is an error toast mid-QTE and every
  // tap spends rate-limit tokens. A native NON-passive listener is required,
  // because preventDefault on a passive one is ignored.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const swallow = (e: Event) => {
      e.preventDefault();
    };
    el.addEventListener('touchstart', swallow, { passive: false });
    el.addEventListener('pointerdown', swallow, { passive: false });
    el.addEventListener('gesturestart', swallow);
    return () => {
      el.removeEventListener('touchstart', swallow);
      el.removeEventListener('pointerdown', swallow);
      el.removeEventListener('gesturestart', swallow);
    };
  }, []);

  // Keypresses ONLY count during the PRESSING phase (the keys are hidden before
  // that). Matching is deliberately generous: `e.code` is the PHYSICAL key
  // ("KeyZ", never "z"), so the QWERTY position works on any layout, and `e.key`
  // is the CHARACTER produced (AZERTY swaps q↔a and w↔z), compared
  // case-insensitively so CapsLock/Shift cannot break it. Either match counts.
  useEffect(() => {
    if (!iAmInClash || phase !== 'pressing' || result) return;
    const hitKey = (e: KeyboardEvent, k: string) =>
      e.code === `Key${k.toUpperCase()}` || (typeof e.key === 'string' && e.key.toLowerCase() === k);
    const handler = (e: KeyboardEvent) => {
      const hit = listenerKeys.find((k) => hitKey(e, k));
      if (hit) onKeyPress(hit);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [iAmInClash, phase, listenerKeys, result, onKeyPress]);

  // Auto-dismiss the result card; the reducer keeps `clash` alive until then (or until
  // the engine's release frame, whichever comes first). The timer depends ONLY on the
  // result: `onComplete` is an inline function in Game.tsx, so listing it as a
  // dependency restarted this timer on every parent render, which could stop it from
  // ever firing and leave the card (and its overlay) on screen.
  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => completeRef.current(), CLASH_RESULT_MS);
    return () => clearTimeout(timer);
  }, [result]);

  // Best-effort landscape lock, armed only where the touch path is active. It
  // needs fullscreen on Android Chrome and does not exist on iOS Safari, so the
  // portrait gate below is the mechanism and this is the bonus.
  useEffect(() => {
    if (!touchMode) return;
    const orientation = screen.orientation as
      | (ScreenOrientation & { lock?: (o: string) => Promise<void> })
      | undefined;
    try {
      const lock = orientation?.lock?.('landscape');
      if (lock && typeof lock.catch === 'function') lock.catch(() => undefined);
    } catch {
      // Not supported here: the portrait gate carries the requirement.
    }
  }, [touchMode]);

  const countdownSecs = Math.max(0, Math.ceil((clash.countdownDeadline - now) / 1000));
  const fightFlash = phase === 'pressing' && now - clash.countdownDeadline < CLASH_FIGHT_FLASH_MS;
  const pressable = !result && phase === 'pressing';
  // Your own device (PvP/PvE): a tap on the opponent's pad would be rejected by
  // the server's ownership check, so only your own group is drawn. Hotseat: both
  // seats belong to this socket, so both groups are drawn (physical separation,
  // side tint and a per-group letter are the guards).
  const showDefenderPad = touchMode && iAmInClash && (allowBothSides || defenderIsMe);
  const showAttackerPad = touchMode && iAmInClash && (allowBothSides || attackerIsMe);

  // Persistent "who's fighting" header — Defender LEFT / Attacker RIGHT,
  // mirroring the split the key sets already use.
  const plates = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
      <Plate role="defender" color={clash.defender} isMe={defenderIsMe} />
      <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-muted)' }}>
        {t('game.clashVersus')}
      </div>
      <Plate role="attacker" color={clash.attacker} isMe={attackerIsMe} />
    </div>
  );

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,.72)',
        backdropFilter: 'blur(4px)',
        touchAction: 'manipulation',
        overscrollBehavior: 'none',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      <div
        style={{
          width: 'min(92vw, 860px)',
          borderRadius: 24,
          padding: '44px 56px 48px',
          textAlign: 'center',
          background: 'var(--bg-card)',
          border: 'var(--card-border-style)',
          boxShadow: 'var(--box-shadow)',
        }}
      >
        {result ? (
          <>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 13,
                letterSpacing: '.3em',
                color: 'var(--accent-yellow)',
                marginBottom: 10,
              }}
            >
              {result.continues ? t('game.clashRoundOver') : t('game.clashOver')}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 46,
                lineHeight: 1.1,
                color: COLORS[result.winner],
                marginBottom: 14,
              }}
            >
              {result.winner === myColor
                ? t('game.clashYouWon')
                : t('game.clashWins', { color: result.winner.toUpperCase() })}
            </div>
            {chainLine && (
              <div
                style={{
                  marginBottom: 14,
                  fontSize: 15,
                  fontWeight: 700,
                  color: 'var(--text-main)',
                }}
              >
                {chainLine}
              </div>
            )}
            {result.totalRounds != null && result.totalRounds > 1 && (
              <div style={{ marginBottom: 14 }}>
                <RoundBadge round={result.round ?? round} total={result.totalRounds} />
              </div>
            )}
            <div
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 28 }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>
                  {t('game.clashDefenderRole')}
                </div>
                <Bar
                  color={clash.defender}
                  presses={
                    result.winner === clash.defender ? result.winnerPresses : result.loserPresses
                  }
                  target={clash.target ?? CLASH_TARGET}
                />
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--text-muted)' }}>
                {t('game.clashVersus')}
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-main)' }}>
                  {t('game.clashAttackerRole')}
                </div>
                <Bar
                  color={clash.attacker}
                  presses={
                    result.winner === clash.attacker ? result.winnerPresses : result.loserPresses
                  }
                  target={clash.target ?? CLASH_TARGET}
                />
              </div>
            </div>
          </>
        ) : phase === 'announce' ? (
          <>
            <div
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 66,
                letterSpacing: '.14em',
                lineHeight: 1.1,
                color: 'var(--accent-yellow)',
              }}
            >
              {t('game.clashAnnounceTitle')}
            </div>
            <div style={{ marginTop: 10, fontSize: 14, color: 'var(--text-muted)' }}>
              {t('game.clashAnnounceBody')}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('game.clashAnnounceTiming', {
                reveal: CLASH_ANNOUNCE_MS / 1000,
                countdown: CLASH_COUNTDOWN_MS / 1000,
                clash: CLASH_PRESS_MS / 1000,
              })}
            </div>
            {totalRounds > 1 && (
              <div style={{ marginTop: 18 }}>
                <RoundBadge round={round} total={totalRounds} />
              </div>
            )}
            <div style={{ marginTop: 22 }}>{plates}</div>
          </>
        ) : (
          <>
            {plates}
            {totalRounds > 1 && (
              <div style={{ marginTop: 18 }}>
                <RoundBadge round={round} total={totalRounds} />
              </div>
            )}
            <div
              style={{
                marginTop: 22,
                minHeight: 170,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
              }}
            >
              {phase === 'countdown' ? (
                <>
                  <div
                    style={{
                      fontFamily: 'var(--font-heading)',
                      fontSize: 18,
                      letterSpacing: '.18em',
                      color: 'var(--accent-yellow)',
                    }}
                  >
                    {t('game.clashGetReady')}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 96,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: 'var(--accent-yellow)',
                    }}
                  >
                    {countdownSecs > 0
                      ? Math.min(countdownSecs, Math.ceil(CLASH_COUNTDOWN_MS / 1000))
                      : t('game.clashGo')}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                    {touchMode ? t('game.clashTouchHint') : t('game.clashKeyHint')}
                  </div>
                </>
              ) : (
                <>
                  {fightFlash && (
                    <div
                      style={{
                        fontFamily: 'var(--font-heading)',
                        fontSize: 42,
                        letterSpacing: '.3em',
                        color: 'var(--accent-yellow)',
                      }}
                    >
                      {t('game.clashFight')}
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'center',
                      gap: 28,
                    }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <KeyBadge label={clash.defenderKey} emphasized={defenderIsMe} />
                      <Bar
                        color={clash.defender}
                        presses={clash.defenderPresses}
                        target={clash.target ?? CLASH_TARGET}
                      />
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        alignSelf: 'center',
                        fontSize: 26,
                        fontWeight: 900,
                        color: 'var(--text-muted)',
                      }}
                    >
                      {t('game.clashVersus')}
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <KeyBadge label={clash.attackerKey} emphasized={attackerIsMe} />
                      <Bar
                        color={clash.attacker}
                        presses={clash.attackerPresses}
                        target={clash.target ?? CLASH_TARGET}
                      />
                    </div>
                  </div>
                  {!iAmInClash && (
                    <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>
                      {t('game.clashWatching')}
                    </div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                    {touchMode
                      ? t('game.clashTouchPress', { seconds: CLASH_PRESS_MS / 1000 })
                      : t('game.clashPressHint', { seconds: CLASH_PRESS_MS / 1000 })}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Touch path: the pads render from clash_start, so the announce plus the
          countdown (4.5 s) is the player's rotation runway; they stay inert
          until the press phase opens. */}
      {touchMode && iAmInClash && (
        <>
          {showDefenderPad && (
            <div
              style={{
                position: 'fixed',
                left: 0,
                top: 0,
                bottom: 0,
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <TouchPad
                side="defender"
                color={clash.defender}
                acceptKey={clash.defenderKey}
                round={round}
                active={pressable}
                onPress={onKeyPress}
              />
            </div>
          )}
          {showAttackerPad && (
            <div
              style={{
                position: 'fixed',
                right: 0,
                top: 0,
                bottom: 0,
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <TouchPad
                side="attacker"
                color={clash.attacker}
                acceptKey={clash.attackerKey}
                round={round}
                active={pressable}
                onPress={onKeyPress}
              />
            </div>
          )}
        </>
      )}

      {/* Portrait gate: only where the touch path is active (a desktop window is
          never gated for nothing), and it must not swallow keydown, so a tablet
          with a keyboard case can always fall back to its keys. */}
      {touchMode && portrait && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            padding: 24,
            textAlign: 'center',
            background: 'rgba(0, 0, 0, 0.94)',
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: 16,
              letterSpacing: '.12em',
              color: 'var(--accent-yellow)',
            }}
          >
            {t('game.clashRotateTitle')}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 14,
              color: 'var(--text-muted)',
              maxWidth: 420,
              lineHeight: 1.5,
            }}
          >
            {t('game.clashRotateBody')}
          </div>
        </div>
      )}
    </div>
  );
}
