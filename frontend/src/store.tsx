import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import i18n from './i18n'
import { BOT_POOL } from './theme'
import { apiFetch, restoreMe } from './api'
import type { PlayerColor } from './game/types'

export type AuthUser = { id: string; username: string; displayName?: string; email?: string | null; twoFactorEnabled?: boolean; avatarStyle?: string | null; hasAvatarPhoto?: boolean }

/** Pulls a readable message out of nestjs error body  */
function apiError(body: unknown, fallback: string): string {
  const message = (body as { message?: string | string[] } | null)?.message
  if (Array.isArray(message)) return message.join('. ')
  return typeof message === 'string' ? message : fallback
}

export type Seat =
  | { type: 'you' }
  | { type: 'bot'; name: string }
  | { type: 'player'; name: string }
  | { type: 'empty' }

export type PlayerCount = 1 | 2 | 3 | 4

export type Lang = 'en' | 'fr' | 'ms'
export type ThemeType = 'synthwave' | 'win95' | 'terminal'

/** Languages offered in the account menu. */
export const LANGUAGES: Array<{ code: Lang; label: string; flag: string }> = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ms', label: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
]

const LANG_KEY = 'lr.lang'
const THEME_KEY = 'retro_theme'
const ACTIVE_MATCH_KEY = 'lr.activeMatch'
const SEATS_KEY = 'lr.seats'

function storedLang(): Lang {
  const raw = localStorage.getItem(LANG_KEY)
  return LANGUAGES.some((l) => l.code === raw) ? (raw as Lang) : 'en'
}

function storedTheme(): ThemeType {
  const raw = localStorage.getItem(THEME_KEY)
  return raw === 'win95' || raw === 'terminal' || raw === 'synthwave' ? raw : 'synthwave'
}

const HEARTBEAT_INTERVAL_MS = 20_000
/** settingOn/toggleSetting key for "show the rules popup when a match starts" — read by Lobby's Rules button and Game.tsx. */
export const RULES_ON_START_KEY = 'rulesShowOnStart'
/** Defaults for the settings toggles, keyed "<group>-<row>". */
export const SETTING_DEFAULTS: Record<string, boolean> = {
  '0-0': true, // Sound effects
  '0-1': true, // Music
  '1-0': true, // Auto-roll
  '1-1': false, // Fast animations
  '1-2': true, // Move hints
  '2-0': true, // Friend invites
  '2-1': false, // Weekly recap
}

/** Credentials returned by POST /api/match/create — stored in context so Game page can connect to the engine. */
export type ActiveMatch = {
  gameId: string
  token: string
  color: PlayerColor
  inviteCode?: string
  mode: 'pvp' | 'pve' | 'hotseat'
  playerCount: number
} | null

