import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { navigate, useRoute } from '../router';
import { useApp, type Lang } from '../store';
import { retroAudio } from '../utils/audio';
import { MarkdownViewer } from '../components/MarkdownViewer';
import {
  PAGE_SHELL,
  GRID_BACKGROUND,
  SYNTHWAVE_SUN,
  GRID_HORIZON,
  PERSPECTIVE_GRID,
  HERO_SECTION,
  HERO_TITLE,
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_BODY,
  RETRO_BTN,
} from '../styles/tw';

import privacyEn from '../content/docs/Privacy-Policy-en.md?raw';
import privacyFr from '../content/docs/Privacy-Policy-fr.md?raw';
import privacyMs from '../content/docs/Privacy-Policy-my.md?raw';
import termsEn from '../content/docs/Terms-of-Service-en.md?raw';
import termsFr from '../content/docs/Terms-of-Service-fr.md?raw';
import termsMs from '../content/docs/Terms-of-Service-my.md?raw';

interface LegalPageProps {
  initialDoc?: 'privacy' | 'terms';
}

const DOCS = {
  privacy: {
    en: privacyEn,
    fr: privacyFr,
    ms: privacyMs,
  },
  terms: {
    en: termsEn,
    fr: termsFr,
    ms: termsMs,
  },
};

export function LegalPage({ initialDoc = 'privacy' }: LegalPageProps) {
  const { t } = useTranslation();
  const route = useRoute();
  const { lang, setLang } = useApp();
  const [activeDoc, setActiveDoc] = useState<'privacy' | 'terms'>(
    route.path === '/terms' ? 'terms' : initialDoc,
  );
  const [docLang, setDocLang] = useState<Lang>(lang);

  useEffect(() => {
    if (route.path === '/terms') setActiveDoc('terms');
    else if (route.path === '/privacy') setActiveDoc('privacy');
  }, [route.path]);

  useEffect(() => {
    setDocLang(lang);
  }, [lang]);

  const currentContent = DOCS[activeDoc][docLang] || DOCS[activeDoc]['en'];

  return (
    <>
      <div className={GRID_BACKGROUND}>
        <div className={SYNTHWAVE_SUN} />
        <div className={GRID_HORIZON} />
        <div className={PERSPECTIVE_GRID} />
      </div>

      <div
        className={`${PAGE_SHELL} page-shell flex min-h-screen w-full flex-col items-center justify-start`}
      >
        <div className="relative z-10 box-border flex min-h-screen w-full max-w-5xl flex-col items-center justify-start px-4 py-8 sm:px-6">
          {/* Header */}
          <header
            className={`${HERO_SECTION} w-full`}
            style={{ marginTop: 0, padding: '16px 20px', marginBottom: 20 }}
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className={`${RETRO_BTN} font-display rounded-lg border border-[var(--accent-cyan)] px-3 py-1.5 text-xs font-black text-[var(--accent-cyan)]`}
                  onClick={() => {
                    retroAudio.playUiBeep(440, 0.05);
                    navigate('/home');
                  }}
                >
                  ← {t('common.back', 'BACK')}
                </button>
                <h1 className={`${HERO_TITLE} m-0 text-lg sm:text-xl`}>
                  {activeDoc === 'privacy'
                    ? '🛡️ ' + t('legal.privacyPolicy', 'PRIVACY POLICY')
                    : '📜 ' + t('legal.termsOfService', 'TERMS OF SERVICE')}
                </h1>
              </div>

              <div className="flex items-center gap-3">
                {/* Document Switcher */}
                <div className="flex items-center rounded-lg border border-[rgba(0,240,255,0.25)] bg-[rgba(0,0,0,0.5)] p-0.5">
                  <button
                    type="button"
                    className={`font-display rounded px-3 py-1 text-xs font-bold transition-all ${
                      activeDoc === 'privacy'
                        ? 'bg-[var(--accent-pink)] text-[#ffffff] shadow-[0_0_10px_rgba(255,0,127,0.5)]'
                        : 'text-[var(--text-muted)] hover:text-[#ffffff]'
                    }`}
                    onClick={() => {
                      retroAudio.playUiBeep(720, 0.05);
                      setActiveDoc('privacy');
                      navigate('/privacy');
                    }}
                  >
                    {t('legal.tabPrivacy', 'PRIVACY')}
                  </button>
                  <button
                    type="button"
                    className={`font-display rounded px-3 py-1 text-xs font-bold transition-all ${
                      activeDoc === 'terms'
                        ? 'bg-[var(--accent-pink)] text-[#ffffff] shadow-[0_0_10px_rgba(255,0,127,0.5)]'
                        : 'text-[var(--text-muted)] hover:text-[#ffffff]'
                    }`}
                    onClick={() => {
                      retroAudio.playUiBeep(720, 0.05);
                      setActiveDoc('terms');
                      navigate('/terms');
                    }}
                  >
                    {t('legal.tabTerms', 'TERMS')}
                  </button>
                </div>

                {/* Language Switcher */}
                <div className="flex items-center rounded-lg border border-[rgba(0,240,255,0.25)] bg-[rgba(0,0,0,0.5)] p-0.5">
                  {(['en', 'ms', 'fr'] as const).map((l) => (
                    <button
                      key={l}
                      type="button"
                      className={`rounded px-2.5 py-1 font-mono text-xs font-bold transition-all ${
                        docLang === l
                          ? 'bg-[var(--accent-cyan)] text-[#0a0519] shadow-[0_0_8px_rgba(0,240,255,0.5)]'
                          : 'text-[var(--text-muted)] hover:text-[#ffffff]'
                      }`}
                      onClick={() => {
                        retroAudio.playUiBeep(880, 0.05);
                        setDocLang(l);
                        setLang(l);
                      }}
                    >
                      {l.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </header>

          {/* Window Container */}
          <section className={`${RETRO_WINDOW} flex w-full flex-1 flex-col overflow-hidden`}>
            <div className={WINDOW_HEADER} style={{ padding: '8px 16px' }}>
              <span className="font-mono text-xs text-[var(--accent-cyan)]">
                // LEGAL DOCUMENTATION ARCHIVE [{activeDoc.toUpperCase()}_{docLang.toUpperCase()}]
              </span>
            </div>

            <div
              className={`${WINDOW_BODY} flex-1 overflow-y-auto bg-[rgba(12,4,28,0.94)] p-6 sm:p-10`}
            >
              <MarkdownViewer content={currentContent} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
