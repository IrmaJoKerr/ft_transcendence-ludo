import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserAvatar } from '../components/UserAvatar';
import { NavDock } from '../components/NavDock';
import { LegalModal, type LegalDocType } from '../components/LegalModal';
import { useFriendships } from '../hooks/useFriendships';
import { useHeroScene } from '../hooks/useHeroScene';
import { useNotifications } from '../hooks/useNotifications';
import { navigate } from '../router';
import { useApp } from '../store';
import { retroAudio } from '../utils/audio';
import {
  CRT_SCREEN,
  GRID_BACKGROUND,
  STATIC_GRID,
  HERO_SECTION,
  HERO_TITLE,
  HERO_SUBTITLE,
  BADGE_BAR,
  RETRO_BADGE,
  DASHBOARD_GRID,
  RETRO_WINDOW,
  WINDOW_HEADER,
  WINDOW_CONTROLS,
  WINDOW_BTN_MIN,
  WINDOW_BTN_MAX,
  WINDOW_BODY,
  RETRO_BTN,
  ARCADE_CONTAINER,
  ARCADE_SCREEN_FRAME,
  ARCADE_START_OVERLAY,
  ARCADE_START_TITLE,
  ARCADE_START_SUB,
  COL_4,
  COL_8,
  RETRO_FOOTER,
  DISPLAY_ELLIPSIS,
  DISPLAY_TITLE,
} from '../styles/tw';

const STATUS_STYLE: Record<string, { label: string; color: string; border: string; bg: string }> = {
  online: {
    label: 'Online',
    color: 'var(--state-on)',
    border: 'rgb(var(--state-on-rgb) / 0.4)',
    bg: 'rgb(var(--state-on-rgb) / 0.12)',
  },
  playing: {
    label: 'In Game',
    color: 'var(--accent-yellow)',
    border: 'rgb(var(--accent-yellow-rgb) / 0.4)',
    bg: 'rgb(var(--accent-yellow-rgb) / 0.12)',
  },
  offline: {
    label: 'Offline',
    color: '#7a889b',
    border: 'rgba(122, 136, 155, 0.3)',
    bg: 'rgba(122, 136, 155, 0.08)',
  },
};

