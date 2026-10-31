import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { navigate, useRoute } from '../router';
import { railButtonStyle, railHoverHandlers } from './railButton';
import { useApp } from '../store';
import { retroAudio } from '../utils/audio';
import { UserAvatar } from './UserAvatar';
import { LanguageSwitcher } from './LanguageSwitcher';
import { NotificationBell } from './NotificationBell';
import { LobbyChat } from './LobbyChat';
import { useNotifications, type Notification } from '../hooks/useNotifications';
import { getApi, postApi } from '../api';
import type { ActiveMatch } from '../store';
import type { MyRoom } from '../sessionSocket';
import {
  RETRO_BTN,
  THEME_TRIGGER_BTN_BASE,
  THEME_POPOVER_MENU_BASE,
  THEME_POPOVER_MENU_ACTIVE_DOWN,
  RETRO_FLOATING_DOCK,
} from '../styles/tw';

const REJOIN_EDGE = {
  borderColor: 'var(--accent-pink)',
  boxShadow: '0 0 16px rgba(255, 0, 127, 0.55), inset 0 0 8px rgba(0, 240, 255, 0.25)',
};

// The rejoin banner rides the session socket (`rooms:mine`); the one REST read is
// first paint and every reconnect, because the push carries only a diff.
const NAV_LABEL_BASE_PX = 13.6; // ≈ 0.85rem; used before the first measurement
const NAV_LABEL_MIN_PX = 9; // smallest size the fit may choose
const NAV_LABEL_MAX_PX = 20; // largest size the fit may choose
const NAV_LABEL_LS_PX = 1; // letter-spacing applied to the labels
const NAV_PROBE_PX = 100; // off-screen probe font-size (width scales linearly)
const NAV_LABEL_SAFETY_PX = 2; // kept free so rounding can't trigger ellipsis

// The bar itself. Its geometry (width, compact threshold, whether the chat slot
// is drawn at all) is owned by `NavDock`, which is the only caller: the dock's
// mount rule is documented there.
interface RetroNavbarProps {
  activeRoute?: string;
  /** Under `WIDE_MIN_PX`: icon rail, no labels, no chat slot. */
  isCompact: boolean;
  /** The chat panel's on/off state, owned by `useDockPrefs` in `NavDock`. */
  chatOn: boolean;
  onToggleChat: () => void;
  notifications?: Notification[];
  unreadCount?: number;
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
  style?: React.CSSProperties;
}

