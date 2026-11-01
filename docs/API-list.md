# **API List**

Complete reference of all HTTP and WebSocket APIs in the project. Updated 18 Oct 2026

What protects these routes (edge headers, throttling, cookie and token scope) is documented in
[`security_measures.md`](security_measures.md).


---
---


## **Legend**

| Icon | Meaning |
|---|---|
| 🔒 | Requires JWT in `token` cookie (set by login or 2FA verify, refreshed by `/api/auth/refresh`) |
| 🌐 | WebSocket event (Socket.IO) |
| 🤖 | Called by ludo-engine (backend-to-backend) |

> **Auth note:** All 🔒 endpoints authenticate via the `token` httpOnly cookie. No `Authorization: Bearer` header is used.

> **CSRF note:** every mutating request (`POST`, `PATCH`, `DELETE`) under `/api` must echo the signed `csrf_token` cookie in the `X-CSRF-Token` header. The SPA bootstraps the cookie with `GET /api/auth/csrf` (its `fetchWithCsrf` wrapper does this automatically) and the server also rejects a request whose `Origin`/`Referer` is neither this host nor a published frontend URL (`403 CSRF_ORIGIN_REJECTED`). A missing, stale or mismatched token is `403 CSRF_TOKEN_INVALID`; `api.ts` retries once with a fresh token. The two 🤖 engine callbacks are exempt because they authenticate with `x-engine-key` and carry no browser session.

> **Success note:** a success body carries data and, where the SPA branches on it, a `code`. It carries no `message`: the copy the user reads lives in the SPA locale files (`frontend/src/locales/*`), so the server never ships English UI text. `message` exists on error bodies only, as the developer fallback described below.


---
---


## **Error responses**

An error response has one of two shapes:

| Shape | When | Body |
|---|---|---|
| **Default** | NestJS's own exceptions (anything not listed below) | `{ "statusCode": 400, "message": "…", "error": "Bad Request" }` |
| **With a code** | An error or notice that the user reads in their own language | `{ "code": "SOME_CODE", "message": "…" }` |

- **`code`** is a fixed identifier. The frontend uses it to find a translation named `errors.<CODE>` (in `frontend/src/locales/*`) and shows that text in the user's language. If a code has no translation yet, the SPA logs the English `message` to the console and shows a localized generic message — server text is never rendered. `translateErrorCode()` in `api.ts` does the translation, and both the `apiFetch` helpers and the auth store call it.
- **`message`** is always plain English, so a code with no translation never shows a technical identifier to the user.
- **Validation errors** are built by the `ValidationPipe` `exceptionFactory` in `main.ts`. For the fields listed in that file it adds a `VALIDATION_*` code; for every other field it returns the default NestJS body.

**Error codes:**

*Auth*

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH_USERNAME_TAKEN` | 409 | Username already registered |
| `AUTH_EMAIL_TAKEN` | 409 | Email already registered, or already used by another account when linking a provider |
| `AUTH_INVALID_CREDENTIALS` | 401 | Wrong username/email or password |
| `AUTH_RESET_LINK_INVALID` | 401 | Reset link invalid or expired |
| `AUTH_CODE_INVALID` | 401 | 2FA code invalid or expired |
| `AUTH_NOT_AUTHENTICATED` | 401 | No valid session |
| `AUTH_SESSION_EXPIRED` | 401 | Unknown/expired refresh token — log in again |
| `AUTH_SESSION_REUSED` | 401 | A refresh token that was already rotated came back outside the race window: every session was revoked |
| `AUTH_DISPLAY_NAME_TAKEN` | 409 | Display name already taken |
| `AUTH_DISPLAY_NAME_RESERVED` | 400 | Display name cannot start with `bot-` (reserved for bots) |
| `AUTH_USERNAME_RESERVED` | 400 | Username cannot start with `bot-` (reserved for bots) |
| `AUTH_CURRENT_PASSWORD_INCORRECT` | 401 | Current password wrong |
| `AUTH_EMAIL_CHANGE_SET_PASSWORD` | 400 | Set a password before changing email (OAuth-only account) |
| `AUTH_EMAIL_CHANGE_RATE_LIMITED` | 429 | Too many email-change requests (max 3/hour per user) |
| `NO_PENDING_EMAIL_CHANGE` | 400 | No pending email change to resend |
| `AUTH_DELETE_CONFIRM_REQUIRED` | 400 | Deletion not confirmed |
| `AUTH_DELETE_SET_PASSWORD` | 403 | Set a password before deleting |
| `AUTH_PROVIDER_LINKED` | 409 | Provider linked to another user |
| `AUTH_PROVIDER_NOT_LINKED` | 404 | Provider not linked to this account |
| `AUTH_KEEP_ONE_SIGNIN` | 403 | Must keep at least one sign-in method |
| `AUTH_EMAIL_NOT_VERIFIED` | 200 | Notice: verify the address before signing in |
| `AUTH_PASSWORD_UPDATED` | 200 | Notice: password changed, other devices signed out |

*Transport / limits*

| Code | HTTP | Meaning |
|---|---|---|
| `CSRF_TOKEN_INVALID` | 403 | Missing, mismatched or stale `X-CSRF-Token` (see the CSRF note above) |
| `CSRF_ORIGIN_REJECTED` | 403 | `Origin`/`Referer` is not this host and not on the frontend allow-list |

*Validation (400)*

| Code | Field |
|---|---|
| `VALIDATION_USERNAME_FORMAT` | `username` — 3-20 chars, letters/numbers/underscore |
| `VALIDATION_CODE_FORMAT` | `code` — 6 digits |
| `VALIDATION_DISPLAY_NAME_LENGTH` | `displayName` — 1-30 characters |
| `VALIDATION_DISPLAY_NAME_CHARS` | `displayName` — contains a character that is not allowed |

*User / Avatar*

| Code | HTTP | Meaning |
|---|---|---|
| `USER_NOT_FOUND` | 404 | User does not exist |
| `AVATAR_FILE_REQUIRED` | 400 | No file in the upload |
| `AVATAR_INVALID_TYPE` | 400 | File is not a valid image (mapped to `profile.fileTypeError`) |

*Friends*

| Code | HTTP | Meaning |
|---|---|---|
| `FRIEND_INVITE_SELF` | 400 | Cannot invite yourself |
| `NOT_FRIENDS_WITH_USER` | 403 | Not friends with that user |
| `FRIEND_REQUEST_SELF` | 400 | Cannot send a request to yourself |
| `FRIEND_ALREADY` | 400 | Already friends |
| `FRIEND_REQUEST_PENDING` | 400 | Request already pending |
| `FRIEND_BLOCKED` | 403 | A block exists between the two users (send / accept / invite) |
| `FRIEND_REQUEST_COOLDOWN` | 400 | Cannot re-request — the sender was declined less than 1 h ago |
| `FRIEND_REQUEST_NOT_FOUND` | 404 | Friend request not found |
| `FRIEND_NOT_FOUND` | 404 | Friendship not found |
| `FRIEND_BLOCK_SELF` | 400 | Cannot block yourself |
| `FRIEND_BLOCK_NOT_FOUND` | 404 | Blocked record not found |

*Match / Lobby*

| Code | HTTP | Meaning |
|---|---|---|
| `MATCH_MODE_REQUIRED` | 400 | `mode` must be pvp, pve, or hotseat |
| `MATCH_BOTS_PVE_ONLY` | 400 | Bots only in PvE games |
| `MATCH_PLAYER_COUNT_RANGE` | 400 | Player count must be 2, 3 or 4 |
| `MATCH_BOT_COUNT_RANGE` | 400 | Bot count must be from 0 to playerCount - 1 |
| `MATCH_PVP_NO_BOTS` | 400 | PvP mode cannot have bots |
| `MATCH_PVE_NEEDS_BOT` | 400 | PvE mode needs at least 1 bot |
| `MATCH_HOTSEAT_NO_BOTS` | 400 | Hot seat mode cannot have bots |
| `MATCH_PVP_MIN_PLAYERS` | 400 | PvP mode needs at least 2 players |
| `MATCH_SEAT_COLORS_LENGTH` | 400 | `seatColors` has the wrong number of items |
| `MATCH_HOST_BLUE` | 400 | Host (first seat) must be blue |
| `MATCH_BOT_COLORS` | 400 | `botColors` must match `botCount` |
| `MATCH_PLAYER_COUNT_2_4` | 400 | Player count must be 2 or 4 |
| `MATCH_OWN_INVITE` | 400 | Cannot join your own invite |
| `MATCH_INVITE_INVALID` | 404 | Invite code not found or expired |
| `MATCH_GAME_NOT_FOUND` | 404 | Game not found |
| `MATCH_ALREADY_STARTED` | 403 | Game already started |
| `MATCH_PVP_ONLY_JOIN` | 403 | Only PvP rooms can be joined |
| `MATCH_ROOM_FULL` | 403 | Room is full |
| `MATCH_NOT_PLAYER` | 403 | You are not a player in this game |
| `MATCH_SEAT_EXPIRED` | 403 | The seat is finalized (grace expired / End Game) — the player can never rejoin it |
| `MATCH_PVP_ONLY_INVITE` | 403 | Only PvP rooms can be invited to |

> Every user-visible failure carries a `code`. If an error has no `code` (or a code with no `errors.<CODE>` entry), the SPA logs the English `message` to the console and shows a localized generic message instead — it never renders the server text.


---
---


## **Table of Contents**

### **HTTP APIs — Backend (NestJS)**

1. **[Auth — Account & Sessions](#1-auth--account--sessions)** — Registration, email verification, login, 2FA verify, refresh, logout, who am I
   - [`GET /api/auth/csrf`](#get-apiauthcsrf) — Bootstrap the signed CSRF token (cookie + `X-CSRF-Token` on writes)
   - [`POST /api/auth/register`](#post-apiauthregister) — Create a new account (an email-verification link is sent)
   - [`POST /api/auth/verify-email`](#post-apiauthverify-email): Confirm your email address with the token from the emailed link (sent in the body, not the URL)
   - [`POST /api/auth/login`](#post-apiauthlogin) — Log in with username/email + password (returns a 2FA prompt if enabled)
   - [`POST /api/auth/2fa/verify`](#post-apiauth2faverify) — Enter the 6-digit code emailed to you to finish logging in
   - [`POST /api/auth/refresh`](#post-apiauthrefresh) — Silently get a new access token when the current one expires
   - [`POST /api/auth/logout`](#post-apiauthlogout) — Log out and clear your session cookies
   - [`GET /api/auth/me`](#get-apiauthme) — See who the current session belongs to

2. **[Auth — Profile & Password](#2-auth--profile--password)** — Password reset, profile read/update, change password, delete account
   - [`POST /api/auth/forgot-password`](#post-apiauthforgot-password) — Request a password-reset link by email
   - [`POST /api/auth/reset-password`](#post-apiauthresetpassword) — Set a new password using the token from the reset email (sent in the body, not the URL)
   - [`GET /api/auth/profile`](#get-apiauthprofile) — Get your full profile (email, linked OAuth providers, has password)
   - [`PATCH /api/auth/profile`](#patch-apiauthprofile) — Update your username, display name, or email
   - [`PATCH /api/auth/profile/password`](#patch-apiauthprofilepassword) — Change your password while logged in
   - [`DELETE /api/auth/profile`](#delete-apiauthprofile) — Permanently delete your account (password-verified)

3. **[Auth — 2FA](#3-auth--2fa)** — Toggle two-factor authentication
   - [`PATCH /api/auth/2fa`](#patch-apiauth2fa) — Turn two-factor authentication on or off

4. **[Auth — OAuth (Google / GitHub / 42)](#4-auth--oauth-google--github--42)** — Sign in with a third-party provider
   - [`GET /api/auth/google`](#get-apiauthgoogle) — Log in with Google
   - [`GET /api/auth/google/callback`](#get-apiauthgooglecallback) — Google OAuth redirect target (browser only)
   - [`GET /api/auth/github`](#get-apiauthgithub) — Log in with GitHub
   - [`GET /api/auth/github/callback`](#get-apiauthgithubcallback) — GitHub OAuth redirect target (browser only)
   - [`GET /api/auth/42`](#get-apiauth42) — Log in with your 42 (intra) account
   - [`GET /api/auth/42/callback`](#get-apiauth42callback) — 42 OAuth redirect target (browser only)

5. **[User](#5-user)** — Public profiles, game history, avatar management
   - [`GET /api/user/:username`](#get-apiuserusername) — Look up a player's profile as the caller may see it (pair-gated)
   - [`GET /api/user/:username/games`](#get-apiuserusernamegames) — View a player's past game history
   - [`POST /api/user/avatar`](#post-apiuseravatar) — Upload a custom avatar image
   - [`GET /api/user/id/:userId/avatar`](#get-apiuseriduseridavatar) — Fetch a player's avatar image
   - [`DELETE /api/user/avatar`](#delete-apiuseravatar) — Remove your custom avatar

6. **[Match — Matchmaking](#6-match--matchmaking)** — Create/join PvP, PvE, hotseat games
   - [`POST /api/match/pvp/invite`](#post-apimatchpvpinvite) — Create a private PvP room with an invite code to share
   - [`POST /api/match/join/:code`](#post-apimatchjoincode) — Join a private PvP room using an invite code
   - [`POST /api/match/pve`](#post-apimatchpve) — Start a single-player game against bots
   - [`POST /api/match/create`](#post-apimatchcreate) — Create any game (PvP / PvE / hotseat) with full options
   - [`POST /api/match/guest`](#post-apimatchguest) — Start an anonymous PvE room (bots and rules only, no account, nothing saved)

7. **[Game Actions — Room](#7-game-actions--room)** — Ready, exit, abort, rejoin, invite
   - [`POST /api/game/:id/ready`](#post-apigameidready) — Mark yourself ready in a room so the game can start
   - [`POST /api/game/:id/exit`](#post-apigameidexit) — Leave the post-game lobby
   - [`POST /api/game/:id/abort`](#post-apigameidabort) — Cancel a game that hasn't started yet
   - [`POST /api/game/:id/rejoin`](#post-apigameidrejoin) — Reconnect to a room you're seated in (e.g. after a page refresh)
   - [`POST /api/game/:id/invite`](#post-apigameidinvite) — Invite a friend into your waiting PvP room

8. **[Game Actions — Browse](#8-game-actions--browse)** — List games/rooms, find your rooms
   - [`GET /api/games/rooms`](#get-apigamesrooms) — Browse open (joinable) PvP rooms
   - [`GET /api/games/mine`](#get-apigamesmine) — List rooms you are seated in

9. **[Game End (engine callback)](#9-game-end-engine-callback)** — Engine reports game start/end
   - [`POST /api/game/end`](#post-apigameend) — (engine) Report a finished game; triggers scoring, ratings, achievements
   - [`POST /api/game/:id/started`](#post-apigameidstarted) — (engine) Mark a game as started once the ready check passes

10. **[Leaderboard](#10-leaderboard)** — Global rankings
   - [`GET /api/leaderboard`](#get-apileaderboard) — View the global rankings (optionally highlight your own rank)

11. **[Achievements](#11-achievements)** — Achievement progress and re-check
   - [`GET /api/achievements`](#get-apiachievements) — View your achievement progress and unlock targets
   - [`POST /api/achievements/check`](#post-apiachievementscheck) — Re-evaluate your achievements (silent backfill after rule changes)

12. **[Stats](#12-stats)** — Lifetime player statistics
   - [`GET /api/stats`](#get-apistats) — View your lifetime stats (rating, wins, losses, captures, …)

13. **[Friends — Requests](#13-friends--requests)** — Send/accept/decline friend requests
   - [`POST /api/friends/request/:userId`](#post-apifriendsrequestuserid) — Send a friend request to another user
   - [`POST /api/friends/accept/:requestId`](#post-apifriendsacceptrequestid) — Accept a pending friend request
   - [`POST /api/friends/decline/:requestId`](#post-apifriendsdeclinerequestid) — Decline a pending friend request
   - [`GET /api/friends/requests`](#get-apifriendsrequests) — View pending sent/received friend requests

14. **[Friends — Manage](#14-friends--manage)** — List, remove, block, unblock friends
   - [`DELETE /api/friends/remove/:friendId`](#delete-apifriendsremovefriendid) — Remove a friend
   - [`GET /api/friends`](#get-apifriends) — List your friends (optional `?username=` filter)
   - [`POST /api/friends/block/:userId`](#post-apifriendsblockuserid) — Block a user
   - [`GET /api/friends/blocked`](#get-apifriendsblocked) — List users you have blocked
   - [`POST /api/friends/unblock/:userId`](#post-apifriendsunblockuserid) — Unblock a user

15. **[Friends — Game Invites](#15-friends--game-invites)** — Invite friends to games, pending/dismiss
   - [`POST /api/friends/:friendId/invite`](#post-apifriendsfriendidinvite) — Invite a friend to a PvP game
   - [`GET /api/friends/invites/pending`](#get-apifriendsinvitespending) — Check whether you have a pending game invite
   - [`POST /api/friends/invites/dismiss`](#post-apifriendsinvitesdismiss) — Dismiss your pending game invite

16. **[Presence](#16-presence)** — No REST routes (D11): presence rides the session socket

17. **[Notifications](#17-notifications)** — Socket frames + a Redis bell, two write routes
   - [`PATCH /api/notifications/:id/read`](#patch-apinotificationsidread) — Read one notification (the entry is deleted)
   - [`POST /api/notifications/read-all`](#post-apinotificationsread-all) — Read everything (both keys are deleted)

18. **[Health](#18-health)** — Backend/database health check
   - [`GET /health`](#get-health) — Check the backend is up (verifies database connectivity)

### WebSocket APIs — Ludo Engine

19. **[Connection](#19-connection)** — Connect to the game engine with a match token
20. **[Client → Server Events](#20-client--server-events-emit)** — What the client sends: join, roll/move, barriers, clash input, room rules, ready, end game
21. **[Server → Client Events](#21-server--client-events-on)** — What the client receives: state updates, dice/move results, game end
22. **[End-to-End Flow](#22-end-to-end-flow)** — A complete walkthrough from login to a finished game


---
---


## HTTP APIs — Backend (NestJS)

Base URL: `http://localhost:3000` (or `http://backend:3000` from Docker)

