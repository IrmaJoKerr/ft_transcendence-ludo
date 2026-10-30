import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApi } from '../api';
import { UserAvatar } from '../components/UserAvatar';
import { RetroNavbar } from '../components/RetroNavbar';
import { LegalModal, type LegalDocType } from '../components/LegalModal';
import { useNotifications } from '../hooks/useNotifications';
import { navigate } from '../router';
import { useApp } from '../store';
import { retroAudio } from '../utils/audio';
import '../styles/retrowave.css';
import {
  CRT_SCREEN,
  GRID_BACKGROUND,
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
} from '../styles/tw';

type Friend = {
  id: string;
  username: string;
  displayName?: string;
  avatarStyle?: string | null;
  hasAvatarPhoto?: boolean;
  rating?: number;
  friendsSince?: string;
  status?: 'online' | 'playing' | 'offline';
};

const STATUS_STYLE: Record<string, { label: string; color: string; border: string; bg: string }> = {
  online: {
    label: 'Online',
    color: '#00ff88',
    border: 'rgba(0, 255, 136, 0.4)',
    bg: 'rgba(0, 255, 136, 0.12)',
  },
  playing: {
    label: 'In Game',
    color: '#ffe600',
    border: 'rgba(255, 230, 0, 0.4)',
    bg: 'rgba(255, 230, 0, 0.12)',
  },
  offline: {
    label: 'Offline',
    color: '#7a889b',
    border: 'rgba(122, 136, 155, 0.3)',
    bg: 'rgba(122, 136, 155, 0.08)',
  },
};

