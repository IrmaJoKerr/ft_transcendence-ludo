import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavDock } from '../../components/NavDock';
import { LegalModal, type LegalDocType } from '../../components/LegalModal';
import { useFriendships } from '../../hooks/useFriendships';
import { useHeroScene } from '../../hooks/useHeroScene';
import { useNotifications } from '../../hooks/useNotifications';
import { navigate } from '../../router';
import { useApp } from '../../store';
import { retroAudio } from '../../utils/audio';
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
} from '../../styles/tw';
import { FriendsWidget } from './FriendsWidget';
import { HeroCabinet } from './HeroCabinet';
import { HomeFooter } from './HomeFooter';

export function Home() {
  const { t } = useTranslation();
  const { user, onlineCount, theme } = useApp();
  const [legalModalDoc, setLegalModalDoc] = useState<LegalDocType | null>(null);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  // **2. THEME & CRT CONTROLS**
  // Read once at mount: the CRT look is a page-level choice, not a dock control.
  const [crtEnabled] = useState(() => localStorage.getItem('retro_crt') !== 'false');

  // 4. CYBER COMM // FRIEND LIST & AUDIO: one initial read for first paint; from then on
  // `friendship:changed` drives the column and the request badge (socket D2). The 12 s poll, and the
  // separate request fetch it repeated, are gone.
  const { friends: friendRows, requests, loading: friendsLoading } = useFriendships();
  const friends = useMemo(
    () => (friendsLoading ? null : [...friendRows].sort((a, b) => b.rating - a.rating)),
    [friendRows, friendsLoading],
  );
  const pendingRequestsCount = requests.received.length;

  // 4b. HERO BADGE BAR: live site-wide online-player count, straight off the session socket.

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
              <HeroCabinet
                canvasRef={canvasRef}
                isWarpingToLobby={isWarpingToLobby}
                onLaunch={launchToLobby}
              />

              <FriendsWidget friends={friends} pendingRequestsCount={pendingRequestsCount} />
            </main>

            <HomeFooter onOpenLegal={setLegalModalDoc} />
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
