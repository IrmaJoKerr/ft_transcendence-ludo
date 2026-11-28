import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { retroAudio } from '../../utils/audio';
import { CyberModal } from '../CyberModal';
import { RulesBoardPages } from './RulesBoardPages';
import { RulesIntroPages } from './RulesIntroPages';
import { RulesModePages } from './RulesModePages';
import { LAST_RULES_PAGE, RULES_PAGE_TAB_KEYS } from './rulesPageData';

interface GameRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// The arena's rules: ten pages, one modal, two mount points.
export function GameRulesModal({ isOpen, onClose }: GameRulesModalProps) {
  const { t } = useTranslation();
  const [rulesPage, setRulesPage] = useState(0);

  // A fresh open starts at the objective, whoever pressed the button.
  const closeModal = () => {
    setRulesPage(0);
    onClose();
  };

  const pages =
    rulesPage <= 2 ? (
      <RulesIntroPages page={rulesPage} />
    ) : rulesPage <= 5 ? (
      <RulesBoardPages page={rulesPage} />
    ) : (
      <RulesModePages page={rulesPage} />
    );

  return (
    <CyberModal
      isOpen={isOpen}
      title={t('gameExtra.rulesModalTitle')}
      versionTag={t('gameExtra.rulesVersionTag')}
      cancelLabel={t('common.close')}
      proceedLabel={
        rulesPage < LAST_RULES_PAGE ? t('gameExtra.nextPageBtn') : t('gameExtra.backToFirstPageBtn')
      }
      cancelShortcut="ESC"
      proceedShortcut={rulesPage < LAST_RULES_PAGE ? '→' : '↩'}
      closeOnProceed={false}
      panelStyle={{ width: 'min(1200px, calc(100vw - 3rem))' }}
      onCancel={closeModal}
      onProceed={() => {
        retroAudio.playUiBeep(700, 0.05);
        setRulesPage((p) => (p < LAST_RULES_PAGE ? p + 1 : 0));
      }}
      message={
        <div
          // A new key per page remounts this column, which is what returns the scroll
          // to the top on every page turn; nothing else here depends on identity.
          key={rulesPage}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            width: '100%',
            minWidth: 0,
            maxWidth: 1140,
            // From page 7 the deck outgrows a 900 px window. Capping the page column here, not in
            // `CyberModal`, keeps the NEXT PAGE footer visible; `stable` reserves the scrollbar
            // gutter so a short page keeps its line breaks.
            maxHeight: 'calc(100vh - 300px)',
            overflowY: 'auto',
            scrollbarGutter: 'stable',
          }}
        >
          {/* The pill is the label plus a 6px border of air on every side (20.5), so it sizes
              to its label and the strip wraps instead of sharing a narrower `flex: 1`. */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: 6,
              borderBottom: '1px solid rgb(var(--accent-cyan-rgb) / 0.25)',
              paddingBottom: 10,
            }}
          >
            {RULES_PAGE_TAB_KEYS.map((key, id) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  retroAudio.playUiBeep(520, 0.04);
                  setRulesPage(id);
                }}
                style={{
                  flex: '0 0 auto',
                  padding: 6,
                  fontSize: '0.68rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 'bold',
                  background:
                    rulesPage === id
                      ? 'rgb(var(--accent-cyan-rgb) / 0.22)'
                      : 'rgb(var(--ink-rgb) / 0.04)',
                  border:
                    rulesPage === id
                      ? '1.5px solid var(--accent-cyan)'
                      : '1px solid rgb(var(--ink-rgb) / 0.1)',
                  color: rulesPage === id ? 'var(--text-main)' : 'var(--text-muted)',
                  boxShadow:
                    rulesPage === id ? '0 0 10px rgb(var(--accent-cyan-rgb) / 0.35)' : 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(key)}
              </button>
            ))}
          </div>

          {pages}
        </div>
      }
    />
  );
}