All endpoints return JSON. The backend runs on port 3000.

Auth is handled via **httpOnly cookies**:
- `token` — short-lived access token (15 min), set by login, 2FA verify, OAuth completion, or refresh
- `refresh_token` — long-lived refresh token (7 days), path-scoped to `/api/auth`

No manual `Authorization` header is needed for cookie-authenticated requests.


---
---


### 1. Auth — Account & Sessions


---
---


#### `GET /api/auth/csrf`

**Source:** `backend/src/auth/auth.controller.ts` + `backend/src/common/csrf.ts` — AuthModule

Returns the browser's CSRF token and (re)sets the readable `csrf_token` cookie. The middleware also sets the cookie on any other response when it is missing, so this route is the explicit bootstrap the SPA calls before its first mutating request.

**Headers:** None
**Response:**

```json
{
  "token": "<nonce>.<hmac>"
}
```

The cookie and the returned token are the same value; send it back as `X-CSRF-Token` on every `POST`/`PATCH`/`DELETE`. The token is signed with a key derived from `JWT_SECRET`, so a cookie planted by another origin cannot be made to validate.


---

---


#### `POST /api/auth/register`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Create a new user account and send a verification email. This call sets no session, and the account cannot sign in until the emailed link is redeemed. The signup form requires its terms tick before it calls this endpoint; the body below does not carry it.

**Headers:** None  
**Body:**

```json
{
  "username": "string (required, 3-20 chars, alphanumeric + underscore)",
  "email": "string (required, valid email)",
  "password": "string (required, 12-72 chars, must contain uppercase, lowercase, number, and special character)"
}

```

**Response:**

```json
{
  "code": "AUTH_ACCOUNT_CREATED",
  "username": "string"
}

```