function storedActiveMatch(): ActiveMatch {
  try {
    const raw = sessionStorage.getItem(ACTIVE_MATCH_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** Snapshot of a finished match's outcome — set from Game.tsx's `game_ended` handler so Results.tsx can render real data instead of mock podium rows. */
export type LastResult = {
  winner: PlayerColor
  resultDetail: string
  mode: 'pvp' | 'pve' | 'hotseat'
  playerCount: number
  players: Array<{ color: PlayerColor; username: string; isBot: boolean; piecesInGoal: number }>
  /** True when the match was abandoned/expired — a different Results card (no winner/podium). */
  abandoned?: boolean
} | null

type AppState = {
  user: AuthUser | null
  setUser: (u: AuthUser | null) => void
  authReady: boolean
  /** Factor one. `identifier` is a username or email. Success = { pendingToken } (code emailed); failure = { error }. */
  login: (identifier: string, password: string) => Promise<{ error?: string; pendingToken?: string }>
  /** Success = null (verification email sent — no session yet); failure = message. */
  register: (username: string, password: string, email: string) => Promise<string | null>
  /** Factor two. Success = null (session cookie set, user in store); failure = message. */
  verify2fa: (pendingToken: string, code: string) => Promise<string | null>
  /** Emails a reset link. Always resolves null (generic response — no account enumeration). */
  forgotPassword: (email: string) => Promise<string | null>
  /** Redeems a reset token and sets a new password. Success = null; failure = message. */
  resetPassword: (token: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
  playerCount: PlayerCount
  seats: Seat[]
  dice: number
  rolling: boolean
  turn: number
  settings: Record<string, boolean>
  setPlayerCount: (c: PlayerCount) => void
  addBot: (i: number) => void
  removeBot: (i: number) => void
  addPlayer: (i: number) => void
  removePlayer: (i: number) => void
  renamePlayer: (i: number, name: string) => void
  /** Clears every seat but the host — call when entering the sub-lobby so a fresh room never inherits bots/players from a previous session. */
  resetSeats: () => void
  /** Fills remaining empty seats with Easy bots. Returns false when no bot is seated yet. */
  startGame: () => boolean
  roll: () => void
  endTurn: () => void
  settingOn: (key: string) => boolean
  toggleSetting: (key: string) => void
  theme: ThemeType
  setTheme: (t: ThemeType) => void
  lang: Lang
  setLang: (l: Lang) => void
  twoFactor: boolean
  toggleTwoFactor: () => void
  setPlaying: (playing: boolean) => void
  activeMatch: ActiveMatch
  setActiveMatch: (match: ActiveMatch) => void
  lastResult: LastResult
  setLastResult: (result: LastResult) => void
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeType>(storedTheme)

  const setTheme = useCallback((newTheme: ThemeType) => {
    setThemeState(newTheme)
    localStorage.setItem(THEME_KEY, newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    document.body.setAttribute('data-theme', newTheme)
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    document.body.setAttribute('data-theme', theme)
  }, [theme])

  const [user, setUser] = useState<AuthUser | null>(null)
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Login/signup are reachable while genuinely signed out — /api/auth/me
    // (and the /api/auth/refresh it triggers on a 401) would just fail there
    // every time, so skip the round trip and let `user` stay null until an
    // actual login/register call sets it. Every other route still restores
    // the session normally on load/refresh.
    const path = window.location.pathname
    if (path === '/login' || path === '/signup') {
      setAuthReady(true)
      return
    }

    // Restore is always authoritative: the session lives entirely in httpOnly
    // cookies, so /api/auth/me is the single source of truth for "who am I?".
    // /me self-heals server-side and never answers 401: signed out → 200
    // { user: null }; a stale access token with a valid refresh cookie is
    // rotated and returns 200 { user } with fresh cookies. (restoreMe() routes
    // the call through the cross-tab refresh lock so several tabs restoring at
    // once don't race each other's token rotation.)
    //
    // (An earlier lr_session presence-marker cookie gated this call to silence
    // the console 401 on logged-out loads — but it added a second source of
    // truth about the session for a purely cosmetic gain. Reverted in favour of
    // always restoring via /me, which now returns 200 in every state.)

    const restore = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await restoreMe()
          if (cancelled) return

          if (res.ok) {
            setUser((await res.json()).user)
            return
          }
          if (res.status === 401 || res.status === 403) {
            setUser(null) // genuinely signed out
            return
          }

          // 429/5xx — retry, honouring Retry-After when the server sends one.
          const retryAfter = Number(res.headers.get('Retry-After'))
          const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter * 1000, 8000)
            : 1000 * 2 ** attempt
          await new Promise((r) => setTimeout(r, waitMs))
        } catch {
          if (cancelled) return
          // Network error — also not a logout. Back off and try again.
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt))
        }
      }
      // Out of attempts and still no clear answer: leave `user` as it is rather
      // than inventing a logout. authReady still resolves below, so the UI
      // renders instead of hanging on a spinner.
    }

    restore().finally(() => {
      if (!cancelled) setAuthReady(true)
    })

    return () => { cancelled = true }
  }, [])

  // Login — factor one. Password OK means a code was emailed; the session
  // itself only exists after verify2fa succeeds.
  const login = useCallback(
    async (identifier: string, password: string): Promise<{ error?: string; pendingToken?: string }> => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier, password }),
      }).catch(() => null)
      if (!res) return { error: 'Could not reach the server' }
      if (!res.ok) return { error: apiError(await res.json().catch(() => null), 'Login failed') }
      const data = await res.json()
      // 2FA off: the backend already set the session cookies, so there's no
      // code step — record the user and let the caller route straight home.
      if (!data.twoFactorRequired) {
        setUser(data.user)
        return {}
      }
      // 2FA on: a code was emailed; the session only exists after verify2fa.
      return { pendingToken: data.pendingToken }
    },
    [],
  )

  // Register — no session on signup; the account activates via the emailed
  // verification link, then the user logs in normally.
  const register = useCallback(
    async (username: string, password: string, email: string): Promise<string | null> => {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, email }),
      }).catch(() => null)
      if (!res) return 'Could not reach the server'
      if (!res.ok) return apiError(await res.json().catch(() => null), 'Sign up failed')
      return null
    },
    [],
  )

  // Factor two — a correct emailed code buys the actual session cookie.
  const verify2fa = useCallback(
    async (pendingToken: string, code: string): Promise<string | null> => {
      const res = await fetch('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingToken, code }),
      }).catch(() => null)
      if (!res) return 'Could not reach the server'
      if (!res.ok) return apiError(await res.json().catch(() => null), 'Code rejected')
      setUser((await res.json()).user)
      return null
    },
    [],
  )

  // Forgot password — asks the backend to email a reset link. The response is
  // deliberately generic, so this always resolves null (never reveals whether
  // the address exists). A network failure still surfaces as a message.
  const forgotPassword = useCallback(async (email: string): Promise<string | null> => {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    }).catch(() => null)
    if (!res) return 'Could not reach the server'
    if (!res.ok) return apiError(await res.json().catch(() => null), 'Something went wrong')
    return null
  }, [])

  // Reset password — redeems the emailed token and sets the new password.
  const resetPassword = useCallback(async (token: string, password: string): Promise<string | null> => {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    }).catch(() => null)
    if (!res) return 'Could not reach the server'
    if (!res.ok) return apiError(await res.json().catch(() => null), 'Could not reset password')
    return null
  }, [])

  // Logout
  const logout = useCallback(async () => {
    // Clears presence immediately, before the auth cookie needed to identify
    // the request is gone — otherwise the account reads "online" for up to
    // the heartbeat TTL after signing out.
    await fetch('/api/presence/heartbeat', { method: 'DELETE', credentials: 'include' }).catch(() => undefined)
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    setUser(null)
    setTwoFactor(false)
  }, [])

  // Presence — a ref (not state) because it only drives an outgoing request,
  // never a render; Game.tsx flips it on mount/unmount via setPlaying.
  const playingRef = useRef(false)
  const sendHeartbeat = useCallback((playing: boolean) => {
    // Goes through apiFetch so a 401 (expired 15-min access token) triggers the
    // silent refresh (cross-tab coordinated) and retry instead of logging the
    // user out on the spot — the heartbeat fires every 20s, so a raw fetch here
    // would kick you to /login the first time the access token lapses.
    apiFetch('/api/presence/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ playing }),
    }).then((res) => {
      // A 401 surviving apiFetch means the REFRESH token itself is gone/revoked
      // — the session really is over. Stop the loop instead of retrying every
      // HEARTBEAT_INTERVAL_MS forever; clearing `user` also lets App.tsx's
      // route guard redirect to /login on its own.
      if (res.status === 401) setUser(null)
    }).catch(() => undefined)
  }, [])
  const setPlaying = useCallback(
    (playing: boolean) => {
      playingRef.current = playing
      if (user) sendHeartbeat(playing)
    },
    [user, sendHeartbeat],
  )

  // Heartbeat loop: tells the backend this account is still here every
  // HEARTBEAT_INTERVAL_MS, so friends' presence dots can go stale correctly.
  useEffect(() => {
    if (!user) return
    sendHeartbeat(playingRef.current)
    const id = setInterval(() => sendHeartbeat(playingRef.current), HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(id)
  }, [user, sendHeartbeat])

  const [playerCount, setPlayerCount] = useState<PlayerCount>(4)
  const [seats, setSeats] = useState<Seat[]>(() => {
    try {
      const raw = sessionStorage.getItem(SEATS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Seat[]
        if (Array.isArray(parsed) && parsed.length === 4 && parsed.some((x) => x.type === 'you')) return parsed
      }
    } catch { /* ignore corrupt value */ }
    return [{ type: 'you' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }]
  })
  const [dice, setDice] = useState(4)
  const [rolling, setRolling] = useState(false)
  const [turn, setTurn] = useState(0)
  const [settings, setSettings] = useState<Record<string, boolean>>({})
  const [lang, setLangState] = useState<Lang>(storedLang)
  const [twoFactor, setTwoFactor] = useState(false)
  const rollingRef = useRef(false)

  // Persist account prefs; swap this for PATCH /api/user/me once the backend lands.
  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem(LANG_KEY, l)
    document.documentElement.lang = l
    i18n.changeLanguage(l)
  }, [])

  // Load the account's real 2FA preference once signed in — GET /api/auth/2fa.
  useEffect(() => {
    if (!user) return
    apiFetch('/api/auth/2fa')
      .then(async (res) => {
        if (!res.ok) return
        const data = await res.json()
        setTwoFactor(!!data.twoFactorEnabled)
      })
      .catch(() => undefined)
  }, [user])

  // Optimistic toggle; PATCH /api/auth/2fa persists it, reverting on failure.
  const toggleTwoFactor = useCallback(() => {
    setTwoFactor((prev) => {
      const next = !prev
      apiFetch('/api/auth/2fa', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      })
        .then((res) => {
          if (!res.ok) setTwoFactor(prev)
        })
        .catch(() => setTwoFactor(prev))
      return next
    })
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
    i18n.changeLanguage(lang)
  }, [lang])

  const addBot = useCallback((i: number) => {
    setSeats((prev) => {
      const used = prev.filter((s) => s.type === 'bot').map((s) => s.name)
      const name = BOT_POOL.find((n) => !used.includes(n)) || 'Bot'
      const next = prev.slice()
      next[i] = { type: 'bot', name }
      return next
    })
  }, [])

  const removeBot = useCallback((i: number) => {
    setSeats((prev) => {
      const next = prev.slice()
      next[i] = { type: 'empty' }
      return next
    })
  }, [])

  const addPlayer = useCallback((i: number) => {
    setSeats((prev) => {
      const existing = prev.filter((s) => s.type === 'player').length
      const name = i18n.t('lobby.defaultPlayerName', { num: existing + 2 })
      const next = prev.slice()
      next[i] = { type: 'player', name }
      return next
    })
  }, [])

  const removePlayer = useCallback((i: number) => {
    setSeats((prev) => {
      const next = prev.slice()
      next[i] = { type: 'empty' }
      return next
    })
  }, [])

  const renamePlayer = useCallback((i: number, name: string) => {
    setSeats((prev) => {
      if (prev[i].type !== 'player') return prev
      const next = prev.slice()
      next[i] = { type: 'player', name }
      return next
    })
  }, [])

  const resetSeats = useCallback(() => {
    setSeats([{ type: 'you' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }])
  }, [])

  const startGame = useCallback((): boolean => {
    const bots = seats.slice(0, playerCount).filter((s) => s.type === 'bot').length
    if (bots < 1) return false
    const used = seats.filter((s) => s.type === 'bot').map((s) => s.name)
    const pool = BOT_POOL.filter((n) => !used.includes(n))
    setSeats((prev) =>
      prev.map((s, i): Seat => {
        if (i < playerCount && s.type === 'empty') return { type: 'bot', name: pool.shift() || 'Bot' }
        return s
      }),
    )
    setTurn(0)
    return true
  }, [seats, playerCount])

  const roll = useCallback(() => {
    if (rollingRef.current) return
    rollingRef.current = true
    setRolling(true)
    setTimeout(() => {
      setDice(1 + Math.floor(Math.random() * 6))
      setRolling(false)
      rollingRef.current = false
    }, 650)
  }, [])

  const endTurn = useCallback(() => {
    setTurn((t) => (t + 1) % playerCount)
  }, [playerCount])

  const settingOn = useCallback(
    (key: string) => (key in settings ? settings[key] : SETTING_DEFAULTS[key] ?? false),
    [settings],
  )

  const toggleSetting = useCallback(
    (key: string) => setSettings((prev) => ({ ...prev, [key]: !(key in prev ? prev[key] : SETTING_DEFAULTS[key] ?? false) })),
    [],
  )

  const [activeMatch, setActiveMatch] = useState<ActiveMatch>(storedActiveMatch)
  const [lastResult, setLastResult] = useState<LastResult>(null)

  // Persist activeMatch + seats in sessionStorage so a page refresh can
  // reconnect (hotseat needs the local seat names to rejoin every seat).
  useEffect(() => {
    if (activeMatch) sessionStorage.setItem(ACTIVE_MATCH_KEY, JSON.stringify(activeMatch))
    else sessionStorage.removeItem(ACTIVE_MATCH_KEY)
  }, [activeMatch])

  useEffect(() => {
    sessionStorage.setItem(SEATS_KEY, JSON.stringify(seats))
  }, [seats])

  const value = useMemo(
    () => ({
      user, setUser, authReady, login, register, verify2fa, forgotPassword, resetPassword, logout,
      theme, setTheme,
      playerCount, seats, dice, rolling, turn, settings,
      setPlayerCount, addBot, removeBot, addPlayer, removePlayer, renamePlayer, resetSeats, startGame, roll, endTurn, settingOn, toggleSetting,
      lang, setLang, twoFactor, toggleTwoFactor, setPlaying, activeMatch, setActiveMatch, lastResult, setLastResult,
    }),
    [user, setUser, authReady, login, register, verify2fa, forgotPassword, resetPassword, logout, theme, setTheme, playerCount, seats, dice, rolling, turn, settings, addBot, removeBot, addPlayer, removePlayer, renamePlayer, resetSeats, startGame, roll, endTurn, settingOn, toggleSetting, lang, setLang, twoFactor, toggleTwoFactor, setPlaying, activeMatch, lastResult],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>')
  return ctx
}
