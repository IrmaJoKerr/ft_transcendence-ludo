import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RetroAuthLayout, NeonCheck } from '../components/RetroAuthLayout';
import { LegalModal } from '../components/LegalModal';
import { PasswordInfo } from '../components/PasswordInfo';
import { FieldError } from '../components/FieldError';
import { navigate } from '../router';
import { useApp } from '../store';
import { passwordMeetsPolicy } from '../validatePassword';
import { isValidEmail } from '../validateEmail';
import '../styles/retrowave.css';
import {
  RETRO_AUTH_BTN,
  RETRO_AUTH_BTN_OUTLINE,
  RETRO_AUTH_DIVIDER,
  RETRO_AUTH_DIVIDER_LINE,
  RETRO_AUTH_ERROR,
  RETRO_AUTH_INPUT,
  RETRO_AUTH_LABEL,
  RETRO_AUTH_LINK,
  RETRO_AUTH_MUTED,
  RETRO_AUTH_SUBTITLE,
  RETRO_AUTH_TITLE,
} from '../styles/tw';

// Errors are held as locale keys, not translated strings: switching language
// then re-renders a live message instead of leaving the previous language on
// screen. Both keys exist in en, fr and ms.
type FieldMessage = 'passwordInfo.error' | 'auth.passwordMismatch' | null;

