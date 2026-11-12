import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RetroAuthLayout } from '../components/RetroAuthLayout';
import { navigate } from '../router';
import { useApp } from '../store';
import {
  RETRO_AUTH_BTN,
  RETRO_AUTH_LINK,
  RETRO_AUTH_MUTED,
  RETRO_AUTH_SUBTITLE,
  RETRO_AUTH_TITLE,
} from '../styles/tw';
import { retroAudio } from '../utils/audio';

/** Landing route for an emailed link: `/verify-email#token=<token>`. The token
 * is in the URL fragment, which browsers never send to the server, so it cannot
 * reach a log. See the F-04 entry in security-review.md. */
export function VerifyEmail() {
  const { t } = useTranslation();
  const { verifyEmail } = useApp();
  // Read the fragment once, on the first render: the effect below strips it from
  // the URL, so holding the token in state lets a retry work without a second
  // email. The empty string means the link carried no token at all.
  const [token] = useState(
    () => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? '',
  );
  const [status, setStatus] = useState<'verifying' | 'dead' | 'unreachable'>(
    token ? 'verifying' : 'dead',
  );
  // React StrictMode double-invokes effects in development. The token is
  // single-use, so a second POST would come back 'invalid' and race the first
  // navigation, leaving the user on the invalid-link screen.
  const attempted = useRef(false);

  const attempt = useCallback(async () => {
    setStatus('verifying');
    const outcome = await verifyEmail(token);
    // Where each outcome lands mirrors the redirects the backend used to issue
    // when the emailed link pointed straight at the API.
    if (outcome === 'signup') navigate('/login?verified=1', { replace: true });
    else if (outcome === 'change') navigate('/profile?emailChanged=1', { replace: true });
    else if (outcome === 'conflict') navigate('/profile?error=email-taken', { replace: true });
    else if (outcome === 'invalid') {
      navigate('/login?error=invalid-verification-link', { replace: true });
    } else setStatus('unreachable'); // request never completed: token is still good
  }, [token, verifyEmail]);

  useEffect(() => {
    // Strip the fragment first, so it cannot stay in browser history or appear
    // in a later navigation.
    window.history.replaceState(null, '', window.location.pathname);
    if (attempted.current || !token) return;
    attempted.current = true;
    void attempt();
  }, [attempt, token]);

  if (status === 'verifying') {
    return (
      <RetroAuthLayout tag={t('auth.oneMoreStep')}>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className={RETRO_AUTH_TITLE} style={{ fontSize: 24 }}>
            {t('auth.verifyingTitle')}
          </div>
          <div className={RETRO_AUTH_SUBTITLE}>{t('auth.verifyingDesc')}</div>
        </div>
      </RetroAuthLayout>
    );
  }

  // No token in the fragment: either the mail client stripped it, or someone
  // typed the path by hand. Nothing to redeem, so point at a fresh link.
  if (status === 'dead') {
    return (
      <RetroAuthLayout tag={t('auth.linkProblemTag')}>
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className={RETRO_AUTH_TITLE} style={{ fontSize: 24 }}>
            {t('auth.verifyInvalidTitle')}
          </div>
          <div className={RETRO_AUTH_MUTED} style={{ lineHeight: 1.5, fontSize: '14px' }}>
            {t('auth.invalidLinkDesc')}
          </div>
          <div className={RETRO_AUTH_MUTED} style={{ fontSize: '13px' }}>
            <a
              onClick={() => {
                retroAudio.playUiBeep(400, 0.05);
                navigate('/login');
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

  // The request never reached the backend, so the token was not consumed and
  // this same link still works: offer an in-place retry.
  return (
    <RetroAuthLayout>
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className={RETRO_AUTH_TITLE} style={{ fontSize: 24 }}>
          {t('common.couldNotReachServer')}
        </div>
        <div className={RETRO_AUTH_MUTED} style={{ lineHeight: 1.5, fontSize: '14px' }}>
          {t('auth.verifyUnreachableDesc')}
        </div>
        <button
          type="button"
          onClick={() => {
            retroAudio.playUiBeep(880, 0.05);
            void attempt();
          }}
          className={RETRO_AUTH_BTN}
        >
          {t('auth.tryAgainBtn')}
        </button>
      </div>
    </RetroAuthLayout>
  );
}
