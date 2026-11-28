import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import i18n from '../i18n';
import { CHAT_HISTORY } from '../__shared__/chat.constants';
import { BOT_POOL, type ColorKey } from '../theme';
import { apiFetch, fetchWithCsrf, refreshOnce, translateErrorCode } from '../api';
import { useChatFeed } from '../hooks/useChatFeed';
import { connectSessionSocket } from '../sessionSocket';
import { ACCESS_TOKEN_REFRESH_MS, ACTIVE_MATCH_KEY, LANG_KEY, NOTIF_AUTOCLOSE_KEY, SEATS_KEY, THEME_KEY, emptySeats, storedActiveMatch, storedAutoClose, storedLang, storedSeats, storedTheme } from './storage';
import type { ActiveMatch, AppState, AuthUser, GuestSetup, Lang, LastResult, PlayerCount, Seat, ThemeType, VerifyOutcome } from './types';
import { SETTING_DEFAULTS } from './types';
import { THEME_BY_ID } from '../styles/themes';
import type { ChatAck, ChatMessage, SessionSocket } from '../sessionSocket';

export type { AuthUser, GuestSetup, LastResult, Lang, PlayerCount, Seat, ThemeType, VerifyOutcome, ActiveMatch, ResultPlayer } from './types';
export { LANGUAGES, THEMES, SETTING_DEFAULTS, RULES_ON_START_KEY, isOccupiedSeat, freeColors } from './types';

const Ctx = createContext<AppState | null>(null);

function apiError(body: unknown, fallback: string): string {
  const b = body as { code?: string; message?: string | string[] } | null;
  const localized = translateErrorCode(b?.code);
  if (localized) return localized;
  if (b?.message) console.error('[api]', b.message);
  return fallback;
}

