import { useEffect, useId, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { getApi, patchApi, postApi, translateErrorCode } from '../api';
import { passwordMeetsPolicy } from '../validatePassword';
import { isValidEmail } from '../validateEmail';
import { useApp } from '../store';
import { DeleteAccountModal } from './DeleteAccountModal';
import { PasswordInfo } from './PasswordInfo';
import { FieldError } from './FieldError';
import { RETRO_BTN } from '../styles/tw';

const OTP = { '42': '/forty_two.png', github: '/github.png', google: '/google.png' } as const;
const PROVIDERS = ['google', 'github', '42'] as const;

type Providers = string[];
interface ProfileResp {
  user?: {
    id: string;
    username: string;
    displayName?: string;
    email?: string | null;
    providers?: Providers;
    hasPassword?: boolean;
    emailVerified?: boolean;
    pendingEmail?: string | null;
    twoFactorEnabled?: boolean;
  };
  emailChangePending?: boolean;
  pendingEmail?: string | null;
  oauthRedirectUrl?: string;
  message?: string;
}

type ErrorField = 'displayName' | 'email' | 'password' | 'oauth' | 'form';

// Errors are held as locale keys, not translated strings: switching language
// then re-renders a live message instead of leaving the previous language on
// screen. All three keys exist in en, fr and ms.
type FieldMessage =
  | 'passwordInfo.error'
  | 'profileEdit.newPasswordRequired'
  | 'profileEdit.passwordMismatch'
  | null;

// Which field a backend error code belongs under.
const ERROR_FIELD: Record<string, ErrorField> = {
  AUTH_DISPLAY_NAME_RESERVED: 'displayName',
  AUTH_DISPLAY_NAME_TAKEN: 'displayName',
  AUTH_EMAIL_TAKEN: 'email',
  AUTH_EMAIL_CHANGE_SET_PASSWORD: 'email',
  AUTH_EMAIL_CHANGE_RATE_LIMITED: 'email',
  VALIDATION_EMAIL_FORMAT: 'email',
  NO_PENDING_EMAIL_CHANGE: 'email',
  AUTH_CURRENT_PASSWORD_INCORRECT: 'password',
  AUTH_KEEP_ONE_SIGNIN: 'oauth',
  AUTH_PROVIDER_LINKED: 'oauth',
  AUTH_PROVIDER_NOT_LINKED: 'oauth',
};

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

export function ProfileEditModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user, setUser } = useApp();

  const [username] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState('');
  // Baselines taken from the server, so "unchanged" is judged against what the
  // profile holds (the session user may be missing fields).
  const [initialEmail, setInitialEmail] = useState<string | null>(null);
  const [initialDisplayName, setInitialDisplayName] = useState<string | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  // Server value of the toggle; null until the profile load returns. Save only
  // sends the field when it differs, so a stale default cannot flip it off.
  const [initialTwoFactor, setInitialTwoFactor] = useState<boolean | null>(null);
  const [hasPassword, setHasPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Reserved slots under the two password fields: filled on save, cleared as
  // soon as that field is edited, so they never nag mid-typing.
  const [passwordFieldError, setPasswordFieldError] = useState<FieldMessage>(null);
  const [confirmFieldError, setConfirmFieldError] = useState<FieldMessage>(null);
  // The inputs point aria-describedby at these slots, so the message is tied to
  // the field it belongs to even while the slot is empty.
  const passwordErrorId = useId();
  const confirmErrorId = useId();
  const [providers, setProviders] = useState<Providers>([]);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [errorField, setErrorField] = useState<ErrorField>('form');
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [emailPassword, setEmailPassword] = useState('');

  // Error text rendered under the field it belongs to (falls back to the first field).
  const errorFor = (fields: ErrorField[]) =>
    error && fields.includes(errorField) ? (
      <div style={{ fontSize: '0.7rem', color: '#ff0055', margin: '-4px 0 10px' }}>{error}</div>
    ) : null;

  // Load the full profile (linked providers + email) on open.
  useEffect(() => {
    let cancelled = false;
    getApi<ProfileResp>('/api/auth/profile')
      .catch(() => null)
      .then((data) => {
        if (cancelled || !data?.user) return;
        const loadedName = data.user.displayName ?? data.user.username;
        const loadedEmail = data.user.email ?? '';
        setDisplayName(loadedName);
        setInitialDisplayName(loadedName);
        setEmail(loadedEmail);
        setInitialEmail(loadedEmail);
        setPendingEmail(data.user.pendingEmail ?? null);
        setProviders(data.user.providers ?? []);
        setHasPassword(!!data.user.hasPassword);
        setTwoFactorEnabled(!!data.user.twoFactorEnabled);
        setInitialTwoFactor(!!data.user.twoFactorEnabled);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // Judged against the loaded baseline (falling back to the session user). A user
  // object without `email` must not read as "address cleared, one typed since" :
  // that faked an email change and blocked unrelated saves such as the 2FA toggle.
  const emailBaseline = initialEmail ?? user?.email ?? null;
  const emailChanging = emailBaseline !== null && !!email.trim() && email.trim() !== emailBaseline;
  const displayNameBaseline = initialDisplayName ?? user?.displayName ?? user?.username ?? '';
  // Same judgement for the 2FA toggle: only an actual change counts.
  const twoFactorChanging = initialTwoFactor !== null && twoFactorEnabled !== initialTwoFactor;
  // Which password block an error belongs under: the change-password section
  // only when that flow is being attempted, otherwise the confirm field above.
  const passwordChangeAttempt = !!(currentPassword || newPassword || confirmPassword);

  const handleSave = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    const isPasswordChange = !!(currentPassword || newPassword || confirmPassword);
    const emailValue = email.trim();
    // Mirror the backend's @IsEmail() gate so a malformed address fails inline
    // (localized) instead of round-tripping to a 400. The server re-checks.
    if (emailValue && !isValidEmail(emailValue)) {
      setBusy(false);
      setErrorField('email');
      setError(t('profileEdit.emailInvalid'));
      return;
    }
    // Strict two-step: never change the password and the email in one save: the
    // email change relies on a password already being active.
    if (isPasswordChange && emailChanging) {
      setBusy(false);
      setErrorField('email');
      setError(t('profileEdit.emailChangeSeparateSave'));
      return;
    }
    const body: Record<string, unknown> = {};
    if (displayName.trim() && displayName.trim() !== displayNameBaseline)
      body.displayName = displayName.trim();
    if (emailChanging) {
      if (!hasPassword) {
        setBusy(false);
        setErrorField('email');
        setError(t('profileEdit.emailSetPasswordFirst'));
        return;
      }
      if (!emailPassword) {
        setBusy(false);
        setErrorField('email');
        setError(t('profileEdit.emailPasswordRequired'));
        return;
      }
      body.email = emailValue;
      body.currentPassword = emailPassword;
    }
    // Send the toggle only when it changed and the real value is known, so an
    // unrelated save cannot write a stale state over it. A password account confirms
    // the password once for whichever sensitive field this save touches.
    if (twoFactorChanging) {
      if (hasPassword && !emailPassword) {
        setBusy(false);
        setErrorField('password');
        setError(t('profileEdit.passwordConfirmRequired'));
        return;
      }
      body.twoFactorEnabled = twoFactorEnabled;
      if (hasPassword) body.currentPassword = emailPassword;
    }
    if (isPasswordChange) {
      const policyOk = passwordMeetsPolicy(newPassword);
      const matchOk = newPassword === confirmPassword;
      setPasswordFieldError(
        policyOk ? null : newPassword ? 'passwordInfo.error' : 'profileEdit.newPasswordRequired',
      );
      setConfirmFieldError(matchOk ? null : 'profileEdit.passwordMismatch');
      if (!policyOk || !matchOk) {
        setBusy(false);
        return;
      }
    }
    try {
      const data = await patchApi<ProfileResp>('/api/auth/profile', body);
      if (data.user) {
        setUser(data.user);
        setProviders(data.user.providers ?? []);
        // Trust the returned value and keep the baseline in step with it.
        if (data.user.twoFactorEnabled !== undefined) {
          setTwoFactorEnabled(data.user.twoFactorEnabled);
          setInitialTwoFactor(data.user.twoFactorEnabled);
        }
        // The email is NOT applied until confirmed: keep showing the current one.
        setEmail(data.user.email ?? '');
        setPendingEmail(data.user.pendingEmail ?? data.pendingEmail ?? null);
        // Re-baseline on what the server now holds, so the next save does not
        // resend a field the user left untouched.
        if (data.user.email !== undefined) setInitialEmail(data.user.email ?? '');
        if (data.user.displayName !== undefined) setInitialDisplayName(data.user.displayName);
      }
      if (data.emailChangePending) {
        setNotice(t('profileEdit.emailChangePending'));
        setEmailPassword('');
      }
      if (isPasswordChange) {
        const pwBody: Record<string, string> = { newPassword };
        if (hasPassword) pwBody.currentPassword = currentPassword;
        const pwResp = await patchApi<{ code?: string; message?: string }>(
          '/api/auth/profile/password',
          pwBody,
        );
        const notice = translateErrorCode(pwResp.code);
        if (notice) setNotice(notice);
        // Password change keeps the CURRENT session alive: stay signed in.
        setHasPassword(true);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        return;
      }
      // Clear password fields after a successful non-password save.
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setEmailPassword('');
    } catch (e) {
      const err = e as { code?: string; message?: string } | null | undefined;
      // `request()` (api.ts) already localizes a coded error into `message`, so
      // prefer the code map, then the message, then a generic fallback.
      setErrorField(ERROR_FIELD[err?.code ?? ''] ?? 'form');
      setError(translateErrorCode(err?.code) ?? err?.message ?? t('profileEdit.genericError'));
    } finally {
      setBusy(false);
    }
  };

  // Resend the pending email-change confirmation link.
  const resendEmailChange = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await postApi<{ pendingEmail?: string }>(
        '/api/auth/profile/resend-email-change',
        {},
      );
      if (data.pendingEmail) setPendingEmail(data.pendingEmail);
      setNotice(t('profileEdit.emailResent'));
    } catch (e) {
      const err = e as { code?: string; message?: string } | null | undefined;
      setErrorField('email');
      setError(translateErrorCode(err?.code) ?? err?.message ?? t('profileEdit.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const addOAuth = (provider: string) => {
    // Open the provider login directly in a new tab (same as the login page).
    // The oauth-link `state` is auto-signed by the guard from the session cookie.
    window.open(`/api/auth/${provider}`, '_blank');
  };

  const removeOAuth = async (provider: string) => {
    if (hasPassword && !emailPassword) {
      setErrorField('oauth');
      setError(t('profileEdit.passwordConfirmRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await patchApi<ProfileResp>('/api/auth/profile', {
        oauthToRemove: provider,
        ...(hasPassword ? { currentPassword: emailPassword } : {}),
      });
      setProviders((p) => p.filter((x) => x !== provider));
    } catch (e) {
      const err = e as { code?: string; message?: string } | null | undefined;
      setErrorField('oauth');
      setError(translateErrorCode(err?.code) ?? err?.message ?? t('profileEdit.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const overlay: CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgba(5,2,18,0.72)',
    backdropFilter: 'blur(4px)',
  };
  const panel: CSSProperties = {
    width: 'min(92vw, 560px)',
    // Taller than the old 94vh: the password section now keeps a two-line
    // error slot under each input, so the panel needs ~70px more room before
    // it starts scrolling.
    maxHeight: 'calc(100vh - 16px)',
    overflowY: 'auto',
    borderRadius: 10,
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    boxShadow: 'var(--box-shadow)',
    padding: 22,
  };

  return (
    <div
      style={overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={panel}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontWeight: 900,
              fontSize: '0.95rem',
              fontFamily: 'var(--font-display)',
              color: 'var(--text-main)',
            }}
          >
            {t('profileEdit.title')}
          </div>
          <button
            className={RETRO_BTN}
            onClick={onClose}
            style={{ padding: '3px 9px', fontSize: '0.66rem', color: 'var(--text-muted)' }}
          >
            {t('common.close')}
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          <label style={fieldLabel({ color: 'var(--text-muted)' })}>
            {t('profileEdit.username')}
          </label>
          <input
            style={{
              ...inputStyle(),
              background: 'rgba(0,0,0,0.25)',
              color: 'var(--text-muted)',
              cursor: 'not-allowed',
            }}
            value={username}
            readOnly
            disabled
          />
          <div
            style={{
              fontSize: '0.64rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            {t('profileEdit.usernameLocked')}
          </div>

          <label style={fieldLabel({ color: 'var(--text-muted)' })}>
            {t('profileEdit.displayName')}
          </label>
          <input
            style={inputStyle()}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={t('profileEdit.displayNamePlaceholder')}
          />
          {errorFor(['displayName', 'form'])}

          <label style={fieldLabel({ color: 'var(--text-muted)' })}>{t('profileEdit.email')}</label>
          <input
            style={inputStyle()}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('profileEdit.emailPlaceholder')}
          />
          {hasPassword && (
            <>
              <label style={fieldLabel({ color: 'var(--text-muted)' })}>
                {t('profileEdit.currentPassword')}
              </label>
              <input
                style={inputStyle()}
                type="password"
                value={emailPassword}
                onChange={(e) => setEmailPassword(e.target.value)}
                placeholder={t('profileEdit.currentPasswordPlaceholder')}
                autoComplete="current-password"
              />
              <div
                style={{
                  fontSize: '0.64rem',
                  color: 'var(--text-muted)',
                  margin: '-6px 0 12px',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t('profileEdit.passwordConfirmRequired')}
              </div>
              {!passwordChangeAttempt && errorFor(['password'])}
            </>
          )}
          {emailChanging && !hasPassword && (
            <div
              style={{
                fontSize: '0.64rem',
                color: '#ff0055',
                marginBottom: 12,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {t('profileEdit.emailSetPasswordFirst')}
            </div>
          )}
          {pendingEmail && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span
                style={{
                  flex: 1,
                  fontSize: '0.66rem',
                  color: 'var(--accent-cyan)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {t('profileEdit.emailChangePendingTo', { email: pendingEmail })}
              </span>
              <button
                type="button"
                className={RETRO_BTN}
                disabled={busy}
                onClick={() => void resendEmailChange()}
                style={{ padding: '2px 8px', fontSize: '0.62rem', color: 'var(--accent-cyan)' }}
              >
                {t('profileEdit.resend')}
              </button>
            </div>
          )}
          {errorFor(['email'])}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  fontFamily: 'var(--font-display)',
                  color: 'var(--text-main)',
                }}
              >
                {t('profileEdit.twoFactor')}
              </div>
              <div style={{ fontSize: '0.66rem', color: 'var(--text-muted)' }}>
                {t('profileEdit.twoFactorDesc')}
              </div>
            </div>
            <button
              className={RETRO_BTN}
              type="button"
              onClick={() => setTwoFactorEnabled((v) => !v)}
              style={{ padding: '2px 9px', fontSize: '0.66rem', color: 'var(--accent-cyan)' }}
            >
              {twoFactorEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          <div
            style={{ borderTop: '1px solid var(--border-color)', margin: '10px 0', paddingTop: 10 }}
          >
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 900,
                fontFamily: 'var(--font-display)',
                color: 'var(--text-main)',
                marginBottom: 8,
              }}
            >
              {hasPassword ? t('profileEdit.password') : t('profileEdit.passwordSet')}
            </div>
            {hasPassword && (
              <>
                <label style={fieldLabel({ color: 'var(--text-muted)' })}>
                  {t('profileEdit.currentPassword')}
                </label>
                <input
                  style={inputStyle()}
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder={t('profileEdit.currentPasswordPlaceholder')}
                />
              </>
            )}
            <label
              style={{
                ...fieldLabel({ color: 'var(--text-muted)' }),
                display: 'flex',
                alignItems: 'center',
                position: 'relative',
              }}
            >
              <span>{t('profileEdit.newPassword')}</span>
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
              aria-invalid={passwordFieldError !== null}
              aria-describedby={passwordErrorId}
            />
            <FieldError
              id={passwordErrorId}
              message={passwordFieldError ? t(passwordFieldError) : null}
            />
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
              aria-invalid={confirmFieldError !== null}
              aria-describedby={confirmErrorId}
            />
            <FieldError
              id={confirmErrorId}
              message={confirmFieldError ? t(confirmFieldError) : null}
            />
            {passwordChangeAttempt && errorFor(['password'])}
          </div>

          <div
            style={{ borderTop: '1px solid var(--border-color)', margin: '10px 0', paddingTop: 10 }}
          >
            <div
              style={{
                fontSize: '0.8rem',
                fontWeight: 900,
                fontFamily: 'var(--font-display)',
                color: 'var(--text-main)',
                marginBottom: 8,
              }}
            >
              {t('profileEdit.oauthMethods')}
            </div>
            {PROVIDERS.map((p) => {
              const linked = providers.includes(p);
              return (
                <div
                  key={p}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}
                >
                  <img src={OTP[p]} alt={p} style={{ width: 18, height: 18 }} />
                  <span
                    style={{
                      flex: 1,
                      fontSize: '0.72rem',
                      color: 'var(--text-main)',
                      fontFamily: 'var(--font-display)',
                      textTransform: 'capitalize',
                    }}
                  >
                    {p === '42' ? '42' : p}
                  </span>
                  <span
                    style={{
                      fontSize: '0.62rem',
                      color: linked ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    }}
                  >
                    {linked ? t('profileEdit.linked') : t('profileEdit.notLinked')}
                  </span>
                  <button
                    className={RETRO_BTN}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (linked) void removeOAuth(p);
                      else addOAuth(p);
                    }}
                    style={{
                      padding: '2px 8px',
                      fontSize: '0.62rem',
                      color: linked ? '#ff0055' : 'var(--accent-cyan)',
                    }}
                  >
                    {linked ? t('profileEdit.remove') : t('profileEdit.add')}
                  </button>
                </div>
              );
            })}
            {errorFor(['oauth'])}
          </div>

          {notice && (
            <div style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)', margin: '4px 0 8px' }}>
              {notice}
            </div>
          )}
          <button
            className={RETRO_BTN}
            type="submit"
            disabled={busy}
            style={{ width: '100%', padding: '10px', fontSize: '0.8rem', fontWeight: 900 }}
          >
            {busy ? t('profileEdit.saving') : t('profileEdit.save')}
          </button>
        </form>

        <button
          className={RETRO_BTN}
          type="button"
          disabled={busy}
          onClick={() => setDeleteOpen(true)}
          style={{
            width: '100%',
            padding: '10px',
            fontSize: '0.8rem',
            fontWeight: 900,
            color: 'var(--accent-cyan)',
            marginTop: 8,
          }}
        >
          {t('profileEdit.deleteAccountBtn')}
        </button>

        {deleteOpen && (
          <DeleteAccountModal onClose={() => setDeleteOpen(false)} hasPassword={hasPassword} />
        )}
      </div>
    </div>
  );
}
