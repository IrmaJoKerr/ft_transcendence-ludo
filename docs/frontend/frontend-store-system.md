# Frontend — Store (Global State)

## Table of Contents

- [Overview](#overview): React Context global state: authentication, game setup, settings
- [Files](#files): Source file inventory
- [Key Types / Interfaces](#key-types--interfaces): AuthUser, Seat, PlayerCount, Lang, ActiveMatch, LastResult, AppState
- [Core Logic / Flow](#core-logic--flow): Mermaid sequence diagrams for the authentication lifecycle and game setup
- [Logic Paths Summary](#logic-paths-summary): Decision trees for authentication and game state changes
- [Dependencies](#dependencies): Internal and external dependencies


---
---


## Overview

The store is one React Context provider (`AppProvider`) that holds all global UI (user interface) state. It has:

1. **Authentication session**: the `user` object, the `authReady` flag, and the `login`, `register` and `logout` actions.
2. **Game setup state**: `playerCount` (2-4), the `seats` array (you/bot/player/empty), `dice`, `rolling` and `turn`.
3. **Settings**: on/off switches (sound, music, auto-roll and others), each with a string key and a default value.
4. **Real-time match**: `activeMatch` (the engine credentials from `POST /api/match/create`) and `lastResult` (the finished-match data for the `ResultsModal` overlay).
5. **Helpers**: `addBot`, `removeBot`, `addPlayer`, `removePlayer`, `startGame`, `roll`, `endTurn`, `settingOn`, `toggleSetting`.
6. **Session keep-alive**: a presence heartbeat every 20 seconds (`PRESENCE_HEARTBEAT_MS` / `sendPresenceHeartbeat()`) while signed in, plus a `/api/auth/refresh` call every 14 minutes, so the 15-minute access token never expires while a request is still waiting for a response. This is the **client → server** direction only, and it shows that the browser session is still active; keeping the notification SSE stream alive runs the other way and is handled server-side (`SSE_HEARTBEAT_MS`). See [`../architecture.md`](../architecture.md) → Connection liveness (two-direction heartbeats).


---
---


## Files

| File | Role |
|------|------|
| `src/store.tsx` | `AppProvider`, `useApp` hook, all state and actions |


---
---


## Key Types / Interfaces

### AuthUser

```typescript
export type AuthUser = {
  id: string  // Unique ID
  username: string  // Player's username
  displayName?: string  // Name shown in the game
  email?: string | null  // Email address
  twoFactorEnabled?: boolean  // Whether 2FA is on
  avatarStyle?: string | null  // DiceBear style for the fallback avatar
  hasAvatarPhoto?: boolean  // Whether a custom uploaded photo exists
}
```

### Seat

```typescript
export type Seat =
  | { type: 'you' }
  | { type: 'bot'; name: string }
  | { type: 'player'; name: string }
  | { type: 'empty' }
```

### PlayerCount

```typescript
export type PlayerCount = 2 | 3 | 4
```

### Lang

```typescript
export type Lang = 'en' | 'ms' | 'fr'
```

### ActiveMatch / LastResult

```typescript
export type ActiveMatch = {
  gameId: string  // ID of the game
  token: string        // JWT (JSON Web Token) for the Socket.IO handshake
  color: PlayerColor  // Seat color
  inviteCode?: string  // Code to join a private game
  mode: 'pvp' | 'pve' | 'hotseat'  // Game mode
  playerCount: number  // How many players
} | null

export type ResultPlayer = {
  color: PlayerColor  // Seat color
  username: string  // Seat label: display name or hotseat name; for a bot the raw "bot-<color> (<assistant>)" label, localized for display and used as the avatar seed
  isBot: boolean  // Whether it is a bot
  piecesInGoal: number  // Pieces finished (0-4)
  userId?: string  // Immutable account id: absent for bots and hotseat's local seats, except the host's own row, which Game.tsx stamps with the store's /me id
  hasAvatarPhoto?: boolean  // Engine roster snapshot, or the store's /me flag on the host's hotseat row: a photo was known to exist
  avatarStyle?: string | null  // DiceBear style that seat chose
}

export type LastResult = {
  winner: PlayerColor  // Winning color
  resultDetail: string  // How the game ended
  mode: 'pvp' | 'pve' | 'hotseat'  // Game mode
  playerCount: number  // How many players
  players: ResultPlayer[]  // List of players
  abandoned?: boolean  // Whether the game was abandoned
} | null
```

### AppState (partial)

```typescript
type AppState = {
  user: AuthUser | null  // The logged-in user
  authReady: boolean  // Whether the sign-in state has loaded
  // Auth actions
  login: (identifier: string, password: string) => Promise<{ error?: string; pendingToken?: string; notVerified?: boolean }>  // Logs the user in
  register: (username: string, password: string, email: string) => Promise<{ error?: string; username?: string }>  // Creates a new account; success returns the assigned username
  verify2fa: (pendingToken: string, code: string) => Promise<string | null>  // Checks the 2FA code
  resend2fa: (pendingToken: string) => Promise<string | null>  // Re-issues the login code for a live 2FA challenge
  forgotPassword: (email: string) => Promise<string | null>  // Requests a password reset
  resetPassword: (token: string, password: string) => Promise<string | null>  // Sets a new password
  resendVerification: (email: string) => Promise<string | null>  // Resends a signup verification link
  logout: () => Promise<void>  // Logs the user out
  // 2FA preference
  twoFactor: boolean  // Whether 2FA is on
  toggleTwoFactor: () => void  // Turns 2FA on/off
  // Game setup state
  playerCount: PlayerCount  // How many players
  seats: Seat[]  // List of seats (you/bot/player/empty)
  dice: number  // Current dice value
  rolling: boolean  // Whether the dice is animating
  turn: number  // Whose turn (index)
  settings: Record<string, boolean>  // Game settings (sound, music and others)
  setPlayerCount: (n: PlayerCount) => void  // Changes the player count
  addBot: (i: number) => void  // Adds a bot to a seat
  removeBot: (i: number) => void  // Removes a bot from a seat
  addPlayer: (i: number) => void  // Adds a human player to a seat
  removePlayer: (i: number) => void  // Removes a player from a seat
  renamePlayer: (i: number, name: string) => void  // Renames a seat
  resetSeats: () => void  // Clears all seats except the host
  startGame: () => boolean  // Starts the game
  roll: () => void  // Rolls the dice
  endTurn: () => void  // Passes the turn
  settingOn: (key: string) => boolean  // Checks if a setting is on
  toggleSetting: (key: string) => void  // Flips a setting
  // Theme
  theme: ThemeType  // Current theme (synthwave, persisted as retro_theme)
  setTheme: (t: ThemeType) => void  // Changes the theme
  // Real-time match
  activeMatch: ActiveMatch  // The current match info
  setActiveMatch: (m: ActiveMatch) => void  // Updates the current match
  lastResult: LastResult  // Finished match results
  setLastResult: (r: LastResult) => void  // Saves finished match results
  // Language
  lang: Lang  // Selected language
  setLang: (l: Lang) => void  // Changes the language
  // Presence
  setPlaying: (playing: boolean) => void  // Marks the user as in-game
}
```

### SETTING_DEFAULTS

```typescript
export const SETTING_DEFAULTS: Record<string, boolean> = {
  '0-0': true,  // Sound effects
  '0-1': true,  // Music
  '1-0': true,  // Auto-roll
  '1-1': false, // Fast animations
  '1-2': true,  // Move hints
  '2-0': true,  // Friend invites
  '2-1': false, // Weekly recap
}
```


---
---


## Core Logic / Flow

### 1. Auth Lifecycle

Sequence of steps from page load to a signed-in session.
```mermaid
sequenceDiagram
    participant App as App.tsx
    participant Store as App state
    participant API as Backend

    Note over App,API: On page load
    App->>Store: Start loading
    alt Public route ('/', /login, /signup)
        Store->>Store: Skip the check, mark ready
    else Protected route
        Store->>API: Ask "who is logged in?" (/api/auth/me)
        alt Logged in
            API-->>Store: user info
            Store->>Store: Save the user
        else Not logged in (401/403)
            API-->>Store: nothing
            Store->>Store: User = nobody
        end
    end
    Store->>Store: Loading finished

    Note over App,API: Logging in
    App->>Store: login(identifier, password)
    Store->>API: POST /api/auth/login
    alt Address not verified
        API-->>Store: 200 notice, no session
    else Otherwise
        API-->>Store: user info, or a pending token when 2FA is on
        Store->>Store: Save the user when a session was issued
    end

    Note over App,API: Logging out
    App->>Store: logout()
    Store->>API: POST /api/auth/logout
    Store->>Store: User = nobody
```

### 2. Game Setup Flow

Sequence of steps from selecting player count to starting a game.
```mermaid
sequenceDiagram
    participant Lobby as LudoLobby.tsx
    participant Store as App state
    participant Game as Game.tsx

    Lobby->>Store: setPlayerCount(4)
    Store->>Store: Remember 4 players

    Lobby->>Store: addBot(1) / addPlayer(2)
    Store->>Store: Update the seat list

    Lobby->>Store: startGame()
    Store->>Store: Fill empty seats with bots
    Store->>Store: Set turn to player 0
    Store-->>Lobby: Game ready
```

> **Note:** `startGame` only builds the local seat state used by the offline/hotseat preview. For a real match, the lobby calls `POST /api/match/create` (or the PvP (player versus player) and PvE (player versus environment) shortcuts) and stores the returned `activeMatch`; the Game page then connects to the engine over Socket.IO.


---
---


## Logic Paths Summary

### Authentication Lifecycle Path
```
Mount
  └── path is '/', '/login', or '/signup' → skip the check, setAuthReady(true)
  └── otherwise fetch('/api/auth/me')
       ├── 200 → setUser(user), setAuthReady(true)
       ├── 401/403 → setUser(null) (genuinely signed out), setAuthReady(true)
       └── 429/5xx/network → retry up to 3× (exponential backoff, honours Retry-After),
            then leave `user` unchanged and setAuthReady(true)

login(identifier, password)
  └── POST /api/auth/login
       ├── 200 + code=AUTH_EMAIL_NOT_VERIFIED → return { error } (the translated notice)
       ├── 200 + twoFactorRequired=false → setUser(user), return {}
       ├── 200 + twoFactorRequired=true → return { pendingToken }
       └── non-2xx → return { error }

register(username, password, email)
  └── POST /api/auth/register
       ├── 200 → return { username } (the assigned username; no session; the account activates via the emailed link)
       └── error → return { error }

logout()
  └── POST /api/auth/logout → setUser(null)
```

### Game Setup Path
```
setPlayerCount(n)
  └── Update playerCount state

addBot(i)
  └── Find unused bot name from BOT_POOL → replace seat[i] with { type: 'bot', name }

addPlayer(i) / removePlayer(i)
  └── Replace seat[i] with { type: 'player', name } / { type: 'empty' }

startGame()
  ├── Count bots in seats[0..playerCount)
  ├── If bots < 1 → return false
  ├── Fill remaining empty seats with bots from BOT_POOL
  ├── setTurn(0)
  └── return true

roll()
  └── If not already rolling → setRolling(true) → setTimeout(650ms) → setDice(1-6), setRolling(false)

endTurn()
  └── setTurn((t + 1) % playerCount)
```

The names a bot seat shows come from `BOT_POOL`. `Lobby.tsx` sends the same names
to the backend as `botNames`, and they come back on each seat as `displayName`
(`bot-<color> (<assistant>)`); the in-game client translates only the colour word.

### Settings Path
```
settingOn(key)
  └── Return settings[key] ?? SETTING_DEFAULTS[key] ?? false

toggleSetting(key)
  └── Flip current value (settings or default)
```


---
---


## `api.ts`: Refresh and Retry

`apiFetch(url, init)` handles every authenticated call:

- Every mutating call goes through `fetchWithCsrf` (which `apiFetch` uses internally): it reads the `csrf_token` cookie, bootstraps it from `GET /api/auth/csrf` when absent, sends it as `X-CSRF-Token`, and retries once on `403 CSRF_TOKEN_INVALID` with a freshly minted token. Raw `fetch()` sites that mutate (auth store, friends, avatar) use the same wrapper; GETs can stay plain.
- On a **401** it refreshes once through `POST /api/auth/refresh`, then retries the original request. All callers share one in-flight refresh request, so two 401s arriving at the same time can never rotate the refresh token twice. A refresh token that is replayed outside the server's 15-second two-tab grace is reported as `AUTH_SESSION_REUSED`, and the server has already revoked every session.
- If the refresh **fails**, the two cases are kept apart: a missing or expired refresh token means the user is really signed out, while a *blocked* refresh (for example, rate-limited) returns its own status instead of pretending the user signed out.
- It adds the `ngrok-skip-browser-warning` header so the ngrok interstitial page never intercepts an API (Application Programming Interface) call (other hosts ignore the header), and it builds headers with the `Headers` constructor, so headers passed by the caller are merged instead of overwritten.
- **Errors are translated using their code.** When a response fails, `request()` reads the `code` field from the body and translates it with `translateErrorCode()` (`errors.<CODE>`). If the body has no `code`, or the code has no translation, it logs the English `message` to the console and uses a localized generic message; the server text is never rendered. The auth store's `apiError()` works the same way. See [API-list.md](../API-list.md) → Error responses.

`store.tsx` also refreshes **early**, every 14 minutes: access tokens expire after 15 minutes (`JwtModule` `expiresIn: '15m'`), so refreshing one minute ahead keeps the presence heartbeat (and any other call) from arriving with an expired token. The 401 retry path above would still recover, but the browser logs the 401 first.


---
---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `theme.ts` | `BOT_POOL` for bot seat names (sent as `botNames`, shown as the seat's `displayName`) |
| `i18n.ts` | `i18n.changeLanguage` and `i18n.t` for default player names |
| `api.ts` | `apiFetch` (refresh-and-retry), `fetchWithCsrf` (CSRF bootstrap + header), `refreshOnce` (called on the store's 14-minute timer, before the access token expires), and `translateErrorCode`, which turns an error code into text in the user's language |
| `game/types.ts` | `PlayerColor` for `ActiveMatch` |
| API (Application Programming Interface) | `/api/auth/me`, `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`, `/api/auth/2fa/verify`, `/api/auth/forgot-password`, `/api/auth/reset-password`, `/api/auth/2fa`, `/api/presence/heartbeat` |