**Errors:** 400 `AUTH_USERNAME_RESERVED` if the username starts with `bot-`/`bot_` (the namespace bots own); 409 `AUTH_EMAIL_TAKEN` if the email exists; 400 with a `VALIDATION_*` code if the body fails validation. See [Error responses](#error-responses).


---
---


#### `POST /api/auth/verify-email`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redeems an emailed link. The token is checked as a signup verification token (`verify:`, Redis) first, then as an email-change confirmation token (`emailchange:`, Redis). The token is strictly single-use (`GET` + `DEL`), so a second attempt with the same link reports `invalid`.

The emailed link points at the SPA (`/verify-email#token=…`), so the token travels in the **request body** and never in a URL. A URL fragment is not sent to the server, which keeps the token out of nginx's access and error logs, out of browser history, and safe from mail clients that prefetch links.

**Headers:** None  
**Body:** `token`: the 64-char hex token carried by the email link's URL fragment  
**Response:** 200 `{ result }`: the SPA maps the outcome to a landing route:

| `result` | Meaning | SPA lands on |
|----------|---------|--------------|
| `signup` | Signup address marked verified | `/login?verified=1` |
| `change` | Pending email change committed | `/profile?emailChanged=1` |
| `conflict` | Address was taken meanwhile | `/profile?error=email-taken` |
| `invalid` | Unknown, expired, or already-used token | `/login?error=invalid-verification-link` |

**Errors:** 400 with a `VALIDATION_*` code if `token` is missing or is not exactly 64 characters. See [Error responses](#error-responses).


---
---


#### `POST /api/auth/resend-verification`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Public. Resends a signup verification link if the address exists and is still unverified; the response is identical either way (no account enumeration). Throttled 3/hour.

**Headers:** None  
**Body:**

```json
{ "email": "user@example.com" }
```

**Response:** `200 { "code": "AUTH_VERIFICATION_RESENT" }`


---
---


#### `POST /api/auth/login`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Authenticate. With 2FA enabled, returns a `pendingToken` and emails a code; with 2FA disabled, sets the session cookies. An address that is not yet verified cannot sign in: the reply is a 200 notice with the code `AUTH_EMAIL_NOT_VERIFIED`.

Signing in also ends the account's other sessions (D8, one live session per account): the previous refresh token is deleted and that client's socket is closed by the revocation push, so the newest login takes the account over. Tabs of one browser share the cookie jar and are unaffected.

**Headers:** None  
**Body:**

```json
{
  "identifier": "string (required — username or email)",
  "password": "string (required)"
}

```

**Response (2FA disabled):**

```json
{
  "twoFactorRequired": false,
  "user": { "id": "uuid", "username": "string", "displayName": "string" }
}

```

**Response (2FA enabled):**

```json
{
  "twoFactorRequired": true,
  "pendingToken": "hex-string"
}

```

**Response (address not verified):** HTTP 200, and no session cookies are set.

```json
{
  "code": "AUTH_EMAIL_NOT_VERIFIED"
}

```

**Errors:** 401 `AUTH_INVALID_CREDENTIALS` when the identifier or password is wrong. An unverified address is not an error: it returns the 200 notice above, so the browser logs no failed request. The same 401 covers a locked identifier: a refusal is not distinguished from a wrong password.

**Per-account lockout (`LoginLockoutService`):** failures are counted against the identifier, not the caller's address, so rotating proxies does not buy extra guesses at one account. From the 5th failure the next attempt is held back by `min(2^n, 30)` s (2, 4, 8, 16, then 30) before the password is checked, and from the 10th the identifier is refused for 15 minutes (further attempts do not extend that window); a correct password deletes the counter. An identifier that never existed is counted and delayed identically, so the response says nothing about which accounts exist. Clients should not retry a 401 in a loop: the per-address throttle answers `429` as well.


---
---


#### `POST /api/auth/2fa/verify`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redeem a 2FA code emailed during login. Sets session cookies on success.

**Headers:** None  
**Body:**

```json
{
  "pendingToken": "string (64-char hex)",
  "code": "string (6 digits)"
}

```

**Response:**

```json
{
  "user": { "id": "uuid", "username": "string", "displayName": "string" }
}

```

**Errors:** 401 `AUTH_CODE_INVALID` if the code is invalid/expired or there were too many attempts; 400 `VALIDATION_CODE_FORMAT` if the code is not 6 digits.


---
---


#### `POST /api/auth/2fa/resend`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Re-issue the 2FA login code for a live challenge (same `pendingToken`; the previous code is invalidated). The `pendingToken` is the credential: no session required. Throttled per-IP, plus a per-user cap of **3 resends per hour**.

**Headers:** None  
**Body:**

```json
{ "pendingToken": "string (64-char hex)" }
```

**Response:** `200 { "code": "AUTH_CODE_RESENT" }`

**Errors:** `400 AUTH_CODE_EXPIRED` if the challenge lapsed; `429 AUTH_CODE_RESEND_LOCKED` if the per-user resend cap is hit.


---
---


#### `POST /api/auth/refresh`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Silent re-authentication. Trade a valid refresh token for a fresh access token + rotated refresh token.

**Headers:** None (refresh_token cookie is sent automatically)  
**Body:** None  
**Response:**

```json
{
  "user": { "id": "uuid", "username": "string", "displayName": "string" }
}

```

**Errors:** 401 `AUTH_NOT_AUTHENTICATED` when the refresh cookie is absent; 401 `AUTH_SESSION_EXPIRED` for an unknown/expired token; 401 `AUTH_SESSION_REUSED` when an already-rotated token is presented outside the 15 s two-tab grace window — the server then revokes **every** session for that user. A rotation inside the grace window whose replacement is still live is treated as the cross-tab race and returns `AUTH_SESSION_EXPIRED` without revoking anything, so the SPA's `/me` probe can settle it.

A rotation does not end the account's other sessions by surprise: it mints through the same `issue`, but its own consumed hash is already out of `sessions:<userId>` by then, so there is nothing to evict and no revocation is published.


---
---


#### `POST /api/auth/logout`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Revoke the refresh token and clear both cookies.

**Headers:** None  
**Body:** None  
**Response:**

```json
{
  "ok": true
}

```


---
---


#### `GET /api/auth/me`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Return the current user from the access token cookie.

**Headers:** 🔒 (requires `token` cookie)  
**Response:** the same shape as `GET /api/auth/profile`'s `user` (the handler delegates to the same service method):

```json
{
  "user": {
    "id": "uuid",
    "username": "string",
    "displayName": "string",
    "email": "string | null",
    "hasPassword": true,
    "avatarStyle": "bottts",
    "hasAvatarPhoto": false,
    "providers": ["google"]
  }
}

```


---
---


### 2. Auth — Profile & Password


---
---


#### `POST /api/auth/forgot-password`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Email a password-reset link. Response is identical whether or not the email is registered (no account enumeration).

**Headers:** None  
**Body:**

```json
{
  "email": "string (valid email)"
}

```

**Response:**

```json
{
  "code": "AUTH_RESET_LINK_SENT"
}

```


---
---


#### `POST /api/auth/reset-password`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redeem a reset token and set a new password. Redeeming the emailed link also marks the address as verified, so an account that had not verified yet can sign in afterwards.

The emailed link points at the SPA (`/reset-password#token=…`), so the token travels in the **request body** and never in a URL. A URL fragment is not sent to the server, which keeps the token out of the proxy access and error logs, out of browser history, and safe from mail clients that prefetch links.

**Headers:** None  
**Body:**

```json
{
  "token": "string (64-char hex)",
  "password": "string (12-72 chars, same policy as registration)"
}

```

**Response:**

```json
{
  "code": "AUTH_PASSWORD_RESET"
}

```

**Errors:** 401 if token is invalid or expired.


---
---


#### `GET /api/auth/profile`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Return the full profile for the logged-in user (used by the Edit-Profile card).

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
{
  "user": {
    "id": "uuid",
    "username": "username",
    "displayName": "Display Name",
    "email": "user@example.com",
    "hasPassword": true,
    "avatarStyle": "bottts",
    "hasAvatarPhoto": false,
    "providers": ["google", "github", "42"]
  }
}

```


---
---


#### `PATCH /api/auth/profile`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Update the logged-in user's profile (display name, email, 2FA toggle, OAuth link/unlink). **Email changes are verify-then-commit**: the new address is *not* applied until the emailed link is opened; the current address stays active meanwhile.

**Headers:** 🔒 (requires `token` cookie)  
**Body:** (any subset of the editable fields, validated by `UpdateProfileDto`)

```json
{
  "displayName": "New Display Name",
  "email": "new@example.com",
  "currentPassword": "required with any sensitive change (password accounts): email, 2FA, OAuth link/unlink",
  "twoFactorEnabled": true,
  "oauthToAdd": "google",
  "oauthToRemove": "github"
}
```

- Changing the email requires the account to have a password **and** `currentPassword`; OAuth-only accounts get `400 AUTH_EMAIL_CHANGE_SET_PASSWORD`, a wrong password `401 AUTH_CURRENT_PASSWORD_INCORRECT`.
- **Re-auth:** a password account must also send `currentPassword` to toggle 2FA or to unlink an OAuth provider (and to use the `oauthToAdd` field). The SPA's "Add" button opens the provider's own login, which is itself a fresh authentication. OAuth-only accounts have no password to confirm and are trusted through the active session. A missing or wrong password is `401 AUTH_CURRENT_PASSWORD_INCORRECT`.
- Rate-limited to **3 email changes/hour** per user → `429 AUTH_EMAIL_CHANGE_RATE_LIMITED`.

**Response:**

```json
{
  "user": { "id": "…", "username": "…", "displayName": "…", "email": "current@example.com", "hasPassword": true, "providers": ["google"] },
  "emailChangePending": true,
  "pendingEmail": "new@example.com",
  "oauthRedirectUrl": null
}
```

`user.email` stays the **current** address while a change is pending. A bad `displayName` returns 400 with `VALIDATION_DISPLAY_NAME_LENGTH` / `VALIDATION_DISPLAY_NAME_CHARS`; a name that impersonates a bot (starts with `bot-`) returns `400 AUTH_DISPLAY_NAME_RESERVED`.


---
---


#### `POST /api/auth/profile/resend-email-change`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Resend the pending email-change confirmation link. Rotates the token (invalidating the previous link) and re-emails the pending address. Throttled 5/hour.

**Headers:** 🔒 (requires `token` cookie)  
**Body:** none  
**Response:** `200 { "pendingEmail": "new@example.com" }`  
**Errors:** `400 NO_PENDING_EMAIL_CHANGE` when there is no pending change.


---
---


#### `PATCH /api/auth/profile/password`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Change the password while logged in (requires the current password).

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "currentPassword": "old-password",
  "newPassword": "new-password"
}

```

**Response:** changing the password also signs out every other device (the SPA shows a localized notice).

```json
{
  "code": "AUTH_PASSWORD_UPDATED"
}

```


---
---


#### `DELETE /api/auth/profile`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Permanently delete the current account. Requires explicit confirmation plus the
account password (OAuth-only accounts must set a password first via the
change-password flow).

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "currentPassword": "current-password",
  "confirm": true
}

```

**Response:** clears both session cookies, so the browser ends logged out.

```json
{ "code": "AUTH_ACCOUNT_DELETED" }

```

**Errors:** 400 if `confirm` is not `true`; 403 if the account has no password set; 401 if the password is wrong.


---
---


### 3. Auth — 2FA


---
---


#### `PATCH /api/auth/2fa`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Toggle the user's 2FA preference. There is no `GET` counterpart: the current value already rides on
`GET /api/auth/me` and `GET /api/auth/profile` as `twoFactorEnabled`, which is where the Edit-Profile
card reads it.

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "enabled": true,
  "currentPassword": "required for a password account (ignored for OAuth-only)"
}

```

**Response:**

```json
{
  "twoFactorEnabled": true
}

```

**Errors:** `401 AUTH_CURRENT_PASSWORD_INCORRECT` when the toggle changes and the supplied password is wrong; `429 RATE_LIMITED` above 10 toggles/hour.


---
---


### 4. Auth — OAuth (Google / GitHub / 42)


---
---


#### `GET /api/auth/google`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redirect to Google OAuth consent screen.

**Headers:** None  
**Response:** 302 redirect.


---
---


#### `GET /api/auth/google/callback`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Google OAuth callback. Do not call directly.

**Headers:** None  
**Response:** 302 redirect to `FRONTEND_URL`.


---
---


#### `GET /api/auth/github`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redirect to GitHub OAuth consent screen.

**Headers:** None  
**Response:** 302 redirect.


---
---


#### `GET /api/auth/github/callback`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

GitHub OAuth callback. Do not call directly.

**Headers:** None  
**Response:** 302 redirect to `FRONTEND_URL`.


---
---


#### `GET /api/auth/42`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redirect to 42 (intra) OAuth consent screen.

**Headers:** None  
**Response:** 302 redirect.


---
---


#### `GET /api/auth/42/callback`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

42 OAuth callback. Do not call directly.

**Headers:** None  
**Response:** 302 redirect to `FRONTEND_URL`.


---
---


### 5. User


---
---


#### `GET /api/user/:username`

**Source:** `backend/src/user/user.controller.ts` — UserModule

Get a user's profile, **as the caller is allowed to see it**: every render is gated by the friendship pair, not by the click that opened the page.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:username` = username string  
**Response:**

```json
{
  "id": "uuid",
  "username": "string",
  "displayName": "string",
  "createdAt": "ISO-date-string",
  "avatarStyle": "string",
  "avatarV": 1793376265279,
  "rating": 0,
  "highestRating": 0,
  "wins": 0,
  "losses": 0,
  "winStreak": 0,
  "bestWinStreak": 0,
  "botWins": 0,
  "humanWins": 0,
  "hasAvatarPhoto": false,
  "status": "online | playing | offline",
  "visibility": "full"
}
```

`avatarV` is the shared avatar record's change stamp (`avatar:<userId>.v`): the client appends it as `?v=` to the photo URL, so a stale image is never reused and the stamp does not move on a read.

**A block between the caller and the target degrades the payload instead of failing it** — `200`, no stats, no presence:

```json
{
  "id": "uuid",
  "username": "string",
  "displayName": "string",
  "avatarStyle": "string",
  "avatarV": 1793376265279,
  "hasAvatarPhoto": false,
  "visibility": "blocked-by-you | blocked-by-them"
}
```

`blocked-by-you` means the caller holds a block (the page offers **Unblock** via `POST /api/friends/unblock/:userId`, then refetches); `blocked-by-them` renders *"You have been blocked by this user."* A mutual block reads as `blocked-by-you`, because the caller's own block is still there to lift. The avatar is kept on purpose: a block hides the relationship, not the person.

**Errors:** 401 (no session); 404 if user not found. A block is **never** a 403 here — see the three collateral reads below.


---
---


#### `GET /api/user/:username/games`

**Source:** `backend/src/user/user.controller.ts` — UserModule

Get a user's game history.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:username` = username string  
**Query Params:**
| Param | Type | Default | Max |
|---|---|---|---|
| `page` | integer | `1` | — |
| `limit` | integer | `20` | `100` |

**Response:**

```json
{
  "games": [
    {
      "gameId": "uuid",
      "status": "COMPLETED | ABANDONED",
      "gameType": "PVP | PVE",
      "color": "RED | GREEN | YELLOW | BLUE",
      "rank": 1,
      "piecesCaptured": 3,
      "piecesInGoal": 4,
      "ratingDelta": 5,
      "startedAt": "ISO-date-string",
      "endedAt": "ISO-date-string",
      "participants": [
        {
          "username": "string",
          "displayName": "string",
          "avatarStyle": "bottts",
          "hasAvatarPhoto": false,
          "color": "RED",
          "rank": 1,
          "piecesInGoal": 4
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 42,
    "totalPages": 3
  }
}

```

**Errors:** 401 (no session); 404 if user not found; **403 `FRIEND_BLOCKED`** when a block exists between the caller and the target (any direction). The profile page skips this read when `visibility !== 'full'`; the 403 is what stops a deep link or `curl`.


---
---


#### `POST /api/user/avatar`

**Source:** `backend/src/user/user.controller.ts` — UserModule

Upload an avatar image (max 2 MB, PNG/JPEG/GIF/WebP).

**Headers:** 🔒 (requires `token` cookie)  
**Content-Type:** `multipart/form-data`  
**Body:** `avatar` file field  
**Response:**

```json
{
  "contentType": "image/png"
}

```

**Errors:** 400 `AVATAR_FILE_REQUIRED` (no file) or `AVATAR_INVALID_TYPE` (not a PNG/JPEG/GIF/WebP); 400 if the file exceeds 2 MB.


---
---


#### `GET /api/user/id/:userId/avatar`

**Source:** `backend/src/user/user.controller.ts` — UserModule

Retrieve a user's custom avatar image, keyed by the **immutable user id** — a display-name rename can therefore never invalidate an avatar URL. Signed-in only, but deliberately **not** pair-gated: the bytes are not a capability (the same picture is on the leaderboard), so a blocked profile keeps its avatar.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:userId` = user id  
**Response:** Binary image data with `Content-Type` set to the stored MIME type, served with `Cache-Control: public, no-cache, no-transform` plus an `ETag`. The base URL is stable, so an unchanged photo is answered `304` on revalidation. When a change is announced to that user's own clients (the socket `avatar_changed` frame, pushed with `notifyTransient()` to the owner alone, or the uploader's own client) the client appends `?v=<stamp>`, which forces a real fetch — a byte-identical URL can otherwise be served from the browser's in-memory image cache without any request, so `no-cache` alone would never revalidate.

