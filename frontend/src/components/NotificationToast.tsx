import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { DigestReport, Notification, ToastDismissReason } from '../hooks/useNotifications';
import { navigate } from '../router';
import { apiFetch, postApi } from '../api';
import { useApp, type ActiveMatch } from '../store';
import { retroAudio } from '../utils/audio';
import { RETRO_BTN } from '../styles/tw';
import { NotificationRow } from './NotificationRow';
import { offerMechanism, offerMechanismLabel, parseNotificationPayload } from './notificationParts';

// **The clock**
// One window for every card (22.4): the live card, the boot report, and any card
// added later. The entrance (30 ms) and the exit (350 ms) are transitions, not
// windows, and stay where they are.
export const TOAST_AUTOCLOSE_MS = 8_000;

// **Helpers**

function getToastInfo(
  n: Notification,
  t: (key: string, options?: Record<string, unknown>) => string,
): {
  tag: string;
  badgeLabel: string;
  badgeColor: string;
  badgeBg: string;
  fromUser: string | null;
  actionMessage: string;
} {
  const payload = parseNotificationPayload(n.payload);
  const from = payload.fromUsername ? String(payload.fromUsername) : null;

  switch (n.type) {
    case 'friend_request':
      return {
        tag: t('notifications.linkReqTag'),
        badgeLabel: 'LINK',
        badgeColor: 'var(--accent-pink, #ff007f)',
        badgeBg: 'rgba(255, 0, 127, 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendReq'),
      };
    case 'friend_accepted':
      return {
        tag: t('notifications.linkEstablishedTag'),
        badgeLabel: 'SYNC',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendAccepted'),
      };
    case 'game_invite':
      // Two mechanisms, one type (22.9): a challenge asks for a duel, a room
      // invite offers a seat in a table that already exists. The row says which
      // one it is, and the badge no longer guesses at a headcount the room will
      // decide at kickoff.
      return offerMechanism(payload) === 'room'
        ? {
            tag: t('notifications.matchInviteTag'),
            badgeLabel: offerMechanismLabel('room'),
            badgeColor: 'var(--accent-cyan, #00f0ff)',
            badgeBg: 'rgba(0, 240, 255, 0.18)',
            fromUser: from,
            actionMessage: t('notifications.actionMatchInvite'),
          }
        : {
            tag: t('notifications.matchChallengeTag'),
            badgeLabel: offerMechanismLabel('challenge'),
            badgeColor: 'var(--accent-cyan, #00f0ff)',
            badgeBg: 'rgba(0, 240, 255, 0.18)',
            fromUser: from,
            actionMessage: t('notifications.actionMatchChallenge'),
          };
    case 'achievement': {
      const nameKey = payload.nameKey as string | undefined;
      const name = nameKey ? t(nameKey) : '';
      return {
        tag: t('notifications.achievementTag'),
        badgeLabel: 'ACHV',
        badgeColor: 'var(--state-on)',
        badgeBg: 'rgb(var(--state-on-rgb) / 0.18)',
        fromUser: null,
        actionMessage: name ? `${name}!` : t('notifications.achievementUnlocked'),
      };
    }
    case 'match_finished': {
      const rank = payload.rank;
      const winner = payload.winnerUsername ? String(payload.winnerUsername) : 'A rival';
      return {
        tag: t('notifications.matchEndTag'),
        badgeLabel: 'END',
        badgeColor: 'var(--state-on)',
        badgeBg: 'rgb(var(--state-on-rgb) / 0.18)',
        fromUser: null,
        actionMessage:
          rank === 1
            ? t('notifications.matchEndWonText')
            : t('notifications.matchEndLostText', { winner }),
      };
    }
    case 'match_cancelled':
      return {
        tag: t('notifications.matchCancelledTag'),
        badgeLabel: 'ABRT',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionMatchCancelled'),
      };
    case 'challenge_accepted':
      // The challenger's half of an accept (19.6): the room exists now, and they are
      // already seated in it, so the toast's one press goes to the table.
      return {
        tag: t('notifications.matchAcceptedTag'),
        badgeLabel: 'DUEL',
        badgeColor: 'var(--accent-cyan, #00f0ff)',
        badgeBg: 'rgba(0, 240, 255, 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionMatchAccepted'),
      };
    case 'match_abandoned':
      return {
        tag: t('notifications.matchAbandonedTag'),
        badgeLabel: 'LEFT',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: null,
        actionMessage: t('notifications.matchAbandonedText'),
      };
    case 'friend_removed':
      return {
        tag: t('notifications.friendRemovedTag'),
        badgeLabel: 'LINK',
        badgeColor: 'var(--accent-pink, #ff007f)',
        badgeBg: 'rgba(255, 0, 127, 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendRemoved'),
      };
    case 'friend_declined':
      return {
        tag: t('notifications.friendDeclinedTag'),
        badgeLabel: 'LINK',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: from,
        actionMessage: t('notifications.actionFriendDeclined'),
      };
    case 'friend_online':
      return {
        tag: t('notifications.friendOnlineTag'),
        badgeLabel: 'ON',
        badgeColor: 'var(--state-on)',
        badgeBg: 'rgb(var(--state-on-rgb) / 0.18)',
        fromUser: String(payload.displayName ?? from),
        actionMessage: t('notifications.actionFriendOnline', {
          displayName: payload.displayName ?? from,
        }),
      };
    case 'friend_offline':
      return {
        tag: t('notifications.friendOfflineTag'),
        badgeLabel: 'OFF',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: String(payload.displayName ?? from),
        actionMessage: t('notifications.actionFriendOffline', {
          displayName: payload.displayName ?? from,
        }),
      };
    // A friend entered a match (M3's playing edge): the same transient toast shape as
    // the two above, saying what the dot now says.
    case 'friend_playing':
      return {
        tag: t('notifications.friendPlayingTag'),
        badgeLabel: 'INGAME',
        badgeColor: 'var(--accent-yellow, #ffe600)',
        badgeBg: 'rgb(var(--accent-yellow-rgb) / 0.18)',
        fromUser: String(payload.displayName ?? from),
        actionMessage: t('notifications.actionFriendPlaying', {
          displayName: payload.displayName ?? from,
        }),
      };
    case 'profile_updated': {
      const items = Array.isArray(payload.items) ? (payload.items as string[]) : [];
      const labels = items
        .map((i) => t(`notifications.profileItem${i.charAt(0).toUpperCase()}${i.slice(1)}`))
        .join(', ');
      return {
        tag: t('notifications.profileUpdatedTag'),
        badgeLabel: 'PROF',
        badgeColor: 'var(--accent-cyan, #00f0ff)',
        badgeBg: 'rgba(0, 240, 255, 0.18)',
        fromUser: null,
        actionMessage: t('notifications.profileUpdatedText', {
          item: labels || t('notifications.unknown'),
        }),
      };
    }
    case 'display_name_changed': {
      const oldName = payload.oldDisplayName ? String(payload.oldDisplayName) : from;
      const newName = payload.displayName
        ? String(payload.displayName)
        : t('notifications.unknown');
      return {
        tag: t('notifications.displayNameChangedTag'),
        badgeLabel: 'CALL',
        badgeColor: 'var(--accent-cyan, #00f0ff)',
        badgeBg: 'rgba(0, 240, 255, 0.18)',
        fromUser: null,
        actionMessage: t('notifications.displayNameChangedText', {
          displayName: oldName,
          newDisplayName: newName,
        }),
      };
    }
    default:
      return {
        tag: t('notifications.sysBroadcastTag'),
        badgeLabel: 'SYS',
        badgeColor: 'var(--accent-cyan, #00f0ff)',
        badgeBg: 'rgba(0, 240, 255, 0.18)',
        fromUser: null,
        actionMessage: t('notifications.actionSysBroadcast'),
      };
  }
}

