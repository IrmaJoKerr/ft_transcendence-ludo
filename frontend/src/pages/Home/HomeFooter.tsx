import { useTranslation } from 'react-i18next';
import { retroAudio } from '../../utils/audio';
import { RETRO_FOOTER } from '../../styles/tw';
import type { LegalDocType } from '../../components/LegalModal';

export function HomeFooter({ onOpenLegal }: { onOpenLegal: (doc: LegalDocType) => void }) {
  const { t } = useTranslation();
  return (
            <footer className={RETRO_FOOTER}>
              <p>{t('home.footerLegal')}</p>
              <div
                style={{
                  display: 'flex',
                  gap: 14,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginTop: 8,
                  fontSize: '0.74rem',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    retroAudio.playUiBeep(640, 0.05);
                    onOpenLegal('privacy');
                  }}
                  style={{
                    color: 'var(--accent-cyan)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  {t('legal.privacyPolicy', 'PRIVACY POLICY')}
                </button>
                <span className="text-(--text-muted)">//</span>
                <button
                  type="button"
                  onClick={() => {
                    retroAudio.playUiBeep(640, 0.05);
                    onOpenLegal('terms');
                  }}
                  style={{
                    color: 'var(--accent-cyan)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  {t('legal.termsOfService', 'TERMS OF SERVICE')}
                </button>
              </div>
            </footer>
  );
}
