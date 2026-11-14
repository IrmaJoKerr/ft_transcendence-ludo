import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { retroAudio } from '../utils/audio';
import { CyberModal } from './CyberModal';

/**
 * The arena's rules: ten pages, one modal, two mount points.
 *
 * It shipped inline in `pages/Game.tsx`, opened by the game's own GAME RULES
 * button. The lobby header now offers the same button (34, item 2), and a second
 * copy of these pages is a second set to keep in step, so the block moved here
 * whole: `isOpen` and `onClose` in, everything else owned — the page the reader is
 * on, the tab strip, the footer's next/finish pair and the beep each turn makes.
 * `Game.tsx` keeps its trigger and passes the same two props, so the lobby's rules
 * and the game's cannot drift.
 *
 * Opening it always starts at the objective, which is what the game's button used
 * to do by hand (`setRulesPage(0)` before opening).
 *
 * The body's own measurements (`minWidth: 380, maxWidth: 520`) are untouched and
 * stay so on purpose (34, decision 20): the box grows once the content has been
 * read at this size, and that is its own step.
 */

/** The last page index: `rulesTab0`..`rulesTab9`, where the footer turns from
 *  "next page" into "start playing". */
const LAST_PAGE = 9;

interface GameRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function GameRulesModal({ isOpen, onClose }: GameRulesModalProps) {
  const { t } = useTranslation();
  const [rulesPage, setRulesPage] = useState(0);

  // A fresh open starts at the objective, whoever pressed the button. The reset
  // happens on the way *out* rather than on the way in: closing is the modal's own
  // event, so `0` needs no effect watching `isOpen` and no `setRulesPage(0)` in each
  // caller — the two rules the extraction was made to remove (34, item 2).
  const closeModal = () => {
    setRulesPage(0);
    onClose();
  };

