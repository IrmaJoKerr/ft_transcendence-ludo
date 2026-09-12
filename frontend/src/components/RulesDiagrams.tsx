import { useTranslation } from 'react-i18next'
import { UserAvatar } from './UserAvatar'

// Self-contained CSS/emoji "illustrations" for the rules modal's GAME MODS /
// CLASH MODE / NO SAFE ZONES pages. Everything is inline-styled to match the
// game's neon-cyber theme — no image assets, labels come from i18n.
//
// IMPORTANT: use ONLY the explicit diagram palette below (never CSS vars like
// --text-muted / --accent-cyan). Theme vars turn dark in win95/terminal mode
// and would be unreadable on the dark rule-card backgrounds.

// ─── Diagram palette (theme-independent, high-contrast) ──────────────────────
const C_TEXT = '#f2f2f2' // primary labels
const C_DIM = '#cfcfcf' // secondary text / hints
const C_CYAN = '#00e5ff' // defender accent
const C_PINK = '#ff5fa2' // attacker accent
const C_GOLD = '#ffe600' // VS / star glow
const C_RED = '#e05050' // player red (attacker character)
const C_YELLOW = '#f0d18a' // player yellow (defender character)

// ─── Shared bits ─────────────────────────────────────────────────────────────

/** Small key-cap chip, mirrored after the live ClashOverlay KeyBadge (same
 *  Atkinson Hyperlegible face). Static 30px box — at 15.2px glyphs the widest
 *  key (W) keeps ~1.7mm clearance from the border on all sides, comfortably
 *  above the 0.8mm floor chosen for this diagram scale. */
function Keycap({ label, lit }: { label: string; lit?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: 30,
        height: 30,
        borderRadius: 6,
        fontFamily: "'Atkinson Hyperlegible', sans-serif",
        fontWeight: 700,
        fontSize: '0.95rem',
        border: lit ? `2px solid ${C_GOLD}` : '1px solid rgba(255, 255, 255, 0.3)',
        color: lit ? '#ffffff' : C_DIM,
        background: lit ? 'rgba(255, 230, 0, 0.16)' : 'rgba(255, 255, 255, 0.06)',
        boxShadow: lit ? '0 0 8px rgba(255, 230, 0, 0.45)' : 'none',
      }}
    >
      {label}
    </span>
  )
}

/** 3×3 QWERTY cluster for one clash side. */
function KeyCluster({ label, keys, accent }: { label?: string; keys: string[]; accent: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
      {label && (
        <div style={{ color: accent, fontWeight: 900, fontSize: '0.82rem', fontFamily: 'var(--font-mono)', letterSpacing: '1px' }}>
          {label}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 30px)', gap: 5 }}>
        {keys.map((k, i) => <Keycap key={k} label={k} lit={i === 4} />)}
      </div>
    </div>
  )
}

/** Chunky fill bar, matching the live ClashOverlay Bar. */
function MeterBar({ pct, color, label }: { pct: number; color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          flex: 1, width: 140, height: 14, borderRadius: 7, overflow: 'hidden',
          background: 'rgba(255, 255, 255, 0.1)', border: '1px solid rgba(255, 255, 255, 0.28)',
        }}
      >
        <div
          style={{
            height: '100%', width: `${pct}%`, borderRadius: 7,
            background: color, boxShadow: `0 0 8px ${color}66`,
          }}
        />
      </div>
      <span style={{ fontSize: '0.72rem', color: C_DIM, fontFamily: 'var(--font-mono)', minWidth: 34, textAlign: 'right' }}>
        {label}
      </span>
    </div>
  )
}

// ─── Clash Mode page ─────────────────────────────────────────────────────────

/** One side of the scaled-down clash screen: avatar + name, character plate, keys, bar. */
function ClashSide({
  role, roleAccent, character, username, keys, pct,
}: {
  role: string
  roleAccent: string
  character: string
  username: string
  keys: string[]
  pct: number
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
      {/* user avatar + name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <UserAvatar username={username} size={30} hasAvatarPhoto={false} />
        <span style={{ color: C_TEXT, fontWeight: 900, fontSize: '0.9rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.5px' }}>
          {role}
        </span>
      </div>
      {/* character plate (like the live ClashOverlay Plate) */}
      <div
        style={{
          width: 92, height: 40, borderRadius: 10,
          background: character, boxShadow: `0 0 12px ${character}66`,
          display: 'grid', placeItems: 'center',
          color: '#12100a', fontWeight: 900, fontSize: '1.05rem', fontFamily: 'var(--font-mono)',
          letterSpacing: '0.1em',
        }}
      >
        {role.slice(0, 2).toUpperCase()}
      </div>
      <div style={{ color: roleAccent, fontWeight: 900, fontSize: '0.8rem', fontFamily: 'var(--font-mono)', letterSpacing: '1.5px' }}>
        {role}
      </div>
      <KeyCluster keys={keys} accent={roleAccent} />
      <MeterBar pct={pct} color={character} label={`${pct}%`} />
    </div>
  )
}

