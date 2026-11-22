import { useTranslation } from 'react-i18next';
import { NavDock } from '../../components/NavDock';
import { UserAvatar } from '../../components/UserAvatar';
import { navigate } from '../../router';
import { retroAudio } from '../../utils/audio';
import { CRT_SCREEN, HERO_SECTION, HERO_TITLE, RETRO_WINDOW, RETRO_BTN } from '../../styles/tw';
import { UsernameCopyChip } from './UsernameCopyChip';
import type { UserProfile } from './profileTypes';

export function BlockedProfileCard({
  profile,
  crtEnabled,
  unblocking,
  onUnblock,
}: {
  profile: UserProfile;
  crtEnabled: boolean;
  unblocking: boolean;
  onUnblock: () => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <div className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''}`} id="crtScreen">
        <div className="relative z-10 box-border flex min-h-screen w-full flex-row items-start justify-center gap-7 px-6 py-8">
          <NavDock activeRoute="/profile" />

          <div className="sticky top-8 w-full min-w-0 flex-1" style={{ margin: 0, padding: 0 }}>
            <header
              className={HERO_SECTION}
              style={{ marginTop: 0, padding: '16px 0 18px', marginBottom: 12, flexShrink: 0 }}
            >
              <h1
                className={HERO_TITLE}
                style={{ fontSize: '1.45rem', margin: 0, letterSpacing: '1.5px' }}
              >
                {t('profile.heroTitle')}
              </h1>
            </header>

            <section className={RETRO_WINDOW} style={{ width: '100%', padding: 26 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, minWidth: 0 }}>
                <div
                  style={{
                    padding: 4,
                    borderRadius: 8,
                    background: 'linear-gradient(135deg, var(--accent-pink), var(--accent-cyan))',
                    boxShadow: '0 0 20px rgb(var(--accent-cyan-rgb) / 0.4)',
                    flexShrink: 0,
                  }}
                >
                  <UserAvatar
                    username={profile.username}
                    userId={profile.id}
                    hasAvatarPhoto={profile.hasAvatarPhoto}
                    avatarStyle={profile.avatarStyle}
                    size={95}
                    fallbackStyle={{
                      width: 95,
                      height: 95,
                      borderRadius: 6,
                      background: 'rgb(var(--bg-void-rgb) / 0.95)',
                      color: 'var(--accent-cyan)',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: '2.3rem',
                      fontWeight: 900,
                      fontFamily: 'var(--font-display)',
                    }}
                  />
                </div>

                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '2rem',
                      fontWeight: 900,
                      color: 'var(--text-main)',
                      letterSpacing: '0.04em',
                      lineHeight: 1.05,
                      textShadow: '0 0 20px rgb(var(--accent-cyan-rgb) / 0.65)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {profile.displayName ?? profile.username}
                  </div>
                  {/* The handle is click-to-copy here too: a block hides the
                      relationship, not the identifier. */}
                  <div style={{ marginTop: 6 }}>
                    <UsernameCopyChip username={profile.username} />
                  </div>
                </div>
              </div>

              <div
                style={{
                  marginTop: 22,
                  padding: '14px 16px',
                  borderRadius: 7,
                  background: 'rgb(var(--bg-panel-rgb) / 0.9)',
                  border: '1.5px solid rgb(var(--state-off-rgb) / 0.45)',
                  boxShadow: '0 0 14px rgb(var(--state-off-rgb) / 0.12)',
                }}
              >
                <div
                  style={{
                    color: 'var(--state-off)',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 900,
                    fontSize: '0.82rem',
                    letterSpacing: '0.06em',
                  }}
                >
                  {t('profile.blockedCardTitle')}
                </div>
                <p
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.86rem',
                    lineHeight: 1.5,
                    margin: '8px 0 0',
                  }}
                >
                  {profile.visibility === 'blocked-by-you'
                    ? t('profile.blockedByYou')
                    : t('profile.blockedByThem')}
                </p>

                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  {profile.visibility === 'blocked-by-you' && (
                    <button
                      className={RETRO_BTN}
                      onClick={() => {
                        if (unblocking) return;
                        retroAudio.playUiBeep(520, 0.05);
                        onUnblock();
                      }}
                      disabled={unblocking}
                      style={{
                        padding: '5px 12px',
                        fontSize: '0.72rem',
                        color: 'var(--accent-cyan)',
                        borderColor: 'rgb(var(--accent-cyan-rgb) / 0.45)',
                        fontFamily: 'var(--font-display)',
                        borderRadius: 4,
                        cursor: unblocking ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {unblocking ? t('profile.unblocking') : t('profile.unblockButton')}
                    </button>
                  )}
                  <button
                    className={RETRO_BTN}
                    onClick={() => {
                      retroAudio.playUiBeep(640, 0.04);
                      navigate('/profile');
                    }}
                    style={{
                      padding: '5px 12px',
                      fontSize: '0.72rem',
                      color: 'var(--accent-cyan)',
                      borderColor: 'rgb(var(--accent-cyan-rgb) / 0.45)',
                      fontFamily: 'var(--font-display)',
                      borderRadius: 4,
                    }}
                  >
                    {t('profile.returnToMyProfileBtn')}
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
