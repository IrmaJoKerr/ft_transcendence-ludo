import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { navigate, useRoute } from '../router';
import { useApp } from '../store';
import { retroAudio } from '../utils/audio';
import { UserAvatar } from './UserAvatar';
import { NotificationBell } from './NotificationBell';
import { useNotifications, type Notification } from '../hooks/useNotifications';
import { getApi, postApi } from '../api';
import type { ActiveMatch } from '../store';
import {
  RETRO_BTN,
  THEME_TRIGGER_BTN_BASE,
  THEME_POPOVER_MENU_BASE,
  THEME_POPOVER_MENU_ACTIVE_DOWN,
  THEME_POPOVER_MENU_ACTIVE_UP,
  RETRO_FLOATING_DOCK,
} from '../styles/tw';

type ThemeType = 'synthwave' | 'win95' | 'terminal';

// How often the rejoin banner re-checks for an active game.
// Original: 2500 ms. Recommended: 10000 ms — the badge only needs to appear
// soon after a game is created in another tab or by an invite.
const ACTIVE_GAME_POLL_MS = 10_000;

interface RetroNavbarProps {
  activeRoute?: string;
  notifications?: Notification[];
  unreadCount?: number;
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
  style?: React.CSSProperties;
}

export function RetroNavbar({
  activeRoute,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  style,
}: RetroNavbarProps) {
  const { t } = useTranslation();
  const route = useRoute();
  const {
    user,
    logout,
    lang,
    setLang,
    twoFactor,
    toggleTwoFactor,
    theme,
    setTheme,
    setActiveMatch,
  } = useApp();
  const currentPath = activeRoute ?? route.path;

  // Below `xl` (1280px) the sidebar collapses to an icon rail; labels are
  // JS-toggled because parts of the bar use inline styles. Pages mirror the
  // threshold with `w-[88px] xl:w-[270px]`.
  const [isCompact, setIsCompact] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 1280,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)');
    const handler = () => setIsCompact(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const [activeGame, setActiveGame] = useState<{
    id: string;
    roomCode: string | null;
    status: string;
    gameType: string;
  } | null>(null);
  const [isRejoining, setIsRejoining] = useState(false);

  const navItems = [
    { path: '/home', label: t('nav.home').toUpperCase(), icon: '⌂' },
    { path: '/leaderboard', label: t('nav.leaderboard').toUpperCase(), icon: '♛' },
    { path: '/profile', label: t('nav.profile').toUpperCase(), icon: '@/' },
    { path: '/friends', label: t('nav.friends').toUpperCase(), icon: '♟' },
    { path: '/gamelobby', label: t('nav.lobby').toUpperCase(), icon: '>_' },
  ];

  // Global live notifications fallback so the notification bell works across all pages
  const fallbackNotifs = useNotifications();
  const activeNotifications = notifications ?? fallbackNotifs.notifications;
  const activeUnreadCount = unreadCount ?? fallbackNotifs.unreadCount;
  const activeMarkRead = onMarkRead ?? fallbackNotifs.markRead;
  const activeMarkAllRead = onMarkAllRead ?? fallbackNotifs.markAllRead;

  const [isThemePopoverOpen, setIsThemePopoverOpen] = useState(false);
  const [isAccountPopoverOpen, setIsAccountPopoverOpen] = useState(false);
  const [soundMuted, setSoundMuted] = useState(retroAudio.muted);
  const popoverRef = useRef<HTMLDivElement>(null);
  const themePopoverContentRef = useRef<HTMLDivElement>(null);
  const [themePopoverPos, setThemePopoverPos] = useState({ left: 0, bottom: 0, width: 0 });
  const accountPopoverRef = useRef<HTMLDivElement>(null);
  const accountPopoverContentRef = useRef<HTMLDivElement>(null);
  const [accountPopoverPos, setAccountPopoverPos] = useState({ top: 0, left: 0 });

  // Global "all sounds" mute — same retroAudio.muted flag the in-game audio
  // toggle uses (gates music AND every UI/FX beep), not just the chiptune
  // background track (that's the separate togglePlay()/isPlayingAudio on Home).
  const toggleSound = () => {
    retroAudio.muted = !retroAudio.muted;
    setSoundMuted(retroAudio.muted);
    if (!retroAudio.muted) {
      retroAudio.playUiBeep(520, 0.06);
    }
  };

  const applyTheme = (newTheme: ThemeType) => {
    setTheme(newTheme);
    retroAudio.playUiBeep(880, 0.05);
  };

  const fetchActiveGame = useCallback(() => {
    if (!user) {
      setActiveGame(null);
      return;
    }
    getApi<Array<{ id: string; roomCode: string | null; status: string; gameType: string }>>(
      '/api/games/mine',
    )
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setActiveGame(data[0]);
        } else {
          setActiveGame(null);
        }
      })
      .catch(() => setActiveGame(null));
  }, [user]);

  useEffect(() => {
    fetchActiveGame();
    const iv = setInterval(fetchActiveGame, ACTIVE_GAME_POLL_MS);
    return () => clearInterval(iv);
  }, [user, currentPath, fetchActiveGame]);

  const handleRejoinActive = async () => {
    if (!activeGame || isRejoining) return;
    retroAudio.playUiBeep(880, 0.08);
    setIsRejoining(true);
    try {
      const res = await postApi<ActiveMatch>(`/api/game/${activeGame.id}/rejoin`, {});
      if (res) {
        setActiveMatch(res);
        navigate(`/game?gameId=${res.gameId}`);
      }
    } catch (err) {
      console.error('Failed to rejoin active game:', err);
      fetchActiveGame();
    } finally {
      setIsRejoining(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const insideThemeTrigger = popoverRef.current?.contains(target);
      const insideThemePortal = themePopoverContentRef.current?.contains(target);
      if (!insideThemeTrigger && !insideThemePortal) {
        setIsThemePopoverOpen(false);
      }
      const insideTrigger = accountPopoverRef.current?.contains(target);
      const insidePortal = accountPopoverContentRef.current?.contains(target);
      if (!insideTrigger && !insidePortal) {
        setIsAccountPopoverOpen(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Portalled to <body> so it clears every stacking context; position comes from
  // the trigger's viewport rect (the portal escapes its `position: relative`
  // wrapper).
  useEffect(() => {
    if (!isAccountPopoverOpen) return;
    const updatePosition = () => {
      const rect = accountPopoverRef.current?.getBoundingClientRect();
      if (!rect) return;
      setAccountPopoverPos({ top: rect.top, left: rect.right + 14 });
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isAccountPopoverOpen]);

  // Same reasoning as the account popover: portal to document.body so the
  // theme menu can't be clipped/covered by an ancestor's stacking context.
  useEffect(() => {
    if (!isThemePopoverOpen) return;
    const updatePosition = () => {
      const rect = popoverRef.current?.getBoundingClientRect();
      if (!rect) return;
      setThemePopoverPos({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
        width: isCompact ? 240 : rect.width,
      });
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isThemePopoverOpen, isCompact]);

  const username = user?.username ?? 'PILOT';
  const displayName = user?.displayName ?? username;

  return (
    <nav
      className={RETRO_FLOATING_DOCK}
      id="mainNav"
      style={{
        width: isCompact ? 88 : 270,
        minWidth: isCompact ? 88 : 270,
        maxWidth: isCompact ? 88 : 270,
        height: 'calc(100vh - 64px)',
        maxHeight: 'calc(100vh - 64px)',
        margin: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        padding: isCompact ? '22px 10px 18px' : '22px 16px 18px',
        transition: 'width 0.2s ease, min-width 0.2s ease, max-width 0.2s ease',
        background: 'linear-gradient(180deg, rgba(20, 6, 46, 0.86), rgba(10, 2, 28, 0.94))',
        backdropFilter: 'blur(32px) saturate(220%)',
        WebkitBackdropFilter: 'blur(32px) saturate(220%)',
        border: '1px solid rgba(0, 240, 255, 0.35)',
        borderRadius: 22,
        boxShadow:
          '0 28px 70px rgba(0, 0, 0, 0.8), 0 0 32px rgba(0, 240, 255, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.15), inset 0 0 20px rgba(255, 0, 127, 0.08)',
        boxSizing: 'border-box',
        overflow: 'visible',
        ...style,
      }}
    >
      {/* Top Section: User Profile Pill with Account Menu Popover */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
          paddingBottom: 14,
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* User Profile Pill Button -> Opens Account & Settings Popover Menu */}
        <div
          className="z-10000 inline-block"
          ref={accountPopoverRef}
          style={{ width: '100%', position: 'relative' }}
        >
          <button
            type="button"
            className={`${RETRO_BTN} ${THEME_TRIGGER_BTN_BASE} ${isAccountPopoverOpen ? 'active' : ''}`}
            id="userAccountBtn"
            aria-label="Account Settings, Language and 2FA"
            style={{
              width: '100%',
              height: 48,
              padding: isCompact ? 0 : '0 12px',
              borderRadius: 12,
              background: isAccountPopoverOpen
                ? 'rgba(255, 0, 127, 0.2)'
                : 'rgba(255, 255, 255, 0.04)',
              border: isAccountPopoverOpen
                ? '1.5px solid #ff007f'
                : '1px solid rgba(0, 240, 255, 0.3)',
              boxShadow: isAccountPopoverOpen ? '0 0 16px rgba(255, 0, 127, 0.4)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: isCompact ? 'center' : 'space-between',
              gap: 10,
              cursor: 'pointer',
              boxSizing: 'border-box',
              transition: 'all 0.2s ease',
              color: '#ffffff',
            }}
            onClick={(e) => {
              e.stopPropagation();
              setIsThemePopoverOpen(false);
              const next = !isAccountPopoverOpen;
              setIsAccountPopoverOpen(next);
              retroAudio.playUiBeep(next ? 880 : 440, 0.05);
            }}
            onMouseEnter={(e) => {
              if (!isAccountPopoverOpen) {
                e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                e.currentTarget.style.boxShadow = '0 0 14px rgba(0, 240, 255, 0.35)';
              }
            }}
            onMouseLeave={(e) => {
              if (!isAccountPopoverOpen) {
                e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.3)';
                e.currentTarget.style.boxShadow = 'none';
              }
            }}
            title="Account Settings, Language & 2FA"
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: isCompact ? 'center' : 'flex-start',
                gap: 10,
                overflow: 'hidden',
                flex: isCompact ? 'none' : 1,
              }}
            >
              <UserAvatar
                username={username}
                userId={user?.id}
                avatarStyle={user?.avatarStyle}
                hasAvatarPhoto={user?.hasAvatarPhoto ?? false}
                size={30}
                fallbackStyle={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: 'rgba(25, 10, 56, 0.95)',
                  color: 'var(--accent-pink)',
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                }}
              />
              {!isCompact && (
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: '0.94rem',
                    fontWeight: 900,
                    color: '#ffffff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    textAlign: 'left',
                  }}
                >
                  {displayName}
                </span>
              )}
            </div>
            {!isCompact && (
              <span
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--accent-cyan)',
                  fontWeight: 'bold',
                  transform: isAccountPopoverOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s ease',
                  flexShrink: 0,
                }}
              >
                ▼
              </span>
            )}
          </button>

          {/* Account & Settings Popover — portaled to document.body so it renders
          above sibling content instead of being clipped or covered by an
          ancestor's stacking context; positioned at the trigger's rect. */}
          {isAccountPopoverOpen &&
            createPortal(
              <div
                ref={accountPopoverContentRef}
                className={`${THEME_POPOVER_MENU_BASE} ${THEME_POPOVER_MENU_ACTIVE_DOWN}`}
                id="accountPopoverMenu"
                style={{
                  position: 'fixed',
                  top: accountPopoverPos.top,
                  left: accountPopoverPos.left,
                  right: 'auto',
                  bottom: 'auto',
                  width: 275,
                  padding: '16px 16px',
                  borderRadius: 14,
                  background:
                    'linear-gradient(180deg, rgba(20, 6, 46, 0.96), rgba(10, 2, 28, 0.98))',
                  backdropFilter: 'blur(32px) saturate(220%)',
                  border: '1.5px solid rgba(0, 240, 255, 0.45)',
                  boxShadow: '0 20px 60px rgba(0, 0, 0, 0.95), 0 0 25px rgba(0, 240, 255, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                  zIndex: 10005,
                }}
              >
                {/* 1. Language Selection (Cyber Segmented Tabs) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '0.76rem',
                        fontWeight: 900,
                        color: 'var(--text-muted)',
                        letterSpacing: '0.5px',
                      }}
                    >
                      🌐 {t('navbar.languageLabel')}
                    </span>
                  </div>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, 1fr)',
                      gap: 6,
                      background: 'rgba(0, 0, 0, 0.45)',
                      padding: 4,
                      borderRadius: 8,
                      border: '1px solid rgba(0, 240, 255, 0.2)',
                    }}
                  >
                    {[
                      { code: 'en' as const, label: 'EN', full: 'ENGLISH' },
                      { code: 'ms' as const, label: 'MS', full: 'MELAYU' },
                      { code: 'fr' as const, label: 'FR', full: 'FRANÇAIS' },
                    ].map((item) => {
                      const isSelected = lang === item.code;
                      return (
                        <button
                          key={item.code}
                          type="button"
                          onClick={() => {
                            setLang(item.code);
                            retroAudio.playUiBeep(880, 0.05);
                          }}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '7px 4px',
                            borderRadius: 6,
                            border: isSelected
                              ? '1.5px solid var(--accent-cyan)'
                              : '1px solid transparent',
                            background: isSelected
                              ? 'linear-gradient(135deg, rgba(0, 240, 255, 0.25), rgba(255, 0, 127, 0.2))'
                              : 'transparent',
                            color: isSelected ? '#ffffff' : 'var(--text-muted)',
                            cursor: 'pointer',
                            boxShadow: isSelected ? '0 0 10px rgba(0, 240, 255, 0.35)' : 'none',
                            transition: 'all 0.18s ease',
                            outline: 'none',
                          }}
                        >
                          <span
                            style={{
                              fontFamily: 'var(--font-display)',
                              fontWeight: 900,
                              fontSize: '0.88rem',
                            }}
                          >
                            {item.label}
                          </span>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '0.62rem',
                              opacity: 0.85,
                              marginTop: 2,
                            }}
                          >
                            {item.full}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. 2FA Security Toggle Option */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: twoFactor ? 'rgba(0, 255, 136, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                    border: twoFactor ? '1px solid #00ff88' : '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: twoFactor ? '0 0 10px rgba(0, 255, 136, 0.2)' : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                  }}
                  onClick={() => {
                    toggleTwoFactor();
                    retroAudio.playUiBeep(twoFactor ? 440 : 880, 0.06);
                  }}
                  title="Toggle Two-Factor Authentication"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1rem' }}>🛡️</span>
                    <span
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '0.84rem',
                        fontWeight: 900,
                        color: '#ffffff',
                      }}
                    >
                      {t('navbar.twoFactorLabel')}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 900,
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: twoFactor ? '#00ff88' : 'rgba(255, 255, 255, 0.12)',
                      color: twoFactor ? '#0b021a' : 'var(--text-muted)',
                      border: twoFactor
                        ? '1px solid #00ff88'
                        : '1px solid rgba(255, 255, 255, 0.18)',
                    }}
                  >
                    {twoFactor ? t('navbar.enabledBadge') : t('navbar.disabledBadge')}
                  </span>
                </div>

                {/* 3. Master Audio Toggle — mutes/unmutes ALL sounds (music + FX),
                same retroAudio.muted flag as the in-game audio toggle. */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: !soundMuted
                      ? 'rgba(0, 255, 136, 0.12)'
                      : 'rgba(255, 255, 255, 0.04)',
                    border: !soundMuted
                      ? '1px solid #00ff88'
                      : '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: !soundMuted ? '0 0 10px rgba(0, 255, 136, 0.2)' : 'none',
                    cursor: 'pointer',
                    transition: 'all 0.18s ease',
                  }}
                  onClick={toggleSound}
                  title="Toggle all game audio (music + sound effects)"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1rem' }}>{soundMuted ? '🔇' : '🔊'}</span>
                    <span
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: '0.84rem',
                        fontWeight: 900,
                        color: '#ffffff',
                      }}
                    >
                      {t('navbar.audioLabel')}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 900,
                      padding: '3px 8px',
                      borderRadius: 4,
                      background: !soundMuted ? '#00ff88' : 'rgba(255, 255, 255, 0.12)',
                      color: !soundMuted ? '#0b021a' : 'var(--text-muted)',
                      border: !soundMuted
                        ? '1px solid #00ff88'
                        : '1px solid rgba(255, 255, 255, 0.18)',
                    }}
                  >
                    {!soundMuted ? t('navbar.enabledBadge') : t('navbar.disabledBadge')}
                  </span>
                </div>

                {/* 4. Logout / Disconnect Button */}
                <button
                  className={RETRO_BTN}
                  onClick={() => {
                    setIsAccountPopoverOpen(false);
                    retroAudio.playUiBeep(330, 0.08);
                    void logout().then(() => navigate('/login'));
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 0',
                    fontSize: '0.84rem',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 900,
                    background:
                      'linear-gradient(90deg, rgba(255, 0, 85, 0.25), rgba(255, 0, 127, 0.35))',
                    border: '1.5px solid #ff0055',
                    color: '#ffffff',
                    boxShadow: '0 0 12px rgba(255, 0, 85, 0.3)',
                    borderRadius: 8,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'all 0.18s ease',
                  }}
                >
                  <span>⏻</span>
                  <span>{t('navbar.logoutBtn')}</span>
                </button>
              </div>,
              document.body,
            )}
        </div>
      </div>

      {/* Active Match In Progress - Instant Rejoin Button */}
      {activeGame && currentPath !== '/game' && (
        <div style={{ width: '100%', padding: '0 0 2px', flexShrink: 0 }}>
          <button
            type="button"
            className={RETRO_BTN}
            id="navRejoinActiveGameBtn"
            onClick={() => {
              void handleRejoinActive();
            }}
            disabled={isRejoining}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: 12,
              background:
                'linear-gradient(135deg, rgba(255, 0, 127, 0.35), rgba(0, 240, 255, 0.35))',
              border: '1.5px solid var(--accent-pink)',
              boxShadow: '0 0 16px rgba(255, 0, 127, 0.55), inset 0 0 8px rgba(0, 240, 255, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              cursor: isRejoining ? 'wait' : 'pointer',
              color: '#ffffff',
              fontFamily: 'var(--font-display)',
              fontWeight: 900,
              boxSizing: 'border-box',
              transition: 'all 0.2s ease',
            }}
            title={t('navbar.rejoinActiveTooltip')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  textAlign: 'left',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    fontSize: '0.8rem',
                    color: '#ffffff',
                    fontWeight: 900,
                    letterSpacing: '0.04em',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {isRejoining ? t('navbar.rejoining') : t('navbar.rejoinActiveBtn')}
                </span>
                <span
                  style={{
                    fontSize: '0.62rem',
                    color: 'var(--accent-cyan)',
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                  }}
                >
                  {activeGame.roomCode
                    ? `${t('navbar.rejoinRoomLabel')} ${activeGame.roomCode}`
                    : `${t('navbar.rejoinStatusLabel')} ${activeGame.status}`}
                </span>
              </div>
            </div>
            <span style={{ fontSize: '0.85rem', color: 'var(--accent-pink)', flexShrink: 0 }}>
              ►
            </span>
          </button>
        </div>
      )}

      {/* Navigation Slider Window (Middle of Y-Axis) */}
      <div
        className="nav-slider-viewport"
        style={{
          position: 'relative',
          width: '100%',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          // `overflow-y: auto` is only a safety net. The old centre-shift "coverflow"
          // was removed: at short window heights it pushed the last item over the theme
          // button.
          overflowY: 'auto',
          padding: '8px 0',
        }}
      >
        {/* Nav Items Track */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            zIndex: 2,
          }}
        >
          {navItems.map((item, idx) => {
            const activeIdx = navItems.findIndex((it) => {
              if (it.path === '/home') return currentPath === '/home' || currentPath === '/';
              if (it.path === '/gamelobby')
                return currentPath === '/gamelobby' || currentPath === '/ludolobby';
              if (it.path === '/profile') return currentPath.startsWith('/profile');
              return currentPath === it.path;
            });
            const safeActiveIdx = activeIdx >= 0 ? activeIdx : 0;
            const isActive = idx === safeActiveIdx;
            const dist = Math.abs(idx - safeActiveIdx);
            const itemOpacity = isActive ? 1.0 : Math.max(0.35, 0.75 - dist * 0.14);
            const itemScale = isActive ? 1.02 : Math.max(0.93, 1.0 - dist * 0.02);

            return (
              <button
                key={item.path}
                className={`${RETRO_BTN} ${THEME_TRIGGER_BTN_BASE} ${isActive ? 'active' : ''}`}
                style={{
                  width: '100%',
                  height: 52,
                  justifyContent: isCompact ? 'center' : 'flex-start',
                  gap: isCompact ? 0 : 12,
                  padding: isCompact ? 0 : '0 14px',
                  fontSize: '1.02rem',
                  borderRadius: 12,
                  background: isActive
                    ? 'linear-gradient(90deg, rgba(255, 0, 127, 0.95), rgba(157, 0, 255, 0.95))'
                    : 'rgba(20, 8, 44, 0.85)',
                  color: isActive ? '#ffffff' : 'var(--text-main)',
                  border: isActive ? '1.5px solid #ff007f' : '1px solid rgba(0, 240, 255, 0.25)',
                  boxShadow: isActive
                    ? '0 0 20px rgba(255, 0, 127, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.3)'
                    : 'none',
                  fontWeight: 900,
                  letterSpacing: '1px',
                  cursor: 'pointer',
                  opacity: itemOpacity,
                  transform: `scale(${itemScale})`,
                  transition: 'all 0.35s ease',
                }}
                title={item.label}
                onClick={() => {
                  retroAudio.playUiBeep(isActive ? 480 : 640, 0.05);
                  navigate(item.path);
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(0, 240, 255, 0.18)';
                    e.currentTarget.style.borderColor = 'var(--accent-cyan)';
                    e.currentTarget.style.color = '#ffffff';
                    e.currentTarget.style.opacity = '1';
                    e.currentTarget.style.boxShadow = '0 0 14px rgba(0, 240, 255, 0.35)';
                    e.currentTarget.style.transform = 'translateX(4px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(20, 8, 44, 0.85)';
                    e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.25)';
                    e.currentTarget.style.color = 'var(--text-main)';
                    e.currentTarget.style.opacity = String(itemOpacity);
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = `scale(${itemScale})`;
                  }
                }}
              >
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 7,
                    background: isActive ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 240, 255, 0.08)',
                    display: 'grid',
                    placeItems: 'center',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '1.2rem',
                    color: isActive ? '#ffffff' : 'var(--accent-cyan)',
                    flexShrink: 0,
                    filter: isActive ? 'drop-shadow(0 0 6px #ffffff)' : 'none',
                  }}
                >
                  {item.icon}
                </div>
                {!isCompact && (
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: '1.02rem',
                      letterSpacing: '1px',
                      fontWeight: 900,
                      flex: 1,
                      textAlign: 'left',
                    }}
                  >
                    {item.label}
                  </span>
                )}
                {!isCompact && isActive && (
                  <span
                    style={{
                      color: '#ffffff',
                      fontSize: '1rem',
                      fontWeight: 900,
                      textShadow: '0 0 6px #ffffff',
                    }}
                  >
                    ►
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom Controls: Theme Selector + Notifications */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          paddingTop: 10,
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
        }}
      >
        {/* Theme Selector Popover */}
        <div
          className="z-10000 inline-block"
          ref={popoverRef}
          style={{ width: '100%', position: 'relative' }}
        >
          <button
            className={`${RETRO_BTN} ${THEME_TRIGGER_BTN_BASE} ${isThemePopoverOpen ? 'active' : ''}`}
            id="themeModalBtn"
            aria-label="Toggle Theme Menu"
            style={{
              width: '100%',
              height: 44,
              justifyContent: isCompact ? 'center' : 'space-between',
              padding: isCompact ? 0 : '0 14px',
              fontSize: '0.94rem',
              borderRadius: 10,
              background: 'rgba(255, 255, 255, 0.04)',
              border: '1px solid rgba(0, 240, 255, 0.3)',
              color: 'var(--text-main)',
            }}
            onClick={(e) => {
              e.stopPropagation();
              setIsAccountPopoverOpen(false);
              const next = !isThemePopoverOpen;
              setIsThemePopoverOpen(next);
              retroAudio.playUiBeep(next ? 960 : 480, 0.05);
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent-cyan)';
              e.currentTarget.style.boxShadow = '0 0 14px rgba(0, 240, 255, 0.35)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(0, 240, 255, 0.3)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span
                style={{
                  color: 'var(--accent-yellow)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '1.05rem',
                  fontWeight: 'bold',
                }}
              >
                &lt;/&gt;
              </span>
              {!isCompact && (
                <span
                  style={{
                    fontFamily: 'var(--font-display)',
                    letterSpacing: '1px',
                    fontWeight: 900,
                    fontSize: '0.94rem',
                  }}
                >
                  {t('navbar.themeBtn')}
                </span>
              )}
            </div>
            {!isCompact && (
              <span style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)', fontWeight: 'bold' }}>
                {isThemePopoverOpen ? '▼' : '▲'}
              </span>
            )}
          </button>

          {/* Upward Opening Theme Popover Menu — portaled to document.body,
              see accountPopoverMenu above for why. */}
          {isThemePopoverOpen &&
            createPortal(
              <div
                ref={themePopoverContentRef}
                className={`${THEME_POPOVER_MENU_BASE} ${THEME_POPOVER_MENU_ACTIVE_UP}`}
                id="themePopoverMenu"
                style={{
                  position: 'fixed',
                  bottom: themePopoverPos.bottom,
                  top: 'auto',
                  left: themePopoverPos.left,
                  right: 'auto',
                  width: themePopoverPos.width,
                  padding: '14px 16px',
                  borderRadius: 14,
                  boxSizing: 'border-box',
                  zIndex: 10005,
                }}
              >
                <fieldset
                  id="color-scheme"
                  style={{
                    borderRadius: 10,
                    padding: '12px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <legend style={{ fontSize: '0.82rem', padding: '0 8px', fontWeight: 'bold' }}>
                    {t('navbar.themeSelectorLegend')}
                  </legend>
                  <label
                    htmlFor="theme-synthwave"
                    style={{
                      fontSize: '0.88rem',
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      cursor: 'pointer',
                      borderRadius: 6,
                    }}
                  >
                    <input
                      type="radio"
                      id="theme-synthwave"
                      name="theme-radio"
                      value="synthwave"
                      checked={theme === 'synthwave'}
                      onChange={() => {
                        applyTheme('synthwave');
                        setIsThemePopoverOpen(false);
                      }}
                      style={{ width: 17, height: 17, cursor: 'pointer' }}
                    />
                    <span style={{ fontWeight: 'bold' }}>{t('navbar.themeCyberpunk')}</span>
                  </label>
                  <label
                    htmlFor="theme-win95"
                    style={{
                      fontSize: '0.88rem',
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      cursor: 'pointer',
                      borderRadius: 6,
                    }}
                  >
                    <input
                      type="radio"
                      id="theme-win95"
                      name="theme-radio"
                      value="win95"
                      checked={theme === 'win95'}
                      onChange={() => {
                        applyTheme('win95');
                        setIsThemePopoverOpen(false);
                      }}
                      style={{ width: 17, height: 17, cursor: 'pointer' }}
                    />
                    <span style={{ fontWeight: 'bold' }}>{t('navbar.themeWin95')}</span>
                  </label>
                  <label
                    htmlFor="theme-terminal"
                    style={{
                      fontSize: '0.88rem',
                      padding: '8px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      cursor: 'pointer',
                      borderRadius: 6,
                    }}
                  >
                    <input
                      type="radio"
                      id="theme-terminal"
                      name="theme-radio"
                      value="terminal"
                      checked={theme === 'terminal'}
                      onChange={() => {
                        applyTheme('terminal');
                        setIsThemePopoverOpen(false);
                      }}
                      style={{ width: 17, height: 17, cursor: 'pointer' }}
                    />
                    <span style={{ fontWeight: 'bold' }}>{t('navbar.themeTerminal')}</span>
                  </label>
                </fieldset>
              </div>,
              document.body,
            )}
        </div>

        {/* Notifications Bell -> Accessible across ALL pages */}
        <div
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <NotificationBell
            notifications={activeNotifications}
            unreadCount={activeUnreadCount}
            onMarkRead={activeMarkRead}
            onMarkAllRead={activeMarkAllRead}
            placement="right"
            fullWidth
            compact={isCompact}
          />
        </div>
      </div>
    </nav>
  );
}