**Errors:** 401 (no session); `404` when no custom avatar is set, sent with `Cache-Control: no-store` so a "no photo" answer is never cached and replayed.


> Full pipeline — storage layers, the shared Redis record, caching and freshness rules, seat
> rendering: [`avatar-system.md`](avatar-system.md).


---
---


#### `DELETE /api/user/avatar`

**Source:** `backend/src/user/user.controller.ts` — UserModule

Delete the current user's custom avatar.

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
{
  "ok": true
}

```


---
---


### 6. Match — Matchmaking

Match responses share a handoff shape: `{ gameId, token, engineUrl, color, mode, playerCount }`, plus `inviteCode` for invite games. The guest route adds `isGuest: true` and returns an opaque `g_` token instead of a JWT.

- `gameId`: UUID of the new/pending match
- `token`: JWT to use when connecting to ludo-engine via Socket.IO
- `engineUrl`: the Socket.IO endpoint name, derived from `FRONTEND_URL` (`ENGINE_WS_URL`, prefix `http` → `ws`, so `wss://localhost:8443` with the example `.env`). The SPA does not use it to connect, it connects to its own origin.
- `color`: the seat colour the caller was given
- `mode`: `pvp`, `pve`, or `hotseat`
- `playerCount`: `2`, `3`, or `4`
- `inviteCode`: 6-char shareable code (invite games only, and only when the room has one)

To connect to the engine:

```js
const io = require('socket.io-client');
const socket = io(window.location.origin, { // same-origin → nginx → ludo-engine
  auth: { token: '<token-from-response>' },
  transports: ['websocket'],
});

```


---
---


#### `POST /api/match/pvp/invite`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Create a PvP invite game with a shareable code.

**Headers:** 🔒 (requires `token` cookie)  
**Body:** all fields optional — the three room rules, defaulting to a standard room:

```json
{
  "clashEnabled": false,
  "noSafeZones": false,
  "freeExit": false
}

```

**Response:**

```json
{
  "gameId": "uuid",
  "inviteCode": "ABCD12",
  "token": "jwt-string",
  "engineUrl": "wss://localhost:8443",
  "color": "blue",
  "mode": "pvp",
  "playerCount": 4
}

```

**Notes:**
- Share `inviteCode` via chat/friend list.
- Recipient joins via `POST /api/match/join/:code`.
- Follows the same create-or-reuse path as `POST /api/match/create`: if you already sit in one of your own `WAITING` PvP rooms, that room (and its existing invite code) is handed back instead of a second room being created.
- `clashEnabled` turns the clash QTE on, `noSafeZones` makes star squares capture-able, and `freeExit` lets any roll leave prison (the exit square counts as part of the roll). The rules are frozen when the room is created; the host can still change them from the lobby panel while the room is `WAITING` (`update_modifiers`, see §20).


---
---


#### `POST /api/match/join/:code`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Join a PvP game by invite code.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:code` = 6-char invite code  
**Body:** None

**Response:**

```json
{
  "gameId": "uuid",
  "token": "jwt-string",
  "engineUrl": "wss://localhost:8443",
  "color": "red",
  "inviteCode": "ABCD12",
  "mode": "pvp",
  "playerCount": 4
}

```

**Errors:** 404 `MATCH_INVITE_INVALID` when no WAITING room carries that code (not found or expired); 403 `MATCH_ROOM_FULL` if the last seat was taken between the lookup and the assignment; 400 `MATCH_OWN_INVITE` when you are the host; 403 `MATCH_ALREADY_STARTED` when the room's game already started (the stored hash is `ACTIVE`, or the engine's ready-check already flipped the game state out of `waiting`) or when your own seat in that room has been finalized (`MATCH_SEAT_EXPIRED`).

If the caller already holds a seat in that room, the rejoin rules apply and their **existing** seat and colour are returned instead of a new slot being allocated.


---
---


#### `POST /api/match/pve`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Start a PvE (vs bot) game.

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "playerCount": 2
}

```

**Response:**

```json
{
  "gameId": "uuid",
  "token": "jwt-string",
  "engineUrl": "wss://localhost:8443",
  "color": "blue",
  "mode": "pve",
  "playerCount": 2
}

```

**Notes:**
- Game is `ACTIVE` immediately.
- Bots fill remaining slots automatically.
- `playerCount` must be 2 or 4.


---
---


#### `POST /api/match/create`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Unified match creation — supports PvP, PvE, and hotseat modes.

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "mode": "pvp",
  "playerCount": 2,
  "botCount": 0,
  "botColors": ["red", "green"],
  "botNames": ["Siri", "Alexa"],
  "seatColors": ["yellow", "blue"],
  "clashEnabled": false,
  "noSafeZones": false,
  "freeExit": false
}

```

**Response:**

```json
{
  "gameId": "uuid",
  "token": "jwt-string",
  "engineUrl": "wss://localhost:8443",
  "color": "blue",
  "mode": "pvp",
  "playerCount": 2,
  "inviteCode": "ABCD12"
}

```

