import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { UserAvatar } from './UserAvatar';
import { useApp, type LastResult } from '../store';
import { retroAudio } from '../utils/audio';
import { avatarSeed, localizedBotName } from '../utils/botName';
import '../styles/retrowave.css';
import {
  RETRO_BTN,
  TICKET_CONTAINER,
  RESULTS_INVOICE_CONTAINER,
  INVOICE_SLOT_BOTTOM,
  SLOT_HOLE_BOTTOM,
  INVOICE_SLOT_TOP,
  VENDING_HEADER_BAR,
  SLOT_HOLE_TOP,
  TICKET_PAPER_WRAPPER,
  RESULTS_INVOICE,
  TICKET_NOTCH_LEFT,
  TICKET_NOTCH_RIGHT,
  INVOICE_TITLE,
  INVOICE_AMOUNT,
  INVOICE_VALUE,
  PAYERS_LIST,
  PAYERS_LI,
  PAYERS_LI_P,
  PAYER_IMAGE_CONTAINER,
  PAY_TAG_BASE,
  PAY_TAG_WIN,
  PAY_TAG_RUNNER,
  PAY_TAG_THIRD,
  PAY_TAG_FOURTH,
  PAY_NOW_BTN,
} from '../styles/tw';

type ResultsModalProps = {
  result: NonNullable<LastResult>;
  onReturnToLobby: () => void;
  onClose?: () => void;
  // Guests only: a fresh mint with the same setup, and the label their exit
  // carries. Both are optional so every existing call site is unchanged.
  onPlayAgain?: () => void;
  returnLabel?: string;
  errorText?: string | null;
};