export function Signup() {
  const { t } = useTranslation();
  const { register } = useApp();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Field-level slots: filled on submit, cleared as soon as that field is
  // edited, so the red text never nags while someone is still typing.
  const [passwordFieldError, setPasswordFieldError] = useState<FieldMessage>(null);
  const [confirmFieldError, setConfirmFieldError] = useState<FieldMessage>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [assigned, setAssigned] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [legalOpen, setLegalOpen] = useState(false);
  // The inputs point aria-describedby at these slots, so the message is tied to
  // the field it belongs to even while the slot is empty.
  const passwordErrorId = useId();
  const confirmErrorId = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    // Mirror the backend's @IsEmail() rule (RegisterDto) so a malformed address
    // fails inline (localized) instead of round-tripping to a 400. The server
    // still re-checks.
    if (!isValidEmail(email.trim())) {
      setError(t('errors.VALIDATION_EMAIL_FORMAT'));
      return;
    }
    // Mirror the backend rule (RegisterDto) so weak passwords fail instantly
    // rather than round-tripping to a 400. The server still re-checks. Each
    // message gets its own slot under the field; the form-level box below
    // stays for the email, the checkbox and server errors.
    const policyOk = passwordMeetsPolicy(password);
    const matchOk = password === confirm;
    setPasswordFieldError(policyOk ? null : 'passwordInfo.error');
    setConfirmFieldError(matchOk ? null : 'auth.passwordMismatch');
    if (!policyOk || !matchOk) return;
    if (!agreed) {
      setError(t('auth.agreeRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await register(username, password, email.trim());
    setSubmitting(false);
    if (result.error) setError(result.error);
    else {
      setAssigned(result.username ?? '');
      setSent(true); // no session yet: the account activates via the emailed link
    }
  }

  if (sent) {
    return (
      <RetroAuthLayout tag={t('auth.oneMoreStep')}>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className={RETRO_AUTH_TITLE} style={{ fontSize: 24 }}>
            {t('auth.checkInboxTitle')}
          </div>
          <div className={RETRO_AUTH_MUTED} style={{ lineHeight: 1.5, fontSize: '14px' }}>
            {t('auth.verificationSentPrefix')} <b style={{ color: '#00f0ff' }}>{email}</b>.{' '}
            {t('auth.verificationSentSuffix')}
          </div>
          {assigned && (
            <div className={RETRO_AUTH_MUTED} style={{ lineHeight: 1.5, fontSize: '14px' }}>
              {t('auth.assignedUsernamePrefix')} <b style={{ color: '#00f0ff' }}>{assigned}</b>
            </div>
          )}
          <div className={RETRO_AUTH_MUTED} style={{ fontSize: '13px' }}>
            {t('auth.doneVerifying')}{' '}
            <a
              onClick={() => {
                navigate('/login');
              }}
              className={RETRO_AUTH_LINK}
            >
              {t('auth.signInLink')}
            </a>
          </div>
        </div>
      </RetroAuthLayout>
    );
  }

  return (
    <RetroAuthLayout tag={t('auth.signupTag')}>
      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}
      >
        <div>
          <div className={RETRO_AUTH_TITLE} style={{ fontSize: 24 }}>
            {t('auth.createSeatTitle')}
          </div>
          <div className={RETRO_AUTH_SUBTITLE}>{t('auth.claimSeatDesc')}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className={RETRO_AUTH_LABEL}>{t('auth.usernameLabel')}</div>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t('auth.usernamePlaceholder')}
            autoComplete="username"
            className={RETRO_AUTH_INPUT}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className={RETRO_AUTH_LABEL}>{t('auth.emailLabel')}</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('auth.emailPlaceholderSignup')}
            autoComplete="email"
            required
            className={RETRO_AUTH_INPUT}
          />
        </div>
        {/* Full width, one below the other: half of the card is too narrow for
            the longest localized policy message to fit its reserved lines. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              className={RETRO_AUTH_LABEL}
              style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
            >
              <span>{t('auth.passwordLabel')}</span>
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
              aria-invalid={passwordFieldError !== null}
              aria-describedby={passwordErrorId}
              className={RETRO_AUTH_INPUT}
            />
            <FieldError
              id={passwordErrorId}
              message={passwordFieldError ? t(passwordFieldError) : null}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className={RETRO_AUTH_LABEL}>{t('auth.confirmLabel')}</div>
            <input
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setConfirmFieldError(null);
              }}
              placeholder="••••••••"
              autoComplete="new-password"
              aria-invalid={confirmFieldError !== null}
              aria-describedby={confirmErrorId}
              className={RETRO_AUTH_INPUT}
            />
            <FieldError
              id={confirmErrorId}
              message={confirmFieldError ? t(confirmFieldError) : null}
            />
          </div>
        </div>
        {error && <div className={RETRO_AUTH_ERROR}>{error}</div>}
        <label
          className={RETRO_AUTH_MUTED}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 9,
            cursor: 'pointer',
            lineHeight: 1.4,
          }}
        >
          <input
            type="checkbox"
            className="peer sr-only"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            aria-required="true"
          />
          <NeonCheck
            offsetTop
            checked={agreed}
            className="peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#00f0ff]"
          />
          {t('auth.agreePrefix')}
          <button
            type="button"
            className={RETRO_AUTH_LINK}
            style={{ padding: 0, border: 'none', background: 'none' }}
            onClick={(e) => {
              // The label wraps this button, so stop the click toggling the box.
              e.stopPropagation();
              setLegalOpen(true);
            }}
          >
            {t('auth.agreeLegal')}
          </button>
        </label>
        <button type="submit" disabled={submitting} className={RETRO_AUTH_BTN}>
          {submitting ? t('auth.creatingBtn') : t('auth.createAccountBtn')}
        </button>

        {/* OR divider */}
        <div className={RETRO_AUTH_DIVIDER}>
          <span className={RETRO_AUTH_DIVIDER_LINE} />
          {t('auth.orSignUpWith')}
          <span className={RETRO_AUTH_DIVIDER_LINE} />
        </div>

        {/* OAuth buttons */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {[
            { name: '42', icon: '/forty_two.png', path: '/api/auth/42' },
            { name: 'GitHub', icon: '/github.png', path: '/api/auth/github' },
            { name: 'Google', icon: '/google.png', path: '/api/auth/google' },
          ].map((p) => (
            <button
              key={p.name}
              type="button"
              onClick={() => {
                window.location.href = p.path;
              }}
              className={RETRO_AUTH_BTN_OUTLINE}
            >
              <img
                src={p.icon}
                alt={p.name}
                style={{ width: 18, height: 18, objectFit: 'contain' }}
              />
              {p.name}
            </button>
          ))}
        </div>

        <div className={RETRO_AUTH_MUTED} style={{ textAlign: 'center' }}>
          {t('auth.alreadyHaveSeat')}{' '}
          <a
            onClick={() => {
              navigate('/login');
            }}
            className={RETRO_AUTH_LINK}
          >
            {t('auth.signInLink')}
          </a>
        </div>
      </form>
      <LegalModal
        isOpen={legalOpen}
        initialDoc="terms"
        onClose={() => {
          setLegalOpen(false);
        }}
      />
    </RetroAuthLayout>
  );
}
