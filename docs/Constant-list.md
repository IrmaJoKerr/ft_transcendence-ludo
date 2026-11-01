# **Constant List**

Every tunable that decides how the app behaves — its value, the file that owns it, and what it
moves. Updated 29 Oct 2026

Each number appears once, under the file that exports it. Where the same value has to exist on both
sides of the wire, the mirror is named in the row and collected again in §18.


---


## **Legend**

| Icon | Layer |
|---|---|
| ⚙️ | Ludo engine — `backend/app/ludo-engine/src` |
| 🗄️ | Backend API — `backend/src` |
| 🖥️ | Frontend SPA — `frontend/src` |
| 🎨 | Stylesheet — `frontend/src/styles/retrowave.css` |
| 🔗 | Mirrored — the same value exists on the other side of the wire (see [§18](#18-mirrored-values)) |

**How to read a row**

- **Owner, not usage.** A constant is listed once, under the file that exports it. Call sites are
  named only where they change what the number means.
- **Units.** `_MS` is milliseconds, `_S` is seconds, `TTL` is whatever form the code stores (a JWT
  lifetime string such as `'24h'`, or Redis seconds); a number with no suffix is a count, a ratio or
  a pixel value as the description says.
- **`(inline)`** marks a literal with no name that is still load-bearing, quoted because a reader
  changing the feature needs it. Everything without that mark is a named declaration.
- **Values are the ones in the tree on the date above.**


---
---


## **Table of Contents**

### Engine

1. **[Engine timing](#1-engine-timing)** — every delay the engine owns: clash windows, turn pacing, transport, lifecycle
2. **[Clash rules](#2-clash-rules)** — target presses, key grids, tap weight, bot pacing profiles and draw odds
3. **[Board rules](#3-board-rules)** — track and home-lane steps, safe squares, base exit, the three-six rule, Wall Breaker hand
4. **[Bot valuation](#4-bot-valuation)** — the one score scale the bot ranks moves on

### Backend

5. **[Auth lifetimes and passwords](#5-auth-lifetimes-and-passwords)** — token TTLs, cookies, 2FA challenge, login lockout ladder
6. **[CSRF, bot and token shapes](#6-csrf-bot-and-token-shapes)** — cookie/header names, prefixes, audiences
7. **[Route rate limits](#7-route-rate-limits)** — per-route `@Throttle` table and the global backstop
8. **[Guest budgets](#8-guest-budgets)** — per-address mints, live rooms, abort weight, token lifetime
9. **[Transport, presence and storage](#9-transport-presence-and-storage)** — socket caps, presence refresh, Redis TTLs, read caps
10. **[Scoring and achievements](#10-scoring-and-achievements)** — rating deltas and all 16 achievement thresholds
11. **[Friends](#11-friends)** — pending-request expiry and decline cooldown

### Frontend

12. **[Theme and palette](#12-theme-and-palette)** — seat colours, presence colours, CSS design tokens
13. **[Client timing](#13-client-timing)** — every presentation delay: clash cards, dice brake, path, capture burst, guards
14. **[Client cadences](#14-client-cadences)** — token refresh, room-push debounce and repair, cross-tab locks, toasts
15. **[Layout, size and z-index](#15-layout-size-and-z-index)** — board geometry, clash card, touch pad, nav fit, toast stack
16. **[Audio](#16-audio)** — master volume and the blip defaults
17. **[Browser storage](#17-browser-storage)** — localStorage keys and settings defaults

### Contracts

18. **[Mirrored values](#18-mirrored-values)** — every value that must agree across files, with its owner and its mirror
19. **[Where a new constant goes](#19-where-a-new-constant-goes)** — the placement rules


---
---


## Engine


### **1. Engine timing**

**Owner:** `backend/app/ludo-engine/src/timing.ts` ⚙️ — "every delay the engine owns, in one
place". The client mirrors the shared subset in §13 with the same names and values.

**Clash QTE**

| Constant | Value | What it decides |
|---|---|---|
| `CLASH_ANNOUNCE_MS` | 1500 | "CLASH!" flash; keys still hidden |
| `CLASH_COUNTDOWN_MS` | 3000 | GET READY, then 3-2-1; keys still hidden |
| `CLASH_PRESS_MS` | 5000 | the press race window (the `duration` on the wire is this ÷ 1000) |
| `CLASH_SWITCH_FIRST_MIN_MS` | 2000 | earliest first key switch, measured from the press window opening (`countdownDeadline`) |
| `CLASH_SWITCH_FIRST_MAX_MS` | 2500 | latest first key switch |
| `CLASH_SWITCH_GAP_MIN_MS` | 800 | shortest gap between two switches |
| `CLASH_SWITCH_GAP_MAX_MS` | 1100 | longest gap; the worst case (2500 + 1100) still leaves 1.4 s of the press window after the last switch |
| `RESULT_FX_MS` | 1300 | the result card's gesture, mirrored from the client (the engine never draws it, but the card's length is its freeze) |
| `RESULT_HEADLINE_READ_MS` | 1300 | the beat the card's headline gets once the gesture stops |
| `CLASH_RESULT_MS` | 2600 | the card, **added** from the two rows above rather than written down: the client shows it, the engine freezes input for it and arms the chain's next round on it |
| `CLASH_RESULT_FREEZE_MS` | 4000 | input-freeze **ceiling**: a client card hold can only shorten it |
| `CARD_HOLD_MIN_MS` | 250 | floor for a reported card hold: a client that asks for less is raised to this |
| `CLASH_SWEEP_GRACE_MS` | 15000 | outer cleanup bound measured from the clash start |
| `CLASH_SWEEP_INTERVAL_MS` | 5000 | cadence of the orphaned-clash sweep |
| `CLASH_PRESS_CAP_MS` | 110 | minimum gap between accepted presses per side (≈9/s) |
| `CLASH_BOT_FAST_MS_BASE` | 111 | fast profile's interval base: deliberately just above `CLASH_PRESS_CAP_MS` |
| `CLASH_BOT_CASUAL_MS_BASE` | 129 | casual profile's interval base |
| `CLASH_BOT_JITTER_MS` | 30 | random spread added to each bot gap |
| `CLASH_BOT_FAST_REACTION_MS` | 120 | touch-typist pause before the first press (muscle memory, 100–150 band) |
| `CLASH_BOT_CASUAL_REACTION_MS` | 500 | choice reaction pause before the first press (400–600 band) |

**Turn animation** — the engine keeps the client's numbers because bot turns are paced so their move
finishes animating before the next action fires.

| Constant | Value | What it decides |
|---|---|---|
| `MOVE_STEP_ANIM_MS` | 180 | one board step of the client's path animation 🔗 |
| `DICE_ROLL_ANIM_MS` | 750 | dice spin before the path starts 🔗 |
| `BOT_MOVE_STEP_MS` | 220 | the engine's slack over `MOVE_STEP_ANIM_MS` when it schedules a bot turn |
| `BOT_THINK_MS` | 500 | flat pause before a bot acts |

**Transport**

| Constant | Value | What it decides |
|---|---|---|
| `PING_INTERVAL_MS` | 10000 | Socket.IO ping cadence |
| `PING_TIMEOUT_MS` | 15000 | a socket silent this long is dropped |
| `EVENT_WINDOW_MS` | 5000 | refill window for the per-socket inbound budget (§9) |
| `CLASH_EVENT_WINDOW_MS` | 5000 | refill window for the clash-press bucket (§9) |

**Lifecycle**

| Constant | Value | What it decides |
|---|---|---|
| `IDLE_LOBBY_TIMEOUT_MS` | 300000 (5 min) | an empty PvP lobby is aborted after this |
| `POST_GAME_TIMEOUT_MS` | 60000 (1 min) | a finished room is torn down after this |
| `DISCONNECT_GRACE_MS` | 45000 | PvP reconnect window before the seat is pruned |
| `SINGLE_SOCKET_DISCONNECT_GRACE_MS` | 3600000 (1 h) | bot-mode reconnect window (solo-seat game, nothing to hold up) |

`player-handler.ts` arms the disconnect timer at `DISCONNECT_GRACE_MS + 1000` so the deadline is
already past when the callback fires; the stored `reconnectDeadline` still uses the bare constant.


### **2. Clash rules**

**Owners:** `backend/app/ludo-engine/src/clash.ts` ⚙️ (keys, target, odds) and `clash-pace.ts` ⚙️
(bot pacing), with the windows in §1.

| Constant | Value | What it decides |
|---|---|---|
| `CLASH_TARGET` | 42 | presses that end a round immediately; if neither side reaches it, the press deadline compares the counts. The client's bar is 4 px per press (168 px) |
| `CLASH_TAP_COUNT_MAX` | 2 | most one accepted press may be worth; a touch tap sends 2 |
| `ATTACKER_KEYS` | `u i o h j k b n m` | the attacker's 3×3 grid (right-hand block) |
| `DEFENDER_KEYS` | `q w e a s d z x c` | the defender's 3×3 grid (left-hand block); disjoint from the attacker's |
| `CLASH_BOT_FAST_VS_HUMAN` | 0.25 | odds a bot side draws the fast profile against a human seat |
| `CLASH_BOT_FAST_VS_BOT` | 0.5 | odds against another bot (coin flip decides who is fast) |
| `CLASH_BOT_PRESS_TARGETS` | fast 38, casual 33 | presses a bot side makes, counted **including** its reaction pause |
| `CLASH_BOT_REACTION_MS` | fast 120, casual 500 | the pause, one constant per profile (re-exported from §1) |
| `CLASH_BOT_RAMP` | 1.25, 1.15, 1.07 | the first three mash gaps are stretched so a bot does not open like a metronome |
| `CLASH_BOT_TAIL_GUARD_MS` | 100 | the last press lands this far inside the window, before the deadline resolver reads the meters |
| `CLASH_BOT_STUMBLE_CHANCE` | 0.03 | casual-only chance of one long gap |
| `CLASH_BOT_STUMBLE_MIN_MS` / `MAX_MS` | 150 / 250 | the drawn length of that gap (taken from the jitter budget, never from the press count) |

The scheduling shape is fixed: reaction pause (constant) → `presses - 1` gaps of `base × ramp` plus
`0..CLASH_BOT_JITTER_MS`. If the drawn gaps would overrun the window, only the jitter is scaled down
— never the base and never the count — so the 38th (or 33rd) press always lands inside
`CLASH_PRESS_MS`.

**Bot ownership:** a bot side handles its own presses directly against the store, so it bypasses
`CLASH_PRESS_CAP_MS`. The 111 ms base sits above that cap so the day bots are routed through the
capped path they lose nothing.


### **3. Board rules**

**Owners:** `backend/app/ludo-engine/src/board-mapper.ts` ⚙️ (safe squares, colour offsets),
`move-validator.ts` ⚙️ (base exit, overshoot, blockades), `engine.ts` ⚙️ (six streak, goal, win) and
`types.ts` ⚙️ (Wall Breaker hand). The client mirrors the track geometry in
`frontend/src/game/boardGeometry.ts` 🖥️ (§15).

| Constant / rule | Value | What it decides |
|---|---|---|
| `SAFE_TRACK_POSITIONS` | `1, 9, 14, 22, 27, 35, 40, 48` | the eight protected squares on the shared loop (start squares + star squares); no capture lands there and a stack there is not a blockade |
| Track length | 52 | shared loop, position 1–52 |
| Steps | `0` base, `1–51` track, `52–56` home lane, `57` goal | a piece's `step` is its whole journey; `0` also means "on the track at the start square" after a base exit |
| Colour offsets | red 0, green 13, yellow 26, blue 39 | `trackPos = ((step + offset - 1) % 52) + 1` |
| Home lane | 5 cells per colour | `step 52..56` → the colour's lane; each colour's lane is the red one rotated by its quarter |
| Goal | step 57 | exactly 57: a roll that would pass it is not a legal move (`to > 57` is skipped) |
| Base exit | die 6, or any roll with `freeExit` on | a normal 6 exits to step 1, the colour's start square; with free exit on, the roll itself is the landing step (`to = diceValue`) |
| Six streak | 3 | a third consecutive 6 forfeits the turn (`consecutiveSixes >= 3`); every other 6 grants a bonus roll |
| Blockade | 2+ same-colour pieces on one non-safe track square | opponents cannot cross or land on it; the owner is unaffected |
| Win | 4 pieces at step 57 | `all(step === 57)` → `game_ended` with `resultDetail: 'four_pieces'` |
| `STARTING_BUSTER_TOKENS` | 1 | Wall Breaker tokens every seat starts with 🔗 (client copy in §14) |
| `BARRIER_BUSTER_TOKEN_CAP` | 3 | most tokens a seat can bank; a won clash against one defender pays one back, a won barrier never pays |
| `LOG_CAP` | 30 | lines the engine keeps in `state.log` (and the client draws); the oldest are dropped on write |

The Wall Breaker token buys one landing on a barrier the roll reaches **exactly** — never a
crossing — and a bust that is declined leaves the token in hand.


### **4. Bot valuation**

**Owner:** `backend/app/ludo-engine/src/bot.ts` ⚙️ — one score scale, so every candidate move on a
turn is comparable.

| Constant | Value | What it decides |
|---|---|---|
| `CAPTURE_CREDIT` | 7000 | a capture scores this × its clash odds; no positional bonus is added on top |
| `BUST_TOKEN_SHADOW` | 1400 (0.2 × `CAPTURE_CREDIT`) | the token a Wall Breaker bust spends; a bust below the shadow is declined |
| `JAIL_EXIT_BONUS` | 1000 | extra on a 6 that leaves the base, so that exit outranks every positional move except a home entry |
| Home entry (inline) | +1000 | landing in the home lane |
| Safe-zone landing (inline) | +500 | only when entering a safe square from the track |
| Progress (inline) | `to × 10` | distance along the journey |
| Base exit (inline) | +100 | any move out of the base |
| Move delay (inline) | 1200 ms | the pause after the roll before the bot moves, so the client's dice spin has finished |

No positional move scores above 1560, which is why a 2+-defender wall (odds-discounted credit at
`CLASH_BOT_FAST_VS_HUMAN ** rounds`) can fall below the best safe move and be declined. The worked
values are in [`ludo-engine/ludo-engine-bot-module.md`](ludo-engine/ludo-engine-bot-module.md).


---
---


## Backend


### **5. Auth lifetimes and passwords**

**Owners:** `backend/src/auth/auth.constants.ts` 🗄️ (the tunable block and JWT scopes),
`auth.controller.ts` 🗄️ (cookies), `auth.module.ts` 🗄️ (JWT lifetime), `auth.service.ts` 🗄️ (hashing),
`session.service.ts` 🗄️ (refresh rotation), `twofactor.service.ts` 🗄️ (challenge state) and
`dto/password.rules.ts` 🗄️ (password policy).

**Links, codes and the login ladder** — `AUTH`, one object, edited in one place.

| Constant | Value | What it decides |
|---|---|---|
| `AUTH.verifyTokenTtlS` | 86400 (24 h) | signup verification link (Redis `verify:`) |
| `AUTH.resetTokenTtlS` | 3600 (1 h) | password-reset link (Redis `reset:`) |
| `AUTH.changeTokenTtlS` | 900 (15 min) | email-change link (Redis `emailchange:`) |
| `AUTH.maxEmailChangesPerHour` | 3 | email-change requests per user per hour |
| `AUTH.challenge.ttlS` | 300 (5 min) | a 2FA login code (Redis `2fa:`) |
| `AUTH.challenge.maxAttempts` | 5 | wrong codes before the challenge is burned |
| `AUTH.challenge.resendWindowS` | 3600 (1 h) | window of the per-user resend cap (`2fa:rl:<userId>`) |
| `AUTH.challenge.maxResends` | 3 | resends allowed in that window |
| `AUTH.loginLockout.windowS` | 900 (15 min) | failures older than this start the counter again |
| `AUTH.loginLockout.softLimit` | 5 | failures at which each attempt starts costing time |
| `AUTH.loginLockout.hardLimit` | 10 | failures at which the identifier is refused outright |
| `AUTH.loginLockout.hardLockS` | 900 (15 min) | how long that refusal lasts (equal to the window today, a separate knob on purpose) |
| `AUTH.loginLockout.maxDelayS` | 30 | ceiling on the per-attempt delay |
| `MAX_DELAY_STEPS` | 5 | `min(2^n, 30) s` stops growing here (2, 4, 8, 16, then 30 s) |

The count is keyed by `sha256(lowercased identifier)` in `login:fail:<hash>`, never the identifier
itself, and an identifier that never existed is counted and delayed identically.

**Tokens and cookies**

| Constant | Value | What it decides |
|---|---|---|
| JWT lifetime (`auth.module.ts`) | `'15m'` | access token expiry |
| `ACCESS_COOKIE` | `'token'` | access-token cookie name |
| `ACCESS_MAX_AGE_MS` | 900000 (15 min) | its `maxAge` |
| `REFRESH_COOKIE` | `'refresh_token'` | refresh-token cookie name |
| `REFRESH_PATH` | `'/api/auth'` | its path scope: sent nowhere else |
| `REFRESH_MAX_AGE_MS` | 604800000 (7 days) | its `maxAge` |
| `REFRESH_TTL_S` | 604800 | the Redis lifetime of `refresh:<sha256>` and the session set |
| `REUSE_GRACE_MS` | 15000 | a consumed token presented again this soon is the two-tab race, not theft; older replays revoke every session |
| `SALT_ROUNDS` | 10 | bcrypt cost for passwords |
| `TOKEN_ISSUER` | `ft_transcendence` | `iss` on every token |
| `SESSION_TOKEN_AUDIENCE` | `ft_transcendence-api` | audience a session token carries |
| `OAUTH_LINK_AUDIENCE` | `oauth-link` | audience of the short-lived OAuth-link token |
| `OAUTH_LINK_TTL` | `'10m'` | that token's lifetime |

**Password policy** — mirrored client-side in `frontend/src/validatePassword.ts` 🖥️ (same five values,
§18).

| Constant | Value | What it decides |
|---|---|---|
| `PASSWORD_MIN` | 12 | shortest accepted password |
| `PASSWORD_MAX` | 72 | longest accepted password (bcrypt ignores bytes past 72) |
| `PASSWORD_REGEX` | `^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$` | lowercase, uppercase, digit and special character |
| `PASSWORD_MESSAGE` | "password must be 12+ characters with an uppercase letter, a lowercase letter, a number, and a special character" | the English fallback when no code applies |

A 2FA code is 6 digits: `randomInt(0, 1_000_000)` padded to 6, stored as a SHA-256 hash with an
attempt counter.

`twofactor.service.ts` re-binds these under local names (`VERIFY_TOKEN_TTL_S`, `RESET_TOKEN_TTL_S`,
`CHANGE_TTL_S`, `CODE_TTL_S`, `MAX_ATTEMPTS`, `RESEND_WINDOW_S`, `MAX_RESENDS`), and
`login-lockout.service.ts` does the same (`FAIL_WINDOW_S`, `SOFT_LIMIT`, `HARD_LIMIT`, `HARD_LOCK_S`,
`MAX_DELAY_MS`). The numbers live in `AUTH`; only the names are per-service.

**Email shape (client-side):** `EMAIL_REGEX` in `frontend/src/validateEmail.ts` is
`^[^\s@]+@[^\s@]+\.[^\s@]+$`. The server validates with class-validator's `@IsEmail` (mapped to
`VALIDATION_EMAIL_FORMAT`), so the two are deliberately not the same expression: the client catches a
typo early, the server is authoritative.


### **6. CSRF, bot and token shapes**

**Owners:** `backend/src/common/csrf.ts` 🗄️, `common/botname-enforce.ts` 🗄️,
`match/engine-token.util.ts` 🗄️, `match/guest-token.util.ts` 🗄️, and the engine's copies in
`socket/auth.ts` ⚙️.

| Constant | Value | What it decides |
|---|---|---|
| `CSRF_COOKIE` / `CSRF_HEADER` | `csrf_token` / `x-csrf-token` | the double-submit pair 🔗 (the SPA reads the cookie in `api.ts`) |
| `TOKEN_TTL_MS` | 604800000 (7 days) | CSRF cookie lifetime; rotating `JWT_SECRET` invalidates outstanding tokens |
| `MUTATING` | `POST PUT PATCH DELETE` | methods that must present the token |
| `ENGINE_CALLBACKS` | `/api/game/end`, `/api/game/:id/started` | the two key-authenticated callbacks CSRF exempts |
| CSRF nonce | 18 random bytes | `nonce.signature`, HMAC-SHA256 base64url, key derived from `JWT_SECRET` |
| `BOT_PREFIX` | `bot-` | a bot seat's user id; `bot-<color>` is the identity 🔗 (engine copy in `socket/auth.ts`) |
| Reserved bot name | `^bot[-\s_]` | a human display name may not start with `bot`, `bot-`, `bot ` or `bot_` |
| `GUEST_TOKEN_PREFIX` | `g_` | guest socket tokens live in their own namespace 🔗 (engine copy in `socket/auth.ts`) |
| `GUEST_TOKEN_TTL_S` | 3600 (1 h) | lifetime of one guest token record (Redis `guesttok:<hash>`) |
| `ENGINE_TOKEN_AUDIENCE` | `ludo-engine` | audience of every engine match token 🔗 (engine `socket/auth.ts`) |
| `ENGINE_TOKEN_TTL` | `'24h'` | engine match-token lifetime |
| CSRF origin allow-list | `FRONTEND_URL`, `NGROK_FRONTEND_URL`, `http://localhost:5173`, `http://127.0.0.1:5173`, and `https://LAN_IP:8443` when `LAN_IP` is set | origins a mutating request may come from (its own host is always allowed). The engine's socket handshake has its own list from `CORS_ORIGIN` |
| Engine backend URL | `BACKEND_URL` default `http://backend:3000` | where the engine posts `/api/game/end` and `/api/game/:id/started` |


### **7. Route rate limits**

**Owners:** `backend/src/common/throttles.ts` 🗄️ (one table per controller, so coverage stays
auditable) and `backend/src/app.module.ts` 🗄️ (the global backstop). Caps are **per client IP**, not per
account; the per-account ladders are §5 and §8.

**Global:** 300 requests / 60 s, applied by `CodedThrottlerGuard` to every route. Every mutating route
overrides it with a row below; reads fall back to it.

**Auth — `auth.controller.ts`**

| Key | Limit | Window |
|---|---|---|
| `register` | 5 | 1 h |
| `resendVerification` | 3 | 1 h |
| `login` | 5 | 1 min |
| `twoFactorVerify` | 5 | 1 min |
| `twoFactorResend` | 5 | 1 h |
| `refresh` | 30 | 1 min |
| `forgotPassword` | 3 | 1 h |
| `resetPassword` | 5 | 15 min |
| `updateProfile` | 10 | 1 h |
| `resendEmailChange` | 5 | 1 h |
| `changePassword` | 5 | 1 h |
| `deleteAccount` | 5 | 1 h |
| `setTwoFactor` | 10 | 1 h |

**Friends — `friends.controller.ts`**

| Key | Limit | Window |
|---|---|---|
| `request` | 20 | 1 min |
| `accept` / `decline` / `remove` | 30 | 1 min |
| `block` / `unblock` / `invite` | 20 | 1 min |
| `dismissInvite` | 60 | 1 min |

**Match — `match.controller.ts`** (the two engine callbacks are key-authenticated and deliberately
unthrottled here)

| Key | Limit | Window |
|---|---|---|
| `pvpInvite` / `pve` / `create` | 10 | 1 min |
| `join` / `inviteFriend` | 20 | 1 min |
| `guest` | 20 | 1 min |
| `ready` / `rejoin` | 60 | 1 min |
| `exit` / `abort` | 30 | 1 min |

**Notifications / user / achievements**

| Key | Limit | Window |
|---|---|---|
| `notifications.stream` | 60 | 1 min |
| `notifications.markRead` | 120 | 1 min |
| `notifications.markAllRead` | 30 | 1 min |
| `user.avatarUpload` / `avatarDelete` | 10 | 1 h |
| `achievements.check` | 30 | 1 h |

**Edge limits — `nginx/conf/nginx.conf` + `app.inc`** (one layer out; `429` is returned before the
request reaches NestJS)

| Zone | Rate | Burst | Protects |
|---|---|---|---|
| `login` | 5 r/min | 5 | `POST /api/auth/login` |
| `refresh` | 30 r/min | 15 | `POST /api/auth/refresh` |
| `auth` | 60 r/min | 20 | every other `/api/auth/` route |
| `guest` | 10 r/min | 5 | `POST /api/match/guest` |
| `leaderboard` | 30 r/min | 20 | `GET /api/leaderboard` |
| `api` | 600 r/min | 100 | everything else under `/api/` |
| `conn` | — | 100 (direct listener) / 30 (tunnel listener) | simultaneous connections per client |

**Edge transport:** `client_max_body_size 3M` (the avatar limit is 2 MiB, §9), TLS 1.2 floor on both
listeners, `Strict-Transport-Security: max-age=31536000` (one year; `includeSubDomains` only on the
direct listener, because the tunnel's host is an ngrok domain).


### **8. Guest budgets**

**Owners:** `backend/src/match/guest-limit.service.ts` 🗄️ — "the whole knob block, edit here, nowhere
else" — mirrored in part by the engine in `backend/app/ludo-engine/src/redis.ts` ⚙️, which writes the
counters and decides no limit.

| Constant | Value | What it decides |
|---|---|---|
| `GUEST_LIMITS.windowS` | 21600 (6 h) | how far back the per-address counters look 🔗 (engine `GUEST_ABORT_WINDOW_S`) |
| `GUEST_LIMITS.mintSoftLimit` | 10 | mints past which each call costs the caller time |
| `GUEST_LIMITS.mintHardLimit` | 40 | mints past which the address is refused (`GUEST_LIMITED`, 429) |
| `GUEST_LIMITS.abortWeight` | 2 | what one abort costs against the mint budget (an abort burns a room, a socket and bot timers) |
| `GUEST_LIMITS.maxConcurrent` | 3 | live guest rooms per address |
| `GUEST_LIMITS.maxLiveRooms` | 50 | live guest rooms, all addresses (`GUEST_CAPACITY`, 429) |
| `GUEST_LIMITS.maxDelayS` | 30 | ceiling on the per-call delay |
| `GUEST_LIMITS.liveTtlS` | 3600 (1 h) | self-heal TTL for the concurrency counters |
| `GUEST_LIMITS.tokenTtlS` | 3600 (1 h) | lifetime of one guest token record (`GUEST_TOKEN_TTL_S`, §6) |
| `MAX_DELAY_STEPS` | 5 | `min(2^n, 30) s`, the login ladder verbatim |
| `GUEST_ROOMS_LIVE` | `guest:rooms:live` | the one non-per-address ceiling 🔗 (engine copy) |
| Counter keys | `guest:mint:<hash>`, `guest:abort:<hash>`, `guest:live:<hash>` | `<hash>` is `sha256(ip)`, so a Redis dump holds no addresses |

The delay ladder is the same shape as login: `min(2^n, 30) s` for the n-th mint past the soft limit
(2, 4, 8, 16, then 30 s), and a refused caller is refused **before** any delay or counter write.
Reservations are taken before the room exists and given back with a Lua script that never leaves a
counter below zero.


### **9. Transport, presence and storage**

**Engine — `socket/server.ts` and `socket/auth.ts`** ⚙️

| Constant | Value | What it decides |
|---|---|---|
| `MAX_EVENT_BYTES` | 65536 (64 KiB) | largest inbound event Socket.IO buffers and parses (OWASP guidance; the join payload is a few KiB) |
| `MAX_SOCKETS_PER_USER` | 4 | sockets one account may hold: one per device, one stale during a refresh, one clash pipe, one slack |
| `EVENT_LIMIT` | 20 | inbound events per socket per `EVENT_WINDOW_MS` (5 s, §1); a loop or flood closes the socket |
| `CLASH_EVENT_LIMIT` | 125 | presses per socket per `CLASH_EVENT_WINDOW_MS` (5 s); a mash at `CLASH_PRESS_CAP_MS` is ~9/s per side, so this bucket exists to keep the shared one from closing a racing socket |
| `GUEST_EVENTS` | 10 names | the entire event surface a guest socket may drive: `join_game`, `roll_dice`, `move_piece`, `skip_bust`, `arm_barrier`, `clash_card_hold`, `clash_input`, `leave_game`, `end_game`, `disconnect` |
| `cardId` shape (inline) | 1–64 chars | `clash_card_hold` refuses anything else |

**Backend — presence, notifications, avatars, listings** 🗄️

| Constant | Value | What it decides |
|---|---|---|
| `PRESENCE_TTL_S` | 45 | how long `presence:<userId>` and `presence:conns:<userId>` live without a refresh; the session socket refreshes both every 20 s, and the socket's own ping/pong (20 s + 20 s) detects a dead peer first |
| `PRESENCE_REFRESH_MS` | 20000 | the server-side refresh of one live connection's row and set membership |
| `PRESENCE_COUNT_COALESCE_MS` | 5000 | `presence:count` publishes at most once per window (the count is a SCAN) |
| `UNREAD_CAP` | 150 | unread entries per account; the write trims the oldest past it, in the same Lua script |
| `NOTIFICATION_TTL_S` | 1209600 (14 days) | TTL on `notif:<userId>` and `notif:<userId>:unread`, refreshed on every write |
| Avatar upload | 2 MiB (`2 * 1024 * 1024`) | largest accepted avatar; nginx allows 3 MiB so the API, not the proxy, answers |
| Avatar signatures | PNG, JPEG, GIF, WebP | the magic bytes checked at offset 0 (and 8 for WebP) before a byte is stored |
| Leaderboard page | default 20, cap 100 | `limit` is clamped to `min(limit, 100)` |
| Game-history page | default 20, cap 100 | same clamp on `GET /api/user/:username/games` |
| Redis `SCAN` | `COUNT 100` | every prefix scan (rooms, guests, online count) |
| Invite code | 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` | join code; no `I`, `O`, `0` or `1` |

**Engine Redis TTLs** ⚙️ / 🗄️

| Key | TTL | Set by |
|---|---|---|
| `game:<gameId>` (state hash) | 86400 (24 h) | `redis.ts` on every save |
| `match:<gameId>` (room hash) | 86400 (24 h) | `match.creator.service.ts` at create |
| `match:<gameId>` after an abort | 3600 (1 h) | `redis.ts`, so the room drops out of open-room listings sooner |
| `guesttok:<hash>` | 3600 (1 h) | `GUEST_TOKEN_TTL_S` (§8) |

**Statuses matched literally:** an engine seat status of `exited` (`TERMINAL_SEAT_STATUSES`) means the
seat can never be rejoined; a match status of `ABORTED` or `ENDED` (`ENDED_MATCH_STATUSES`) means the
room is over. Both readers fail open: an unreadable state never hides a seat or a room.

**Ports and defaults** (compose publishes the first four on loopback only)

| Service | Port | Where it is fixed |
|---|---|---|
| Backend HTTP | 3000 | `main.ts` `app.listen(3000)` |
| Engine HTTP + WebSocket | 3001 | `index.ts` `PORT` (default `3001`), compose `ENGINE_PORT` |
| Redis | 6479 | `REDIS_PORT` default in every service that connects |
| Postgres | 5432 | compose `127.0.0.1:5432` |
| nginx HTTPS (direct) | 443, published 8443 | `nginx.conf` listener `443 ssl` |
| nginx HTTPS (tunnel) | 444, published 8444 | `nginx.conf` listener `444 ssl` |
| SPA dev server | 8080 in Docker, 5173 for `npm run dev` | `frontend` compose profile (proxies `/api`) / Vite default, which is on the CSRF origin allow-list |


### **10. Scoring and achievements**

**Rating — `backend/src/common/scoring.ts`** 🗄️

| Constant | Value | What it decides |
|---|---|---|
| `POINTS_PER_PIECE` | 2 | rating per piece that reached the goal (half in PvE) |
| `WIN_BONUS_PIECE` | 1 | extra "piece" for the winner, added before the per-piece rate |

`ratingDeltaFor` = `(piecesInGoal + (rank === 1 ? 1 : 0)) × (PVE ? 1 : 2)`. Only `PVP` and `PVE` are
rated (`RATED_GAME_TYPES` in `achievements.service.ts`).

**Achievements — `backend/src/achievements/achievements.registry.ts`** 🗄️ — 16 rows, the authoritative
list; the client dashboard mirrors the same keys and thresholds in `pages/Profile.tsx` 🖥️.

| Key | Type | Target | Counts |
|---|---|---|---|
| `achFirstBlood` | lifetime | 1 | wins |
| `achOnFire` | lifetime | 2 | win streak |
| `achDiceMaster` | lifetime | 3 | wins |
| `achBabySteps` | lifetime | 1 | PvE wins |
| `achTheDiceLoveMe` | lifetime | 3 | PvE wins |
| `achTactician` | lifetime | 5 | wins |
| `achMaster` | lifetime | 8 | wins |
| `achGrandBotMaster` | lifetime | 12 | wins |
| `achWorldChampion` | lifetime | 15 | wins |
| `achft_Transcendence` | lifetime | 10 | PvP wins |
| `achLoveTheMachine` | lifetime | 3 | consecutive PvE games (any outcome) |
| `achSpeedDemon` | per-game | 1 | a win in under 30 min (`30 * 60 * 1000`) |
| `achUnstoppable` | per-game | 3 | pieces captured |
| `achSteadyDefender` | per-game | 2 | clashes defended and won |
| `achMercilessAttacker` | per-game | 2 | clashes attacked and won |
| `achTearDownThisWall` | per-game | 2 | Wall Breaker breaks (walls of 2+ torn down) |


### **11. Friends**

**Owner:** `backend/src/friends/friendship-pair.ts` 🗄️ — pure predicates, so friends, match and
presence share one definition without circular dependencies.

| Constant | Value | What it decides |
|---|---|---|
| `PENDING_TTL_MS` | 86400000 (24 h) | an unanswered request reads as `none` after this, and the sender may ask again |
| `DECLINE_COOLDOWN_MS` | 3600000 (1 h) | a declined direction blocks re-requests for this long |


---
---


## Frontend


### **12. Theme and palette**

**Owners:** `frontend/src/theme.ts` 🖥️ (the player colours and the shared style objects),
`frontend/src/styles/retrowave.css` 🎨 (the design tokens), `frontend/src/game/ClashOverlay.tsx` 🖥️
(clash plate colours).

**Player colours — `COL`** — the one place a Ludo colour is defined; `base` fills a piece, `dark` is the
shade used for piece depth, `yard` is the dim home-quadrant fill.

| Pair | `base` | `dark` | `yard` |
|---|---|---|---|
| red | `#ff007f` | `#a00050` | `rgba(255, 0, 127, 0.15)` |
| green | `#00ff88` | `#009950` | `rgba(0, 255, 136, 0.15)` |
| yellow | `#ffe600` | `#998a00` | `rgba(255, 230, 0, 0.15)` |
| blue | `#00f0ff` | `#009099` | `rgba(0, 240, 255, 0.15)` |

| Constant | Value | What it decides |
|---|---|---|
| `SEAT_COLORS` | `blue, red, green, yellow` | seat index → colour. Seat 0 is always you; this order is also the engine's `SLOT_COLORS` 🔗 |
| `BOT_POOL` | `Siri, Alexa, Cortana` | the three assistant names a bot seat can draw (seat 0 is you, so 3 is enough) |
| `BASE_MODE_HUE` | `#b8a6e4` | the lobby's "base game" room chip: a room with no mutator is a category, not an empty cell |
| `STATUS_STYLE` (theme) | online `#4bbf7b`, playing `#f0c24e`, offline `#6b6255` | presence dot colour, mirroring the backend's `PresenceStatus` |
| Clash plate colours | red `#e05050`, green `#5fd08a`, yellow `#f0d18a`, blue `#4a92e0` | the clash overlay's plates and bars, read as `var(--clash-<colour>, <fallback>)`. The vars are **not** defined in `retrowave.css`, so the fallback is the effective value |

**Design tokens — `retrowave.css`** 🎨 — `:root, [data-theme='synthwave']`; this is the only theme
(`ThemeType = 'synthwave'`), and the attributes are set on both `<html>` and `<body>`.

| Token | Value | Role |
|---|---|---|
| `--bg-primary` | `#0d0221` | page background (the cityscape image sits on top) |
| `--bg-secondary` | `#190a38` | panels, scrollbar track |
| `--bg-card` | `rgba(25, 10, 56, 0.85)` | card fill |
| `--accent-cyan` | `#00f0ff` | primary accent (blue seat) |
| `--accent-pink` | `#ff007f` | secondary accent (red seat), default border |
| `--accent-yellow` | `#ffe600` | highlight (yellow seat) |
| `--accent-purple` | `#9d00ff` | gradient partner |
| `--text-main` | `#ffffff` | body text |
| `--text-muted` | `#b8a6e4` | secondary text |
| `--text-soft` | `#d4caef` | captions and empty-state lines (lighter than muted) |
| `--border-color` | `#ff007f` | default border |
| `--box-shadow` | `0 0 15px rgba(255,0,127,.5), inset 0 0 15px rgba(0,240,255,.2)` | panel glow |
| `--font-heading`, `--font-display` | `'Atkinson Hyperlegible Next', system-ui, sans-serif` | UI face (Braille Institute, low-vision legibility) |
| `--font-mono` | `'Atkinson Hyperlegible Mono', ui-monospace, 'Courier New', monospace` | tabular readouts and room codes |
| `--grid-line-color` | `rgba(255, 0, 127, 0.35)` | perspective grid lines |
| `--grid-bg-glow` | `rgba(157, 0, 255, 0.2)` | grid horizon glow |
| `--btn-bg` | `linear-gradient(135deg, #ff007f, #9d00ff)` | button fill |
| `--btn-hover-shadow` | `0 0 20px #00f0ff, 0 0 35px #ff007f` | button hover glow |
| `--crt-scanline-opacity` | `0.15` | CRT scanline overlay |
| `--crt-flicker-opacity` | `0.03` | CRT flicker overlay |
| `--window-header-bg` | `linear-gradient(90deg, #ff007f, #00f0ff)` | OS-window title bar |
| `--window-header-text` | `#ffffff` | its text |
| `--card-border-style` | `2px solid var(--accent-pink)` | card border shorthand |
| `--fs-border` / `--fs-text` / `--fs-accent` | `#ff007f` / `#ffffff` / `#ff007f` | custom fieldset + colour-scheme component (global `:root`, not theme-scoped) |
| `--fs-cyan` / `--fs-bg` / `--fs-glow` | `#00f0ff` / `rgba(25,10,56,.9)` / `rgba(255,0,127,.5)` | the same component's outline, fill and glow |


### **13. Client timing**

**Owner:** `frontend/src/game/timing.ts` 🖥️ — "the delays the client shows, in one place". The four
clash windows are **presentation only**: the server sends absolute deadlines and the overlay follows
those, so these values decide the card animation, never the game state.

**Shared with the engine** — same name, same value on both sides, so the two describe one moment.

| Constant | Value | What it shows |
|---|---|---|
| `CLASH_ANNOUNCE_MS` 🔗 | 1500 | Card A: the "CLASH!" splash |
| `CLASH_COUNTDOWN_MS` 🔗 | 3000 | GET READY, then 3-2-1 |
| `CLASH_PRESS_MS` 🔗 | 5000 | the press race window, used for the card's CSS reveal and the "press for 5 seconds" copy; the live bar itself follows the server deadline |
| `CLASH_RESULT_MS` 🔗 | 2600 | Card D: the result card, and the card hold the client reports (`RESULT_FX_MS + RESULT_HEADLINE_READ_MS`, added on both sides) |
| `RESULT_FX_MS` 🔗 | 1300 | how long the card's gesture plays (`game/ResultFx.tsx` keeps every animation inside it) |
| `RESULT_HEADLINE_READ_MS` 🔗 | 1300 | the headline's own time once the gesture has stopped |
| `MOVE_STEP_ANIM_MS` 🔗 | 180 | one board step of the path animation |
| `DICE_ROLL_ANIM_MS` 🔗 | 750 | dice spin before the path starts |

**Key-shift presentation** — client-only, because the engine sends the absolute switch instants and the
overlay schedules its own timers against them. Nothing here decides the game; the server judges a press
against the live letter on its own clock.

| Constant | Value | What it shows |
|---|---|---|
| `CLASH_SWITCH_WARN_MS` | 400 | how far ahead the "LETTER SWITCHING!" banner fires (it never names the new letter) |
| `CLASH_SWITCH_WARN_HOLD_MS` | 300 | how long the banner lingers after the switch |
| `CLASH_SWITCH_FLIP_MS` | 110 | one half of the 220 ms badge flip: the face is edge-on exactly AT the switch, so the new letter is never late |
| `CLASH_SWITCH_PAD_STAGGER_MS` | 40 | per-circle landing delay when the touch pad re-scrambles (0/40/80/120 ms) |

**Client-only**

| Constant | Value | What it shows |
|---|---|---|
| `CLASH_FIGHT_FLASH_MS` | 700 | "FIGHT!" flash at press start |
| `CLASH_UI_TICK_MS` | 250 | overlay re-render cadence (bars, timer) |
| `TOUCH_FLASH_MS` | 120 | touch pad pressed state |
| `DICE_BRAKE_ARM_MS` | 200 | a tap younger than this is a double tap, not a brake |
| `DICE_BRAKE_FLOOR_MS` | 450 | shortest braked roll, so nothing teleports |
| `DICE_BRAKE_SETTLE_MS` | 150 | near-miss face, then the true one |
| `RESULTS_MODAL_DELAY_MS` | 900 | beat after the last move before the results modal |
| `PENDING_MOVE_GUARD_MS` | 3000 | safety net for a move that never answers |
| `CARD_HOLD_MARGIN_MS` | 200 | the receipt's one-way trip: card hold = `CLASH_RESULT_MS + this` |
| `CAPTURE_FX_MS` | 600 | the capture burst's own length; interpolated into both copies' inline `animation` so the keyframes hold no 600 |
| `CAPTURE_FX_CARD_OPACITY` | 0.7 | the burst as it reads over the clash result card |
| `CAPTURE_FX_AFTER_CARD_MS` | 50 | beat between the card leaving and the board's real burst |

**The dice brake — `diceLandAt(start, valueAt, brakeAt)`** is the whole clamp, and the three
`DICE_BRAKE_*` constants are its only inputs:

- no brake → `max(valueAt, start + 750)` (the full spin)
- brake → `max(valueAt, min(start + 750, max(start + 450, brakeAt + 150, valueAt + 150)))`

A brake can shorten a roll, never extend it; a slow server answer wins over the shortened window
rather than settling on a face nobody sent. `piece_moved` then waits out what is **left** of
`rollLandAtRef`, not the whole constant.


### **14. Client cadences**

**Owners:** `frontend/src/store.tsx` 🖥️, `frontend/src/api.ts` 🖥️, `frontend/src/authRefreshLock.ts` 🖥️,
`components/NotificationToast.tsx` 🖥️, `hooks/useNotifications.tsx` 🖥️, `pages/Game.tsx` 🖥️,
`pages/Profile.tsx` 🖥️, and `backend/src/realtime/realtime-broadcaster.service.ts` 🗄️ for the two
`ROOMS_*` values. No screen polls: the lobby, the friend lists, presence and the bell are pushed over
the session socket, so the only client timers left are the client rows below.

| Constant / literal | Value | What it paces |
|---|---|---|
| `ACCESS_TOKEN_REFRESH_MS` | 840000 (14 min) | proactive refresh, one minute before the 15-minute access token expires |
| `ROOMS_DEBOUNCE_MS` | 500 (backend) | how long a burst of `rooms:changed` publishes is folded into one snapshot read before the diff is emitted |
| `ROOMS_REPAIR_TICK_MS` | 30000 (backend) | recompute-and-emit-on-change, and count the diffs it emits (a steady non-zero count is a missed publish) |
| Room code and `[COPY]` badge (inline) | 1500 | how long the confirmation holds: `[COPIED OK]` beside a copied room code (`Game.tsx`) and beside the copied handle in the profile header (`Profile.tsx`) |
| Notification toast | 9000 visible, 350 exit, 30 entrance | how long a toast stays, then its slide-out and the one-frame delay before sliding in |
| `LOCK_TTL_MS` | 10000 | the cross-tab refresh lock in `lr.authRefreshLock`; a dead holder cannot wedge the other tabs |
| `RESULT_WAIT_MS` | 3000 | how long a losing tab waits for the winning tab's refresh result over the `BroadcastChannel` |
| `RESULT_POLL_MS` | 100 | how often it re-checks for that result |
| `PROBE_ATTEMPTS` | 3 | `/me` probes after a lost refresh race before treating the session as ended |
| `PROBE_GAP_MS` | 250 | gap between those probes |
| `CHANNEL_NAME` | `lr.authRefresh` | the BroadcastChannel name the tabs share |
| `DIGEST_WINDOW_MS` | 2000 | live stored arrivals buffered into one digest toast; shown once per tab (`sessionStorage`) |
| `ACTIVE_MATCH_KEY` / `SEATS_KEY` | `lr.activeMatch`, `lr.seats` | §17 |


### **15. Layout, size and z-index**

**Owners:** `frontend/src/components/Board.tsx` 🖥️ and `frontend/src/game/boardGeometry.ts` 🖥️ (board),
`components/CaptureBurst.tsx` 🖥️, `game/ClashOverlay.tsx` 🖥️, `pages/Game.tsx` 🖥️,
`components/RetroNavbar.tsx` 🖥️, `hooks/useFitTextSize.ts` 🖥️, `components/NotificationToast.tsx` 🖥️.

**Board geometry** — one mapping shared by the renderer and anything that has to point at a square
(the capture burst's anchor is measured from the cell's `data-cell` rect).

| Constant | Value | What it decides |
|---|---|---|
| `TRACK_CELLS` | 52 cells | the shared outer loop, track position 1–52 → `{r, c}` |
| `RED_SEGMENT` | 13 cells | the red quarter is authored once and rotated 90° three more times (`rotate90`: `{r: c, c: 14 - r}` on the 15×15 grid) |
| `HOME_LANES` | 5 cells × 4 colours | red lane authored once, the rest rotated by their quarter |
| `TRACK_OFFSET` | red 0, green 13, yellow 26, blue 39 | same arithmetic as the engine 🔗 (§3) |
| Board cells | 15 × 15 | the cross; `stepToCell` returns `null` for base and goal, which have no square |
| `CELL_BG` / `LINE` | `#050515` / `#00f0ff` | empty cell fill and track stroke |
| `SAFE_STAR_CELLS` | derived from `1, 9, 14, 22, 27, 35, 40, 48` | the eight stars 🔗 (engine `SAFE_TRACK_POSITIONS`, §3) |
| `SAFE_STAR_COLOR` / `SAFE_STAR_OUTLINE` | `#ffffff` / `#000000` | the two-layer star: white core plus black ring, so it clears all five cell fills |
| `SAFE_STAR_POINTS` | 10-point star, 21.16 × 20.13 inside a 24 box | the star's SVG path (2.2 stroke fits) |
| Board SVG `viewBox` | `-1 -1 13 10` | the drawing box, with a 1-unit margin |

**Capture burst**

| Constant | Value | What it decides |
|---|---|---|
| `SPARKS` | 8 entries | four on the axes (offset 20, size 7/6) and four on the diagonals (offset 14, size 5), seat colour alternating with white |
| Ring | 34 × 34, inset −17, 3 px border, 12 px glow | the expanding ring around the anchor |
| `KEYFRAMES_ID` | `capture-fx-keyframes` | the two `@keyframes` (`captureRing`, `captureSpark`) are injected once however many bursts are mounted |
| `settleMs` (inline, `Game.tsx`) | 600 captured / 350 plain | how long the landing holds before the turn is handed back; 600 keeps the burst mounted for its whole `CAPTURE_FX_MS` |

**Clash overlay**

| Constant | Value | What it decides |
|---|---|---|
| `CLASH_BAR_WIDTH_PX` | 168 | the press bar: 4 px per press × `CLASH_TARGET` 42 |
| `TOUCH_BUTTON` | `3cm` | touch pad circle diameter (a CSS length, so it scales with the device) |
| `TOUCH_GAP` | `1cm` | inert space between circles |
| `TOUCH_EDGE_BUFFER` | `1cm` | added to the safe-area inset |
| `TOUCH_TAP_COUNT` | 2 | presses one tap sends (the engine clamps to `CLASH_TAP_COUNT_MAX`) 🔗 |
| `KEY_BADGE_W` / `KEY_BADGE_H` | 67 / 61 | the static key box: 54 px glyph plus 2 mm clearance to the 2 px border |
| Overlay backdrop | `rgba(0,0,0,.72)` + `blur(4px)` | what dims the board behind the card |

**Game page**

| Constant | Value | What it decides |
|---|---|---|
| `BUSTER_PANEL_W` / `BUSTER_PANEL_GAP` | 96 / 10 | the Wall Breaker token panel's width and the gap in front of it |
| `CARD_ROOM_OVERHANG` | 46 | extra room for display names in every room; the roster's overhang is 46, or 46 + 96 + 10 = 152 in clash mode, so the cards are equally wide either way |
| `BUSTER_GLYPH` | `🧨` | the token's glyph |
| Board size | `min(650px, 66vh)` | the desktop board's ceiling, and it also yields `rosterOverhang` |
| Layout breakpoint | `1024px` | below this the game stacks to one column |
| Tactical grid | `250px / 1fr / 250px`, then 285, then 310 | side columns at the md/lg/xl/2xl breakpoints |
| Page width | 1440 px | the game shell's maximum |

**Navbar label fit — `RetroNavbar.tsx`** (each label is measured, never guessed)

| Constant | Value | What it decides |
|---|---|---|
| `NAV_LABEL_BASE_PX` | 13.6 | starting size (≈0.85 rem) before the first measurement |
| `NAV_LABEL_MIN_PX` / `NAV_LABEL_MAX_PX` | 9 / 20 | the range the fit may choose |
| `NAV_LABEL_LS_PX` | 1 | letter-spacing accounted for in the measurement |
| `NAV_PROBE_PX` | 100 | the off-screen probe font-size (width scales linearly) |
| `NAV_LABEL_SAFETY_PX` | 2 | kept free so rounding cannot trigger an ellipsis |
| `REFERENCE_FONT_SIZE` / `FONT_SIZE_STEP` | 100 / 0.25 | `useFitTextSize`: measure once at 100 px, then step down by a quarter pixel |

**Toast stack:** width 430 px, `bottom: 28 + index * 150`, z-index 99999.

**Z-index ladder** — bottom to top.

| Layer | z-index |
|---|---|
| Board piece, legal-move halo, chain badge, board burst anchor | 1 (30 when the move is legal), 31, 11 |
| Clash overlay backdrop (card inside it) | 999 |
| The card's dim capture burst, touch pads | 1000 |
| Portrait gate | 1100 |
| Results modal, navbar dropdown | 9999 (navbar's popover 10005) |
| Notification toast | 99999 |
| Notification bell popover | 100000 |


### **16. Audio**

**Owner:** `frontend/src/utils/audio.ts` 🖥️ — one `RetroAudioEngine` (`retroAudio`), Web Audio, no audio
files. Every sound is a small oscillator/noise graph; the master gain multiplies each.

| Constant / method | Value | What it decides |
|---|---|---|
| `volume` | 0.2 | master gain; each sound multiplies it (`×1.5` for the explosion, `×0.45` for ignition, `×0.5` for the printer) |
| `muted` | false | session mute; `toggleMute()` flips it, `setVolume()` sets the gain |
| `playUiBeep(freq = 440, duration = 0.08, type = 'square')` | 440 Hz, 80 ms, square | the UI blip; every call site passes its own frequency and length (`520`, `580`, `640`, `720`, `800`, `880`, `980`, `1100`, `1318`, `1760` are in use) |
| `playLaserSound()` | 880 → 110 Hz, 150 ms | laser sweep |
| `playCyberSlide()` | 180 → 740 Hz, 180–200 ms | slide open |
| `playCyberAccept()` | 587.3 / 880 / 1174.6 Hz, 240 ms | accept chime |
| `playCyberReject()` | 440 → 160 Hz, 160–180 ms | reject buzz |
| `playIgnitionSound()` | 140 → 360 Hz, 140 ms | ignition |
| `playExplosionSound()` | white noise, 250 ms, lowpass 1000 → 100 Hz | explosion |
| `playPrinterSound()` | 14 pulses 110 ms apart, pitch `350 + (i % 4) × 110` Hz, closing beep 1200 Hz | the results receipt printing |

The results modal drives its own print cadence on top of these: steps at `0, 80, 180, 290, 410, 540` ms
(`340 + (i % 3) × 60` Hz) and a final `880` Hz at `720` ms.


### **17. Browser storage**

**Owners:** `frontend/src/store.tsx` 🖥️ (keys and defaults), `frontend/src/i18n.ts` 🖥️ (language boot),
`frontend/src/authRefreshLock.ts` 🖥️ (the cross-tab lock).

| Key | Default / shape | What it holds |
|---|---|---|
| `lr.lang` | `'en'` (one of `en`, `ms`, `fr`) | chosen language; read at boot so the first paint is already localized |
| `retro_theme` | `'synthwave'` | theme name, written to `data-theme` on `<html>` and `<body>` |
| `lr.activeMatch` | JSON `ActiveMatch` (`gameId`, `token`, `color`, `inviteCode`) | the navbar's rejoin banner |
| `lr.seats` | JSON seat map | lobby → game handoff of seat colours/names |
| `rulesShowOnStart` | `true` (absent means on) | show the rules popup when a match starts |
| `lr.authRefreshLock` | JSON `{ owner, expiresAt }` | cross-tab refresh lock (`LOCK_TTL_MS` 10 s, §14) |

**Settings defaults — `SETTING_DEFAULTS`**, keyed `"<group>-<row>"`:

| Key | Default | Toggle |
|---|---|---|
| `0-0` | on | Sound effects |
| `0-1` | on | Music |
| `1-0` | on | Auto-roll |
| `1-1` | off | Fast animations |
| `1-2` | on | Move hints |
| `2-0` | on | Friend invites |
| `2-1` | off | Weekly recap |


---
---


## Contracts


### **18. Mirrored values**

Every number or string that exists in more than one place, with the file that owns it and the file
that mirrors it. A change is not complete until the mirror is edited too.

| Value | Owner | Mirror | Note |
|---|---|---|---|
| Clash windows 1500 / 3000 / 5000 / 2600 | ⚙️ `timing.ts` | 🖥️ `game/timing.ts` | same names on both sides; the card is added from `RESULT_FX_MS + RESULT_HEADLINE_READ_MS` |
| `MOVE_STEP_ANIM_MS` 180, `DICE_ROLL_ANIM_MS` 750 | ⚙️ `timing.ts` | 🖥️ `game/timing.ts` | the engine paces bot turns with the client's animation |
| Key grids `u i o h j k b n m` / `q w e a s d z x c` | ⚙️ `clash.ts` | 🖥️ `ClashOverlay.tsx` (touch decoys) | the sets are disjoint so a decoy cannot be the other side's key |
| Tap weight 2 (`CLASH_TAP_COUNT_MAX`) | ⚙️ `clash.ts` | 🖥️ `ClashOverlay.tsx` `TOUCH_TAP_COUNT` | the engine clamps: a heavier tap is cut to 2 |
| `CLASH_TARGET` 42 → bar 168 px | ⚙️ `clash.ts` | 🖥️ `CLASH_BAR_WIDTH_PX` | 4 px per press |
| Safe squares `1, 9, 14, 22, 27, 35, 40, 48` | ⚙️ `board-mapper.ts` | 🖥️ `Board.tsx` `SAFE_STAR_CELLS` | the eight stars |
| Colour offsets 0 / 13 / 26 / 39 | ⚙️ `board-mapper.ts` | 🖥️ `boardGeometry.ts` `TRACK_OFFSET` | same modulo arithmetic |
| `BARRIER_BUSTER_TOKEN_CAP` 3 | ⚙️ `types.ts` | 🖥️ `pages/Game.tsx` | the client draws exactly three glyph slots |
| `LOG_CAP` 30 | ⚙️ `types.ts` | 🖥️ `game/types.ts` | the engine caps the stored log, the panel caps what it renders |
| Password 12–72 + character classes | 🗄️ `dto/password.rules.ts` | 🖥️ `validatePassword.ts` | the server is authoritative |
| Guest window 6 h + `guest:*` key shapes | 🗄️ `guest-limit.service.ts` | ⚙️ `redis.ts` (`GUEST_ABORT_WINDOW_S`, keys) | the engine writes counts, decides no limit |
| `BOT_PREFIX` `bot-` | 🗄️ `common/botname-enforce.ts` | ⚙️ `socket/auth.ts` | `bot-<color>` is a seat identity |
| `GUEST_TOKEN_PREFIX` `g_` | 🗄️ `match/guest-token.util.ts` | ⚙️ `socket/auth.ts` | a mismatched prefix fails closed ("not found") |
| `ENGINE_TOKEN_AUDIENCE` `ludo-engine` | 🗄️ `match/engine-token.util.ts` | ⚙️ `socket/auth.ts` | a mismatch rejects every engine token |
| Seat order blue → red → green → yellow | ⚙️ `SLOT_COLORS` (join/lobby/match services) | 🖥️ `theme.ts` `SEAT_COLORS` | seat index 0 is always the local player |
| Presence strings `online` / `playing` / `offline` | 🗄️ `presence.service.ts` | 🖥️ `theme.ts` `PresenceStatus` + `STATUS_KEYS` | the Redis value is the wire value |
| 16 achievement keys and thresholds | 🗄️ `achievements.registry.ts` | 🖥️ `pages/Profile.tsx` `ACHIEVEMENTS_DEF` | titles, icons and copy are client-side |
| CSRF cookie `csrf_token` | 🗄️ `common/csrf.ts` | 🖥️ `api.ts` | a mismatch fails every write with `CSRF_TOKEN_INVALID` |
| `GUEST_EVENTS` allow-list (10 names) | ⚙️ `socket/auth.ts` | 🖥️ the guest client's emits (`Game.tsx`) | an event on one side only is refused |
| Seat hues `#ff007f` / `#00ff88` / `#ffe600` / `#00f0ff` | 🖥️ `theme.ts` `COL.base` | 🖥️ `pages/Lobby.tsx` and `pages/Game.tsx` (`SEAT_HUES`), `pages/LudoLobby.tsx` (`ROOM_AVATAR_HUES`) | three copies of the same four hexes |


### **19. Where a new constant goes**

1. **A delay the engine also needs → `backend/app/ludo-engine/src/timing.ts`**, then add it to
   `frontend/src/game/timing.ts` only if the client shows something with it. Never introduce a second
   literal for the same moment.
2. **A delay only the client shows → `frontend/src/game/timing.ts`** (clash, dice, path, burst,
   guards). A component-local timer constant stays in the component only if nothing else can ever
   read it.
3. **A rule the engine enforces → next to the rule** (`clash.ts` for the QTE, `board-mapper.ts` for
   geometry, `types.ts` for the starting hand) and, if the client mirrors it, a row in §18.
4. **A limit or lifetime the backend enforces → the owning service's knob block** (`AUTH` in
   `auth.constants.ts`, `GUEST_LIMITS` in `guest-limit.service.ts`) or the shared table
   (`common/throttles.ts`, `common/scoring.ts`). Do not scatter a limit across controllers.
5. **A colour, token or size → `theme.ts` or `retrowave.css`**, and a row in §12 or §15. A raw hex in a
   component is a bug unless it is a one-off illustration (the board art, the burst's sparks).
6. **A string the user reads → `locales/*.ts`**, never a hard-coded constant in a component.
7. **When two files must agree, name the mirror in a comment** and add a §18 row, so the next reader
   does not have to rediscover the pair.


---
---


## **Notes**

- **The engine owns the moment; the client owns the picture.** The clash's phase changes come from the
  server's absolute deadlines. The client's `CLASH_*` windows drive what the card looks like and when a
  local animation ends, never whether a press counts or a turn advances.
- **A client-only number is not a contract.** `CAPTURE_FX_MS`, `CAPTURE_FX_CARD_OPACITY`,
  `CAPTURE_FX_AFTER_CARD_MS`, the dice brake's three constants and the toast timings exist only in the
  SPA; nothing server-side paces against them, so they can change in one edit.
- **Computed values are shown computed.** Where the code does the arithmetic (`2 * 1024 * 1024`,
  `7 * 24 * 60 * 60`, `2^n` ladders, `4 px × 42`), the table carries the result and the expression, so a
  change is a single edit in the owner and a single row here.