export function ResultsModal({
  result,
  onReturnToLobby,
  onClose,
  onPlayAgain,
  returnLabel,
  errorText,
}: ResultsModalProps) {
  const { t } = useTranslation();
  const { user } = useApp();

  // Trigger vending machine mechanical stepping feed sounds during 0.72s print animation
  useEffect(() => {
    const steps = [0, 80, 180, 290, 410, 540];
    const stepTimers = steps.map((ms, i) =>
      setTimeout(() => {
        retroAudio.playUiBeep(340 + (i % 3) * 60, 0.025, 'sawtooth');
      }, ms),
    );
    const finalTimer = setTimeout(() => {
      retroAudio.playUiBeep(880, 0.08, 'sine');
    }, 720);
    return () => {
      stepTimers.forEach(clearTimeout);
      clearTimeout(finalTimer);
    };
  }, []);

  const ranked = [...result.players].sort((a, b) => b.piecesInGoal - a.piecesInGoal);

  // A match is only completed with a real champion if it wasn't abandoned and has a winner
  const hasRealWinner =
    !result.abandoned &&
    (Boolean(result.winner) || result.players.some((p) => p.piecesInGoal >= 4));

  // Find current player's color or fallback to first human/player. The id first:
  // `players[].username` is the engine's seat label (a display name or a lobby
  // name), so a rename can make the name comparison pick the wrong seat.
  const myPlayer =
    result.players.find((p) => !p.isBot && !!user?.id && p.userId === user.id) ??
    result.players.find((p) => !p.isBot && p.username === user?.username) ??
    result.players.find((p) => !p.isBot) ??
    (result.players.length > 0 ? result.players[0] : undefined);
  const myColor = myPlayer?.color ?? 'red';
  const won = hasRealWinner && result.winner === myColor;
  const winnerPlayer = result.players.find((p) => p.color === result.winner);

  const COLOR_NAME_KEYS: Record<string, string> = {
    red: 'lobby.colorRed',
    green: 'lobby.colorGreen',
    yellow: 'lobby.colorYellow',
    blue: 'lobby.colorBlue',
  };
  const winnerColorName = COLOR_NAME_KEYS[result.winner] ?? COLOR_NAME_KEYS.red;
  const winnerName = winnerPlayer
    ? winnerPlayer.color === myColor
      ? t('common.you')
      : localizedBotName(t, winnerPlayer.username)
    : t(winnerColorName);

  const modeLabels: Record<string, string> = {
    pvp: t('results.modePvp'),
    pve: t('results.modePve'),
    hotseat: t('results.modeHotseat'),
  };
  const modeLabel = modeLabels[result.mode] || t('results.modeDefault');

  // Calculate outcome display title
  let outcomeTitle: string;
  if (result.abandoned || !hasRealWinner) {
    outcomeTitle = t('results.outcomeAbandoned');
  } else if (result.mode === 'hotseat') {
    outcomeTitle = t('results.outcomeMatchComplete');
  } else if (won) {
    outcomeTitle = t('results.outcomeVictory');
  } else {
    outcomeTitle = t('results.outcomeDefeat');
  }

  // Render rank badge with correct 1st, 2nd, 3rd, 4th ordinal suffixes (only when not abandoned)
  const renderRankBadge = (rank: number, isWinner: boolean) => {
    if (!hasRealWinner) return null;
    if (isWinner) {
      return <span className={`${PAY_TAG_BASE} ${PAY_TAG_WIN}`}>{t('results.firstPlace')}</span>;
    }
    if (rank === 2) {
      return (
        <span className={`${PAY_TAG_BASE} ${PAY_TAG_RUNNER}`}>{t('results.secondPlace')}</span>
      );
    }
    if (rank === 3) {
      return <span className={`${PAY_TAG_BASE} ${PAY_TAG_THIRD}`}>{t('results.thirdPlace')}</span>;
    }
    return <span className={`${PAY_TAG_BASE} ${PAY_TAG_FOURTH}`}>{t('results.fourthPlace')}</span>;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.82)',
        backdropFilter: 'blur(8px)',
        padding: '20px 10px',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 520,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Ticket Dispenser Container */}
        <section className={TICKET_CONTAINER} style={{ margin: 0, width: '100%' }}>
          <section className={RESULTS_INVOICE_CONTAINER}>
            {/* Bottom part of slot chassis (BEHIND ticket: z-index 2) */}
            <div className={INVOICE_SLOT_BOTTOM}>
              <div className={SLOT_HOLE_BOTTOM}></div>
            </div>

            {/* Mask Container - Dispenses directly out of slot (z-index 10) */}
            <div className={TICKET_PAPER_WRAPPER}>
              {/* Animated Dispensed Invoice Ticket */}
              <div className={RESULTS_INVOICE}>
                <span className={TICKET_NOTCH_LEFT}></span>
                <span className={TICKET_NOTCH_RIGHT}></span>
                <h2 className={INVOICE_TITLE}>{t('results.matchInvoiceTitle')}</h2>

                <p className={INVOICE_AMOUNT}>
                  {t('results.outcomeLabel')} <span className={INVOICE_VALUE}>{outcomeTitle}</span>
                </p>
                <p className={INVOICE_AMOUNT}>
                  {t('results.modeLabel')} <span className={INVOICE_VALUE}>{modeLabel}</span>
                </p>
                {hasRealWinner && (
                  <p className={INVOICE_AMOUNT}>
                    {t('results.championLabel')}{' '}
                    <span className={INVOICE_VALUE}>{winnerName.toUpperCase()}</span>
                  </p>
                )}

                <hr
                  style={{
                    border: 'none',
                    height: 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.15)',
                    margin: '0.75em 0',
                  }}
                />

                {/* Player Roster Breakdown List */}
                <ul className={PAYERS_LIST}>
                  {ranked.map((p, index) => {
                    const isWinner = index === 0 && hasRealWinner;
                    const isMe = p.color === myColor;
                    // Only when the id matched: the name and first-human fallbacks
                    // can land on another seat, which must not reuse our photo.
                    const mySeat = isMe && !!user?.id && p.userId === user.id;
                    const pName = isMe ? t('common.you') : localizedBotName(t, p.username);

                    return (
                      <li key={p.color} className={PAYERS_LI}>
                        <div className={PAYER_IMAGE_CONTAINER}>
                          <UserAvatar
                            // Bots carry their raw label, so the seed is the assistant
                            // name: one bot keeps one avatar in the lobby and the arena.
                            username={avatarSeed(p.username)}
                            // Seat facts from the engine's roster; our own seat uses the store's
                            // live /me values. See docs/frontend/frontend-results-module.md.
                            userId={mySeat ? user.id : p.userId}
                            isBot={p.isBot}
                            hasAvatarPhoto={
                              mySeat ? (user.hasAvatarPhoto ?? false) : (p.hasAvatarPhoto ?? false)
                            }
                            avatarStyle={p.avatarStyle}
                            size={40}
                            fallbackStyle={{
                              width: 40,
                              height: 40,
                              borderRadius: '50%',
                              background: 'rgba(0, 240, 255, 0.2)',
                              color: 'var(--accent-cyan)',
                              display: 'grid',
                              placeItems: 'center',
                              fontWeight: 'bold',
                              fontSize: '0.9rem',
                            }}
                          />
                        </div>
                        <p className={PAYERS_LI_P}>
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              // The rank badge is `shrink-0`, so the name must be able to
                              // shrink for its ellipsis to apply.
                              minWidth: 0,
                            }}
                          >
                            {pName} ({p.piecesInGoal}/4)
                          </span>
                          {renderRankBadge(index + 1, isWinner)}
                        </p>
                      </li>
                    );
                  })}
                </ul>

                {/* Action Buttons */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    width: '100%',
                    marginTop: '1.2em',
                  }}
                >
                  {errorText && (
                    <div
                      role="alert"
                      style={{
                        color: '#ff0055',
                        fontSize: '0.78rem',
                        fontFamily: 'var(--font-mono)',
                        textAlign: 'center',
                        lineHeight: 1.4,
                      }}
                    >
                      {errorText}
                    </div>
                  )}

                  {onPlayAgain && (
                    <button
                      className={PAY_NOW_BTN}
                      onClick={() => {
                        retroAudio.playUiBeep(720, 0.05);
                        onPlayAgain();
                      }}
                    >
                      {t('guest.playAgainBtn')}
                    </button>
                  )}

                  <button
                    className={PAY_NOW_BTN}
                    onClick={() => {
                      retroAudio.playUiBeep(600, 0.05);
                      onReturnToLobby();
                    }}
                  >
                    {returnLabel ?? t('results.returnToLobbyBtn')}
                  </button>

                  {onClose && (
                    <button
                      className={RETRO_BTN}
                      onClick={() => {
                        retroAudio.playUiBeep(520, 0.05);
                        onClose();
                      }}
                      style={{
                        width: '100%',
                        justifyContent: 'center',
                        background: 'rgba(255, 255, 255, 0.08)',
                        borderColor: 'rgba(0, 240, 255, 0.4)',
                        color: 'var(--accent-cyan)',
                        fontSize: '0.76rem',
                        padding: '10px 0',
                      }}
                    >
                      {t('game.viewBoardBtn', 'VIEW BOARD')}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Top part of slot chassis (IN FRONT OF ticket: z-index 20) */}
            <div className={INVOICE_SLOT_TOP}>
              <div className={VENDING_HEADER_BAR}></div>
              <div className={SLOT_HOLE_TOP}></div>
            </div>
          </section>
        </section>
      </div>
    </div>
  );
}