**Notes:**
- `mode` is **required** and must be `pvp`, `pve`, or `hotseat` (no silent fallback).
- `playerCount` accepts 2-4; `botCount` must be 0 to `playerCount-1`. Bots are only allowed in PvE games.
- `botColors` / `seatColors` (optional string arrays) can override the default slot colors. Seat `color` is otherwise assigned by the server.
- `botNames` (optional string array) is index-aligned with `botColors`. Each entry is the name the lobby gave that bot: the backend stores it as `player{n}_displayName` in the form `bot-<color> (<assistant>)`, so every client shows the lobby's own assistant name. An entry that is missing, blank or unusable is dropped, and the seat then shows its plain `bot-<color>` id. The stored label is not translated, so clients re-localize the colour word with the `lobby.color*` keys and keep the assistant name as sent.
- **Reuse:** creating a `pvp` room while you already sit in one of your own still-`WAITING` PvP rooms hands that room back — the response carries its `gameId`, `inviteCode` and your existing seat colour, and nothing in the stored room is modified. A room whose game has already started (engine state is anything but `waiting`, or your seat in it is finalized) is never reused: a fresh room is created instead, so a player who left a live game can start or join another one while their old seat stays ghosted.
- `pve`/`hotseat` always create a fresh room (they start `ACTIVE` and are never reused).
- `clashEnabled`, `noSafeZones` and `freeExit` are the three room rules (all optional, default `false` = standard room). They are written in the same call that creates the room, so no room ever exists without its rules; `room-rules.ts` coerces the raw body values to booleans. While the room is `WAITING`, the host can change them from the lobby panel (`update_modifiers`, see §20).


---
---


#### `POST /api/match/guest`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Start an anonymous PvE game. This is the public door behind the login screen's **Play as guest** button.

**Headers:** public (no session cookie). The write still carries CSRF, and it is limited twice: nginx's `guest` zone (10 r/m, burst 5) and the route's own throttler (20/min).  
**Body:** `botCount` is required; everything else is optional.

```json
{
  "botCount": 2,
  "botColors": ["green", "red"],
  "botNames": ["Siri", "Alexa"],
  "clashEnabled": false,
  "noSafeZones": false,
  "freeExit": false
}
```

**Response:**

```json
{
  "gameId": "uuid",
  "token": "g_…",
  "engineUrl": "wss://localhost:8443",
  "color": "blue",
  "mode": "pve",
  "playerCount": 3,
  "rules": { "clashEnabled": false, "noSafeZones": false, "freeExit": false },
  "isGuest": true
}
```

**Errors:** 400 on a bad body (a `botCount` outside 1-3, or a duplicate or unknown bot colour); 429 `GUEST_LIMITED` when the address has spent its 6 h budget or already holds 3 live rooms; 429 `GUEST_CAPACITY` when the deployment holds 50 live guest rooms.

**Notes:**
- The mode is forced to `pve` and the human seat is always `blue`. `mode`, `playerCount`, `seatColors` and `gameId` are not accepted fields.
- `token` is an opaque `g_` token, not a JWT: the engine resolves it from Redis (`guesttok:<sha256>`) and it opens no backend route. It lives for 1 h and is revoked when the room is aborted.
- The seat id is `guest-<sha256(token)>`, unique per mint, so a shared campus address never receives another guest's `MATCH_ACTIVE_GAME` refusal.
- Nothing is saved: no `Game`, `GameParticipant`, counter, achievement or leaderboard row. The response has no `inviteCode`, and the room accepts no join.
- Limits, settlement and the frontend flow are documented in [guest-mode.md](guest-mode.md).


---
---


### 7. Game Actions — Room


---
---


#### `POST /api/game/:id/ready`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Signal that the current player is ready.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:id` = gameId  
**Body:** None  
**Response:**

```json
{
  "gameId": "uuid",
  "readyCount": 1,
  "totalPlayers": 2,
  "allReady": false
}
```

**Errors:** 404 `MATCH_GAME_NOT_FOUND` if the room is gone; 403 `MATCH_NOT_PLAYER` if the caller holds no seat.

```


---
---


#### `POST /api/game/:id/exit`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Acknowledge leaving the game (after game has ended).

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:id` = gameId  
**Body:** None  
**Response:**

```json
{
  "gameId": "uuid"
}
```

**Errors:** 404 `MATCH_GAME_NOT_FOUND` if the room is gone; 403 `MATCH_NOT_PLAYER` if the caller holds no seat.

```


---
---


#### `POST /api/game/:id/abort`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Cancel an unstarted game (while still in WAITING state).

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:id` = gameId  
**Body:** None  
**Response:**

```json
{
  "gameId": "uuid"
}

```

**Errors:** 404 if game not found, 403 if user is not a player.


---
---


#### `POST /api/game/:id/invite`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Invite a friend into a WAITING PvP room.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:id` = gameId  
**Body:**

```json
{ "friendId": "user-id" }

```

**Response:**

```json
{
  "gameId": "uuid"
}
```

**Errors:** 400 validation if `friendId` is missing or not a UUID; 404 `MATCH_GAME_NOT_FOUND` if the
room is gone; 403 `MATCH_PVP_ONLY_INVITE` for a non-PvP room; 403 `MATCH_ALREADY_STARTED` once the
room has left WAITING; 403 `MATCH_NOT_PLAYER` if the caller holds no seat; 403 `FRIEND_BLOCKED` when a
block exists between the caller and the target; 403 `NOT_FRIENDS_WITH_USER` when the target is not a
friend; 403 `MATCH_ROOM_FULL` if no seat is left for the friend.


---
---


### 8. Game Actions — Browse


---
---


#### `GET /api/games/rooms`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

List the PvP rooms the caller may enter. **This is the first-paint read now**: the same list is
pushed as `rooms:list` over the session socket whenever a room changes, and the lobby does not poll.
The list is computed **per caller**:

- **Join rows** (`mySeat: false`) — PvP rooms stored as `WAITING` whose engine game has not started and
  which are not full.
- **Rejoin rows** (`mySeat: true`) — rooms the caller holds a seat in, **including games that have
  already started**: their seat is kept for the 45 s grace window after they leave the table
  ("RETURN TO LOBBY"), so they can come back to it. Such a row is returned even when the room is full,
  and stops being returned once the engine finalizes that seat.

A started room is therefore hidden from everybody except the players who still hold a reclaimable seat
in it, and `ABORTED` rooms are never returned. The engine state, not just the stored hash,
decides whether a game has started (see `isEngineGameStarted` in `backend-match-module.md`).

**Headers:** 🔒 (requires `token` cookie)  
**Response:** Array of room summaries — `id`, `roomCode`, `hostId`, `host`, `hostUsername`,
`hasAvatarPhoto`, `seats`, `maxSeats`, `mode`, `mySeat`, and the room's three rules as
`clashEnabled`, `noSafeZones`, and `freeExit`. The rules are read from the same `match:*` hash fields
the create route wrote (`readRoomRules`), so a room created before the fields existed reads as the
standard room: `false`, `false`, `false` (clash off, free exit off, safe zones protecting — the
safe-zone flag is stored inverted). The lobby renders them as the room browser's MODES cell.


---
---


#### `GET /api/games/mine`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