export function ClashModeDiagram() {
  const { t } = useTranslation()
  const steps = [
    { icon: '⚔️', label: t('game.rules.clashStepAttack') },
    { icon: '⏱️', label: t('game.rules.clashStepCountdown') },
    { icon: '⌨️', label: t('game.rules.clashStepMash') },
    { icon: '🏆', label: t('game.rules.clashStepResult') },
  ]
  const defenderKeys = ['Q', 'W', 'E', 'A', 'S', 'D', 'Z', 'X', 'C']
  const attackerKeys = ['U', 'I', 'O', 'H', 'J', 'K', 'B', 'N', 'M']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 4-step flow strip */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 88 }}>
              <span style={{ fontSize: '1.5rem' }}>{s.icon}</span>
              <span style={{ fontSize: '0.78rem', color: C_DIM, fontFamily: 'var(--font-mono)', textAlign: 'center', lineHeight: 1.3 }}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && <span style={{ color: C_DIM, fontSize: '1rem' }}>→</span>}
          </div>
        ))}
      </div>

      {/* scaled-down representation of the live clash screen */}
      <div
        style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
          gap: 14, flexWrap: 'wrap',
          background: 'rgba(0, 0, 0, 0.35)', border: '1px solid rgba(255, 255, 255, 0.14)',
          borderRadius: 10, padding: '14px 12px',
        }}
      >
        <ClashSide
          role={t('game.rules.clashDefenderLabel')}
          roleAccent={C_CYAN}
          character={C_YELLOW}
          username="defender"
          keys={defenderKeys}
          pct={72}
        />
        <div style={{ paddingTop: 34 }}>
          <span style={{ color: C_GOLD, fontWeight: 900, fontFamily: 'var(--font-mono)', fontSize: '0.9rem' }}>
            VS
          </span>
        </div>
        <ClashSide
          role={t('game.rules.clashAttackerLabel')}
          roleAccent={C_PINK}
          character={C_RED}
          username="attacker"
          keys={attackerKeys}
          pct={45}
        />
      </div>
    </div>
  )
}

// ─── No Safe Zones page ──────────────────────────────────────────────────────

