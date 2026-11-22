// The three presence states the friends column can show.
export const STATUS_STYLE: Record<
  string,
  { label: string; color: string; border: string; bg: string }
> = {
  online: {
    label: 'Online',
    color: 'var(--state-on)',
    border: 'rgb(var(--state-on-rgb) / 0.4)',
    bg: 'rgb(var(--state-on-rgb) / 0.12)',
  },
  playing: {
    label: 'In Game',
    color: 'var(--accent-yellow)',
    border: 'rgb(var(--accent-yellow-rgb) / 0.4)',
    bg: 'rgb(var(--accent-yellow-rgb) / 0.12)',
  },
  offline: {
    label: 'Offline',
    color: '#7a889b',
    border: 'rgba(122, 136, 155, 0.3)',
    bg: 'rgba(122, 136, 155, 0.08)',
  },
};
