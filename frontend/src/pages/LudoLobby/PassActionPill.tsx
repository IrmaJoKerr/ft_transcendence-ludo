import type { CSSProperties } from 'react';
import { TICKET_ACTION_PILL } from '../../styles/tw';

interface PassActionPillProps {
  label: string;
  // Every label the three pills can show, in the active language.
  probes: string[];
  // The pill's tone: its border, ground and ink.
  className?: string;
  // A computed remainder the caller owns (the host pill dims itself while busy).
  style?: CSSProperties;
}

export function PassActionPill({ label, probes, className, style }: PassActionPillProps) {
  return (
    <div
      className={`${TICKET_ACTION_PILL} ${className ?? ''}`}
      style={{ display: 'inline-grid', placeItems: 'center', ...style }}
    >
      <span style={{ gridArea: '1 / 1' }}>{label}</span>
      {probes.map((probe) => (
        <span key={probe} aria-hidden="true" style={{ gridArea: '1 / 1', visibility: 'hidden' }}>
          {probe}
        </span>
      ))}
    </div>
  );
}