  // The modal's own chrome — title, version tag, the two footer buttons and their
  // keyboard pair — then the ten pages in the `message` prop.
  return (
    <CyberModal
      isOpen={isOpen}
      title={t('gameExtra.rulesModalTitle')}
      versionTag={t('gameExtra.rulesVersionTag')}
      cancelLabel={t('common.close')}
      proceedLabel={rulesPage < LAST_PAGE ? t('gameExtra.nextPageBtn') : t('gameExtra.startPlayingBtn')}
      cancelShortcut="ESC"
      proceedShortcut={rulesPage < LAST_PAGE ? '→' : '↵'}
      closeOnProceed={rulesPage >= LAST_PAGE}
      onCancel={closeModal}
      onProceed={() => {
        if (rulesPage < LAST_PAGE) {
          retroAudio.playUiBeep(700, 0.05);
          setRulesPage((p) => p + 1);
        } else {
          closeModal();
        }
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
            minWidth: 380,
            maxWidth: 520,
            // The deck outgrows a 900px window from page 7 on (two cards plus the
            // key-shift table), and the box sits centred in a fixed overlay: with no
            // cap the box grew to 1020px and pushed the footer — and its NEXT PAGE
            // button — 86px below the fold, so the last four pages could not be
            // turned from a 1440x900 screen. Capped here rather than in CyberModal,
            // whose short confirm dialogs want no scroll area; `stable` reserves the
            // gutter so a page that does not scroll keeps the strip's line breaks.
            maxHeight: 'calc(100vh - 300px)',
            overflowY: 'auto',
            scrollbarGutter: 'stable',
          }}
        >
          {/* Page Navigation Tabs: the pill is the label plus a 6px border of air on every
              side (20.5), so it sizes to its label and the strip wraps instead of sharing a
              `flex: 1` that is narrower than "10. WALL BREAKER" — the share squeezed the
              text out of its own pill, which is what made the distance read as 2 to 6px. */}
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
            {[
              { id: 0, label: t('gameExtra.rulesTab0') },
              { id: 1, label: t('gameExtra.rulesTab1') },
              { id: 2, label: t('gameExtra.rulesTab2') },
              { id: 3, label: t('gameExtra.rulesTab3') },
              { id: 4, label: t('gameExtra.rulesTab4') },
              { id: 5, label: t('gameExtra.rulesTab5') },
              { id: 6, label: t('gameExtra.rulesTab6') },
              { id: 7, label: t('gameExtra.rulesTab7') },
              { id: 8, label: t('gameExtra.rulesTab8') },
              { id: 9, label: t('gameExtra.rulesTab9') },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  retroAudio.playUiBeep(520, 0.04);
                  setRulesPage(p.id);
                }}
                style={{
                  // Natural width, so the 6px padding on all four sides is a distance the
                  // eye can see: `flex: 1` divided a 380–520px deck by ten and gave every
                  // pill less than its own label.
                  flex: '0 0 auto',
                  padding: 6,
                  fontSize: '0.68rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 'bold',
                  background:
                    rulesPage === p.id ? 'rgb(var(--accent-cyan-rgb) / 0.22)' : 'rgb(var(--ink-rgb) / 0.04)',
                  border:
                    rulesPage === p.id
                      ? '1.5px solid var(--accent-cyan)'
                      : '1px solid rgb(var(--ink-rgb) / 0.1)',
                  color: rulesPage === p.id ? 'var(--text-main)' : 'var(--text-muted)',
                  boxShadow: rulesPage === p.id ? '0 0 10px rgb(var(--accent-cyan-rgb) / 0.35)' : 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textAlign: 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* PAGE 0: Objective & Controls */}
          {rulesPage === 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--accent-pink)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage0Header')}
              </div>
              <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                {t('gameExtra.rulesPage0Body')}
              </p>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 14,
                  borderRadius: 6,
                  border: '1px solid rgb(var(--accent-pink-rgb) / 0.3)',
                }}
              >
                <div
                  style={{
                    color: 'var(--accent-cyan)',
                    fontWeight: 'bold',
                    fontSize: '0.85rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesCombatControls')}
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {t('gameExtra.rulesRollDiceLabel')}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-main)',
                      fontFamily: 'var(--font-mono)',
                      background: 'rgb(var(--accent-cyan-rgb) / 0.2)',
                      padding: '3px 10px',
                      borderRadius: 4,
                      border: '1px solid var(--accent-cyan)',
                      fontWeight: 'bold',
                      fontSize: '0.85rem',
                    }}
                  >
                    {t('gameExtra.spacebarKey')}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {t('gameExtra.rulesSelectWarpLabel')}
                  </span>
                  <span
                    style={{
                      color: 'var(--text-main)',
                      fontFamily: 'var(--font-mono)',
                      background: 'rgb(var(--accent-pink-rgb) / 0.2)',
                      padding: '3px 10px',
                      borderRadius: 4,
                      border: '1px solid var(--accent-pink)',
                      fontWeight: 'bold',
                      fontSize: '0.85rem',
                    }}
                  >
                    {t('gameExtra.leftClickKey')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* PAGE 1: Rolling a 6 */}
          {rulesPage === 1 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--accent-yellow)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage1Header')}
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 16,
                  borderRadius: 6,
                  borderLeft: '4px solid var(--accent-yellow)',
                  border: '1px solid rgb(var(--accent-yellow-rgb) / 0.2)',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                >
                  <span style={{ color: 'var(--accent-yellow)', fontSize: '1.2rem' }}>⚡</span>
                  <span>{t('gameExtra.rulesPage1Line1')}</span>
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                >
                  <span style={{ color: 'var(--accent-yellow)', fontSize: '1.2rem' }}>🚀</span>
                  <span>{t('gameExtra.rulesPage1Line2')}</span>
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                >
                  <span style={{ color: 'var(--state-off)', fontSize: '1.2rem' }}>⛔</span>
                  <span>{t('gameExtra.rulesPage1Line3')}</span>
                </div>
              </div>
            </div>
          )}

          {/* PAGE 2: Landing on Enemy Piece */}
          {rulesPage === 2 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--accent-pink)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage2Header')}
              </div>
              <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                {t('gameExtra.rulesPage2Intro')}
              </p>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 16,
                  borderRadius: 6,
                  borderLeft: '4px solid var(--accent-pink)',
                  border: '1px solid rgb(var(--accent-pink-rgb) / 0.2)',
                }}
              >
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                >
                  <span style={{ color: 'var(--accent-pink)', fontSize: '1.2rem' }}>⚔</span>
                  <span>{t('gameExtra.rulesPage2Line1')}</span>
                </div>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.95rem' }}
                >
                  <span style={{ color: 'var(--state-on)', fontSize: '1.2rem' }}>✦</span>
                  <span>{t('gameExtra.rulesPage2Line2')}</span>
                </div>
              </div>
            </div>
          )}

          {/* PAGE 3: The Star */}
          {rulesPage === 3 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--accent-cyan)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage3Header')}
              </div>
              <div
                style={{
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 16,
                  borderRadius: 6,
                  borderLeft: '4px solid var(--accent-cyan)',
                  border: '1px solid rgb(var(--accent-cyan-rgb) / 0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div
                  style={{ color: 'var(--accent-cyan)', fontWeight: 'bold', fontSize: '1.1rem' }}
                >
                  {t('gameExtra.rulesPage3Title')}
                </div>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage3Body')}
                </p>
              </div>
            </div>
          )}

          {/* PAGE 4: Two Pieces Together (Blockade) */}
          {rulesPage === 4 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--state-on)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage4Header')}
              </div>
              <div
                style={{
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 16,
                  borderRadius: 6,
                  borderLeft: '4px solid var(--state-on)',
                  border: '1px solid rgb(var(--state-on-rgb) / 0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ color: 'var(--state-on)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                  {t('gameExtra.rulesPage4Title')}
                </div>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage4Body')}
                </p>
              </div>
            </div>
          )}

          {/* PAGE 5: Home Lane */}
          {rulesPage === 5 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--accent-purple)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage5Header')}
              </div>
              <div
                style={{
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 16,
                  borderRadius: 6,
                  borderLeft: '4px solid var(--accent-purple)',
                  border: '1px solid rgb(var(--accent-purple-rgb) / 0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage5Line1')}
                </p>
                <p
                  style={{
                    margin: 0,
                    color: 'var(--accent-yellow)',
                    fontWeight: 'bold',
                    fontSize: '1.05rem',
                    letterSpacing: '0.5px',
                  }}
                >
                  {t('gameExtra.rulesPage5Line2')}
                </p>
              </div>
            </div>
          )}

          {/* PAGE 6: Clash Mode */}
          {rulesPage === 6 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--accent-yellow)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage6Header')}
              </div>
              <div
                style={{
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 16,
                  borderRadius: 6,
                  border: '1px solid rgb(var(--accent-yellow-rgb) / 0.2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ color: 'var(--accent-yellow)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                  {t('gameExtra.rulesPage6Title')}
                </div>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage6Body')}
                </p>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    borderLeft: '3px solid rgb(var(--accent-yellow-rgb) / 0.35)',
                    paddingLeft: 10,
                  }}
                >
                  <div style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>
                    {t('gameExtra.rulesPage6Step1')}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>
                    {t('gameExtra.rulesPage6Step2')}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>
                    {t('gameExtra.rulesPage6Step3')}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#f0f0f0' }}>
                    {t('gameExtra.rulesPage6Step4')}
                  </div>
                </div>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.9rem' }}>
                  {t('gameExtra.rulesPage6Chain')}
                </p>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.9rem' }}>
                  {t('gameExtra.rulesPage6KeyShift')}
                </p>
                <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {t('gameExtra.rulesPage6Touch')}
                </p>
              </div>
            </div>
          )}

          {/* PAGE 7: No Safe Zones (hardcore) */}
          {rulesPage === 7 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--state-off)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage7Header')}
              </div>
              <div
                style={{
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 16,
                  borderRadius: 6,
                  border: '1px solid rgb(var(--state-off-rgb) / 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ color: 'var(--state-off)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                  {t('gameExtra.rulesPage7Title')}
                </div>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage7Body')}
                </p>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage7Body2')}
                </p>
              </div>
            </div>
          )}

          {/* PAGE 8: Free exit */}
          {rulesPage === 8 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--accent-cyan)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage8Header')}
              </div>
              <div
                style={{
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 16,
                  borderRadius: 6,
                  border: '1px solid rgb(var(--accent-cyan-rgb) / 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ color: 'var(--accent-cyan)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                  {t('gameExtra.rulesPage8Title')}
                </div>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage8Body')}
                </p>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage8Body2')}
                </p>
              </div>
            </div>
          )}
          {rulesPage === 9 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                fontSize: '0.95rem',
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  color: 'var(--accent-cyan)',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  letterSpacing: '0.5px',
                }}
              >
                {t('gameExtra.rulesPage9Header')}
              </div>
              <div
                style={{
                  background: 'rgba(5, 2, 18, 0.65)',
                  padding: 16,
                  borderRadius: 6,
                  border: '1px solid rgb(var(--accent-cyan-rgb) / 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ color: 'var(--accent-cyan)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                  {t('gameExtra.rulesPage9Title')}
                </div>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage9Body')}
                </p>
                <p style={{ margin: 0, color: '#f0f0f0', fontSize: '0.95rem' }}>
                  {t('gameExtra.rulesPage9Body2')}
                </p>
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}
