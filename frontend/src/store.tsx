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
import { BOT_POOL, SEAT_COLORS, type ColorKey } from './theme';
import { apiFetch, fetchWithCsrf, refreshOnce, translateErrorCode } from './api';
import { connectSessionSocket } from './sessionSocket';
import type { ChatAck, ChatMessage, SessionSocket } from './sessionSocket';
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

/**
 * One card of the Lobby roster. A seated card owns its colour: the colour is the
 * seat, so it is picked when the seat is taken and never re-derived from the card
 * index afterwards. An empty card owns nothing (there is no colour to own yet).
 */
export type Seat =
  | { type: 'you'; color: ColorKey }
  | { type: 'bot'; name: string; color: ColorKey }
  | { type: 'player'; name: string; color: ColorKey }
  | { type: 'empty' };

/** A seat that occupies a card, and therefore holds one of the four corners. */
export type OccupiedSeat = Exclude<Seat, { type: 'empty' }>;

/** Narrows a roster card to the ones that own a colour. */
export function isOccupiedSeat(seat: Seat): seat is OccupiedSeat {
  return seat.type !== 'empty';
}

/**
 * The corners nobody has claimed yet, in the canonical blue-first order. Every
 * palette is built from this: a taken colour is never offered, so the picker
 * cannot produce a duplicate (the server checks the same rule).
 */
export function freeColors(seats: Seat[]): ColorKey[] {
  const taken = new Set(seats.filter(isOccupiedSeat).map((seat) => seat.color));
  return SEAT_COLORS.filter((color) => !taken.has(color));
}

/** A fresh roster: four empty cards. */
function emptySeats(): Seat[] {
  return [{ type: 'empty' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }];
}

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

// Refresh 1 minute early: access tokens expire at 15 minutes, so this keeps
// the session socket's reconnect handshake off an expired token (see the store
// docs).
const ACCESS_TOKEN_REFRESH_MS = 14 * 60 * 1000;

/** The transcript's length: the same 50 rows the backend keeps in its Redis list.
 *  The ring lives here rather than in the dock's panel, so switching the channel
 *  off, or being on `/game` where no panel renders, drops no line. */
const CHAT_LOG_LIMIT = 50;
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
  /** The guest's own corner: the palette is theirs too, and there is no default. */
  hostColor: string;
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
  /** Seats the host (`you`) on card `i` with the picked colour. One host card only: a re-pick moves the seat. */
  placeHost: (i: number, color: ColorKey) => void;
  /** Seats a bot on card `i` at the picked colour. */
  addBot: (i: number, color: ColorKey) => void;
  /** Seats a local hotseat pilot on card `i` at the picked colour. */
  addPlayer: (i: number, color: ColorKey) => void;
  /** Empties card `i`, host card included: an emptied card gives its colour back. */
  removeSeat: (i: number) => void;
  renamePlayer: (i: number, name: string) => void;
  /** Clears every card: call when entering the sub-lobby so a fresh room never inherits seats from a previous session. */
  resetSeats: () => void;
  /** False until the host is seated: every other card is added after the host's colour is theirs. */
  startGame: () => boolean;
  roll: () => void;
  endTurn: () => void;
  settingOn: (key: string) => boolean;
  toggleSetting: (key: string) => void;
  theme: ThemeType;
  setTheme: (t: ThemeType) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  setPlaying: (playing: boolean) => void;
  /** The session socket, or null while signed out (a guest never opens one).
   * Presence rides on it; screens subscribe to its pushes. */
  sessionSocket: SessionSocket | null;
  /** The last site-wide online count the socket pushed. The badge's only source
   * (D11): there is no REST read, and it survives a screen remount because this
   * listener lives as long as the connection. Null until the first push. */
  onlineCount: number | null;
  /** Whether the session socket is up right now. The chat composer is disabled
   * while it is not: an emit made offline would be queued and land minutes later. */
  sessionConnected: boolean;
  /** The public channel's transcript, oldest first, at most 50 lines. Held above
   * the panel so a collapsed channel and `/game` both keep it current. */
  chatLog: ChatMessage[];
  /** Sends one line to the public channel. The ack reports a refusal (too long,
   * too soon, empty, or the transport being down) for the panel's status line. */
  sendChat: (text: string, done?: (reply: ChatAck) => void) => void;
  activeMatch: ActiveMatch;
  setActiveMatch: (match: ActiveMatch) => void;
  guestSetup: GuestSetup | null;
  setGuestSetup: (setup: GuestSetup | null) => void;
  lastResult: LastResult;
  setLastResult: (result: LastResult) => void;
};

