import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useApp, type Lang } from '../store';
import { retroAudio } from '../utils/audio';
import { MarkdownViewer } from './MarkdownViewer';
import { RETRO_WINDOW, WINDOW_HEADER, WINDOW_BODY, RETRO_BTN } from '../styles/tw';

import privacyEn from '../content/docs/Privacy-Policy-en.md?raw';
import privacyFr from '../content/docs/Privacy-Policy-fr.md?raw';
import privacyMs from '../content/docs/Privacy-Policy-my.md?raw';
import termsEn from '../content/docs/Terms-of-Service-en.md?raw';
import termsFr from '../content/docs/Terms-of-Service-fr.md?raw';
import termsMs from '../content/docs/Terms-of-Service-my.md?raw';

export type LegalDocType = 'privacy' | 'terms';

interface LegalModalProps {
  isOpen: boolean;
  initialDoc?: LegalDocType;
  onClose: () => void;
}

const DOCS: Record<LegalDocType, Record<Lang, string>> = {
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

export function LegalModal({ isOpen, initialDoc = 'privacy', onClose }: LegalModalProps) {
  const { t } = useTranslation();
  const { lang, setLang } = useApp();
  const [activeDoc, setActiveDoc] = useState<LegalDocType>(initialDoc);
  const [docLang, setDocLang] = useState<Lang>(lang);

  useEffect(() => {
    setActiveDoc(initialDoc);
  }, [initialDoc]);

  useEffect(() => {
    setDocLang(lang);
  }, [lang]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        retroAudio.playUiBeep(440, 0.05);
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const currentContent = DOCS[activeDoc][docLang] || DOCS[activeDoc]['en'];

  return createPortal(
    <div
      className="animate-fade-in fixed inset-0 z-[10010] flex items-center justify-center bg-[rgba(5,2,14,0.82)] p-4 backdrop-blur-[12px] sm:p-6"
      onClick={() => {
        retroAudio.playUiBeep(440, 0.05);
        onClose();
      }}
    >
      <div
        className={`${RETRO_WINDOW} flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border-[1.5px] border-[rgba(0,240,255,0.4)] shadow-[0_25px_70px_rgba(0,0,0,0.95),0_0_35px_rgba(0,240,255,0.25)]`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Title, Controls & Switchers */}
        <div
          className={WINDOW_HEADER}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 20px',
          }}
        >
          <div className="flex items-center gap-3">
            <span className="font-display text-sm font-black tracking-wider text-[#ffffff]">
              {activeDoc === 'privacy'
                ? '🛡️ ' + t('legal.privacyPolicy', 'PRIVACY POLICY')
                : '📜 ' + t('legal.termsOfService', 'TERMS OF SERVICE')}
            </span>
          </div>

          <div className="flex items-center gap-4">
            {/* Document Tabs */}
            <div className="flex items-center gap-1.5 rounded-lg border border-[rgba(0,240,255,0.25)] bg-[rgba(0,0,0,0.5)] p-1">
              <button
                type="button"
                className={`font-display rounded px-3 py-1.5 text-[0.7rem] font-bold transition-all ${
                  activeDoc === 'privacy'
                    ? 'bg-[var(--accent-pink)] text-[#ffffff] shadow-[0_0_10px_rgba(255,0,127,0.5)]'
                    : 'text-[var(--text-muted)] hover:text-[#ffffff]'
                }`}
                onClick={() => {
                  retroAudio.playUiBeep(720, 0.05);
                  setActiveDoc('privacy');
                }}
              >
                {t('legal.tabPrivacy', 'PRIVACY')}
              </button>
              <button
                type="button"
                className={`font-display rounded px-3 py-1.5 text-[0.7rem] font-bold transition-all ${
                  activeDoc === 'terms'
                    ? 'bg-[var(--accent-pink)] text-[#ffffff] shadow-[0_0_10px_rgba(255,0,127,0.5)]'
                    : 'text-[var(--text-muted)] hover:text-[#ffffff]'
                }`}
                onClick={() => {
                  retroAudio.playUiBeep(720, 0.05);
                  setActiveDoc('terms');
                }}
              >
                {t('legal.tabTerms', 'TERMS')}
              </button>
            </div>

            {/* Language Switcher */}
            <div className="flex items-center gap-1.5 rounded-lg border border-[rgba(0,240,255,0.25)] bg-[rgba(0,0,0,0.5)] p-1">
              {(['en', 'ms', 'fr'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`rounded px-3 py-1.5 font-mono text-[0.68rem] font-bold transition-all ${
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

            {/* Close Button */}
            <button
              type="button"
              className={`${RETRO_BTN} px-2 py-0.5 text-xs text-[var(--accent-pink)] hover:bg-[rgba(255,0,127,0.2)]`}
              onClick={() => {
                retroAudio.playUiBeep(440, 0.05);
                onClose();
              }}
              title={t('common.close', 'Close')}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable Document Body — generous padding so the text never
            hugs the window frame, with a comfortable line length. */}
        <div
          className={`${WINDOW_BODY} flex-1 overflow-y-auto bg-[rgba(12,4,28,0.92)] px-8 py-8 text-[var(--text-main)] sm:px-12 sm:py-10`}
          style={{ maxHeight: 'calc(90vh - 110px)' }}
        >
          <div className="mx-auto w-full max-w-3xl">
            <MarkdownViewer content={currentContent} />
          </div>
        </div>

        {/* Modal Footer Bar */}
        <div className="flex items-center justify-between border-t border-[rgba(0,240,255,0.2)] bg-[rgba(18,6,42,0.95)] p-3 px-6">
          <span className="font-mono text-[0.68rem] text-[var(--text-muted)]">
            // PACE 24 · RETROLUDO '42 LEGAL ARCHIVE [{docLang.toUpperCase()}]
          </span>
          <button
            type="button"
            className={`${RETRO_BTN} font-display rounded-lg border border-[var(--accent-cyan)] bg-[linear-gradient(90deg,rgba(0,240,255,0.3),rgba(255,0,127,0.3))] px-4 py-1.5 text-xs font-black text-[#ffffff] hover:shadow-[0_0_15px_rgba(0,240,255,0.4)]`}
            onClick={() => {
              retroAudio.playUiBeep(440, 0.05);
              onClose();
            }}
          >
            {t('legal.acceptClose', 'CLOSE')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
