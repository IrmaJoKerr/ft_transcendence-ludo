import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../../components/UserAvatar';
import { navigate } from '../../router';
import { retroAudio } from '../../utils/audio';
import type { FriendRow as FriendRowData } from '../../friendshipFeed';
import { STATUS_STYLE } from '../../theme';
import { RETRO_BTN, DISPLAY_TITLE } from '../../styles/tw';
import { STATUS_KEYS } from './friendTypes';

export function FriendRow({
  friend,
  inviting,
  challengeSent,
  onChallenge,
  onConfirm,
}: {
  friend: FriendRowData;
  inviting: boolean;
  challengeSent: boolean;
  onChallenge: (friend: FriendRowData) => void;
  onConfirm: (kind: 'block' | 'remove', friend: FriendRowData) => void;
}) {
  const { t } = useTranslation();
  const f = friend;
  const fStatus = STATUS_STYLE[f.status];
  return (
                            <div
                              key={f.id}
                              onClick={() => {
                                retroAudio.playUiBeep(640, 0.04);
                                navigate(`/profile?u=${f.username}`);
                              }}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '11px 16px',
                                borderRadius: 6,
                                background: 'rgb(var(--bg-raise-rgb) / 0.82)',
                                border: `1.5px solid ${f.status === 'online' || f.status === 'playing' ? 'rgb(var(--accent-cyan-rgb) / 0.28)' : 'rgb(var(--ink-rgb) / 0.1)'}`,
                                boxShadow:
                                  f.status === 'online' || f.status === 'playing'
                                    ? '0 0 10px rgb(var(--accent-cyan-rgb) / 0.08)'
                                    : 'none',
                                transition: 'all 0.18s ease',
                                gap: 12,
                                cursor: 'pointer',
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = 'rgba(28, 10, 64, 0.95)';
                                e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                                e.currentTarget.style.boxShadow =
                                  '0 0 14px rgb(var(--accent-cyan-rgb) / 0.25)';
                                e.currentTarget.style.transform = 'translateX(3px)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = 'rgb(var(--bg-raise-rgb) / 0.82)';
                                e.currentTarget.style.borderColor =
                                  f.status === 'online' || f.status === 'playing'
                                    ? 'rgb(var(--accent-cyan-rgb) / 0.28)'
                                    : 'rgb(var(--ink-rgb) / 0.1)';
                                e.currentTarget.style.boxShadow =
                                  f.status === 'online' || f.status === 'playing'
                                    ? '0 0 10px rgb(var(--accent-cyan-rgb) / 0.08)'
                                    : 'none';
                                e.currentTarget.style.transform = 'translateX(0)';
                              }}
                              title={t('friends.viewProfileTooltip', { username: f.username })}
                            >
                              {/* Left: Avatar + Callsign + Presence */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 14,
                                  minWidth: 0,
                                  flex: 1,
                                }}
                              >
                                <div style={{ position: 'relative', flexShrink: 0 }}>
                                  <div
                                    style={{
                                      padding: 2,
                                      borderRadius: 6,
                                      background:
                                        'linear-gradient(135deg, var(--accent-pink), var(--accent-cyan))',
                                      boxShadow: '0 0 10px rgb(var(--accent-cyan-rgb) / 0.3)',
                                    }}
                                  >
                                    <UserAvatar
                                      username={f.username}
                                      userId={f.id}
                                      hasAvatarPhoto={f.hasAvatarPhoto}
                                      avatarStyle={f.avatarStyle}
                                      size={42}
                                      fallbackStyle={{
                                        width: 42,
                                        height: 42,
                                        borderRadius: 4,
                                        background: 'rgb(var(--bg-panel-rgb) / 0.95)',
                                        color: 'var(--accent-cyan)',
                                        display: 'grid',
                                        placeItems: 'center',
                                        fontWeight: 900,
                                        fontSize: '1rem',
                                      }}
                                    />
                                  </div>
                                  <span
                                    style={{
                                      position: 'absolute',
                                      right: -2,
                                      bottom: -2,
                                      width: 10,
                                      height: 10,
                                      borderRadius: '50%',
                                      background: fStatus.color,
                                      border: '2px solid rgb(var(--bg-primary-rgb))',
                                      boxShadow: `0 0 6px ${fStatus.color}`,
                                    }}
                                  />
                                </div>

                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: '0.94rem',
                                      fontWeight: 900,
                                      color: 'var(--text-main)',
                                      fontFamily: 'var(--font-display)',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      letterSpacing: '0.02em',
                                    }}
                                  >
                                    {f.displayName ?? f.username}
                                  </div>
                                  <div
                                    style={{
                                      fontSize: '0.7rem',
                                      color: fStatus.color,
                                      fontFamily: 'var(--font-display)',
                                      fontWeight: 'bold',
                                      marginTop: 2,
                                    }}
                                  >
                                    ● {t(STATUS_KEYS[f.status]).toUpperCase()}
                                  </div>
                                </div>
                              </div>

                              {/* Middle: Rating + Rank Badge */}
                              <div style={{ textAlign: 'right', flexShrink: 0, marginRight: 6 }}>
                                <div
                                  className={DISPLAY_TITLE}
                                >
                                  {f.rating}
                                </div>
                                <div
                                  style={{
                                    marginTop: 3,
                                    fontSize: '9px',
                                    fontWeight: 700,
                                    color: 'rgb(var(--accent-cyan-rgb) / 0.7)',
                                    letterSpacing: '1px',
                                    fontFamily: 'var(--font-display)',
                                  }}
                                >
                                  ELO
                                </div>
                              </div>

                              {/* Right: Actions */}
                              <div
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  flexShrink: 0,
                                }}
                              >
                                <button
                                  className={RETRO_BTN}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    retroAudio.playUiBeep(780, 0.06);
                                    onChallenge(f);
                                  }}
                                  disabled={inviting}
                                  style={{
                                    padding: '5px 12px',
                                    fontSize: '0.72rem',
                                    fontFamily: 'var(--font-display)',
                                    fontWeight: 900,
                                    background: 'linear-gradient(90deg, var(--accent-pink), var(--accent-purple))',
                                    color: 'var(--text-main)',
                                    borderColor: 'var(--accent-pink)',
                                    boxShadow: '0 0 10px rgb(var(--accent-pink-rgb) / 0.4)',
                                    opacity: inviting || challengeSent ? 0.6 : 1,
                                    borderRadius: 4,
                                  }}
                                  title={t('friends.challengeTooltip')}
                                >
                                  {inviting
                                    ? t('friends.invitingBtnState')
                                    : t('friends.challengeBtn')}
                                </button>

                                <button
                                  className={RETRO_BTN}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    retroAudio.playUiBeep(320, 0.08);
                                    onConfirm('remove', f);
                                  }}
                                  style={{
                                    padding: '5px 10px',
                                    fontSize: '0.72rem',
                                    fontFamily: 'var(--font-display)',
                                    fontWeight: 900,
                                    color: 'var(--text-main)',
                                    borderColor: 'rgb(var(--ink-rgb) / 0.2)',
                                    background: 'rgb(var(--ink-rgb) / 0.06)',
                                    borderRadius: 4,
                                  }}
                                  title={t('friends.removeTooltip')}
                                >
                                  {t('friends.removeComradeBtn')}
                                </button>

                                <button
                                  className={RETRO_BTN}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    retroAudio.playUiBeep(320, 0.08);
                                    onConfirm('block', f);
                                  }}
                                  style={{
                                    padding: '5px 10px',
                                    fontSize: '0.72rem',
                                    fontFamily: 'var(--font-display)',
                                    fontWeight: 900,
                                    color: 'var(--text-main)',
                                    borderColor: 'rgb(var(--state-off-rgb) / 0.5)',
                                    background: 'rgb(var(--state-off-rgb) / 0.14)',
                                    borderRadius: 4,
                                  }}
                                  title={t('friends.blockTooltip')}
                                >
                                  {t('friends.blockPilotBtn')}
                                </button>
                              </div>
                            </div>
  );
}