/** Exact 15×15 board replicated from components/Board.tsx, at a small scale. */
export function SafeZonesDiagram() {
  const { t } = useTranslation()

  // Track geometry — same RED_SEGMENT + 90° rotation as Board.tsx.
  const RED_SEGMENT: Array<[number, number]> = [
    [6, 1], [6, 2], [6, 3], [6, 4], [6, 5], [5, 6], [4, 6],
    [3, 6], [2, 6], [1, 6], [0, 6], [0, 7], [0, 8],
  ]
  const rotate90 = (cell: [number, number]): [number, number] => [cell[1], 14 - cell[0]]
  const rotateN = (cell: [number, number], n: number): [number, number] => {
    let out = cell
    for (let i = 0; i < n; i++) out = rotate90(out)
    return out
  }
  const TRACK_CELLS: Array<[number, number]> = [0, 1, 2, 3].flatMap((rot) =>
    RED_SEGMENT.map((cell) => rotateN(cell, rot)),
  )
  const trackKey = new Set(TRACK_CELLS.map(([r, c]) => `${r},${c}`))
  // Backend SAFE_TRACK_POSITIONS — these are the star / safe-zone cells.
  const SAFE_TRACK_POSITIONS = [1, 9, 14, 22, 27, 35, 40, 48]
  const STAR_CELLS = new Set(
    SAFE_TRACK_POSITIONS.map((tp) => {
      const [r, c] = TRACK_CELLS[tp - 1]
      return `${r},${c}`
    }),
  )
  const START_CELLS = new Set(['6,1', '1,8', '8,13', '13,6'])

  const laneOf = (r: number, c: number): string | null => {
    if (r === 7 && c >= 1 && c <= 5) return '#ff5fa2' // red home lane
    if (c === 7 && r >= 1 && r <= 5) return '#4aff9e' // green home lane
    if (r === 7 && c >= 9 && c <= 13) return '#ffe600' // yellow home lane
    if (c === 7 && r >= 9 && r <= 13) return '#4aa8ff' // blue home lane
    return null
  }
  const yardOf = (r: number, c: number): string | null => {
    if (r <= 5 && c <= 5) return '#ff5fa2' // red yard
    if (r <= 5 && c >= 9) return '#4aff9e' // green yard
    if (r >= 9 && c >= 9) return '#ffe600' // yellow yard
    if (r >= 9 && c <= 5) return '#4aa8ff' // blue yard
    return null
  }
  const inCenter = (r: number, c: number) => r >= 6 && r <= 8 && c >= 6 && c <= 8

  const renderGrid = (off: boolean) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(15, 9px)',
        gridTemplateRows: 'repeat(15, 9px)',
        gap: 1, padding: 3,
        background: 'rgba(0, 0, 0, 0.4)',
        border: '1px solid rgba(255, 255, 255, 0.28)',
        borderRadius: 5,
      }}
    >
      {Array.from({ length: 225 }).map((_, idx) => {
        const r = Math.floor(idx / 15)
        const c = idx % 15
        const key = `${r},${c}`
        const isStar = STAR_CELLS.has(key)
        const isStart = START_CELLS.has(key)
        const lane = laneOf(r, c)
        const yard = yardOf(r, c)

        let bg = 'rgba(255, 255, 255, 0.07)'
        if (isStar) bg = off ? 'rgba(255, 0, 85, 0.16)' : 'rgba(255, 215, 0, 0.22)'
        else if (inCenter(r, c)) bg = 'rgba(0, 0, 0, 0.5)'
        else if (lane) bg = `${lane}44`
        else if (yard) bg = `${yard}22`

        const borderColor = isStar
          ? (off ? 'rgba(255, 0, 85, 0.65)' : 'rgba(255, 215, 0, 0.7)')
          : isStart
            ? 'rgba(255, 255, 255, 0.5)'
            : trackKey.has(key)
              ? 'rgba(255, 255, 255, 0.14)'
              : 'rgba(255, 255, 255, 0.05)'

        return (
          <div
            key={idx}
            style={{
              width: 9, height: 9, borderRadius: 1.5,
              background: bg,
              border: `1px solid ${borderColor}`,
              display: 'grid', placeItems: 'center',
              fontSize: '0.72rem', lineHeight: 1, fontWeight: 900,
              color: isStar ? (off ? '#ff4d6d' : '#ffd700') : 'transparent',
              textShadow: isStar
                ? (off ? '0 0 4px rgba(255, 77, 109, 0.9)' : '0 0 4px rgba(255, 215, 0, 0.9)')
                : 'none',
            }}
          >
            {isStar ? (off ? '✕' : '★') : ''}
          </div>
        )
      })}
    </div>
  )

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
      <span style={{ fontSize: '2rem', filter: 'drop-shadow(0 0 6px rgba(255, 230, 0, 0.5))' }}>🏃</span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 900, color: C_GOLD, letterSpacing: '0.5px' }}>
          {t('game.rules.noSafeOn')}
        </span>
        {renderGrid(false)}
      </div>
      <span style={{ fontSize: '1.3rem', color: C_DIM }}>→</span>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 900, color: C_PINK, letterSpacing: '0.5px' }}>
          {t('game.rules.noSafeOff')}
        </span>
        {renderGrid(true)}
      </div>
      <span style={{ fontSize: '2rem', filter: 'drop-shadow(0 0 6px rgba(255, 95, 162, 0.5))' }}>🏃</span>
    </div>
  )
}

// ─── Game Mods page ──────────────────────────────────────────────────────────

export function GameModsDiagram() {
  const { t } = useTranslation()
  const toggles = [
    {
      icon: '⚔️',
      title: t('game.rules.gameModsToggleClash'),
      desc: t('game.rules.gameModsToggleClashDesc'),
      on: true,
    },
    {
      icon: '🛡️',
      title: t('game.rules.gameModsToggleSafe'),
      desc: t('game.rules.gameModsToggleSafeDesc'),
      on: false,
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {toggles.map((tg, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            background: 'rgba(255, 255, 255, 0.05)',
            border: `1px solid ${tg.on ? 'rgba(0, 255, 136, 0.45)' : 'rgba(255, 255, 255, 0.18)'}`,
            borderRadius: 8, padding: '10px 12px',
          }}
        >
          <span style={{ fontSize: '1.3rem' }}>{tg.icon}</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ color: C_TEXT, fontWeight: 900, fontSize: '0.94rem', fontFamily: 'var(--font-mono)', letterSpacing: '0.5px' }}>
              {tg.title}
            </span>
            <span style={{ color: C_DIM, fontSize: '0.9rem', lineHeight: 1.4 }}>
              {tg.desc}
            </span>
          </div>
          {/* Mock Arena-Config checkbox */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 18, height: 18, borderRadius: 4,
                border: `2px solid ${tg.on ? 'var(--success)' : 'rgba(255, 255, 255, 0.4)'}`,
                background: tg.on ? 'rgba(0, 255, 136, 0.15)' : 'transparent',
                display: 'grid', placeItems: 'center',
                color: 'var(--success)', fontWeight: 900, fontSize: '0.75rem',
              }}
            >
              {tg.on ? '✓' : ''}
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', fontWeight: 900, color: tg.on ? '#00ff88' : C_DIM }}>
              {tg.on ? 'ON' : 'OFF'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}



