import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../../components/UserAvatar';
import { RETRO_BTN } from '../../styles/tw';
import type { FriendRequestRow } from '../../friendshipFeed';

export function FriendRequestsPanel({
  requests,
  onAccept,
  onDecline,
}: {
  requests: FriendRequestRow[];
  onAccept: (requestId: string) => void;
  onDecline: (requestId: string) => void;
}) {
  const { t } = useTranslation();
  return (
                  <div
                    style={{
                      flex: 1,
                      background:
                        requests.length > 0
                          ? 'linear-gradient(180deg, rgb(var(--bg-card-rgb) / 0.95) 0%, rgb(var(--bg-primary-rgb) / 0.98) 100%)'
                          : 'rgb(var(--bg-panel-rgb) / 0.85)',
                      border:
                        requests.length > 0
                          ? '1.5px solid var(--accent-pink)'
                          : '1.5px solid rgb(var(--ink-rgb) / 0.15)',
                      boxShadow: requests.length > 0 ? '0 0 20px rgb(var(--accent-pink-rgb) / 0.25)' : 'none',
                      borderRadius: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      minHeight: 0,
                    }}
                  >
                    {/* Card Header */}
                    <div
                      style={{
                        padding: '10px 14px',
                        background:
                          requests.length > 0
                            ? 'rgb(var(--accent-pink-rgb) / 0.15)'
                            : 'rgb(var(--ink-rgb) / 0.04)',
                        borderBottom:
                          requests.length > 0
                            ? '1px solid rgb(var(--accent-pink-rgb) / 0.3)'
                            : '1px solid rgb(var(--ink-rgb) / 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: requests.length > 0 ? 'var(--accent-pink)' : 'var(--text-muted)',
                            boxShadow: requests.length > 0 ? '0 0 8px var(--accent-pink)' : 'none',
                          }}
                        />
                        <span
                          style={{
                            fontSize: '0.78rem',
                            color: requests.length > 0 ? 'var(--accent-pink)' : 'var(--text-main)',
                            fontFamily: 'var(--font-display)',
                            fontWeight: 900,
                            letterSpacing: '1px',
                          }}
                        >
                          {t('friends.friendRequestsBoxTitle', { count: requests.length })}
                        </span>
                      </div>

                      {requests.length > 0 && (
                        <span
                          style={{
                            fontSize: '0.66rem',
                            padding: '2px 7px',
                            borderRadius: 3,
                            background: 'linear-gradient(90deg, var(--accent-pink), var(--accent-purple))',
                            color: 'var(--text-main)',
                            fontFamily: 'var(--font-display)',
                            fontWeight: 900,
                            boxShadow: '0 0 8px rgb(var(--accent-pink-rgb) / 0.4)',
                          }}
                        >
                          {t('friends.badgeNewTag')}
                        </span>
                      )}
                    </div>

                    {/* Card Scrollable Content */}
                    <div
                      style={{
                        padding: '12px 14px',
                        flex: 1,
                        overflowY: 'auto',
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 9,
                      }}
                    >
                      {requests.length === 0 ? (
                        <div
                          style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--text-muted)',
                            fontSize: '0.76rem',
                            fontFamily: 'var(--font-display)',
                            textAlign: 'center',
                            gap: 6,
                            padding: '20px 10px',
                          }}
                        >
                          <span style={{ fontSize: '1.2rem', color: 'rgb(var(--ink-rgb) / 0.2)' }}>
                            ✦
                          </span>
                          <span>{t('friends.noPendingRequestsPrompt')}</span>
                        </div>
                      ) : (
                        requests.map((r) => (
                          <div
                            key={r.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '9px 12px',
                              background: 'rgb(var(--bg-raise-rgb) / 0.88)',
                              border: '1px solid rgb(var(--accent-pink-rgb) / 0.32)',
                              boxShadow: '0 0 10px rgb(var(--accent-pink-rgb) / 0.12)',
                              borderRadius: 6,
                              gap: 10,
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                minWidth: 0,
                              }}
                            >
                              <UserAvatar
                                username={r.username}
                                userId={r.userId}
                                hasAvatarPhoto={r.hasAvatarPhoto}
                                avatarStyle={r.avatarStyle}
                                size={34}
                                fallbackStyle={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: 4,
                                  background: 'rgb(var(--bg-panel-rgb) / 0.95)',
                                  color: 'var(--accent-pink)',
                                  display: 'grid',
                                  placeItems: 'center',
                                  fontWeight: 900,
                                }}
                              />
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontSize: '0.86rem',
                                    fontWeight: 900,
                                    color: 'var(--text-main)',
                                    fontFamily: 'var(--font-display)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                >
                                  {r.displayName ?? r.username}
                                </div>
                                <div
                                  style={{
                                    color: 'var(--accent-cyan)',
                                    fontSize: '0.64rem',
                                    fontFamily: 'var(--font-display)',
                                    marginTop: 1,
                                  }}
                                >
                                  {t('friends.sentYouRequestText')}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              <button
                                className={RETRO_BTN}
                                onClick={() => {
                                  void onAccept(r.id);
                                }}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '0.7rem',
                                  fontFamily: 'var(--font-display)',
                                  fontWeight: 900,
                                  background: 'var(--state-on)',
                                  color: 'var(--state-on-ink)',
                                  borderColor: 'var(--state-on)',
                                  borderRadius: 3,
                                }}
                                title={t('friends.acceptTooltip')}
                              >
                                {t('friends.acceptActionBtn')}
                              </button>
                              <button
                                className={RETRO_BTN}
                                onClick={() => {
                                  void onDecline(r.id);
                                }}
                                style={{
                                  padding: '4px 8px',
                                  fontSize: '0.7rem',
                                  fontFamily: 'var(--font-display)',
                                  borderRadius: 3,
                                }}
                                title={t('friends.declineTooltip')}
                              >
                                {t('friends.declineActionBtn')}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
  );
}
