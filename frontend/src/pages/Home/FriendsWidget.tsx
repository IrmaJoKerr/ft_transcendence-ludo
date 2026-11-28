import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../../components/UserAvatar';
import { navigate } from '../../router';
import { retroAudio } from '../../utils/audio';
import type { FriendRow } from '../../friendshipFeed';
import {
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_CONTROLS,
  WINDOW_BTN_MIN,
  WINDOW_BTN_MAX,
  RETRO_BTN,
  COL_4,
  DISPLAY_ELLIPSIS,
  DISPLAY_TITLE,
} from '../../styles/tw';
import { STATUS_STYLE } from './homeStyles';

export function FriendsWidget({
  friends,
  pendingRequestsCount,
}: {
  friends: FriendRow[] | null;
  pendingRequestsCount: number;
}) {
  const { t } = useTranslation();
  return (
    <section className={`${RETRO_WINDOW} ${COL_4}`} id="friendsWindow">
      <div className={WINDOW_HEADER}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>
            {t('friends.title').toUpperCase()} ({friends?.length ?? 0})
          </span>
          {pendingRequestsCount > 0 && (
            <button
              style={{
                background: 'var(--accent-pink)',
                color: 'var(--text-main)',
                fontSize: '0.6rem',
                padding: '2px 6px',
                borderRadius: 3,
                fontWeight: 'bold',
                animation: 'pulse 1.5s infinite',
                cursor: 'pointer',
                border: 'none',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                lineHeight: 1,
              }}
              onClick={(e) => {
                e.stopPropagation();
                retroAudio.playUiBeep(650, 0.05);
                navigate('/friends');
              }}
              title={t('home.pendingRequestsTooltip', { count: pendingRequestsCount })}
            >
              {pendingRequestsCount} {t('home.newBadge')}
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={RETRO_BTN}
            onClick={() => {
              retroAudio.playUiBeep(600, 0.05);
              navigate('/friends');
            }}
            style={{
              padding: '2px 8px',
              fontSize: '0.65rem',
              fontFamily: 'var(--font-display)',
              fontWeight: 900,
            }}
          >
            {t('homeExtended.manageBtn')}
          </button>
          <div className={WINDOW_CONTROLS}>
            <span className={WINDOW_BTN_MIN} />
            <span className={WINDOW_BTN_MAX} />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: '14px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          maxHeight: 390,
        }}
      >
        {friends === null ? (
          <div
            style={{
              padding: 28,
              textAlign: 'center',
              color: 'var(--accent-yellow)',
              fontSize: '0.82rem',
              fontFamily: 'var(--font-display)',
            }}
          >
            {t('homeExtended.scanningComms')}
          </div>
        ) : friends.length === 0 ? (
          <div
            style={{
              padding: 28,
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '0.82rem',
              fontFamily: 'var(--font-display)',
            }}
          >
            {t('homeExtended.noFriendsLinked')}
          </div>
        ) : (
          friends.map((f) => {
            const fStatus = STATUS_STYLE[f.status];

            return (
              <div
                key={f.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 6,
                  background: 'rgb(var(--bg-panel-rgb) / 0.85)',
                  border: '1.5px solid rgb(var(--accent-cyan-rgb) / 0.25)',
                  cursor: 'pointer',
                  transition: 'all 0.18s ease',
                  gap: 12,
                }}
                onClick={() => {
                  retroAudio.playUiBeep(640, 0.04);
                  navigate(`/profile?u=${encodeURIComponent(f.username)}`);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgb(var(--accent-cyan-rgb) / 0.16)';
                  e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                  e.currentTarget.style.transform = 'translateX(2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgb(var(--bg-panel-rgb) / 0.85)';
                  e.currentTarget.style.borderColor = 'rgb(var(--accent-cyan-rgb) / 0.25)';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    <div
                      style={{
                        padding: 2,
                        borderRadius: 5,
                        background:
                          'linear-gradient(135deg, var(--accent-pink), var(--accent-cyan))',
                        boxShadow: '0 0 8px rgb(var(--accent-cyan-rgb) / 0.3)',
                      }}
                    >
                      <UserAvatar
                        username={f.username}
                        userId={f.id}
                        avatarStyle={f.avatarStyle}
                        hasAvatarPhoto={f.hasAvatarPhoto}
                        size={38}
                        fallbackStyle={{
                          width: 38,
                          height: 38,
                          borderRadius: 4,
                          background: 'rgb(var(--bg-panel-rgb) / 0.95)',
                          color: 'var(--accent-cyan)',
                          display: 'grid',
                          placeItems: 'center',
                          fontWeight: 900,
                          fontSize: '0.95rem',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        position: 'absolute',
                        right: -2,
                        bottom: -2,
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: fStatus.color,
                        border: '2px solid rgb(var(--bg-primary-rgb))',
                        boxShadow: `0 0 6px ${fStatus.color}`,
                      }}
                    />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span className={DISPLAY_ELLIPSIS}>{f.displayName ?? f.username}</span>
                    </div>
                    <div
                      style={{
                        fontSize: '0.68rem',
                        color: fStatus.color,
                        fontFamily: 'var(--font-display)',
                        fontWeight: 'bold',
                        marginTop: 2,
                      }}
                    >
                      ● {fStatus.label.toUpperCase()} // {t('homeExtended.alliedPilot')}
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    textAlign: 'right',
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 4,
                  }}
                >
                  <span className={DISPLAY_TITLE}>{f.rating}</span>
                  <span
                    style={{
                      fontSize: '0.64rem',
                      color: 'var(--accent-cyan)',
                      fontFamily: 'var(--font-display)',
                      fontWeight: 900,
                    }}
                  >
                    ELO
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
