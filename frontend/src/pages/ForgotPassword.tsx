import { useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { RetroAuthLayout } from '../components/RetroAuthLayout';
import { navigate } from '../router';
import { useApp } from '../store';
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
import { retroAudio } from '../utils/audio';

/**
 * Reset step 1: request a link; the confirmation is unconditional (no enumeration).
 */
export function ForgotPassword() {
  const { t } = useTranslation();
  const { forgotPassword } = useApp();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const err = await forgotPassword(email.trim());
    setSubmitting(false);
    if (err) setError(err);
    else setSent(true);
  }

  if (sent) {
    return (
      <RetroAuthLayout tag={t('auth.checkInboxTag')}>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className={RETRO_AUTH_TITLE} style={{ fontSize: 24 }}>
            {t('auth.checkInboxTitle')}
          </div>
          <div className={RETRO_AUTH_MUTED} style={{ lineHeight: 1.5, fontSize: '14px' }}>
            {t('auth.resetSentPrefix')} <b style={{ color: '#00f0ff' }}>{email}</b>{' '}
            {t('auth.resetSentSuffix')}
          </div>
          <div className={RETRO_AUTH_MUTED} style={{ fontSize: '13px' }}>
            {t('auth.rememberedIt')}{' '}
            <a
              onClick={() => {
                retroAudio.playUiBeep(400, 0.05);
                navigate('/login');
              }}
              className={RETRO_AUTH_LINK}
            >
              {t('auth.backToSignIn')}
            </a>
          </div>
        </div>
      </RetroAuthLayout>
    );
  }

  return (
    <RetroAuthLayout tag={t('auth.forgotYourPasswordTag')}>
      <form
        onSubmit={(e) => {
          retroAudio.playUiBeep(880, 0.05);
          void onSubmit(e);
        }}
        style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        <div>
          <div className={RETRO_AUTH_TITLE} style={{ fontSize: 24 }}>
            {t('auth.resetYourPasswordTitle')}
          </div>
          <div className={RETRO_AUTH_SUBTITLE}>{t('auth.forgotDesc')}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <div className={RETRO_AUTH_LABEL}>{t('auth.emailLabel')}</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="pilot@transcendence.42"
            autoComplete="email"
            required
            autoFocus
            className={RETRO_AUTH_INPUT}
          />
        </div>
        {error && <div className={RETRO_AUTH_ERROR}>{error}</div>}
        <button type="submit" disabled={submitting} className={RETRO_AUTH_BTN}>
          {submitting ? t('auth.sendingBtn') : t('auth.sendResetLink')}
        </button>
        <div className={RETRO_AUTH_MUTED} style={{ textAlign: 'center' }}>
          {t('auth.rememberedIt')}{' '}
          <a
            onClick={() => {
              retroAudio.playUiBeep(400, 0.05);
              navigate('/login');
            }}
            className={RETRO_AUTH_LINK}
          >
            {t('auth.backToSignIn')}
          </a>
        </div>
      </form>
    </RetroAuthLayout>
  );
}
