import { useTranslation } from 'react-i18next';
import { useUsernameCopy } from './useUsernameCopy';

export function UsernameCopyChip({ username }: { username: string }) {
  const { t } = useTranslation();
  const { copied, copyUsername } = useUsernameCopy(username);

  return (
    <button
      type="button"
      onClick={copyUsername}
      title={t('profile.copyUsernameTooltip')}
      style={{
        background: 'rgb(var(--shade-rgb) / 0.45)',
        border: '1px solid rgb(var(--accent-cyan-rgb) / 0.45)',
        borderRadius: 4,
        padding: '2px 7px',
        margin: 0,
        cursor: 'pointer',
        color: 'var(--text-muted)',
        fontSize: '0.68rem',
        fontFamily: 'var(--font-display)',
        letterSpacing: '0.04em',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        lineHeight: 1.2,
      }}
    >
      @{username}
      <span style={{ color: copied ? 'var(--state-on)' : 'var(--accent-cyan)', fontWeight: 900 }}>
        [{copied ? t('profile.usernameCopiedOk') : t('profile.usernameCopy')}]
      </span>
    </button>
  );
}