export function RetroNavbar({
  activeRoute,
  isCompact,
  chatOn,
  onToggleChat,
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
  style,
}: RetroNavbarProps) {
  const { t } = useTranslation();
  const route = useRoute();
  const { user, logout, lang, setLang, setActiveMatch, sessionSocket } = useApp();
  const currentPath = activeRoute ?? route.path;

  // Below `xl` (1280px) the sidebar collapses to an icon rail; the threshold and
  // the width both come from `useDockPrefs` through `NavDock`, so the spacer and
  // this bar cannot drift apart.
  const [activeGame, setActiveGame] = useState<{
    id: string;
    roomCode: string | null;
    status: string;
    gameType: string;
  } | null>(null);
  const [isRejoining, setIsRejoining] = useState(false);
  const [rejoinError, setRejoinError] = useState<string | null>(null);

  const navItems = [
    { path: '/home', label: t('nav.home').toUpperCase(), icon: '⌂' },
    { path: '/leaderboard', label: t('nav.leaderboard').toUpperCase(), icon: '♛' },
    { path: '/profile', label: t('nav.profile').toUpperCase(), icon: '@/' },
    { path: '/friends', label: t('nav.friends').toUpperCase(), icon: '♟' },
    { path: '/gamelobby', label: t('nav.lobby').toUpperCase(), icon: '>_' },
  ];

  // Measure the widest nav label and apply one font size to all five. Re-runs
  // on language change, resize and web-font load.
  const navTrackRef = useRef<HTMLDivElement>(null);
  const [navLabelPx, setNavLabelPx] = useState(NAV_LABEL_BASE_PX);
  const navLabelKey = navItems.map((item) => item.label).join('|');

  useLayoutEffect(() => {
    if (isCompact) return;
    const track = navTrackRef.current;
    if (!track) return;
    const btn = track.firstElementChild as HTMLElement | null;
    if (!btn) return;

    // The probe uses the label typography and is measured off-screen.
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.position = 'absolute';
    probe.style.top = '-9999px';
    probe.style.left = '-9999px';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.whiteSpace = 'nowrap';
    probe.style.fontFamily = 'var(--font-display)';
    probe.style.fontWeight = '900';
    probe.style.letterSpacing = `${NAV_LABEL_LS_PX}px`;
    probe.style.fontSize = `${NAV_PROBE_PX}px`;
    document.body.appendChild(probe);

    const labels = navLabelKey.split('|');
    const measure = () => {
      // Available label width = button content box minus its 14px side padding,
      // the 34px icon, the 12px icon→label gap and the safety margin.
      const available = btn.clientWidth - 14 - 14 - 34 - 12 - NAV_LABEL_SAFETY_PX;
      if (available <= 0) return;
      let size = Number.POSITIVE_INFINITY;
      for (const label of labels) {
        const n = label.length;
        probe.textContent = label;
        // Strip the font-size-independent letter-spacing to get the glyph width,
        // then scale it to the target width.
        const glyphs = probe.getBoundingClientRect().width - n * NAV_LABEL_LS_PX;
        if (glyphs <= 0) continue;
        const fit = ((available - n * NAV_LABEL_LS_PX) * NAV_PROBE_PX) / glyphs;
        size = Math.min(size, fit);
      }
      if (Number.isFinite(size)) {
        setNavLabelPx(Math.min(NAV_LABEL_MAX_PX, Math.max(NAV_LABEL_MIN_PX, size)));
      }
    };

    measure();
    window.addEventListener('resize', measure);
    // Re-measure with the real Atkinson metrics once the web font loads.
    void document.fonts.ready.then(measure).catch(() => {});
    return () => {
      window.removeEventListener('resize', measure);
      probe.remove();
    };
  }, [navLabelKey, isCompact]);

  // Global live notifications fallback so the notification bell works across all pages
  const fallbackNotifs = useNotifications();
  const activeNotifications = notifications ?? fallbackNotifs.notifications;
  const activeUnreadCount = unreadCount ?? fallbackNotifs.unreadCount;
  const activeMarkRead = onMarkRead ?? fallbackNotifs.markRead;
  const activeMarkAllRead = onMarkAllRead ?? fallbackNotifs.markAllRead;

  const [isAccountPopoverOpen, setIsAccountPopoverOpen] = useState(false);
  const [soundMuted, setSoundMuted] = useState(retroAudio.muted);
  const accountPopoverRef = useRef<HTMLDivElement>(null);
  const accountPopoverContentRef = useRef<HTMLDivElement>(null);
  const [accountPopoverPos, setAccountPopoverPos] = useState({ top: 0, left: 0 });

  // Global "all sounds" mute: gates every UI/FX beep via retroAudio.muted.
  const toggleSound = () => {
    retroAudio.muted = !retroAudio.muted;
    setSoundMuted(retroAudio.muted);
    if (!retroAudio.muted) {
      retroAudio.playUiBeep(520, 0.06);
    }
  };

  const fetchActiveGame = useCallback(() => {
    if (!user) {
      setActiveGame(null);
      return;
    }
    getApi<MyRoom[]>('/api/games/mine')
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
  }, [user, currentPath, fetchActiveGame]);

  // The push half: the same event the lobby uses. `rooms:mine` is the account's own
  // seats, so the banner appears and disappears without a request.
  useEffect(() => {
    if (!sessionSocket) return;
    const onMine = (rooms: MyRoom[]) => setActiveGame(rooms.length > 0 ? rooms[0] : null);
    const onConnect = () => fetchActiveGame();
    sessionSocket.on('rooms:mine', onMine);
    sessionSocket.on('connect', onConnect);
    return () => {
      sessionSocket.off('rooms:mine', onMine);
      sessionSocket.off('connect', onConnect);
    };
  }, [sessionSocket, fetchActiveGame]);

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
      // Show the localized error message inline (e.g. MATCH_SEAT_EXPIRED).
      const message =
        typeof err === 'object' && err !== null && 'message' in err
          ? String(err.message)
          : t('common.requestFailed', { status: 0 });
      setRejoinError(message);
      // Only refresh the active-game poll when the seat is genuinely expired;
      // otherwise the poll itself will clear the banner within ≤10 s anyway.
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code?: string }).code === 'MATCH_SEAT_EXPIRED'
      ) {
        setActiveGame(null);
      } else {
        fetchActiveGame();
      }
    } finally {
      setIsRejoining(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
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

  const username = user?.username ?? 'PILOT';
  const displayName = user?.displayName ?? username;

  return (
    <nav
      className={RETRO_FLOATING_DOCK}
      id="mainNav"
      style={{
        // The spacer owns the width (see NavDock); the bar fills it.
        width: '100%',
        height: 'calc(100vh - 64px)',
        maxHeight: 'calc(100vh - 64px)',
        margin: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        // Top-down: the slack belongs to the chat slot, not to the nav track.
        justifyContent: 'flex-start',
        gap: 14,
        padding: isCompact ? '22px 10px 18px' : '22px 16px 18px',
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
            aria-label={t('navbar.accountMenuAria')}
            style={{
              ...railButtonStyle(isAccountPopoverOpen),
              width: '100%',
              height: 48,
              padding: isCompact ? 0 : '0 12px',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: isCompact ? 'center' : 'space-between',
              gap: 10,
              color: '#ffffff',
            }}
            onClick={(e) => {
              e.stopPropagation();
              const next = !isAccountPopoverOpen;
              setIsAccountPopoverOpen(next);
              retroAudio.playUiBeep(next ? 880 : 440, 0.05);
            }}
            {...railHoverHandlers(isAccountPopoverOpen)}
            title={t('navbar.accountMenuTitle')}
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

          {/* Account & Settings Popover: portaled to document.body so it renders
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
                  <LanguageSwitcher variant="tabs" value={lang} onChange={setLang} />
                </div>

                {/* 2. Master Audio Toggle: mutes/unmutes ALL sounds (music + FX),
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
                  title={t('navbar.toggleAudio')}
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

                {/* 3. Logout / Disconnect Button */}
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
          {/* Rejoin error message */}
          {rejoinError && (
            <div
              style={{
                padding: '6px 10px',
                borderRadius: 6,
                background: 'rgba(255, 0, 85, 0.12)',
                border: '1px solid #ff0055',
                color: '#ff0055',
                fontSize: '0.7rem',
                textAlign: 'center',
                fontFamily: 'var(--font-mono)',
                marginBottom: 4,
              }}
            >
              {rejoinError}
            </div>
          )}
          <button
            type="button"
            className={RETRO_BTN}
            id="navRejoinActiveGameBtn"
            onClick={() => {
              setRejoinError(null);
              void handleRejoinActive();
            }}
            disabled={isRejoining}
            style={{
              width: '100%',
              padding: '9px 12px',
              borderRadius: 12,
              background:
                'linear-gradient(135deg, rgba(255, 0, 127, 0.35), rgba(0, 240, 255, 0.35))',
              border: `1.5px solid ${REJOIN_EDGE.borderColor}`,
              boxShadow: REJOIN_EDGE.boxShadow,
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
            // Same hover animation as the other rail buttons, but it returns to
            // its pink alert edge rather than the default, so an in-progress
            // game still stands out at rest.
            {...railHoverHandlers(false, REJOIN_EDGE)}
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

      {/* Navigation Slider Window: sized by its content, so the slack below it
          belongs to the chat slot. It keeps `overflow-y: auto` and a zero
          minimum, so a short viewport scrolls the track before anything
          overflows the dock. */}
      <div
        className="nav-slider-viewport"
        style={{
          position: 'relative',
          boxSizing: 'border-box',
          width: `calc(100% + ${isCompact ? 20 : 32}px)`,
          marginLeft: isCompact ? -10 : -16,
          marginRight: isCompact ? -10 : -16,
          flex: '0 1 auto',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          overflowY: 'auto',
          // A thin cyan scrollbar when a very short window does force one: the
          // default light bar is the one bright thing on a dark dock.
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(0, 240, 255, 0.35) transparent',
          padding: isCompact ? '8px 10px' : '8px 16px',
        }}
      >
        {/* Nav Items Track */}
        <div
          ref={navTrackRef}
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

            return (
              <button
                key={item.path}
                className={`${RETRO_BTN} ${THEME_TRIGGER_BTN_BASE} ${isActive ? 'active' : ''}`}
                style={{
                  ...railButtonStyle(isActive),
                  width: '100%',
                  height: 52,
                  justifyContent: isCompact ? 'center' : 'flex-start',
                  // No flex gap on the button: the icon→label spacing is the
                  // icon's own margin-right (below).
                  gap: 0,
                  padding: isCompact ? 0 : '0 14px',
                  fontSize: '0.85rem',
                  borderRadius: 12,
                  color: isActive ? '#ffffff' : 'var(--text-main)',
                  fontWeight: 900,
                  letterSpacing: '1px',
                }}
                title={item.label}
                onClick={() => {
                  retroAudio.playUiBeep(isActive ? 480 : 640, 0.05);
                  navigate(item.path);
                }}
                {...railHoverHandlers(isActive)}
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
                    // Icon→label spacing (the button's flex gap is 0).
                    marginRight: isCompact ? 0 : 12,
                    filter: isActive ? 'drop-shadow(0 0 6px #ffffff)' : 'none',
                  }}
                >
                  {item.icon}
                </div>
                {!isCompact && (
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      // Shared auto-fitted size; ellipsis is a rounding fallback.
                      fontSize: navLabelPx,
                      letterSpacing: '1px',
                      fontWeight: 900,
                      flex: '0 1 auto',
                      minWidth: 0,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textAlign: 'left',
                    }}
                  >
                    {item.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat Slot: the dock's share of the slack. Only the wide dock has room
          for a panel, so the 88 px rail draws none of it. */}
      {!isCompact && <LobbyChat open={chatOn} onToggle={onToggleChat} />}

      {/* Bottom Controls: Notifications */}
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
