import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RetroAuthLayout } from '../components/RetroAuthLayout';
import { navigate, useRoute } from '../router';
import { useApp } from '../store';
import '../styles/retrowave.css';
import {
  RETRO_AUTH_BTN,
  RETRO_AUTH_BTN_OUTLINE,
  RETRO_AUTH_ERROR,
  RETRO_AUTH_INPUT,
  RETRO_AUTH_LABEL,
  RETRO_AUTH_SUCCESS,
  RETRO_AUTH_SUBTITLE,
  RETRO_AUTH_TITLE,
} from '../styles/tw';
import { retroAudio } from '../utils/audio';

/**
 * Second login factor: ?token=<pendingToken> from password login or OAuth callback.
 */
export function TwoFactor() {
  const { t } = useTranslation();
  const { verify2fa, resend2fa } = useApp();
  const { query } = useRoute();
  const pendingToken = query.get('token') ?? '';
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const err = await verify2fa(pendingToken, code);
    setSubmitting(false);
    if (err) setError(err);
    else navigate('/home');
  }

  // Re-issue a fresh code for the same challenge (previous code is invalidated).
  async function onResend() {
    if (resending || !pendingToken) return;
    setResending(true);
    setError(null);
    setNotice(null);
    const err = await resend2fa(pendingToken);
    setResending(false);
    if (err) setError(err);
    else setNotice(t('auth.codeResent'));
  }

  return (
    <RetroAuthLayout tag={t('auth.oneMoreStep')}>
      <form
        onSubmit={(e) => {
          retroAudio.playUiBeep(880, 0.05);
          void onSubmit(e);
        }}
        style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <div>
          <div className={RETRO_AUTH_TITLE} style={{ fontSize: 32 }}>
            {t('authExtra.twoFactorAuthTitle')}
          </div>
          <div className={RETRO_AUTH_SUBTITLE}>{t('auth.codeSentDesc')}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className={RETRO_AUTH_LABEL}>{t('auth.loginCodeLabel')}</div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            className={RETRO_AUTH_INPUT}
            style={{
              letterSpacing: 10,
              fontSize: 26,
              fontWeight: 900,
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              color: 'var(--accent-cyan)',
              textShadow: '0 0 10px rgba(0, 240, 255, 0.5)',
            }}
          />
        </div>
        {error && <div className={RETRO_AUTH_ERROR}>{error}</div>}
        {notice && <div className={RETRO_AUTH_SUCCESS}>{notice}</div>}
        <button type="submit" disabled={submitting || code.length !== 6} className={RETRO_AUTH_BTN}>
          {submitting ? t('auth.checkingBtn') : t('authExtra.verifyEnterArenaBtn')}
        </button>
        <button
          type="button"
          className={RETRO_AUTH_BTN_OUTLINE}
          disabled={resending || !pendingToken}
          onClick={() => {
            retroAudio.playUiBeep(880, 0.05);
            void onResend();
          }}
        >
          {resending ? t('auth.sendingBtn') : t('auth.resendCode')}
        </button>
      </form>
    </RetroAuthLayout>
  );
}