List rooms (WAITING/ACTIVE) the current user is seated in — used to rejoin after a refresh. **This is
the first-paint read now**: the same list is pushed as `rooms:mine` over the session socket whenever
it changes (the navbar's rejoin banner subscribes to it). A room whose seat the engine has
**finalized** (grace expired / End Game — `PlayerMeta.status` is `exited`) is filtered out via the
snapshot's `finalizedIds`, so a departed player is not offered a REJOIN MATCH button they can no
longer use. The seat is checked whatever the stored hash status says: a room whose hash still reads
`WAITING` can have live engine state behind it.

**Headers:** 🔒 (requires `token` cookie)  
**Response:** Array of the user's room summaries.


---
---


#### `POST /api/game/:id/rejoin`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Rejoin a room the user is seated in (after a refresh).

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:id` = gameId  
**Body:** None  
**Response:**

```json
{
  "gameId": "uuid",
  "token": "jwt-string",
  "engineUrl": "wss://localhost:8443",
  "color": "red",
  "inviteCode": "ABCD12",
  "mode": "pvp",
  "playerCount": 4
}
```

`color` is the seat's colour, and `mode` / `playerCount` describe the room. `inviteCode` is present
only when the room has one.

**Errors:** 404 if game not found, 403 `MATCH_NOT_PLAYER` if the caller holds no seat, and 403
`MATCH_SEAT_EXPIRED` when the seat has been finalized (the engine parked every piece at `step = -1`),
so no fresh token is minted for a seat that can never move again. The seat is checked regardless of the
stored hash status (`isSeatFinalized` in `backend-match-module.md`), so a hash that was rewritten back
to `WAITING` cannot resurrect a dead seat.


---
---


### 9. Game End (engine callback)


---
---


#### `POST /api/game/end`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Called by ludo-engine when a game finishes. 🤖 Does not require JWT — authenticated via `x-engine-key` header. The payload lists the **human seats that finished**: bots and seats nobody took are not sent. Each seat also carries its clash-mode tallies (`clashDefends`, `clashAttacksWon`), both optional and 0 by default. The engine additionally sends `totalTurns`, which this handler ignores.

**Headers:** `x-engine-key: <ENGINE_API_KEY>`  
**Body:**

```json
{
  "gameId": "uuid",
  "participants": [
    {
      "userId": "string (account id)",
      "color": "'RED'|'GREEN'|'YELLOW'|'BLUE'",
      "rank": 1,
      "piecesCaptured": 3,
      "piecesInGoal": 4,
      "clashDefends": 2,
      "clashAttacksWon": 0
    }
  ]
}

```

**Response:**

```json
{
  "message": "Game processed",
  "gameId": "uuid"
}

```

**Errors:** 400 if `gameId` is missing, `participants` is missing or empty, a PvP result carries fewer than 2 human entries, or no entry holds an account. The backend applies the same bot rule as the engine: a seat the room hash flags `player<N>_isBot` is dropped before anything is written, and the PvP minimum counts what is left, so a bot never stands in for the second player (`MATCH_END_PVP_MIN_PLAYERS`). A participant whose id has no `User` row is skipped too (`user_id` is a foreign key), and when that leaves nobody the request answers `MATCH_END_PLAYERS_REQUIRED` before the transaction, so no bare `Game` row is left behind. Re-sending the same `gameId` is safe (idempotent — returns `"Game already processed"` without double-awarding points).

**Side effects:**
- Writes the `Game` row and one `GameParticipant` row per participant that survives the bot flag and holds an account
- Updates each of those participants' `User` row: `rating` (clamped at 0), `highestRating`, `wins`, `losses`, `humanWins`, `botWins`, `winStreak`, `bestWinStreak`, `pveGameStreak` (scoring via `ratingDeltaFor()`)
- Evaluates achievements for all participants (fires unlock notifications)
- Sends a `match_finished` notification to every scored participant
- Updates the Redis `leaderboard:global` sorted set, one member per scored participant
- Deletes `match:{gameId}` from Redis


---
---


#### `POST /api/game/:id/started`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Called by ludo-engine once the ready-check passes and the game transitions to ACTIVE. 🤖 Authenticated via `x-engine-key` header.

**Headers:** `x-engine-key: <ENGINE_API_KEY>`  
**Path:** `:id` = gameId  
**Body:** None  
**Response:**

```json
{
  "message": "Game marked active",
  "gameId": "uuid"
}
```

The room's Redis status is set to `ACTIVE`, and `startedAt` is stamped once (the first call wins).
If the room is no longer in Redis the call answers `{ "message": "Game not found", "gameId": "uuid" }`.


---
---


### 10. Leaderboard


---
---


#### `GET /api/leaderboard`

**Source:** `backend/src/leaderboard/leaderboard.controller.ts` — LeaderboardModule

Get paginated leaderboard rankings.

**Headers:** 🔒 JWT (required) — the logged-in user is highlighted via `myRank`  
**Query Params:**
| Param | Type | Default | Max |
|---|---|---|---|
| `mode` | `global` \| `ranked` \| `casual` \| `bot` | `global` | — |
| `page` | integer | `1` | — |
| `limit` | integer | `20` | `100` |

**Response:**

```json
{
  "entries": [
    {
      "rank": 1,
      "id": "uuid",
      "username": "string",
      "displayName": "string",
      "rating": 1500,
      "gamesPlayed": 42,
      "wins": 30,
      "losses": 12,
      "draws": 0,
      "winRate": 71,
      "avatarStyle": "bottts",
      "hasAvatarPhoto": false
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "myRank": {
    "rank": 12,
    "username": "you",
    "displayName": "You",
    "rating": 1540
  },
  "source": "redis"
}

```


---
---


### 11. Achievements


---
---


#### `GET /api/achievements`

**Source:** `backend/src/achievements/achievements.controller.ts` — AchievementsModule

Get the current user's achievement report (unlocked state + progress + target per achievement).

**Headers:** 🔒 (requires `token` cookie)  
**Query Params:** optional `?username=<username>` returns another user's achievement report.  
**Errors:** 401 (no session); **403 `FRIEND_BLOCKED`** when a block exists between the caller and `?username=`'s user.
**Response:**

```json
{
  "achFirstBlood": { "unlocked": false, "progress": 0, "target": 1 },
  "achOnFire": { "unlocked": false, "progress": 0, "target": 2 },
  "achDiceMaster": { "unlocked": false, "progress": 0, "target": 3 },
  "achBabySteps": { "unlocked": false, "progress": 0, "target": 1 },
  "achTheDiceLoveMe": { "unlocked": false, "progress": 0, "target": 3 },
  "achTactician": { "unlocked": false, "progress": 0, "target": 5 },
  "achMaster": { "unlocked": false, "progress": 0, "target": 8 },
  "achGrandBotMaster": { "unlocked": false, "progress": 0, "target": 12 },
  "achWorldChampion": { "unlocked": false, "progress": 0, "target": 15 },
  "achft_Transcendence": { "unlocked": false, "progress": 0, "target": 10 },
  "achLoveTheMachine": { "unlocked": false, "progress": 0, "target": 3 },
  "achSpeedDemon": { "unlocked": false, "progress": 0, "target": 1 },
  "achUnstoppable": { "unlocked": false, "progress": 0, "target": 3 }
}

```

**Achievement reference** (from `achievements.registry.ts`):

| Field | Type | Condition |
|---|---|---|
| `achFirstBlood` | lifetime | 1 win |
| `achOnFire` | lifetime | 2-game win streak |
| `achDiceMaster` | lifetime | 3 wins |
| `achBabySteps` | lifetime | 1 bot win |
| `achTheDiceLoveMe` | lifetime | 3 bot wins |
| `achTactician` | lifetime | 5 wins |
| `achMaster` | lifetime | 8 wins |
| `achGrandBotMaster` | lifetime | 12 wins |
| `achWorldChampion` | lifetime | 15 wins |
| `achft_Transcendence` | lifetime | 10 human wins |
| `achLoveTheMachine` | lifetime | 3-game PvE streak |
| `achSpeedDemon` | per-game | Win in under 30 minutes |
| `achUnstoppable` | per-game | Capture ≥ 3 pieces in one game |


---
---


#### `POST /api/achievements/check`

**Source:** `backend/src/achievements/achievements.controller.ts` — AchievementsModule

Force re-evaluate achievements for the current user.

**Headers:** 🔒 (requires `token` cookie)  
**Body:** None  
**Response:**

```json
{
  "unlocked": ["achFirstBlood"]
}

```

The `unlocked` array contains the **keys** of any achievements newly unlocked by this evaluation (e.g. `achFirstBlood`). This backfill runs silently (`announce=false` — no notification burst fires).


---
---


### 12. Stats


---
---


#### `GET /api/stats`

**Source:** `backend/src/player-stats/stats.controller.ts` — StatsModule

Get player statistics for the current user.

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
{
  "rating": 1200,
  "highestRating": 1240,
  "totalGames": 42,
  "wins": 20,
  "losses": 22,
  "totalCaptures": 85,
  "totalPiecesInGoal": 168,
  "avgCapturesPerGame": 2.0
}

```


---
---


### 13. Friends — Requests

All friend endpoints require JWT auth via cookie.


---
---


#### `POST /api/friends/request/:userId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Send a friend request.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:userId` = target user ID  
**Body:** None  
**Response:** Returns the full friendship object with user and friend details.

**Errors:** 400 `FRIEND_REQUEST_SELF` / `FRIEND_ALREADY` / `FRIEND_REQUEST_PENDING` / `FRIEND_REQUEST_COOLDOWN`; 403 `FRIEND_BLOCKED`; 404 `USER_NOT_FOUND`.


---
---


#### `POST /api/friends/accept/:requestId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Accept a friend request.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:requestId` = request UUID  
**Body:** None  
**Response:** Returns the updated friendship object with user and friend details.

**Errors:** 404 `FRIEND_REQUEST_NOT_FOUND` when the pair row does not exist or the caller has no live
inbound request; 403 `FRIEND_BLOCKED` when either side has blocked the other.


---
---


#### `POST /api/friends/decline/:requestId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Decline a friend request.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:requestId` = request UUID  
**Body:** None  
**Response:** `{ "ok": true }`

**Errors:** 404 `FRIEND_REQUEST_NOT_FOUND` when the pair row does not exist or the caller has no live
inbound request.


---
---


#### `GET /api/friends/requests`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Get pending friend requests (both sent and received).

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
{
  "sent": [
    {
      "id": "request-uuid",
      "userId": "friend-user-id",
      "username": "string",
      "displayName": "string",
      "avatarStyle": "bottts",
      "avatarV": 1793404582884,
      "createdAt": "ISO-date-string"
    }
  ],
  "received": [
    {
      "id": "request-uuid",
      "userId": "sender-user-id",
      "username": "string",
      "displayName": "string",
      "avatarStyle": "bottts",
      "avatarV": 1793404582884,
      "createdAt": "ISO-date-string"
    }
  ]
}

```

`id` is the pair row id, which is what `accept`/`decline` take. First-paint read only: a new or
withdrawn request arrives as `friendship:changed` (see [`GET /api/friends`](#get-apifriends)).


---
---


### 14. Friends — Manage


---
---


#### `DELETE /api/friends/remove/:friendId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Remove a friend.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:friendId` = friend's user ID  
**Body:** None  
**Response:** `{ "ok": true }`


---
---


#### `GET /api/friends`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Get the current user's friends list (or, with `?username=`, another user's list).

**Headers:** 🔒 (requires `token` cookie)  
**Query Params:** optional `?username=<username>` returns that user's list.  
**Response:**

```json
[
  {
    "id": "user-id",
    "username": "string",
    "displayName": "string",
    "avatarStyle": "bottts",
    "avatarV": 1793404582884,
    "hasAvatarPhoto": false,
    "rating": 1200,
    "friendsSince": "ISO-date-string",
    "status": "online"
  }
]

```

`avatarV` is the avatar-meta change stamp, read for the whole list through one pipelined Redis
request; the client turns it into the photo URL's `?v=` (see
[avatar-system.md](avatar-system.md)). `status` is the listed account's presence
(`online` / `playing` / `offline`).

**Live updates:** this is a **first-paint read**, not a poll. Every later change arrives as the
`friendship:changed` socket event (one record per changed pair, viewer-relative), and the screen
re-reads this route only on mount, on socket reconnect and on window focus. The same is true of
`GET /api/friends/requests` and `GET /api/friends/blocked`.

**Errors:** 401 (no session); **403 `FRIEND_BLOCKED`** when a block exists between the caller and `?username=`'s user (the profile page skips the read when `visibility !== 'full'`).


---
---


#### `POST /api/friends/block/:userId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Block a user.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:userId` = user ID to block  
**Body:** None  
**Response:** `{ "ok": true }` when the user is newly blocked or already blocked; `{ "id": "<blocked-record-id>" }` when the block row is created.

The SPA refetches the blocked list either way, so it never reads these bodies.


---
---


#### `GET /api/friends/blocked`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

List users the current user has blocked.

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
[
  {
    "id": "user-id",
    "username": "blocked-user",
    "displayName": "Blocked User",
    "avatarStyle": "bottts",
    "avatarV": 1793404582884,
    "hasAvatarPhoto": false,
    "rating": 1200,
    "blockedSince": "2026-08-01T00:00:00.000Z"
  }
]

```

First-paint read only: a block, a lifted block, or a row that a block removed elsewhere arrives as
`friendship:changed` (see [`GET /api/friends`](#get-apifriends)).


---
---


#### `POST /api/friends/unblock/:userId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Unblock a user.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:userId` = user ID to unblock  
**Body:** None  
**Response:**

```json
{ "ok": true }

```


---
---


### 15. Friends — Game Invites


---
---


#### `POST /api/friends/:friendId/invite`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Invite a friend to a PvP game. Creates a match room and seats the friend; pushes a `game_invite` notification.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:friendId` = friend's user ID  
**Body:** None  
**Response:**

```json
{
  "gameId": "game-id",
  "token": "<jwt>",
  "engineUrl": "wss://localhost:8443",
  "color": "red",
  "inviteCode": "ABCD12"
}

```


---
---


#### `GET /api/friends/invites/pending`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Get the current user's pending game invite (if any).

**Headers:** 🔒 (requires `token` cookie)  
**Response:** `null` or a pending-invite object.


---
---


#### `POST /api/friends/invites/dismiss`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Dismiss the current user's pending game invite.

**Headers:** 🔒 (requires `token` cookie)  
**Body:** None  
**Response:**

```json
{ "ok": true }

```


---
---


### 16. Presence

**No HTTP routes.** D11 (Phase 1.6) deleted `presence.controller.ts`, its two routes
(`POST /api/presence/heartbeat`, `GET /api/presence/online-count`), its `HeartbeatDto` and the
`PRESENCE_THROTTLE` entry; both paths now answer `404`. Presence is the session socket: the
connection keeps the row alive, and the badge's number arrives on that connection too.


---
---


#### Socket events (`/ws`, path `/ws-socket.io`)

**Source:** `backend/src/realtime/realtime.gateway.ts` + `backend/src/presence/presence.service.ts`

The handshake authenticates with the same httpOnly `token` cookie (no token ever reaches JS), so the
session socket is a cookie-authenticated connection at the page's own origin.

| Direction | Event | Payload | Meaning |
|-----------|-------|---------|---------|
| server → client | `presence:hello` | none | the socket is registered: authenticated, in `user:<id>` and `friends:of:<id>`, presence connection counted |
| client → server | `presence:playing` | `{ playing: boolean }` | sent on game enter/leave and re-asserted on every `connect`; per connection |
| server → client | `counts:online` | `{ count: number }` | the site-wide online badge, coalesced to at most one push per 5 s, and emitted to a freshly connected socket right after `presence:hello` (the badge's first paint, D11) |
| server → client | `rooms:list` | `LobbyRoom[]` | the open lobby, filtered for this viewer (`mySeat` is per account); pushed after a `rooms:changed` burst, debounced 500 ms and diffed |
| server → client | `rooms:mine` | `MyRoom[]` | this account's own seats (rejoin banner, "has an active game") |
| server → client | `friendship:changed` | `{ state, friend }` | one changed friendship row, **viewer-relative**: the same record drives the friends, requests and blocked lists (see below) |

There is no client heartbeat event: the socket's own ping/pong (20 s / 20 s) is the liveness signal.
A malformed `presence:playing` payload is refused by the DTO and dropped without an ack.

**`friendship:changed`** is published by `FriendshipEventsService` after every write that changes a
friendship row — the six membership mutations (request, accept, decline, remove, block, unblock) and
the three content triggers (display-name change, avatar upload/delete, postgame rating) — and routed
by the broadcaster from the `friendship:<recipientId>` Redis channel.

```json
{
  "state": "pending-in",
  "friend": {
    "id": "sender-user-id",
    "username": "string",
    "displayName": "string",
    "avatarStyle": "bottts",
    "avatarV": 1793404582884,
    "hasAvatarPhoto": false,
    "rating": 1200,
    "friendsSince": "ISO-date-string",
    "requestId": "pair-row-id"
  }
}

```

| `state` | Meaning for the recipient | List it lands in |
|---|---|---|
| `accepted` | both directions consented | friends |
| `pending-in` | the other account asked **you** (`requestId` is what accept/decline take) | requests · received |
| `pending-out` | **you** asked the other account | requests · sent |
| `blocked` | **you** blocked this account (liftable with unblock) | blocked |
| `none` | no row: removed, declined, cancelled — or blocked *by* the other side, which is not announced | removed from all three |

`friendsSince` is when the current state began — friends since / blocked since / requested at — so a
record fully replaces a snapshot row, and the newest record for an account is the whole truth. The
event is a **subscription, not a graph fan-out**: every socket joins `friends:of:<ownUserId>` at
connect (the id comes from the handshake, never from a client payload), and the publisher builds a
record only when at least one recipient side has a live presence row. The `friend_request`,
`friend_accepted` and `friend_removed` notifications cannot substitute: each one reaches a single
side, and none of them carries the row.


---
---


### 17. Notifications


---
---


#### Notifications on the session socket (no HTTP read)

**Source:** `backend/src/realtime/realtime.gateway.ts` — RealtimeModule

There is no HTTP route for reading notifications. The session socket (`/ws`, cookie
handshake) carries both halves:

| Event | Direction | Payload |
|---|---|---|
| `notifications:unread` | server → client | Array of `NotificationPayload`, unread only, newest first. Emitted on every (re)connect. |
| `notification` | server → client | One `NotificationPayload`: a stored entry, or a transient frame (`friend_online`, `friend_offline`, `display_name_changed`, `avatar_changed`). Stored frames go to that account's room; a global `notify:all` would reach every socket. |

Types: `friend_request` | `friend_accepted` | `friend_removed` | `friend_declined` | `game_invite` | `achievement` | `match_finished` | `match_cancelled` | `profile_updated` | `display_name_changed` | `friend_online` | `friend_offline` | `avatar_changed`

**Storage:** the bell is two Redis keys per account (D12): `notif:<userId>` (hash of
id to frame JSON) and `notif:<userId>:unread` (zset of unread ids scored by
`createdAt`), both with a 14 day TTL and a 150 entry cap. Reading an entry deletes
it, so `read` is always `false` on the wire.

**Reasoning:** a client that cannot open the socket cannot receive a notification
either, so a REST snapshot would only ever be a list that never updates. The two
write routes stay on HTTP, where the JWT refresh, the throttle and the error
surface already are.


---
---


#### `PATCH /api/notifications/:id/read`

**Source:** `backend/src/notification/notification.controller.ts` — NotificationModule

Read a single notification. The server deletes the entry (delete-on-read, D12); an
unknown id, or one belonging to another account, is a no-op.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:id` = notification ID  
**Body:** None  
**Response:** Empty / `204`.


---
---


#### `POST /api/notifications/read-all`

**Source:** `backend/src/notification/notification.controller.ts` — NotificationModule

Read everything: both `notif:` keys are deleted, so the bell and its badge start empty.

**Headers:** 🔒 (requires `token` cookie)  
**Body:** None  
**Response:** Empty / `204`.


---
---


### 18. Health


---
---


#### `GET /health`

**Source:** `backend/src/main.ts` — App bootstrap

Simple health check that verifies database connectivity.

**Headers:** None  
**Response:**

```json
{
  "status": "ok",
  "timestamp": "2026-07-23T10:14:51.664Z"
}

```

On DB error:

```json
{
  "status": "error",
  "timestamp": "2026-07-23T10:14:51.664Z"
}

```


---
---


## WebSocket APIs — Ludo Engine


---
---


### 19. Connection

The browser connects to the engine on its **own origin** — nginx (or the Vite dev proxy) forwards `/socket.io/` to the ludo-engine.

The handshake is bounded before it is authenticated: only origins on the engine's allow-list are accepted, one account may hold at most **4 live sockets**, and both the handshake payload and every event are capped at **64 KB**. The engine pings every 10 s, closes a socket that takes more than 15 s to answer, and disconnects a socket that exceeds 20 events per 5 s.

Connection requires JWT in handshake auth:

```js
const socket = io(window.location.origin, { // same-origin → nginx → ludo-engine
  auth: { token: '<token-from-match-endpoint>' },
  transports: ['websocket'],
});

```

JWT payload structure:

```json
{
  "gameId": "uuid",
  "playerId": "user-id",
  "username": "string",
  "displayName": "string",
  "role": "player1" | "player",
  "color": "red",
  "mode": "pvp" | "pve" | "hotseat",
  "aud": "ludo-engine"
}

```

`mode` is signed only on tokens minted by the creation endpoints (`/api/match/create`, `/api/match/pvp/invite`, `/api/match/pve`); the join-by-code and rejoin tokens omit it, and the engine treats a missing `mode` as a PvP seat. The engine reads the account id from `playerId` (it also accepts `sub` or `userId` if present). `username` is omitted for bot seats.

Every token is signed with the engine-dedicated `ENGINE_JWT_SECRET` (not the session `JWT_SECRET`) and carries `aud: "ludo-engine"`; the engine rejects a token signed with any other key or missing the audience, so a session access token cannot be replayed as a match token.

A guest has no account, so `POST /api/match/guest` returns an opaque `g_<32 random bytes base64url>` token instead of a JWT. The engine branches on the `g_` prefix, hashes the token and reads `guesttok:<sha256(token)>` from Redis (`{ gameId, color, mode, ip }`, 1 h TTL). The record names the room and the seat, so a guest handshake carries no claims at all; an unknown, expired or non-`pve` record is refused with `Invalid token`. Guests may emit only the `GUEST_EVENTS` allow-list (see §20).

**Health endpoint on the engine:** `GET http://localhost:3001/health` returns `{ "status": "ok", "uptime": 12345.67 }`.


---
---


### 20. Client → Server Events (emit)

A guest socket (`g_` token) may emit only the events in `GUEST_EVENTS`: `join_game`, `roll_dice`, `move_piece`, `skip_bust`, `arm_barrier`, `clash_card_hold`, `clash_input`, `leave_game`, `end_game` and `disconnect`. Any other event is dropped and logged, and the socket stays open. See [guest-mode.md](guest-mode.md).


---
---


#### `join_game`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleJoinGame`)

Join or create a game room. If all players have joined, transitions game from `waiting` to `active` automatically.

```js
socket.emit('join_game', gameId, playerColor, userId?, displayName?);

```

| Param | Type | Notes |
|---|---|---|
| `gameId` | string | Match UUID |
| `playerColor` | `'red'` \| `'green'` \| `'yellow'` \| `'blue'` | Your chosen color |
| `userId` | string | (optional) Override for bots |
| `displayName` | string | (optional) Display name for the seat |

**Response:** `game_joined` event with full `GameState`

**Errors:** `error` event with message.


---
---


#### `roll_dice`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleRollDice`)

Roll the dice for the current turn. Rejected if it is not your turn.

```js
socket.emit('roll_dice');

```

**Response:** `dice_rolled` event (broadcast to all in room)

**Errors:** `error` if not your turn, wrong phase, or player exited.


---
---


#### `move_piece`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleMovePiece`)

Move a piece using a legal pieceId.

```js
socket.emit('move_piece', pieceId);

```

| Param | Type | Notes |
|---|---|---|
| `pieceId` | string | e.g. `"red-0"` |

**Response:** `piece_moved` event (broadcast to all in room)

**Errors:** `error` if piece not in current legal moves.


---
---


#### `arm_barrier`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleArmBarrier`)

Arm or disarm the Wall Breaker for the current turn (clash mode only). Armed means this seat may land on a wall; disarmed means the wall blocks it. The flag is turn-scoped and is cleared when the turn advances.

```js
socket.emit('arm_barrier', true);

```

| Param | Type | Notes |
|---|---|---|
| `armed` | boolean | `true` = may break the wall it lands on, `false` = a wall blocks it |

**Response:** `state_update` broadcast (`players[].barrierArmed`).

**Errors:** `error` outside clash mode, off your turn, or when arming an empty hand.


---
---


#### `skip_bust`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleSkipBust`)

Decline the held Wall Breaker turn: a PASS, not a re-roll. The dice are spent, the turn advances, and the token stays in hand.

```js
socket.emit('skip_bust');

```

**Response:** `turn_skipped` + `state_update` broadcast.

**Refusals are silent:** the action is only valid when every pending move is token-priced. Any other state is logged for the operator and nothing is sent to the player.


---
---


#### `clash_input`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleClashInput`)

One QTE keypress during the press phase. The key itself picks the side (defender keys are the left block, attacker keys the right); the seat binding then proves the caller owns it. `count` is the tablet tap weight, clamped to `CLASH_TAP_COUNT_MAX` (2).

```js
socket.emit('clash_input', 'f', 1);

```

| Param | Type | Notes |
|---|---|---|
| `key` | string | The key bound to your side in the current clash |
| `count` | number | Optional tap weight, default 1, clamped to 2; a pad tap is a heavier press, never a faster stream (110 ms per-side cap) |

**Response:** `clash_press` broadcast.

**Refusals are silent:** a press that fails the key/ownership/phase check is dropped.


---
---


#### `clash_card_hold`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleClashCardHold`)

The result-card release handshake. The client forecasts how long its own card will run; the engine clamps that to `[CARD_HOLD_MIN_MS, CLASH_RESULT_FREEZE_MS]` and keeps the smallest receipt, so a receipt can only shorten the freeze (the 4 s ceiling applies when none arrives).

```js
socket.emit('clash_card_hold', 'blue-red-41', 2400);

```

| Param | Type | Notes |
|---|---|---|
| `cardId` | string | `"<attacker>-<defender>-<moveCounter>"`, echoed from `clash_result` |
| `holdMs` | number | Forecast card duration in ms |

**Response:** `clash_card_released` once every participating user has reported its card's length (or the card has no human in it).

**Errors:** `error` only for a caller with no seat in that card; a foreign `cardId` is dropped silently, and a receipt after the release does nothing.


---
---


#### `player_ready`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handlePlayerReady`)

Mark the current seat's color as ready (readiness is color-keyed in engine state). The game starts once ≥2 active seats are all ready.

```js
socket.emit('player_ready');

```

**Response:** `lobby_update` broadcast (updated ready flags).


---
---


#### `select_color`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleSelectColor`)

Pick a seat color in the lobby. Picking or swapping a seat clears the Ready flag on both colors involved (readiness is tracked per color in engine state and must be re-confirmed after a change).

```js
socket.emit('select_color', color);

```

| Param | Type | Notes |
|---|---|---|
| `color` | `'red'` \| `'green'` \| `'yellow'` \| `'blue'` | The requested color |

**Response:** `lobby_update` or `color_selected` broadcast.


---
---


#### `update_modifiers`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleUpdateModifiers`)

Host-only live update of the three room rules while the room is still `WAITING`. The payload is one object, never positional booleans; the engine normalizes it and broadcasts back what it actually persisted (so the room mirrors stored state).

```js
socket.emit('update_modifiers', { clashEnabled: true, noSafeZones: false, freeExit: false });

```

| Param | Type | Notes |
|---|---|---|
| `clashEnabled` | boolean | Turn the clash QTE on/off |
| `noSafeZones` | boolean | `true` = star squares no longer protect a piece |
| `freeExit` | boolean | `true` = any roll leaves prison (the exit square counts as part of the roll) |

**Response:** `modifiers_updated` broadcast (`{ gameId, clashEnabled, noSafeZones, freeExit }`).

**Errors:** `error` when the caller is not the host or the room is no longer `WAITING`; malformed fields are coerced to booleans rather than trusted.


---
---


#### `leave_game`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleLeaveGame`)

Leave the current game room (before it starts).

```js
socket.emit('leave_game');

```

**Response:** `lobby_update` broadcast to the remaining players.


---
---


#### `end_game`

**Source:** `backend/app/ludo-engine/src/socket/server.ts` (`handleEndGame`)

End the game prematurely (host/admin action).

```js
socket.emit('end_game');

```

**Response:** `game_ended` / `player_aborted` broadcast.


---
---


#### `disconnect`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleDisconnect`)

Automatically handled when the WebSocket connection drops. Opens a reconnect grace window (45 s in PvP, 1 h in single-instance modes) for a **live, unfinished** seat and broadcasts `player_disconnected`; no window is opened for an exited/finished seat. `player_reconnected` fires if the player returns inside the window, carrying the name the client reports so a rename survives the reconnect. If the window expires the seat is pruned for good (`player_exited`, pieces parked at `step = -1`), and a later `join_game` for it is answered with `seat_expired` instead of being treated as a reconnect.

```js
// Socket.IO handles this automatically on connection loss

```

**Response:** `player_exited` event (broadcast to room).


---
---


### 21. Server → Client Events (on)

| Event | Payload | When |
|---|---|---|
| `game_joined` | `GameState` (full state) | After `join_game` |
| `dice_rolled` | `{ value, legalMoves, bonusRoll }` | After dice rolled |
| `piece_moved` | `MoveResult` | After piece moved |
| `turn_skipped` | `{ gameId, currentTurn }` | `skip_bust` declined the armed turn; the turn has already advanced in the state |
| `clash_start` | `{ attacker, defender, attackerKey, defenderKey, target, duration, phase, startAt, announceDeadline, countdownDeadline, pressDeadline, attackerPresses, defenderPresses, round?, totalRounds?, defenderPieceId?, remainingDefenderIds? }` | A capture is deferred to the QTE, or a clash chain starts its next round. Keys stay hidden until the press phase |
| `clash_phase` | `{ phase, countdownDeadline, pressDeadline }` | The QTE moves announce → countdown → pressing |
| `clash_press` | `{ color, presses }` | An accepted `clash_input` press |
| `clash_result` | `{ cardId, winner, loser, winnerPresses, loserPresses, round, totalRounds, resultCardUntil, continues, defenderPieceId, remainingDefenderIds }` | A round resolved; `continues: true` means the square still holds defenders and another round follows; `resultCardUntil` is the card's deadline, which the bots' next turn is timed from |
| `clash_card_released` | `{ gameId, resultCardUntil }` | Every participating client reported its card's length; the input freeze ends at `resultCardUntil` and the SPA card keeps its own timer |
| `game_started` | `{ gameId }` | Game transitions from waiting → active |
| `game_ended` | `{ winner, resultDetail }` | Game finished |
| `game_timeout` | none | Post-game lobby expired (60s) — room torn down |
| `game_expired` | `{ gameId }` | Idle lobby (5 min, < 2 seated), single-instance disconnect window expired, or quorum lost after an exit |
| `player_exited` | `{ color }` | A seat left for good or its reconnect grace expired |
| `player_aborted` | `{ color, username }` | The host ended a PvP game / the room was aborted |
| `player_disconnected` | `{ color }` | A player's connection dropped |
| `player_reconnected` | `{ color, displayName? }` | A player reconnected inside the grace window |
| `seat_expired` | `{ gameId, color }` | Your `join_game` was refused because the seat was already removed (left, or the grace window expired) — sent to that socket only |
| `lobby_update` | `{ players: [{ userId, username, avatarStyle, color, ready }] }` | Lobby seats changed (join/leave/ready/colour) |
| `color_selected` | `{ gameId, userId, color }` | A player selected a color in the lobby |
| `modifiers_updated` | `{ gameId, clashEnabled, noSafeZones, freeExit }` | The host changed the room rules while the room was `WAITING` |
| `state_update` | full `GameState` (includes `paused`, `pauseTurnOwner`, `players[].barrierArmed`, `players[].barrierTokens`, `resultCardUntil`) | A live exit moved the turn, a PvP disconnect paused/unpaused the game, or a barrier/clash change landed; also the SPA's catch-all for any other pub/sub frame |
| `error` | `string` | On invalid action / failed authentication. The string is a localization code (`errors.<CODE>`); unmapped strings stay console-only |


---
---


### 22. End-to-End Flow

```

1. POST /api/auth/login
   → { user: { id, username } }
   ← Set-Cookie: token=<jwt> (httpOnly)

2. POST /api/match/create { mode: "pvp" } (or /pve, or /pvp/invite then /match/join/:code)
   → { gameId, token, engineUrl }

3. Connect to engine (same origin — nginx proxies /socket.io/ to the engine):
   io(window.location.origin, { auth: { token }, transports: ['websocket'] })

4. socket.emit('join_game', gameId, 'red')
   ← socket.on('game_joined', state)

5. Play game:
   socket.emit('roll_dice')
   ← socket.on('dice_rolled', {...})
   socket.emit('move_piece', 'red-0')
   ← socket.on('piece_moved', {...})

6. Game end:
   ← socket.on('game_ended', {...})
   (engine calls POST /api/game/end automatically)

7. Post-game:
   ← socket.on('game_timeout')     // finished room expired after 60s
   (or emit 'end_game' to abandon early)

```


---
---


## Notes

- **Auth:** All auth endpoints use httpOnly cookies. Set by login, 2FA verify, OAuth completion, and refresh; cleared by logout. No `Authorization: Bearer` header is used.
- **`code` is the contract, `message` is a diagnostic.** Every error body carries a stable `code` that the SPA localizes (`errors.<CODE>` in `frontend/src/locales`); `message` is English and intended for logs, the console and non-browser clients, and the SPA never renders it. Success bodies that carry a `message` follow the same rule — the SPA keys off `code` (or shows its own localized notice).
- **CSRF:** every mutating `/api` request carries a signed double-submit token (`csrf_token` cookie + `X-CSRF-Token` header, bootstrapped by `GET /api/auth/csrf`) and must come from this host or a configured frontend origin. The engine callbacks (`POST /api/game/end`, `POST /api/game/:id/started`) are exempt: they authenticate with `x-engine-key` and use no cookies.
- **JWT expiration:** 15 minutes for access tokens. Refresh tokens last 7 days and are rotated on each use.
- **Bot seats:** a bot has no account, so its seat id is the literal `bot-<color>` (for example `bot-green`), and `role` is `'player'` / `'player1'`. The shown name comes from our own `player{n}_displayName` entry when the creator sent a `botNames` value: it reads `bot-<color> (<assistant>)`, and the client re-localizes the colour word.
- **CORS:** Not enabled on the backend. Every client call is same-origin through nginx's `/api` proxy, so the backend emits no CORS headers. The engine is the one exception: its Socket.IO handshake answers only the origins on the allow-list compose builds from `FRONTEND_URL` and `NGROK_FRONTEND_URL` (see [`security_measures.md`](security_measures.md), Game engine boundary).
- **Rate limiting:** every mutating route has a per-IP limit, collected in `backend/src/common/throttles.ts` (auth, friends, match, notifications, presence, avatar, achievements); the auth ones are listed on the [login](#post-apiauthlogin) and [profile](#patch-apiauthprofile) entries. Reads fall back to the global default (300 requests per 60 s).
- **Client IP:** `main.ts` trusts internal hops only (`trust proxy`), so the address behind those limits is the client's own and a client-sent `X-Forwarded-For` cannot spoof it.