import type { CSSProperties } from 'react';

// The chat card's shell, shared by the room overlay, lobby card and INVITE COMMS panel.
// It uses the account popover's translucent panel, cyan edge and glow because none of
// the surfaces has a scrim. Layout and position stay with each consumer.
export const CHAT_SURFACE: CSSProperties = {
  background: 'linear-gradient(180deg, rgb(var(--bg-raise-rgb) / 0.97), rgb(var(--bg-panel-rgb) / 0.985))',
  backdropFilter: 'blur(24px) saturate(180%)',
  border: '1px solid rgb(var(--accent-cyan-rgb) / 0.45)',
  boxShadow: '0 24px 60px rgb(var(--shade-rgb) / 0.85), 0 0 24px rgb(var(--accent-cyan-rgb) / 0.22)',
  borderRadius: 10,
  padding: 14,
  gap: 10,
  boxSizing: 'border-box',
};
