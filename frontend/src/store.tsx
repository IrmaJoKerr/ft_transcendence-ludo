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
import i18n from './i18n';
import { BOT_POOL } from './theme';
import { apiFetch, fetchWithCsrf, refreshOnce, translateErrorCode } from './api';
import type { PlayerColor } from './game/types';

export type AuthUser = {
  id: string;
  username: string;
  displayName?: string;
  email?: string | null;
  emailVerified?: boolean;
  pendingEmail?: string | null;
  twoFactorEnabled?: boolean;
  hasPassword?: boolean;
  avatarStyle?: string | null;
  hasAvatarPhoto?: boolean;
};

/** Pulls a localized message out of a nestjs error body. The server `message` is
 * English by contract: log it and fall back to the caller's localized string. */
function apiError(body: unknown, fallback: string): string {
  const b = body as { code?: string; message?: string | string[] } | null;
  const localized = translateErrorCode(b?.code);
  if (localized) return localized;
  if (b?.message) console.error('[api]', b.message);
  return fallback;
}

/** Outcome of redeeming an emailed verify link. 'error' means the request itself
 * failed, so the single-use token was never consumed and the link still works. */
export type VerifyOutcome = 'signup' | 'change' | 'conflict' | 'invalid' | 'error';

export type Seat =
  | { type: 'you' }
  | { type: 'bot'; name: string }
  | { type: 'player'; name: string }
  | { type: 'empty' };

export type PlayerCount = 2 | 3 | 4;

export type Lang = 'en' | 'fr' | 'ms';
export type ThemeType = 'synthwave';

/** Languages offered in the account menu. */
export const LANGUAGES: Array<{ code: Lang; label: string; flag: string }> = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ms', label: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
];

const LANG_KEY = 'lr.lang';
const THEME_KEY = 'retro_theme';
const ACTIVE_MATCH_KEY = 'lr.activeMatch';
const SEATS_KEY = 'lr.seats';

function storedLang(): Lang {
  const raw = localStorage.getItem(LANG_KEY);
  return LANGUAGES.some((l) => l.code === raw) ? (raw as Lang) : 'en';
}

function storedTheme(): ThemeType {
  return 'synthwave';
}

// Presence heartbeat cadence: how often this client tells the backend it is
// still online (POST /api/presence/heartbeat). Deliberately named apart from the
// backend's SSE keep-alive, which keeps the notification stream from being reset.
const PRESENCE_HEARTBEAT_MS = 20_000;
// Refresh 1 minute early: access tokens expire at 15 minutes, so this keeps
// the heartbeat off an expired token (see the store docs).
const ACCESS_TOKEN_REFRESH_MS = 14 * 60 * 1000;
/** settingOn/toggleSetting key for "show the rules popup when a match starts": read by Lobby's Rules button and Game.tsx. */
export const RULES_ON_START_KEY = 'rulesShowOnStart';
/** Defaults for the settings toggles, keyed "<group>-<row>". */
export const SETTING_DEFAULTS: Record<string, boolean> = {
  '0-0': true, // Sound effects
  '0-1': true, // Music
  '1-0': true, // Auto-roll
  '1-1': false, // Fast animations
  '1-2': true, // Move hints
  '2-0': true, // Friend invites
  '2-1': false, // Weekly recap
};

/** Credentials returned by POST /api/match/create: stored in context so Game page can connect to the engine. */
export type ActiveMatch = {
  gameId: string;
  token: string;
  color: PlayerColor;
  inviteCode?: string;
  mode: 'pvp' | 'pve' | 'hotseat';
  playerCount: number;
  // A guest mint (POST /api/match/guest). Never persisted to sessionStorage: a
  // guest pressing Back must not re-enter a revoked room, and the exits branch
  // on this flag ("Back to login" vs "Back to lobby").
  isGuest?: boolean;
} | null;

