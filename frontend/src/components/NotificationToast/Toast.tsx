import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { Notification, ToastDismissReason } from '../../hooks/useNotifications';
import { useApp } from '../../store';
import { retroAudio } from '../../utils/audio';
import { RETRO_BTN } from '../../styles/tw';
import { getToastInfo, TOAST_AUTOCLOSE_MS } from './notificationToastInfo';
import { useToastActions } from './useToastActions';

export function Toast({
  notification,
  onDismiss,
  index,
}: {
  notification: Notification;
  onDismiss: (id: string, reason: ToastDismissReason) => void;
  index: number;
}) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  // The accepted challenge's handoff is applied like any other room entry: the seat
  // the server just wrote is what the game page reads.
  const { notifAutoClose } = useApp();
  // The band's sentence when an answer is refused. The four named failures
  // (`CHALLENGER_OFFLINE`, `CHALLENGER_BUSY`, `CHALLENGEE_OFFLINE`, `CHALLENGEE_BUSY`)
  // exist to be read, so the toast stays up and prints one instead of vanishing.
  const [actionError, setActionError] = useState<string | null>(null);

  // Play audio alert and slide in on mount.
  useEffect(() => {
    try {
      retroAudio.playUiBeep(1200, 0.04);
      setTimeout(() => {
        retroAudio.playUiBeep(1760, 0.08);
      }, 60);
    } catch {
      // Audio safety fallback
    }

    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss on the shared clock, unless the preference is off (22.5): then the
  // card stays until its `x`. The clock only hides either way: the entry stays
  // unread in the bell, because nobody was looking (22.3).
  useEffect(() => {
    if (!notifAutoClose) return;
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(notification.id, 'timeout'), 350);
    }, TOAST_AUTOCLOSE_MS);
    return () => clearTimeout(t);
  }, [notification.id, onDismiss, notifAutoClose]);

  // The `x`: the entry is dealt with, so it goes with the card.
  const dismiss = () => {
    try {
      retroAudio.playUiBeep(400, 0.04);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    setVisible(false);
    setTimeout(() => onDismiss(notification.id, 'read'), 350);
  };

  const { acceptInvite, declineInvite, enterTable, acceptFriend, declineFriend } = useToastActions({
    notification,
    onDismiss,
    dismiss,
    setActionError,
  });

  const { tag, badgeLabel, badgeColor, badgeBg, fromUser, actionMessage } = getToastInfo(
    notification,
    t,
  );
  const isInvite = notification.type === 'game_invite';
  const isAcceptedChallenge = notification.type === 'challenge_accepted';

  const toastStyle: CSSProperties = {
    position: 'fixed',
    right: 28,
    bottom: 28 + index * 150,
    zIndex: 99999,
    width: 430,
    background: 'rgb(var(--bg-panel-rgb) / 0.97)',
    border: '2px solid var(--accent-pink)',
    boxShadow:
      '0 0 24px rgb(var(--accent-pink-rgb) / 0.4), 0 20px 48px rgb(var(--shade-rgb) / 0.95)',
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backdropFilter: 'blur(12px)',
    transform: visible ? 'translateX(0)' : 'translateX(120%)',
    opacity: visible ? 1 : 0,
    transition: 'transform 0.35s cubic-bezier(.22,1,.36,1), opacity 0.35s ease',
    pointerEvents: 'auto',
  };

  return (
    <div style={toastStyle}>
      {/* Toast Titlebar Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'rgb(var(--accent-pink-rgb) / 0.22)',
          borderBottom: '1.5px solid rgb(var(--accent-pink-rgb) / 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--accent-pink)',
              boxShadow: '0 0 8px var(--accent-pink)',
              animation: 'pulse 1s infinite',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-heading, monospace)',
              fontSize: '0.8rem',
              color: 'var(--accent-pink)',
              letterSpacing: 1,
              fontWeight: 'bold',
            }}
          >
            {t('notifications.incomingTransmission')} {tag}
          </span>
        </div>

        <button
          onClick={dismiss}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent-pink)',
            cursor: 'pointer',
            fontSize: '1.1rem',
            padding: '0 4px',
            lineHeight: 1,
            fontWeight: 'bold',
          }}
          title={t('notifications.dismissAlert')}
        >
          &times;
        </button>
      </div>

      {/* Toast Content Body with Type Identifier Badge */}
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* Notification Type Identifier Badge (e.g. "1v1", "LINK", "ACHV") */}
          <div
            style={{
              width: 48,
              height: 38,
              borderRadius: 4,
              background: badgeBg,
              border: `1.5px solid ${badgeColor}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-heading, monospace)',
              fontSize: '0.78rem',
              fontWeight: 'bold',
              color: badgeColor,
              boxShadow: `0 0 12px color-mix(in srgb, ${badgeColor} 21%, transparent)`,
              letterSpacing: 1,
              flexShrink: 0,
            }}
          >
            {badgeLabel}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
            {fromUser ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontFamily: 'var(--font-heading, monospace)',
                    fontSize: '0.82rem',
                    color: 'var(--accent-yellow, #ffe600)',
                    textShadow: '0 0 8px rgb(var(--accent-yellow-rgb) / 0.6)',
                    letterSpacing: 1,
                    fontWeight: 'bold',
                  }}
                >
                  @{fromUser.toUpperCase()}
                </span>
                <span
                  style={{
                    fontSize: '0.62rem',
                    background: 'rgb(var(--accent-cyan-rgb) / 0.18)',
                    border: '1px solid var(--accent-cyan)',
                    color: 'var(--accent-cyan)',
                    padding: '1px 6px',
                    borderRadius: 2,
                    fontFamily: 'var(--font-mono, monospace)',
                    fontWeight: 'bold',
                    letterSpacing: 0.5,
                  }}
                >
                  {t('notifications.pilotLabel')}
                </span>
              </div>
            ) : (
              <span
                style={{
                  fontFamily: 'var(--font-heading, monospace)',
                  fontSize: '0.82rem',
                  color: 'var(--accent-cyan)',
                  letterSpacing: 1,
                  fontWeight: 'bold',
                }}
              >
                {t('notifications.systemAlert')}
              </span>
            )}

            <div
              style={{
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '0.82rem',
                color: actionError ? 'var(--accent-pink, #ff007f)' : '#e4e4e4',
                lineHeight: 1.35,
              }}
            >
              {actionError ?? actionMessage}
            </div>
          </div>
        </div>

        {/* Action Buttons for Game Invites: a seat offered in a room, or a challenge
            that has no room yet. Both answer here, in one press each. */}
        {isInvite && (
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              onClick={() => {
                void acceptInvite();
              }}
              className={RETRO_BTN}
              style={{
                flex: 1,
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgb(var(--accent-cyan-rgb) / 0.18)',
                border: '2px solid var(--accent-cyan)',
                color: 'var(--accent-cyan)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('nav.acceptInvite').toUpperCase()}
            </button>
            <button
              onClick={() => {
                void declineInvite();
              }}
              className={RETRO_BTN}
              style={{
                flex: 1,
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgb(var(--accent-pink-rgb) / 0.15)',
                border: '2px solid rgb(var(--accent-pink-rgb) / 0.5)',
                color: 'var(--accent-pink)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('nav.declineInvite').toUpperCase()}
            </button>
          </div>
        )}

        {/* The challenger's one press out of the toast: the room exists, they are
            seated in it, and the lobby's rejoin is what opens it. */}
        {isAcceptedChallenge && (
          <div style={{ display: 'flex', marginTop: 4 }}>
            <button
              onClick={enterTable}
              className={RETRO_BTN}
              style={{
                width: '100%',
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgb(var(--accent-cyan-rgb) / 0.18)',
                border: '2px solid var(--accent-cyan)',
                color: 'var(--accent-cyan)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('notifications.enterTable')}
            </button>
          </div>
        )}

        {/* Action Buttons for Friend Requests */}
        {notification.type === 'friend_request' && (
          <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
            <button
              onClick={() => {
                void acceptFriend();
              }}
              className={RETRO_BTN}
              style={{
                flex: 1,
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgb(var(--accent-cyan-rgb) / 0.18)',
                border: '2px solid var(--accent-cyan)',
                color: 'var(--accent-cyan)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('nav.acceptInvite').toUpperCase()}
            </button>
            <button
              onClick={() => {
                void declineFriend();
              }}
              className={RETRO_BTN}
              style={{
                flex: 1,
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgb(var(--accent-pink-rgb) / 0.15)',
                border: '2px solid rgb(var(--accent-pink-rgb) / 0.5)',
                color: 'var(--accent-pink)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('nav.declineInvite').toUpperCase()}
            </button>
          </div>
        )}

        {/* Action Button for Friend Accepted */}
        {notification.type === 'friend_accepted' && (
          <div style={{ display: 'flex', marginTop: 4 }}>
            <button
              onClick={dismiss}
              className={RETRO_BTN}
              style={{
                width: '100%',
                height: 38,
                padding: '0 16px',
                fontSize: '0.78rem',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                background: 'rgb(var(--accent-yellow-rgb) / 0.12)',
                border: '2px solid var(--accent-yellow, #ffe600)',
                color: 'var(--accent-yellow, #ffe600)',
                boxSizing: 'border-box',
                margin: 0,
              }}
            >
              {t('notifications.dismiss')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
