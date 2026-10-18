import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RetroAuthLayout } from '../components/RetroAuthLayout';
import { PasswordInfo } from '../components/PasswordInfo';
import { FieldError } from '../components/FieldError';
import { navigate } from '../router';
import { useApp } from '../store';
import { passwordMeetsPolicy } from '../validatePassword';
import '../styles/retrowave.css';
import {
  RETRO_AUTH_BTN,
  RETRO_AUTH_ERROR,
  RETRO_AUTH_INPUT,
  RETRO_AUTH_LABEL,
  RETRO_AUTH_LINK,
  RETRO_AUTH_MUTED,
  RETRO_AUTH_SUBTITLE,
  RETRO_AUTH_TITLE,
} from '../styles/tw';

/**
 * Reset step 2 for an emailed link: `/reset-password#token=<resetToken>`. The
 * token is in the URL fragment, which the browser never sends, so it cannot
 * reach a log. See docs/frontend/frontend-auth-extras-module.md.
 */
export function ResetPassword() {
  const { t } = useTranslation();
  const { resetPassword } = useApp();
  // Read the fragment once, on the first render. The effect below strips it from
  // the URL, and keeping the token in state lets a retry after a failed submit
  // work without a second email. An empty token means the link carried none.
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? '',
  );
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Field-level slots: filled on submit, cleared as soon as that field is
  // edited, so the red text never nags while someone is still typing.
  const [passwordFieldError, setPasswordFieldError] = useState<string | null>(null);
  const [confirmFieldError, setConfirmFieldError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // Strip the fragment before anything can use the URL, so the token cannot
    // stay in browser history or be replayed by a later navigation.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  // A link with no token is unusable: send them to request a fresh one.
  if (!token) {
    return (
      <RetroAuthLayout tag={t('auth.linkProblemTag')}>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className={RETRO_AUTH_TITLE} style={{ fontSize: 24 }}>
            {t('auth.invalidLinkTitle')}
          </div>
          <div className={RETRO_AUTH_MUTED} style={{ lineHeight: 1.5, fontSize: '14px' }}>
            {t('auth.invalidLinkDesc')}
          </div>
          <div className={RETRO_AUTH_MUTED} style={{ fontSize: '13px' }}>
            <a
              onClick={() => {
                navigate('/forgot-password');
              }}
              className={RETRO_AUTH_LINK}
            >
              {t('auth.requestNewLinkBtn')}
            </a>
          </div>
        </div>
      </RetroAuthLayout>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const policyOk = passwordMeetsPolicy(password);
    const matchOk = password === confirm;
    setPasswordFieldError(policyOk ? null : t('passwordInfo.error'));
    setConfirmFieldError(matchOk ? null : t('auth.passwordMismatch'));
    if (!policyOk || !matchOk) return;
    setSubmitting(true);
    setError(null);
    const err = await resetPassword(token, password);
    setSubmitting(false);
    if (err) setError(err);
    else navigate('/login?reset=1');
  }

  return (
    <RetroAuthLayout tag={t('auth.chooseNewPasswordTag')}>
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <div>
          <div className={RETRO_AUTH_TITLE} style={{ fontSize: 24 }}>
            {t('auth.newPasswordTitle')}
          </div>
          <div className={RETRO_AUTH_SUBTITLE}>{t('auth.newPasswordDesc')}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div
            className={RETRO_AUTH_LABEL}
            style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
          >
            <span>{t('auth.newPasswordLabel')}</span>
            <PasswordInfo />
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordFieldError(null);
              // The pair changed, so a mismatch note is stale too.
              setConfirmFieldError(null);
            }}
            placeholder={t('auth.passwordPlaceholderSignup')}
            autoComplete="new-password"
            autoFocus
            className={RETRO_AUTH_INPUT}
          />
          <FieldError message={passwordFieldError} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div className={RETRO_AUTH_LABEL}>{t('auth.confirmPasswordLabel')}</div>
          <input
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setConfirmFieldError(null);
            }}
            placeholder="••••••••"
            autoComplete="new-password"
            className={RETRO_AUTH_INPUT}
          />
          <FieldError message={confirmFieldError} />
        </div>
        {error && <div className={RETRO_AUTH_ERROR}>{error}</div>}
        <button type="submit" disabled={submitting} className={RETRO_AUTH_BTN}>
          {submitting ? t('auth.savingBtn') : t('auth.updatePasswordBtn')}
        </button>
      </form>
    </RetroAuthLayout>
  );
}