export function Home() {
  const { t, i18n } = useTranslation();
  const { user, onlineCount } = useApp();
  const [legalModalDoc, setLegalModalDoc] = useState<LegalDocType | null>(null);
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications();

  // **2. THEME & CRT CONTROLS**
  const [crtEnabled, setCrtEnabled] = useState(true);

  useEffect(() => {
    const savedCrt = localStorage.getItem('retro_crt');
    if (savedCrt === 'false') {
      setCrtEnabled(false);
    }
  }, []);

  const toggleCrt = () => {
    const next = !crtEnabled;
    setCrtEnabled(next);
    localStorage.setItem('retro_crt', next ? 'true' : 'false');
    retroAudio.playUiBeep(440, 0.05);
  };

  // **4. CYBER COMM // FRIEND LIST & AUDIO**
  const [friends, setFriends] = useState<Friend[] | null>(null);
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [isFriendsLoading, setIsFriendsLoading] = useState(false);

  const fetchFriendsData = () => {
    Promise.all([
      getApi<Friend[]>('/api/friends'),
      getApi<{ received: Array<{ id: string }> }>('/api/friends/requests'),
    ])
      .then(([friendsData, reqData]) => {
        const list = Array.isArray(friendsData) ? friendsData : [];
        list.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
        setFriends(list);
        setPendingRequestsCount(Array.isArray(reqData.received) ? reqData.received.length : 0);
      })
      .catch((e) => {
        console.error(e);
      });
  };

  useEffect(() => {
    setIsFriendsLoading(true);
    fetchFriendsData();
    setIsFriendsLoading(false);
    const iv = setInterval(fetchFriendsData, 12000);
    return () => {
      clearInterval(iv);
    };
  }, []);

  // 4b. HERO BADGE BAR: live site-wide online-player count, straight off the
  // session socket. D11 removed the first-paint REST read: the gateway hands a
  // freshly connected socket the number it last pushed, and the store keeps that
  // value for as long as the connection lives (so a remount still paints).

  // **5. HUB ARCADE CABINET: 3D ATTRACT MODE & PRESS START**
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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

  // **1b. HERO MARQUEE // Held in a ref so a language switch only swaps the
  // text: the canvas effect below keeps running (no starfield reshuffle).
  const heroMarqueeRef = useRef(t('homeExtended.heroMarquee'));
  useEffect(() => {
    heroMarqueeRef.current = t('homeExtended.heroMarquee');
  }, [t, i18n.language]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let gridOffset = 0;
    let time = 0;

    // Synthwave color palette
    const cfg = {
      bgTop: '#070114',
      bgMid: '#160530',
      bgBot: '#05010d',
      hasSun: true,
      sunC1: 'rgba(255, 230, 0, 0.72)',
      sunC2: 'rgba(255, 0, 127, 0.38)',
      sunScanline: 'rgba(13, 2, 33, 0.6)',
      gridColor: 'rgba(0, 240, 255, 0.45)',
      starRgb: '255, 255, 255',
      pawns: [
        { label: 'RED', color: '#ff0055', x: 85, y: 350 },
        { label: 'GREEN', color: '#00ff88', x: 230, y: 360 },
        { label: 'YELLOW', color: '#ffe600', x: 490, y: 360 },
        { label: 'BLUE', color: '#00f0ff', x: 635, y: 350 },
      ],
      marqueeColor: '#00f0ff',
    };

    // Background stars
    const stars = Array.from({ length: 65 }, () => ({
      x: Math.random() * 720,
      y: Math.random() * 260,
      size: Math.random() * 1.8 + 0.5,
      speed: Math.random() * 0.3 + 0.1,
      alpha: Math.random() * 0.7 + 0.3,
    }));

    const loop = () => {
      time += 0.02;
      gridOffset = (gridOffset + 1.3) % 26;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 1. Deep Canvas Background with gradient
      const bgGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bgGrad.addColorStop(0, cfg.bgTop);
      bgGrad.addColorStop(0.65, cfg.bgMid);
      bgGrad.addColorStop(1, cfg.bgBot);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Distant Sun: the disc and its scanlines share one clip path, so a
      //    scanline stroke cannot reach past the sun's silhouette.
      const sunY = 250;
      const sunRadius = 90;
      const sunGrad = ctx.createRadialGradient(360, sunY, 7, 360, sunY, sunRadius);
      sunGrad.addColorStop(0, cfg.sunC1);
      sunGrad.addColorStop(0.5, cfg.sunC2);
      sunGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.save();
      ctx.beginPath();
      ctx.arc(360, sunY, sunRadius, Math.PI, 0, false);
      ctx.closePath();
      ctx.clip();

      ctx.fillStyle = sunGrad;
      ctx.fillRect(360 - sunRadius, sunY - sunRadius, sunRadius * 2, sunRadius);

      // Sun horizon scanlines (kept translucent so they band the sun instead
      // of painting solid black lines over it)
      ctx.strokeStyle = cfg.sunScanline;
      ctx.lineWidth = 2;
      for (let sy = sunY - 60; sy < sunY; sy += 8) {
        ctx.beginPath();
        ctx.moveTo(360 - sunRadius, sy);
        ctx.lineTo(360 + sunRadius, sy);
        ctx.stroke();
      }
      ctx.restore();

      // 3. Floating Stars
      stars.forEach((st) => {
        st.y += st.speed;
        if (st.y > 260) st.y = 0;
        ctx.fillStyle = `rgba(${cfg.starRgb}, ${st.alpha * (0.8 + 0.2 * Math.sin(time * 3 + st.x))})`;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.size, 0, Math.PI * 2);
        ctx.fill();
      });

      // 4. Horizon Perspective Grid
      const horizonY = 260;
      ctx.save();
      ctx.strokeStyle = cfg.gridColor;
      ctx.lineWidth = 1;

      // Horizontal grid lines moving toward camera
      for (let gy = 0; gy < 140; gy += 14) {
        const y = horizonY + Math.pow((gy + gridOffset) / 145, 1.8) * 140;
        if (y <= canvas.height) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(canvas.width, y);
          ctx.stroke();
        }
      }

      // Perspective radiating vertical lines from vanishing point (360, 260)
      for (let x = -250; x <= canvas.width + 250; x += 45) {
        ctx.beginPath();
        ctx.moveTo(360, horizonY);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      ctx.restore();

      // 5. 4-Player Army Hologram Nodes
      const pawns = cfg.pawns;

      pawns.forEach((p, idx) => {
        const pulse = Math.sin(time * 3 + idx * 1.5) * 2.4;
        ctx.save();
        ctx.fillStyle = p.color;
        ctx.shadowColor = p.color;
        ctx.shadowBlur = 11;
        ctx.beginPath();
        ctx.arc(p.x, p.y + pulse, 7.5, 0, Math.PI * 2);
        ctx.fill();

        // Base ring
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 12, 15, 5, 0, 0, Math.PI * 2);
        ctx.stroke();

        ctx.font = '8.5px "Atkinson Hyperlegible Next", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.label, p.x, p.y - 13 + pulse);
        ctx.restore();
      });

      // 6. Marquee Title on Top of Screen
      ctx.save();
      ctx.font = '13px "Atkinson Hyperlegible Next", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = cfg.marqueeColor;
      ctx.shadowColor = cfg.marqueeColor;
      ctx.shadowBlur = 11;
      ctx.fillText(heroMarqueeRef.current, 360, 28);
      ctx.shadowBlur = 0;
      ctx.restore();

      animId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      cancelAnimationFrame(animId);
    };
  }, []);

  const username = user?.username ?? t('common.you');
  const displayName = user?.displayName ?? username;

  return (
    <>
      {/* Synthwave cityscape background */}
      <div className={GRID_BACKGROUND} />

      {/* CRT Monitor Overlay FX Container */}
      <div
        className={`${CRT_SCREEN} crt-screen ${crtEnabled ? 'relative' : ''} flex min-h-screen w-full flex-col items-center justify-start`}
        id="crtScreen"
      >
        {/* Dynamic Full-Width Seated Sidebar & Content Layout Container */}
        <div className="relative z-10 box-border flex min-h-screen w-full flex-row items-start justify-center gap-7 px-6 py-8">
          {/* Left-Seated Navigation Dock */}
          <aside
            className="sticky top-8 w-[88px] shrink-0 xl:w-[270px]"
            style={{ margin: 0, padding: 0 }}
          >
            <RetroNavbar
              activeRoute="/home"
              crtEnabled={crtEnabled}
              toggleCrt={toggleCrt}
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={markRead}
              onMarkAllRead={markAllRead}
            />
          </aside>

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
                            border: '4px solid #ffffff',
                            boxShadow: '0 0 35px #ffffff, 0 0 50px var(--accent-cyan)',
                          }
                        : undefined
                    }
                    onClick={launchToLobby}
                    title={t('home.enterLobbyTooltip')}
                  >
                    <canvas id="arcadeCanvas" ref={canvasRef} width={720} height={400} />

                    {/* Interactive Translucent Press Start Banner Overlay */}
                    <div className={ARCADE_START_OVERLAY}>
                      <span className={ARCADE_START_TITLE}>
                        {t('homeExtended.pressStartTitleSynthwave')}
                      </span>
                      <span className={ARCADE_START_SUB}>
                        {t('homeExtended.pressStartSubSynthwave')}
                      </span>
                    </div>

                    {/* Hyperdrive Warp Flash on Launch */}
                    {isWarpingToLobby && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(255, 255, 255, 0.85)',
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
                          color: '#fff',
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
                  {isFriendsLoading && friends === null ? (
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
                  ) : !friends || friends.length === 0 ? (
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
                      const fStatus = STATUS_STYLE[f.status ?? 'offline'];

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
                                  style={{
                                    fontSize: '0.92rem',
                                    fontWeight: 900,
                                    color: '#ffffff',
                                    fontFamily: 'var(--font-display)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    letterSpacing: '0.02em',
                                  }}
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
                              style={{
                                fontSize: '1.05rem',
                                fontWeight: 900,
                                color: '#ffffff',
                                fontFamily: 'var(--font-display)',
                                lineHeight: 1,
                              }}
                            >
                              {f.rating ?? 1200}
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
                <span style={{ color: 'var(--text-muted)' }}>//</span>
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
