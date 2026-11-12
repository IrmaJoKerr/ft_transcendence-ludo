import { OAUTH_BTN } from '../styles/tw';

const PROVIDERS = [
  { name: '42', icon: '/forty_two.png', path: '/api/auth/42' },
  { name: 'GitHub', icon: '/github.png', path: '/api/auth/github' },
  { name: 'Google', icon: '/google.png', path: '/api/auth/google' },
] as const;

/** Row of OAuth provider buttons (42 / GitHub / Google) shared by login and signup. */
export function OAuthButtons() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
      {PROVIDERS.map((p) => (
        <button
          key={p.name}
          onClick={() => {
            window.location.href = p.path;
          }}
          className={OAUTH_BTN}
        >
          <img src={p.icon} alt={p.name} style={{ width: 18, height: 18, objectFit: 'contain' }} />
          {p.name}
        </button>
      ))}
    </div>
  );
}

/** "OR" hairline divider used around the OAuth row. */
export function OrDivider({ text = 'OR' }: { text?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        color: '#7a6c56',
        fontSize: 12,
        letterSpacing: '.1em',
      }}
    >
      <span style={{ flex: 1, height: 1, background: '#3a2c1d' }} />
      {text}
      <span style={{ flex: 1, height: 1, background: '#3a2c1d' }} />
    </div>
  );
}