// One write for the two attributes and the browser's own chrome. The meta is the
// theme's value, not a second table; a document without it (an old built page) is fine.
function applyThemeToDocument(next: ThemeType) {
  document.documentElement.setAttribute('data-theme', next);
  document.body.setAttribute('data-theme', next);
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_BY_ID[next].themeColor);
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeType>(storedTheme);

  const setTheme = useCallback((newTheme: ThemeType) => {
    setThemeState(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    applyThemeToDocument(newTheme);
  }, []);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // '/', '/login' and '/signup' skip the /api/auth/me probe: a guest here must
    // not fire a 401 that the browser logs. Other paths still probe.
    const path = window.location.pathname;
    const publicRoutes = new Set([
      '/',
      '/login',
      '/signup',
      //'/2fa',
      //'/forgot-password',
      //'/reset-password',
    ]);
    if (publicRoutes.has(path)) {
      setAuthReady(true);
      return;
    }

    const restore = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await apiFetch('/api/auth/me');
          if (cancelled) return;

          if (res.ok) {
            setUser((await res.json()).user);
            return;
          }
          if (res.status === 401 || res.status === 403) {
            setUser(null); // genuinely signed out
            return;
          }

          // 429/5xx: retry, honouring Retry-After when the server sends one.
          const retryAfter = Number(res.headers.get('Retry-After'));
          const waitMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? Math.min(retryAfter * 1000, 8000)
              : 1000 * 2 ** attempt;
          await new Promise((r) => setTimeout(r, waitMs));
        } catch {
          if (cancelled) return;
          // Network error: also not a logout. Back off and try again.
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
      // Out of attempts and still no clear answer: leave `user` as it is rather
      // than inventing a logout. authReady still resolves below, so the UI
      // renders instead of hanging on a spinner.
    };

    void restore().finally(() => {
      if (!cancelled) setAuthReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  // Login: factor one. Password OK means a code was emailed; the session
  // itself only exists after verify2fa succeeds.
  const login = useCallback(
    async (
      identifier: string,
      password: string,
    ): Promise<{ error?: string; pendingToken?: string; notVerified?: boolean }> => {
      const res = await fetchWithCsrf('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      }).catch(() => null);
      if (!res) return { error: i18n.t('common.couldNotReachServer') };
      if (!res.ok)
        return { error: apiError(await res.json().catch(() => null), i18n.t('auth.loginFailed')) };
      const data = await res.json();
      // A notice carries a code but no session: the address is not verified
      // yet. Sent as 200, so the browser logs no error for it.
      if (data.code === 'AUTH_EMAIL_NOT_VERIFIED') {
        return { error: apiError(data, i18n.t('auth.loginFailed')), notVerified: true };
      }
      // 2FA off: the backend already set the session cookies, so there's no
      // code step: record the user and let the caller route straight home.
      if (!data.twoFactorRequired) {
        setUser(data.user);
        return {};
      }
      // 2FA on: a code was emailed; the session only exists after verify2fa.
      return { pendingToken: data.pendingToken };
    },
    [],
  );

  // Register: no session on signup; the account activates via the emailed
  // verification link, then the user logs in normally.
  const register = useCallback(
    async (
      username: string,
      password: string,
      email: string,
    ): Promise<{ error?: string; username?: string }> => {
      const res = await fetchWithCsrf('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email, language: i18n.language }),
      }).catch(() => null);
      if (!res) return { error: i18n.t('common.couldNotReachServer') };
      if (!res.ok)
        return { error: apiError(await res.json().catch(() => null), i18n.t('auth.signupFailed')) };
      const data = (await res.json().catch(() => null)) as { username?: string } | null;
      return { username: data?.username };
    },
    [],
  );

  // Factor two: a correct emailed code buys the actual session cookie.
  const verify2fa = useCallback(
    async (pendingToken: string, code: string): Promise<string | null> => {
      const res = await fetchWithCsrf('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingToken, code }),
      }).catch(() => null);
      if (!res) return i18n.t('common.couldNotReachServer');
      if (!res.ok) return apiError(await res.json().catch(() => null), i18n.t('auth.codeRejected'));
      setUser((await res.json()).user);
      return null;
    },
    [],
  );

  // Re-issue the 2FA login code for a live challenge. Success = null.
  const resend2fa = useCallback(async (pendingToken: string): Promise<string | null> => {
    const res = await fetchWithCsrf('/api/auth/2fa/resend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pendingToken }),
    }).catch(() => null);
    if (!res) return i18n.t('common.couldNotReachServer');
    if (!res.ok) return apiError(await res.json().catch(() => null), i18n.t('auth.codeRejected'));
    return null;
  }, []);

  // Forgot password: asks the backend to email a reset link. The response is
  // deliberately generic, so this always resolves null (never reveals whether
  // the address exists). A network failure still surfaces as a message.
  const forgotPassword = useCallback(async (email: string): Promise<string | null> => {
    const res = await fetchWithCsrf('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    if (!res) return i18n.t('common.couldNotReachServer');
    if (!res.ok) return apiError(await res.json().catch(() => null), i18n.t('auth.forgotFailed'));
    return null;
  }, []);

  // Reset password: redeems the emailed token and sets the new password.
  const resetPassword = useCallback(
    async (token: string, password: string): Promise<string | null> => {
      const res = await fetchWithCsrf('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      }).catch(() => null);
      if (!res) return i18n.t('common.couldNotReachServer');
      if (!res.ok) return apiError(await res.json().catch(() => null), i18n.t('auth.resetFailed'));
      return null;
    },
    [],
  );

  // Resend a signup verification link (public endpoint; generic response).
  const resendVerification = useCallback(async (email: string): Promise<string | null> => {
    const res = await fetchWithCsrf('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    if (!res) return i18n.t('common.couldNotReachServer');
    if (!res.ok) return apiError(await res.json().catch(() => null), i18n.t('auth.forgotFailed'));
    return null;
  }, []);

  // Redeem an emailed verify link (signup or email-change). The token travels in
  // the request *body*: the link carries it in a URL fragment, which browsers
  // never send to the server, so it stays out of the access and error logs.
  const verifyEmail = useCallback(async (token: string): Promise<VerifyOutcome> => {
    const res = await fetchWithCsrf('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    // Any transport failure or non-2xx leaves the single-use token unconsumed.
    if (!res?.ok) return 'error';
    const data = (await res.json().catch(() => null)) as { result?: VerifyOutcome } | null;
    return data?.result ?? 'error';
  }, []);

  // Logout. Presence needs no request of its own: signing out clears the user,
  // which tears down the session socket, and the connection *is* the liveness
  // signal (its close lets the presence row lapse on its TTL).
  const logout = useCallback(async () => {
    await fetchWithCsrf('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
  }, []);

  // The session socket: one connection per signed-in tab, authenticated by the
  // httpOnly cookie in the handshake. Presence is the connection itself, so there
  // is no heartbeat request to send any more.
  const [sessionSocket, setSessionSocket] = useState<SessionSocket | null>(null);
  const socketRef = useRef<SessionSocket | null>(null);
  // The badge's number (D11). Read here rather than in the screen that paints it:
  // the connect-time emit happens once per connection, so a listener owned by the
  // connection cannot miss it the way a per-mount one would after a navigation.
  const [onlineCount, setOnlineCount] = useState<number | null>(null);
    // The public channel's transcript (queue item 3), and whether the socket is up. Both live here
  // rather than in the dock's panel: the channel can be switched off, and most screens render no
  // panel at all, but the log must not lose a line and the composer must know if a send is possible.
  const {
    lines: chatLog,
    replace: replaceChatLog,
    append: appendChatLog,
    clear: clearChatLog,
  } = useChatFeed<ChatMessage>(CHAT_HISTORY);
  const [sessionConnected, setSessionConnected] = useState(false);
  // The effect keys on the id, not the object: a profile edit replaces `user` and
  // must not tear down a healthy connection.
  const sessionUserId = user?.id;
  // Presence: a ref (not state) because it only drives an outgoing socket event,
  // never a render; Game.tsx flips it on mount/unmount via setPlaying.
  const playingRef = useRef(false);
  const setPlaying = useCallback((playing: boolean) => {
    playingRef.current = playing;
    // Per connection (D3): the server stores the bit against this socket, so a
    // sibling tab is unaffected. No socket (a guest, or before connect) is fine:
    // every connect re-asserts the current bit below.
    socketRef.current?.emit('presence:playing', { playing });
  }, []);

  // One line to the public channel. No socket means no channel, and the ack says
  // so rather than swallowing the text: the panel keeps it and explains why.
  const sendChat = useCallback((text: string, done?: (reply: ChatAck) => void) => {
    const socket = socketRef.current;
    if (!socket) {
      done?.({ ok: false, error: 'CHAT_UNAVAILABLE' });
      return;
    }
    socket.emit('chat:send', { text }, (reply) => done?.(reply));
  }, []);

  useEffect(() => {
    if (!sessionUserId) return;
    const socket = connectSessionSocket();
    socketRef.current = socket;
    setSessionSocket(socket);

    // A reconnected socket carries no state, so the flag is re-asserted on every
    // connect rather than only on the enter/leave transition.
    socket.on('connect', () => {
      setSessionConnected(true);
      socket.emit('presence:playing', { playing: playingRef.current });
    });
    socket.on('disconnect', () => setSessionConnected(false));

    // The transcript: connect-time history replaces the ring, live lines append, and
    // `useChatFeed` owns the shared id dedupe and ordering.
    socket.on('chat:history', (messages) => replaceChatLog(messages));
    socket.on('chat:message', (message) => appendChatLog(message));

    // The site-wide badge. It arrives on every connection edge, and the gateway
    // also hands a fresh socket the last number it pushed, so this is the badge's
    // first paint as well as its updates.
    socket.on('counts:online', (event) => setOnlineCount(event.count));

        // The handshake is the one auth point on this transport (D4): the access token can be 15 minutes
    // old by the time a reconnect reads the cookie, and only HTTP refreshes it.
    let refused = 0;
    socket.on('connect_error', (error) => {
      if (error.message !== 'Authentication required' && error.message !== 'Invalid token') return;
      refused += 1;
      if (refused > 2) {
        socket.disconnect();
        setUser(null);
        return;
      }
      void refreshOnce();
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setSessionSocket(null);
      // The badge belongs to the connection: a signed-out screen must not paint
      // the last number this session saw. The transcript does too: another
      // account's tab must not inherit this one's channel.
      setOnlineCount(null);
      clearChatLog();
      setSessionConnected(false);
    };
  }, [sessionUserId, replaceChatLog, appendChatLog, clearChatLog]);

  // Proactive refresh so a reconnect handshake (and any apiFetch call) never hits
  // the reactive 401 path with an expired access token. Auth, not state: it stays
  // even though presence no longer sends anything periodically.
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      void refreshOnce();
    }, ACCESS_TOKEN_REFRESH_MS);
    return () => clearInterval(id);
  }, [user]);

  const [playerCount, setPlayerCount] = useState<PlayerCount>(4);
  const [seats, setSeats] = useState<Seat[]>(storedSeats);
  const [dice, setDice] = useState(4);
  const [rolling, setRolling] = useState(false);
  const [turn, setTurn] = useState(0);
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [lang, setLangState] = useState<Lang>(storedLang);
  const [notifAutoClose, setNotifAutoCloseState] = useState<boolean>(storedAutoClose);
  const rollingRef = useRef(false);

  // One field, both homes (22.5): the dock's popover and the game's controls modal
  // read and write this, so the setting cannot disagree with itself.
  const setNotifAutoClose = useCallback((on: boolean) => {
    setNotifAutoCloseState(on);
    try {
      localStorage.setItem(NOTIF_AUTOCLOSE_KEY, on ? 'on' : 'off');
    } catch {
      // Ignore: it still holds for this page load.
    }
  }, []);

  // Persist the language locally, and (when signed in) on the account so
  // transactional email is sent in the user's language.
  const setLang = useCallback(
    (l: Lang) => {
      setLangState(l);
      localStorage.setItem(LANG_KEY, l);
      document.documentElement.lang = l;
      void i18n.changeLanguage(l);
      if (user) {
        void apiFetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: l }),
        }).catch(() => undefined);
      }
    },
    [user],
  );

  useEffect(() => {
    document.documentElement.lang = lang;
    void i18n.changeLanguage(lang);
  }, [lang]);

  const placeHost = useCallback((i: number, color: ColorKey) => {
    setSeats((prev) => {
      const next = prev.slice();
      // One host card only: re-picking moves the seat instead of seating it twice.
      for (let k = 0; k < next.length; k++) if (next[k].type === 'you') next[k] = { type: 'empty' };
      next[i] = { type: 'you', color };
      return next;
    });
  }, []);

  const addBot = useCallback((i: number, color: ColorKey) => {
    setSeats((prev) => {
      const used = prev.filter((s) => s.type === 'bot').map((s) => s.name);
      const name = BOT_POOL.find((n) => !used.includes(n)) ?? 'Bot';
      const next = prev.slice();
      next[i] = { type: 'bot', name, color };
      return next;
    });
  }, []);

  const addPlayer = useCallback((i: number, color: ColorKey) => {
    setSeats((prev) => {
      // A raw, language-independent seat id: rendered as "player-yellow" ->
      // "joueur-jaune" by `localizedPilotName`, so a language switch renames it and
      // the store never bakes a translated string into the seat.
      const next = prev.slice();
      next[i] = { type: 'player', name: `player-${color}`, color };
      return next;
    });
  }, []);

  // One remove path for every card: emptying the host's card gives its colour back
  // and reopens the palette, because no card may be filled before the host's.
  const removeSeat = useCallback((i: number) => {
    setSeats((prev) => {
      const next = prev.slice();
      next[i] = { type: 'empty' };
      return next;
    });
  }, []);

  const renamePlayer = useCallback((i: number, name: string) => {
    setSeats((prev) => {
      const seat = prev[i];
      if (seat.type !== 'player') return prev;
      const next = prev.slice();
      next[i] = { type: 'player', name, color: seat.color };
      return next;
    });
  }, []);

  const resetSeats = useCallback(() => {
    setSeats(emptySeats());
  }, []);

  // Nothing is auto-filled any more: every card is a seat the user placed, so the
  // only thing left to check is that the host took theirs.
  const startGame = useCallback((): boolean => {
    if (!seats.slice(0, playerCount).some((s) => s.type === 'you')) return false;
    setTurn(0);
    return true;
  }, [seats, playerCount]);

  const roll = useCallback(() => {
    if (rollingRef.current) return;
    rollingRef.current = true;
    setRolling(true);
    setTimeout(() => {
      setDice(1 + Math.floor(Math.random() * 6));
      setRolling(false);
      rollingRef.current = false;
    }, 650);
  }, []);

  const endTurn = useCallback(() => {
    setTurn((t) => (t + 1) % playerCount);
  }, [playerCount]);

  const settingOn = useCallback(
    (key: string) => (key in settings ? settings[key] : (SETTING_DEFAULTS[key] ?? false)),
    [settings],
  );

  const toggleSetting = useCallback(
    (key: string) =>
      setSettings((prev) => ({
        ...prev,
        [key]: !(key in prev ? prev[key] : (SETTING_DEFAULTS[key] ?? false)),
      })),
    [],
  );

  const [activeMatch, setActiveMatch] = useState<ActiveMatch>(storedActiveMatch);
  const [guestSetup, setGuestSetup] = useState<GuestSetup | null>(null);
  const [lastResult, setLastResult] = useState<LastResult>(null);

  // Persist activeMatch + seats in sessionStorage so a page refresh can
  // reconnect (hotseat needs the local seat names to rejoin every seat). A
  // guest match is deliberately NOT persisted: it lives in memory only.
  useEffect(() => {
    if (activeMatch && !activeMatch.isGuest)
      sessionStorage.setItem(ACTIVE_MATCH_KEY, JSON.stringify(activeMatch));
    else sessionStorage.removeItem(ACTIVE_MATCH_KEY);
  }, [activeMatch]);

  useEffect(() => {
    sessionStorage.setItem(SEATS_KEY, JSON.stringify(seats));
  }, [seats]);

  const value = useMemo(
    () => ({
      user,
      setUser,
      authReady,
      login,
      register,
      verify2fa,
      forgotPassword,
      resetPassword,
      resendVerification,
      verifyEmail,
      resend2fa,
      logout,
      theme,
      setTheme,
      playerCount,
      seats,
      dice,
      rolling,
      turn,
      settings,
      setPlayerCount,
      placeHost,
      addBot,
      addPlayer,
      removeSeat,
      renamePlayer,
      resetSeats,
      startGame,
      roll,
      endTurn,
      settingOn,
      toggleSetting,
      lang,
      setLang,
      notifAutoClose,
      setNotifAutoClose,
      setPlaying,
      sessionSocket,
      onlineCount,
      sessionConnected,
      chatLog,
      sendChat,
      activeMatch,
      setActiveMatch,
      guestSetup,
      setGuestSetup,
      lastResult,
      setLastResult,
    }),
    [
      user,
      setUser,
      authReady,
      login,
      register,
      verify2fa,
      forgotPassword,
      resetPassword,
      resendVerification,
      verifyEmail,
      resend2fa,
      logout,
      theme,
      setTheme,
      playerCount,
      seats,
      dice,
      rolling,
      turn,
      settings,
      placeHost,
      addBot,
      addPlayer,
      removeSeat,
      renamePlayer,
      resetSeats,
      startGame,
      roll,
      endTurn,
      settingOn,
      toggleSetting,
      lang,
      setLang,
      notifAutoClose,
      setNotifAutoClose,
      setPlaying,
      sessionSocket,
      onlineCount,
      sessionConnected,
      chatLog,
      sendChat,
      activeMatch,
      guestSetup,
      lastResult,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
