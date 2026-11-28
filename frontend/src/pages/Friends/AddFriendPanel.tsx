import { useTranslation } from 'react-i18next';
import { RETRO_BTN } from '../../styles/tw';
import type { FriendMessage } from './friendTypes';

export function AddFriendPanel({
  searchUsername,
  onSearch,
  onAdd,
  msg,
}: {
  searchUsername: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
  msg: FriendMessage | null;
}) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        background: 'rgb(var(--bg-primary-rgb) / 0.92)',
        border: '1.5px solid var(--accent-cyan)',
        boxShadow: '0 0 16px rgb(var(--accent-cyan-rgb) / 0.15)',
        borderRadius: 8,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          fontSize: '0.82rem',
          color: 'var(--accent-cyan)',
          fontFamily: 'var(--font-display)',
          fontWeight: 900,
          letterSpacing: '1px',
        }}
      >
        {t('friends.addFriendTitle')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input
          value={searchUsername}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t('friends.enterUsernamePrompt')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onAdd();
          }}
          style={{
            background: 'rgba(5, 2, 18, 0.95)',
            border: '1.5px solid rgb(var(--accent-cyan-rgb) / 0.45)',
            borderRadius: 4,
            color: 'var(--text-main)',
            padding: '10px 12px',
            fontSize: '0.85rem',
            fontFamily: 'var(--font-display)',
            letterSpacing: '0.04em',
          }}
        />
        <button
          className={RETRO_BTN}
          onClick={() => {
            void onAdd();
          }}
          style={{
            padding: '9px 16px',
            fontSize: '0.78rem',
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            background: 'rgb(var(--accent-cyan-rgb) / 0.22)',
            color: 'var(--text-main)',
            borderColor: 'var(--accent-cyan)',
            boxShadow: '0 0 12px rgb(var(--accent-cyan-rgb) / 0.3)',
            borderRadius: 4,
          }}
        >
          {t('friends.sendFriendRequestBtn')}
        </button>
      </div>

      {msg && (
        <div
          style={{
            padding: '8px 12px',
            borderRadius: 4,
            background:
              msg.type === 'error'
                ? 'rgb(var(--state-off-rgb) / 0.16)'
                : 'rgb(var(--state-on-rgb) / 0.16)',
            border: `1px solid ${msg.type === 'error' ? 'var(--state-off)' : 'var(--state-on)'}`,
            color: msg.type === 'error' ? 'var(--state-off)' : 'var(--state-on)',
            fontSize: '0.74rem',
            fontFamily: 'var(--font-display)',
            fontWeight: 'bold',
          }}
        >
          {msg.type === 'error' ? '✕ ' : '✓ '}
          {msg.text}
        </div>
      )}
    </div>
  );
}