// **Single Toast**

function Toast({
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
  const { setActiveMatch, notifAutoClose } = useApp();
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

  // Accept an invitation. A room invite carries the room, so the lobby claims a corner
  // from it; a challenge carries no room at all (19.6), so the accept is the request
  // that makes one — and the answer is the seat.
  const acceptInvite = async () => {
    try {
      retroAudio.playUiBeep(880, 0.08);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    if (offerMechanism(p) === 'challenge') {
      const fromId = typeof p.fromUserId === 'string' ? p.fromUserId : '';
      if (!fromId) {
        dismiss();
        return;
      }
      try {
        const seat = await postApi<NonNullable<ActiveMatch>>(
          `/api/friends/challenges/${fromId}/accept`,
          {},
        );
        setActiveMatch(seat);
        onDismiss(notification.id, 'read');
        navigate(`/game?gameId=${seat.gameId}`);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : t('friends.genericError'));
      }
      return;
    }
    // The invite carries the room, not a seat: accepting lands in the lobby with the
    // code filled in and the corner claimed there. A seat held elsewhere is left
    // alone: the lobby's lock refuses the claim and the player aborts it themselves.
    onDismiss(notification.id, 'read');
    const code = typeof p.inviteCode === 'string' ? p.inviteCode : '';
    navigate(code ? `/gamelobby?join=${encodeURIComponent(code)}` : '/gamelobby');
  };

  // Decline a challenge. The one act the refusal ladder counts: the server answers
  // with the rung it wrote, and the toast only has to go away.
  const declineInvite = async () => {
    try {
      retroAudio.playUiBeep(400, 0.05);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    const fromId = typeof p.fromUserId === 'string' ? p.fromUserId : '';
    if (offerMechanism(p) === 'challenge' && fromId) {
      try {
        await postApi(`/api/friends/challenges/${fromId}/decline`, {});
      } catch {
        // Ignore: a refusal that cannot be recorded still hides the offer.
      }
    }
    dismiss();
  };

  // Enter the table an accepted challenge made. The challenger is already seated in
  // it, so the lobby's own rejoin path is what opens the room.
  const enterTable = () => {
    try {
      retroAudio.playUiBeep(880, 0.08);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    onDismiss(notification.id, 'read');
    const code = typeof p.inviteCode === 'string' ? p.inviteCode : '';
    navigate(code ? `/gamelobby?join=${encodeURIComponent(code)}` : '/gamelobby');
  };

  // Accept a friend request directly from toast
  const acceptFriend = async () => {
    try {
      retroAudio.playUiBeep(880, 0.08);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    if (p.requestId) {
      try {
        await apiFetch(`/api/friends/accept/${p.requestId}`, { method: 'POST' });
      } catch {
        // Ignore: non-critical action; the toast still dismisses.
      }
    }
    dismiss();
  };

  // Decline a friend request directly from toast
  const declineFriend = async () => {
    try {
      retroAudio.playUiBeep(400, 0.05);
    } catch {
      // Ignore: a sound failure should never break the UI.
    }
    const p = parseNotificationPayload(notification.payload);
    if (p.requestId) {
      try {
        await apiFetch(`/api/friends/decline/${p.requestId}`, { method: 'POST' });
      } catch {
        // Ignore: non-critical action; the toast still dismisses.
      }
    }
    dismiss();
  };

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
    background: 'rgba(10, 4, 24, 0.97)',
    border: '2px solid var(--accent-pink, #ff007f)',
    boxShadow: '0 0 24px rgba(255, 0, 127, 0.4), 0 20px 48px rgb(var(--shade-rgb) / 0.95)',
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
          background: 'rgba(255, 0, 127, 0.22)',
          borderBottom: '1.5px solid rgba(255, 0, 127, 0.4)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#ff007f',
              boxShadow: '0 0 8px #ff007f',
              animation: 'pulse 1s infinite',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-heading, monospace)',
              fontSize: '0.8rem',
              color: 'var(--accent-pink, #ff007f)',
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
            color: 'var(--accent-pink, #ff007f)',
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
                    background: 'rgba(0, 240, 255, 0.18)',
                    border: '1px solid var(--accent-cyan, #00f0ff)',
                    color: 'var(--accent-cyan, #00f0ff)',
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
                  color: 'var(--accent-cyan, #00f0ff)',
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
                background: 'rgba(0, 240, 255, 0.18)',
                border: '2px solid var(--accent-cyan, #00f0ff)',
                color: 'var(--accent-cyan, #00f0ff)',
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
                background: 'rgba(255, 0, 127, 0.15)',
                border: '2px solid rgba(255, 0, 127, 0.5)',
                color: 'var(--accent-pink, #ff007f)',
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
                background: 'rgba(0, 240, 255, 0.18)',
                border: '2px solid var(--accent-cyan, #00f0ff)',
                color: 'var(--accent-cyan, #00f0ff)',
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
                background: 'rgba(0, 240, 255, 0.18)',
                border: '2px solid var(--accent-cyan, #00f0ff)',
                color: 'var(--accent-cyan, #00f0ff)',
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
                background: 'rgba(255, 0, 127, 0.15)',
                border: '2px solid rgba(255, 0, 127, 0.5)',
                color: 'var(--accent-pink, #ff007f)',
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

// **Toast Container**

export function NotificationToasts({
  toasts,
  onDismiss,
}: {
  toasts: Notification[];
  onDismiss: (id: string, reason: ToastDismissReason) => void;
}) {
  // Show at most 3 toasts at once: oldest ones get pushed off.
  const visible = toasts.slice(0, 3);

  return (
    <>
      {visible.map((n, i) => (
        <Toast key={n.id} notification={n} onDismiss={onDismiss} index={i} />
      ))}
    </>
  );
}

// **Digest Toast**

// The boot report (22.2): one card, once per page load, drawn from the unread
// snapshot the handshake delivered and then frozen. It counts every stored type
// except `profile_updated`, which is the user confirming their own act. Its `x`
// wipes the report and deletes nothing: the entries stay in the bell, which is
// where the detail lives. A report is not a row.
export function NotificationDigest({
  report,
  bottom,
  onOpen,
  onDismiss,
}: {
  report: DigestReport | null;
  /** Clearance from the viewport bottom, so it stacks above any live toasts. */
  bottom: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { notifAutoClose } = useApp();
  const [visible, setVisible] = useState(false);

  // The entrance is the live card's one tick (30 ms), awaited rather than synchronous
  // so it is a transition, not an extra render pass.
  useEffect(() => {
    const t = window.setTimeout(() => setVisible(true), 30);
    return () => window.clearTimeout(t);
  }, [report]);

  // The report obeys the same two rules as a live card (22.4 item 3): the shared
  // clock, or its `x`; and with the preference off it waits for the `x` alone.
  useEffect(() => {
    if (!report || !notifAutoClose) return;
    const timer = window.setTimeout(() => setVisible(false), TOAST_AUTOCLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [report, notifAutoClose]);

  // One press, two ways in: the header is a `role="button"` div, so a click and Enter
  // are the same gesture and get the same note — the one the bell plays when it opens
  // (720), because this opens that bell.
  const openPanel = () => {
    retroAudio.playUiBeep(720, 0.05);
    onOpen();
  };

  if (!report) return null;

  return (
    <div
      style={{
        position: 'fixed',
        right: 28,
        bottom,
        zIndex: 99999,
        width: 380,
        background: 'rgba(10, 4, 24, 0.97)',
        border: '2px solid var(--accent-cyan, #00f0ff)',
        boxShadow: '0 0 24px rgba(0, 240, 255, 0.35), 0 20px 48px rgb(var(--shade-rgb) / 0.95)',
        borderRadius: 4,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backdropFilter: 'blur(12px)',
        transform: visible ? 'translateX(0)' : 'translateX(120%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.35s cubic-bezier(.22,1,.36,1), opacity 0.35s ease',
        pointerEvents: 'auto',
      }}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={openPanel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') openPanel();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          cursor: 'pointer',
          borderBottom: '1px solid rgba(0, 240, 255, 0.25)',
        }}
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.78rem',
            fontWeight: 'bold',
            color: 'var(--text-main)',
            letterSpacing: 0.5,
          }}
        >
          {t('notifications.digestToast', { count: report.total })}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            retroAudio.playUiBeep(400, 0.05);
            onDismiss();
          }}
          aria-label={t('notifications.dismiss')}
          style={{
            background: 'transparent',
            border: '1px solid rgb(var(--ink-rgb) / 0.3)',
            color: 'var(--text-muted, #8a7a64)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.7rem',
            lineHeight: 1,
            padding: '3px 6px',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          x
        </button>
      </div>

      {/* The newest first, and scrollable: the report never grows, so the list is
          as long as the load was. */}
      <div style={{ maxHeight: 300, overflowY: 'auto' }}>
        {report.rows.map((n) => (
          <NotificationRow key={n.id} notification={n} />
        ))}
      </div>
    </div>
  );
}