export function Home() {
  const { t } = useTranslation();
  const { user, onlineCount, theme } = useApp();
  const [legalModalDoc, setLegalModalDoc] = useState<LegalDocType | null>(null);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  // **2. THEME & CRT CONTROLS**
  // Read once at mount: the CRT look is a page-level choice, not a dock control.
  const [crtEnabled] = useState(() => localStorage.getItem('retro_crt') !== 'false');

  // **4. CYBER COMM // FRIEND LIST & AUDIO**
  // One initial read for first paint; from then on `friendship:changed` drives the
  // column and the request badge (socket D2). The 12 s poll, and the separate
  // request fetch it repeated, are gone.
  const { friends: friendRows, requests, loading: friendsLoading } = useFriendships();
  const friends = useMemo(
    () => (friendsLoading ? null : [...friendRows].sort((a, b) => b.rating - a.rating)),
    [friendRows, friendsLoading],
  );
  const pendingRequestsCount = requests.received.length;

  // 4b. HERO BADGE BAR: live site-wide online-player count, straight off the
  // session socket. D11 removed the first-paint REST read: the gateway hands a
  // freshly connected socket the number it last pushed, and the store keeps that
  // value for as long as the connection lives (so a remount still paints).

  // **5. HUB ARCADE CABINET: ATTRACT MODE & PRESS START**
  // The canvas, its scene and its one rAF loop belong to `useHeroScene`; the theme
  // decides which backdrop that loop paints. `Home` keeps only the launch.
  const canvasRef = useHeroScene(theme, t('homeExtended.heroMarquee'));
  const [isWarpingToLobby, setIsWarpingToLobby] = useState(false);

  const launchToLobby = useCallback(() => {
    if (isWarpingToLobby) return;
    setIsWarpingToLobby(true);
    // Arcade coin drop and power-up chime
    retroAudio.playUiBeep(987, 0.08);
    setTimeout(() => {
      retroAudio.playUiBeep(1318, 0.12);
    }, 90);
    setTimeout(() => {
      retroAudio.playUiBeep(1760, 0.2);
    }, 200);

    setTimeout(() => {
      navigate('/gamelobby');
    }, 350);
  }, [isWarpingToLobby]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        launchToLobby();
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [launchToLobby]);

  const username = user?.username ?? t('common.you');
  const displayName = user?.displayName ?? username;

  return (
    <>
      {/* Page shell: the era image (dimmed, rearmost) plus the static converging
         grid for synthwave. Every UI surface paints on top of both. */}
      <div className={GRID_BACKGROUND}>
        <div className={STATIC_GRID} />
      </div>

      {/* CRT Monitor Overlay FX Container */}
      <div
        className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''} flex min-h-screen w-full flex-col items-center justify-start`}
        id="crtScreen"
      >
        {/* Dynamic Full-Width Seated Sidebar & Content Layout Container */}
        <div className="relative z-10 box-border flex min-h-screen w-full flex-row items-start justify-center gap-7 px-6 py-8">
          {/* Left-Seated Navigation Dock */}
          <NavDock
            activeRoute="/home"
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
          />

          {/* Main Content Flow - Full Size Fit To Page */}
          <div className="sticky top-8 w-full min-w-0 flex-1" style={{ margin: 0, padding: 0 }}>
            {/* Hero Header Banner */}
            <header
              className={HERO_SECTION}
              style={{ marginTop: 0, padding: '20px 24px 18px', marginBottom: 24 }}
            >
              <h1 className={HERO_TITLE} style={{ marginBottom: 6 }}>
                {t('homeExtended.brandTitle')}
              </h1>
              <p className={HERO_SUBTITLE}>
                {t('home.greeting', { name: displayName.toUpperCase() })}
              </p>

              <div className={BADGE_BAR} style={{ marginTop: 14, gap: 10 }}>
                <span
                  className={RETRO_BADGE}
                  style={{
                    border: '1px solid var(--accent-cyan)',
                    color: 'var(--accent-cyan)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {t('homeExtended.onlinePlayers')} {onlineCount ?? '...'}
                </span>
              </div>
            </header>

            {/* Main Interactive Dashboard Grid */}
            <main className={`${DASHBOARD_GRID} dashboard-grid`}>
              {/* Widget 1: 3D Attract Mode Arcade Cabinet & Press Start */}
              <section className={`${RETRO_WINDOW} ${COL_8}`} id="arcadeWindow">
                <div className={WINDOW_HEADER}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span>{t('homeExtended.arcadeArenaTitle')}</span>
                  </div>
                  <div className={WINDOW_CONTROLS}>
                    <span className={WINDOW_BTN_MIN} />
                    <span className={WINDOW_BTN_MAX} />
                  </div>
                </div>
                <div className={`${WINDOW_BODY} ${ARCADE_CONTAINER}`}>
                  {/* Arcade Canvas Frame & Interactive Press Start Overlay */}
                  <div
                    className={ARCADE_SCREEN_FRAME}
                    style={
                      isWarpingToLobby
                        ? {
                            border: '4px solid rgb(var(--ink-rgb))',
                            boxShadow: '0 0 35px rgb(var(--ink-rgb)), 0 0 50px var(--accent-cyan)',
                          }
                        : undefined
                    }
                    onClick={launchToLobby}
                    title={t('home.enterLobbyTooltip')}
                  >
                    <canvas id="arcadeCanvas" ref={canvasRef} width={720} height={400} />

                    {/* Interactive Translucent Press Start Banner Overlay. The copy
                        follows the theme: the 70s room says LIFT OFF, and its card is
                        the one the stills drew. */}
                    <div className={ARCADE_START_OVERLAY}>
                      <span className={ARCADE_START_TITLE}>
                        {theme === 'retro70'
                          ? t('homeExtended.pressStartTitleRetro70')
                          : t('homeExtended.pressStartTitleSynthwave')}
                      </span>
                      <span className={ARCADE_START_SUB}>
                        {theme === 'retro70'
                          ? t('homeExtended.pressStartSubRetro70')
                          : t('homeExtended.pressStartSubSynthwave')}
                      </span>
                    </div>

                    {/* Hyperdrive Warp Flash on Launch */}
                    {isWarpingToLobby && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgb(var(--ink-rgb) / 0.85)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontFamily: 'var(--font-heading)',
                          fontSize: '1.2rem',
                          color: '#0d0221',
                          animation: 'pulse 0.2s infinite',
                        }}
                      >
                        {t('homeExtended.warpingToArena')}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* Widget 2: Friends List */}
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
                          outline: 'none',
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
                            background: 'rgba(10, 3, 26, 0.85)',
                            border: '1.5px solid rgba(0, 240, 255, 0.25)',
                            cursor: 'pointer',
                            transition: 'all 0.18s ease',
                            gap: 12,
                          }}
                          onClick={() => {
                            retroAudio.playUiBeep(640, 0.04);
                            navigate(`/profile?u=${encodeURIComponent(f.username)}`);
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'rgba(0, 240, 255, 0.16)';
                            e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                            e.currentTarget.style.transform = 'translateX(2px)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'rgba(10, 3, 26, 0.85)';
                            e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.25)';
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
                                  boxShadow: '0 0 8px rgba(0, 240, 255, 0.3)',
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
                                    background: 'rgba(10, 2, 28, 0.95)',
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
                                  border: '2px solid #0d0221',
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
                                <span
                                  className={DISPLAY_ELLIPSIS}
                                >
                                  {f.displayName ?? f.username}
                                </span>
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
                            <span
                              className={DISPLAY_TITLE}
                            >
                              {f.rating}
                            </span>
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
            </main>

            {/* Footer */}
            <footer className={RETRO_FOOTER}>
              <p>{t('home.footerLegal')}</p>
              <div
                style={{
                  display: 'flex',
                  gap: 14,
                  justifyContent: 'center',
                  alignItems: 'center',
                  marginTop: 8,
                  fontSize: '0.74rem',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    retroAudio.playUiBeep(640, 0.05);
                    setLegalModalDoc('privacy');
                  }}
                  style={{
                    color: 'var(--accent-cyan)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  {t('legal.privacyPolicy', 'PRIVACY POLICY')}
                </button>
                <span className="text-(--text-muted)">//</span>
                <button
                  type="button"
                  onClick={() => {
                    retroAudio.playUiBeep(640, 0.05);
                    setLegalModalDoc('terms');
                  }}
                  style={{
                    color: 'var(--accent-cyan)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  {t('legal.termsOfService', 'TERMS OF SERVICE')}
                </button>
              </div>
            </footer>
          </div>
        </div>
      </div>

      <LegalModal
        isOpen={legalModalDoc !== null}
        initialDoc={legalModalDoc ?? 'privacy'}
        onClose={() => {
          setLegalModalDoc(null);
        }}
      />
    </>
  );
}