function storedActiveMatch(): ActiveMatch {
  try {
    const raw = sessionStorage.getItem(ACTIVE_MATCH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** One invoice row: a seat plus the avatar facts the engine's roster reported for it.
 *  Bots, hotseat seats and the lobby-seat fallback have no account, so they carry none. */
export type ResultPlayer = {
  color: PlayerColor;
  username: string;
  isBot: boolean;
  piecesInGoal: number;
  userId?: string;
  hasAvatarPhoto?: boolean;
  avatarStyle?: string | null;
};

/** Snapshot of a finished match's outcome: set from Game.tsx's `game_ended` handler so Results.tsx can render real data instead of mock podium rows. */
export type LastResult = {
  winner: PlayerColor;
  resultDetail: string;
  mode: 'pvp' | 'pve' | 'hotseat';
  playerCount: number;
  players: ResultPlayer[];
  /** True when the match was abandoned/expired: a different Results card (no winner/podium). */
  abandoned?: boolean;
} | null;

/** The guest setup payload, kept in memory so the end card's "Play again" can
 * mint another room with the same seats and rules without re-walking the setup
 * screen. Not persisted: a guest session dies with the tab. */
export type GuestSetup = {
  botCount: number;
  botColors?: string[];
  botNames?: string[];
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
};

type AppState = {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  authReady: boolean;
  /** Factor one. `identifier` is a username or email. Session = {}, emailed
   *  code = { pendingToken }; otherwise { error }. */
  login: (
    identifier: string,
    password: string,
  ) => Promise<{ error?: string; pendingToken?: string; notVerified?: boolean }>;
  /** Success = { username } (verification email sent, no session yet); failure = { error }. */
  register: (
    username: string,
    password: string,
    email: string,
  ) => Promise<{ error?: string; username?: string }>;
  /** Factor two. Success = null (session cookie set, user in store); failure = message. */
  verify2fa: (pendingToken: string, code: string) => Promise<string | null>;
  /** Re-issues the login code for a live 2FA challenge. Success = null. */
  resend2fa: (pendingToken: string) => Promise<string | null>;
  /** Emails a reset link. Always resolves null (generic response: no account enumeration). */
  forgotPassword: (email: string) => Promise<string | null>;
  /** Redeems a reset token and sets a new password. Success = null; failure = message. */
  resetPassword: (token: string, password: string) => Promise<string | null>;
  /** Resends a signup verification link (public). Success = null. */
  resendVerification: (email: string) => Promise<string | null>;
  /** Redeems an emailed verify link (signup or email-change). */
  verifyEmail: (token: string) => Promise<VerifyOutcome>;
  logout: () => Promise<void>;
  playerCount: PlayerCount;
  seats: Seat[];
  dice: number;
  rolling: boolean;
  turn: number;
  settings: Record<string, boolean>;
  setPlayerCount: (c: PlayerCount) => void;
  addBot: (i: number) => void;
  removeBot: (i: number) => void;
  addPlayer: (i: number) => void;
  removePlayer: (i: number) => void;
  renamePlayer: (i: number, name: string) => void;
  /** Clears every seat but the host: call when entering the sub-lobby so a fresh room never inherits bots/players from a previous session. */
  resetSeats: () => void;
  /** Fills remaining empty seats with Easy bots. Returns false when no bot is seated yet. */
  startGame: () => boolean;
  roll: () => void;
  endTurn: () => void;
  settingOn: (key: string) => boolean;
  toggleSetting: (key: string) => void;
  theme: ThemeType;
  setTheme: (t: ThemeType) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  twoFactor: boolean;
  toggleTwoFactor: (currentPassword?: string) => Promise<string | null>;
  setPlaying: (playing: boolean) => void;
  activeMatch: ActiveMatch;
  setActiveMatch: (match: ActiveMatch) => void;
  guestSetup: GuestSetup | null;
  setGuestSetup: (setup: GuestSetup | null) => void;
  lastResult: LastResult;
  setLastResult: (result: LastResult) => void;
};

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeType>(storedTheme);

  const setTheme = useCallback((newTheme: ThemeType) => {
    setThemeState(newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    document.body.setAttribute('data-theme', newTheme);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
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

  // Logout
  const logout = useCallback(async () => {
    // Clears presence immediately, before the auth cookie needed to identify
    // the request is gone: otherwise the account reads "online" for up to
    // the heartbeat TTL after signing out.
    await fetchWithCsrf('/api/presence/heartbeat', {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => undefined);
    await fetchWithCsrf('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setTwoFactor(false);
  }, []);

  // Presence: a ref (not state) because it only drives an outgoing request,
  // never a render; Game.tsx flips it on mount/unmount via setPlaying.
  const playingRef = useRef(false);
  const sendPresenceHeartbeat = useCallback((playing: boolean) => {
    apiFetch('/api/presence/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ playing }),
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) setUser(null);
      })
      .catch(() => undefined);
  }, []);
  const setPlaying = useCallback(
    (playing: boolean) => {
      playingRef.current = playing;
      if (user) sendPresenceHeartbeat(playing);
    },
    [user, sendPresenceHeartbeat],
  );

  // Presence heartbeat loop: tells the backend this account is still here every
  // PRESENCE_HEARTBEAT_MS, so friends' presence dots can go stale correctly.
  useEffect(() => {
    if (!user) return;
    sendPresenceHeartbeat(playingRef.current);
    const id = setInterval(() => sendPresenceHeartbeat(playingRef.current), PRESENCE_HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [user, sendPresenceHeartbeat]);

  // Proactive refresh so the heartbeat never hits the reactive 401 path in
  // apiFetch (which recovers, but logs a console 401 first).
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => {
      void refreshOnce();
    }, ACCESS_TOKEN_REFRESH_MS);
    return () => clearInterval(id);
  }, [user]);

  const [playerCount, setPlayerCount] = useState<PlayerCount>(4);
  const [seats, setSeats] = useState<Seat[]>(() => {
    try {
      const raw = sessionStorage.getItem(SEATS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Seat[];
        if (Array.isArray(parsed) && parsed.length === 4 && parsed.some((x) => x.type === 'you'))
          return parsed;
      }
    } catch {
      /* ignore corrupt value */
    }
    return [{ type: 'you' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }];
  });
  const [dice, setDice] = useState(4);
  const [rolling, setRolling] = useState(false);
  const [turn, setTurn] = useState(0);
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [lang, setLangState] = useState<Lang>(storedLang);
  const [twoFactor, setTwoFactor] = useState(false);
  const rollingRef = useRef(false);

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

  // Load the account's real 2FA preference once signed in: GET /api/auth/2fa.
  useEffect(() => {
    if (!user) return;
    apiFetch('/api/auth/2fa')
      .then(async (res) => {
        if (!res.ok) return;
        const data = await res.json();
        setTwoFactor(!!data.twoFactorEnabled);
      })
      .catch(() => undefined);
  }, [user]);

  // Persist the toggle. Turning 2FA on or off is a sensitive change, so a
  // password account confirms its password; `undefined` is correct for an
  // OAuth-only account (the server trusts the active session). Resolves null on
  // success or a localized error message.
  const toggleTwoFactor = useCallback(
    async (currentPassword?: string): Promise<string | null> => {
      const next = !twoFactor;
      try {
        const res = await apiFetch('/api/auth/2fa', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: next, currentPassword }),
        });
        const data = (await res.json().catch(() => null)) as {
          code?: string;
          message?: string;
          twoFactorEnabled?: boolean;
        } | null;
        if (!res.ok) {
          if (data?.message) console.error('[2fa]', data.message);
          return translateErrorCode(data?.code) ?? i18n.t('common.requestFailed', { status: res.status });
        }
        setTwoFactor(!!data?.twoFactorEnabled);
        return null;
      } catch {
        return i18n.t('common.couldNotReachServer');
      }
    },
    [twoFactor],
  );

  useEffect(() => {
    document.documentElement.lang = lang;
    void i18n.changeLanguage(lang);
  }, [lang]);

  const addBot = useCallback((i: number) => {
    setSeats((prev) => {
      const used = prev.filter((s) => s.type === 'bot').map((s) => s.name);
      const name = BOT_POOL.find((n) => !used.includes(n)) ?? 'Bot';
      const next = prev.slice();
      next[i] = { type: 'bot', name };
      return next;
    });
  }, []);

  const removeBot = useCallback((i: number) => {
    setSeats((prev) => {
      const next = prev.slice();
      next[i] = { type: 'empty' };
      return next;
    });
  }, []);

  const addPlayer = useCallback((i: number) => {
    setSeats((prev) => {
      const existing = prev.filter((s) => s.type === 'player').length;
      const name = i18n.t('lobby.defaultPlayerName', { num: existing + 2 });
      const next = prev.slice();
      next[i] = { type: 'player', name };
      return next;
    });
  }, []);

  const removePlayer = useCallback((i: number) => {
    setSeats((prev) => {
      const next = prev.slice();
      next[i] = { type: 'empty' };
      return next;
    });
  }, []);

  const renamePlayer = useCallback((i: number, name: string) => {
    setSeats((prev) => {
      if (prev[i].type !== 'player') return prev;
      const next = prev.slice();
      next[i] = { type: 'player', name };
      return next;
    });
  }, []);

  const resetSeats = useCallback(() => {
    setSeats([{ type: 'you' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }]);
  }, []);

  const startGame = useCallback((): boolean => {
    const bots = seats.slice(0, playerCount).filter((s) => s.type === 'bot').length;
    if (bots < 1) return false;
    const used = seats.filter((s) => s.type === 'bot').map((s) => s.name);
    const pool = BOT_POOL.filter((n) => !used.includes(n));
    setSeats((prev) =>
      prev.map((s, i): Seat => {
        if (i < playerCount && s.type === 'empty')
          return { type: 'bot', name: pool.shift() ?? 'Bot' };
        return s;
      }),
    );
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
      addBot,
      removeBot,
      addPlayer,
      removePlayer,
      renamePlayer,
      resetSeats,
      startGame,
      roll,
      endTurn,
      settingOn,
      toggleSetting,
      lang,
      setLang,
      twoFactor,
      toggleTwoFactor,
      setPlaying,
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
      addBot,
      removeBot,
      addPlayer,
      removePlayer,
      renamePlayer,
      resetSeats,
      startGame,
      roll,
      endTurn,
      settingOn,
      toggleSetting,
      lang,
      setLang,
      twoFactor,
      toggleTwoFactor,
      setPlaying,
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
