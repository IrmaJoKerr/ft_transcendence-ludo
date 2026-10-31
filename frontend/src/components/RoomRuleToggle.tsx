import type { CSSProperties } from 'react';
import { retroAudio } from '../utils/audio';

// One room-rule row of the create screen's rules panel and of the host's in-game
// one. The caller owns the ORDER, so a panel writes its rules in reading order
// instead of hiding them inside a mapped array: clash, the mid-clash key shift it
// owns, free exit, then no safe zones (the hardest, so it goes last).
const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: '0.78rem',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-main)',
  cursor: 'pointer',
  border: '1px solid var(--border-color)',
  borderRadius: 4,
  padding: '7px 10px',
  background: 'rgba(0, 0, 0, 0.4)',
};

const TEXT: CSSProperties = { display: 'flex', flexDirection: 'column', lineHeight: 1.3 };

const DESC: CSSProperties = { fontSize: '0.62rem', color: 'var(--text-muted)' };

/** One room-rule row: glyph, label, description and the on/off switch. */
export function RoomRuleToggle({
  icon,
  label,
  desc,
  checked,
  accent,
  onToggle,
}: {
  icon: string;
  label: string;
  desc: string;
  checked: boolean;
  accent: string;
  onToggle: (next: boolean) => void;
}) {
  return (
    <label style={ROW}>
      <span style={TEXT}>
        <span>
          {icon} {label}
        </span>
        <span style={DESC}>{desc}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          // The rule toggles reuse the seat add/remove sounds: on reads as a seat
          // added (520 Hz), off as a seat removed (320 Hz), both at the same
          // 0.05 s blip.
          retroAudio.playUiBeep(e.target.checked ? 520 : 320, 0.05);
          onToggle(e.target.checked);
        }}
        style={{
          accentColor: accent,
          width: 15,
          height: 15,
          cursor: 'pointer',
        }}
      />
    </label>
  );
}
