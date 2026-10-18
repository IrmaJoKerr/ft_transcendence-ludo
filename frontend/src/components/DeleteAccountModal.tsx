import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteApi, patchApi } from '../api';
import { passwordMeetsPolicy } from '../validatePassword';
import { FieldError } from './FieldError';
import { PasswordInfo } from './PasswordInfo';
import { useApp } from '../store';
import { navigate } from '../router';
import { RETRO_BTN } from '../styles/tw';

type Step = 'confirm' | 'setPassword';

function fieldLabel(style: CSSProperties): CSSProperties {
  return {
    ...style,
    display: 'block',
    fontSize: '0.72rem',
    fontWeight: 700,
    marginBottom: 4,
    fontFamily: 'var(--font-display)',
  };
}
function inputStyle(): CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '7px 9px',
    marginBottom: 12,
    borderRadius: 4,
    background: 'rgba(0,0,0,0.4)',
    color: 'var(--text-main)',
    border: '1px solid var(--border-color)',
    outline: 'none',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
  };
}

//Account deletion: OAuth-only accounts set a password first, then confirm with it.
export function DeleteAccountModal({
  onClose,
  hasPassword,
}: {
  onClose: () => void;
  hasPassword: boolean;
}) {
  const { t } = useTranslation();
  const { logout } = useApp();

  const [step, setStep] = useState<Step>(hasPassword ? 'confirm' : 'setPassword');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Reserved slots under the two password fields: filled on submit, cleared as
  // soon as that field is edited, so they never nag mid-typing.
  const [passwordFieldError, setPasswordFieldError] = useState<string | null>(null);
  const [confirmFieldError, setConfirmFieldError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const overlay: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(5,2,18,0.72)',
    backdropFilter: 'blur(4px)',
  };
  const panel: CSSProperties = {
    width: 'min(92vw, 560px)',
    maxHeight: '88vh',
    overflowY: 'auto',
    borderRadius: 10,
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    padding: '20px 24px',
  };

  const handleSetPassword = async () => {
    setBusy(true);
    setError('');
    const policyOk = passwordMeetsPolicy(newPassword);
    const matchOk = newPassword === confirmPassword;
    setPasswordFieldError(
      policyOk ? null : newPassword ? t('passwordInfo.error') : t('profileEdit.newPasswordRequired'),
    );
    setConfirmFieldError(matchOk ? null : t('profileEdit.passwordMismatch'));
    if (!policyOk || !matchOk) {
      setBusy(false);
      return;
    }
    try {
      await patchApi('/api/auth/profile/password', { newPassword });
      setStep('confirm');
    } catch (e) {
      setError(
        (e as { message?: string } | null | undefined)?.message ?? t('profileEdit.genericError'),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!acknowledge) {
      setError(t('profileEdit.deleteAccountAcknowledge'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await deleteApi('/api/auth/profile', { currentPassword, confirm: true });
      await logout();
      navigate('/login');
    } catch (e) {
      setError(
        (e as { message?: string } | null | undefined)?.message ?? t('profileEdit.genericError'),
      );
      setBusy(false);
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={panel} onClick={(e) => e.stopPropagation()}>
        <div
          style={{
            fontSize: '0.9rem',
            fontWeight: 900,
            fontFamily: 'var(--font-display)',
            color: '#ff0055',
            marginBottom: 10,
          }}
        >
          {t('profileEdit.deleteAccountTitle')}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (step === 'setPassword') void handleSetPassword();
            else void handleDelete();
          }}
        >
          {step === 'setPassword' ? (
            <>
              <div
                style={{
                  fontSize: '0.74rem',
                  color: 'var(--text-main)',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 1.6,
                  marginBottom: 12,
                }}
              >
                {t('profileEdit.deleteAccountNeedPassword')}
              </div>
              <label
                style={{
                  ...fieldLabel({ color: 'var(--text-muted)' }),
                  display: 'flex',
                  alignItems: 'center',
                  position: 'relative',
                }}
              >
                <span>{t('profileEdit.deleteAccountSetPasswordLabel')}</span>
                <PasswordInfo />
              </label>
              <input
                style={{ ...inputStyle(), marginBottom: 0 }}
                type="password"
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setPasswordFieldError(null);
                  // The pair changed, so a mismatch note is stale too.
                  setConfirmFieldError(null);
                }}
                placeholder={t('profileEdit.newPasswordPlaceholder')}
                autoComplete="new-password"
              />
              <FieldError message={passwordFieldError} />
              <label style={fieldLabel({ color: 'var(--text-muted)' })}>
                {t('profileEdit.confirmPassword')}
              </label>
              <input
                style={{ ...inputStyle(), marginBottom: 0 }}
                type="password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setConfirmFieldError(null);
                }}
                placeholder={t('profileEdit.confirmPasswordPlaceholder')}
                autoComplete="new-password"
              />
              <FieldError message={confirmFieldError} />
              <div
                style={{
                  fontSize: '0.64rem',
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 1.5,
                  marginBottom: 8,
                }}
              >
                {t('profileEdit.deleteAccountSetPasswordDesc')}
              </div>
              {error && (
                <div style={{ fontSize: '0.7rem', color: '#ff0055', margin: '4px 0 8px' }}>
                  {error}
                </div>
              )}
              <button
                className={RETRO_BTN}
                type="submit"
                disabled={busy}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '0.8rem',
                  fontWeight: 900,
                  marginTop: 6,
                }}
              >
                {busy ? t('profileEdit.saving') : t('profileEdit.deleteAccountSetPasswordBtn')}
              </button>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: '0.74rem',
                  color: '#ff8c8c',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: 1.6,
                  marginBottom: 12,
                }}
              >
                {t('profileEdit.deleteAccountWarning')}
              </div>
              <label style={fieldLabel({ color: 'var(--text-muted)' })}>
                {t('profileEdit.deleteAccountPasswordLabel')}
              </label>
              <input
                style={inputStyle()}
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('profileEdit.deleteAccountPasswordPlaceholder')}
                autoComplete="current-password"
              />
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: '0.7rem',
                  color: 'var(--text-main)',
                  marginBottom: 12,
                }}
              >
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                />
                {t('profileEdit.deleteAccountAcknowledge')}
              </label>
              {error && (
                <div style={{ fontSize: '0.7rem', color: '#ff0055', margin: '4px 0 8px' }}>
                  {error}
                </div>
              )}
              <button
                className={RETRO_BTN}
                type="submit"
                disabled={busy || !acknowledge || !currentPassword}
                style={{
                  width: '100%',
                  padding: '10px',
                  fontSize: '0.8rem',
                  fontWeight: 900,
                  color: 'var(--accent-cyan)',
                  marginTop: 6,
                }}
              >
                {busy ? t('profileEdit.saving') : t('profileEdit.deleteAccountDeleteBtn')}
              </button>
            </>
          )}
        </form>

        <button
          className={RETRO_BTN}
          type="button"
          disabled={busy}
          onClick={onClose}
          style={{
            width: '100%',
            padding: '8px',
            fontSize: '0.72rem',
            marginTop: 8,
            color: 'var(--text-muted)',
          }}
        >
          {t('profileEdit.deleteAccountCancel')}
        </button>
      </div>
    </div>
  );
}
