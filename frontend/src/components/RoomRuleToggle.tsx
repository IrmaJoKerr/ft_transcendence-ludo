import type { CSSProperties } from 'react';
import { retroAudio } from '../utils/audio';

// One room-rule row: icon, label, description and switch. The caller owns the order,
// so the create and in-game panels can keep the same reading order without a mapped
// array. The toggle reuses the seat add/remove blips: 520 Hz on, 320 Hz off, both 0.05 s.
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
  background: 'rgb(var(--shade-rgb) / 0.4)',
};

const TEXT: CSSProperties = { display: 'flex', flexDirection: 'column', lineHeight: 1.3 };

const DESC: CSSProperties = { fontSize: '0.62rem', color: 'var(--text-muted)' };

// One room-rule row: glyph, label, description and the on/off switch.
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