const Ctx = createContext<AppState | null>(null);

function storedSeats(): Seat[] {
  try {
    const raw = sessionStorage.getItem(SEATS_KEY);
    if (!raw) return emptySeats();
    const parsed = JSON.parse(raw) as Array<{ type?: unknown; name?: unknown; color?: unknown }>;
    if (!Array.isArray(parsed) || parsed.length !== 4) return emptySeats();
    // A value written before the colour moved onto the seat has no `color` on its
    // occupied cards, and one colour may never sit on two cards: either fault
    // discards the whole value rather than minting a duplicate.
    const taken = new Set<ColorKey>();
    const seats = parsed.map((seat): Seat => {
      const color = SEAT_COLORS.find((c) => c === seat?.color && !taken.has(c));
      if (!color) return { type: 'empty' };
      taken.add(color);
      const name = typeof seat.name === 'string' && seat.name ? seat.name : '';
      if (seat.type === 'you') return { type: 'you', color };
      if (seat.type === 'bot') return { type: 'bot', name: name || 'Bot', color };
      if (seat.type === 'player')
        return { type: 'player', name: name || i18n.t('lobby.defaultPlayerName', { num: 2 }), color };
      return { type: 'empty' };
    });
    if (parsed.some((seat, i) => seat?.type !== 'empty' && seats[i].type === 'empty')) return emptySeats();
    return seats;
  } catch {
    /* a corrupt value is a fresh roster */
    return emptySeats();
  }
}

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
  // The public channel's transcript (queue item 3), and whether the socket is up.
  // Both live here rather than in the dock's panel: the channel can be switched
  // off, and most screens render no panel at all, but the log must not lose a line
  // and the composer must know if a send is possible.
  const [chatLog, setChatLog] = useState<ChatMessage[]>([]);
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

    // The transcript. The connect-time history replaces the ring, a live line
    // appends to it, and the id merge keeps the overlap between the two from
    // painting the newest line twice.
    socket.on('chat:history', (messages) => setChatLog(messages.slice(-CHAT_LOG_LIMIT)));
    socket.on('chat:message', (message) => {
      setChatLog((prev) =>
        prev.some((line) => line.id === message.id)
          ? prev
          : [...prev, message].slice(-CHAT_LOG_LIMIT),
      );
    });

    // The site-wide badge. It arrives on every connection edge, and the gateway
    // also hands a fresh socket the last number it pushed, so this is the badge's
    // first paint as well as its updates.
    socket.on('counts:online', (event) => setOnlineCount(event.count));

    // The handshake is the one auth point on this transport (D4): the access
    // token can be 15 minutes old by the time a reconnect reads the cookie, and
    // only HTTP refreshes it. So a refused handshake refreshes and lets the
    // client retry; persistent refusal means the session is gone, and signing out
    // is better than looping against the refresh route.
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
      setChatLog([]);
      setSessionConnected(false);
    };
  }, [sessionUserId]);

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
      const existing = prev.filter((s) => s.type === 'player').length;
      const name = i18n.t('lobby.defaultPlayerName', { num: existing + 2 });
      const next = prev.slice();
      next[i] = { type: 'player', name, color };
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
