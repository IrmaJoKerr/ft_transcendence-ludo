# **API List**

Complete reference of all HTTP and WebSocket APIs in the project. Updated 29 Aug 2026

---

## **Legend**

| Icon | Meaning |
|---|---|
| 🔒 | Requires JWT in `token` cookie (set by login/register) |
| 🌐 | WebSocket event (Socket.IO) |
| 🤖 | Called by ludo-engine (backend-to-backend) |

> **Auth note:** All 🔒 endpoints authenticate via the `token` httpOnly cookie. No `Authorization: Bearer` header is used.

---

## **Table of Contents**

### **HTTP APIs — Backend (NestJS)**

1. **[Auth — Account & Sessions](#1-auth--account--sessions)** — Registration, email verification, login, 2FA verify, refresh, logout, who am I
   - [`POST /api/auth/register`](#post-apiauthregister) — Create a new account (an email-verification link is sent)
   - [`GET /api/auth/verify-email`](#get-apiauthverify-email) — Confirm your email address via the emailed link
   - [`POST /api/auth/login`](#post-apiauthlogin) — Log in with username/email + password (returns a 2FA prompt if enabled)
   - [`POST /api/auth/2fa/verify`](#post-apiauth2faverify) — Enter the 6-digit code emailed to you to finish logging in
   - [`POST /api/auth/refresh`](#post-apiauthrefresh) — Silently get a new access token when the current one expires
   - [`POST /api/auth/logout`](#post-apiauthlogout) — Log out and clear your session cookies
   - [`GET /api/auth/me`](#get-apiauthme) — See who the current session belongs to

2. **[Auth — Profile & Password](#2-auth--profile--password)** — Password reset, profile read/update, change password
   - [`POST /api/auth/forgot-password`](#post-apiauthforgot-password) — Request a password-reset link by email
   - [`POST /api/auth/reset-password`](#post-apiauthreset-password) — Set a new password using the token from the reset email
   - [`GET /api/auth/profile`](#get-apiauthprofile) — Get your full profile (email, linked OAuth providers, has password)
   - [`PATCH /api/auth/profile`](#patch-apiauthprofile) — Update your username, display name, or email
   - [`PATCH /api/auth/profile/password`](#patch-apiauthprofilepassword) — Change your password while logged in

3. **[Auth — 2FA](#3-auth--2fa)** — Read and toggle two-factor authentication
   - [`GET /api/auth/2fa`](#get-apiauth2fa) — Check whether 2FA is enabled on your account
   - [`PATCH /api/auth/2fa`](#patch-apiauth2fa) — Turn two-factor authentication on or off

4. **[Auth — OAuth (Google / GitHub / 42)](#4-auth--oauth-google--github--42)** — Sign in with a third-party provider
   - [`GET /api/auth/google`](#get-apiauthgoogle) — Log in with Google
   - [`GET /api/auth/google/callback`](#get-apiauthgooglecallback) — Google OAuth redirect target (browser only)
   - [`GET /api/auth/github`](#get-apiauthgithub) — Log in with GitHub
   - [`GET /api/auth/github/callback`](#get-apiauthgithubcallback) — GitHub OAuth redirect target (browser only)
   - [`GET /api/auth/42`](#get-apiauth42) — Log in with your 42 (intra) account
   - [`GET /api/auth/42/callback`](#get-apiauth42callback) — 42 OAuth redirect target (browser only)

5. **[User](#5-user)** — Public profiles, game history, avatar management
   - [`GET /api/user/:username`](#get-apiuserusername) — Look up a player's public profile
   - [`GET /api/user/:username/games`](#get-apiuserusernamegames) — View a player's past game history
   - [`POST /api/user/avatar`](#post-apiuseravatar) — Upload a custom avatar image
   - [`GET /api/user/:username/avatar`](#get-apiuserusernameavatar) — Fetch a player's avatar image
   - [`DELETE /api/user/avatar`](#delete-apiuseravatar) — Remove your custom avatar

6. **[Match — Matchmaking](#6-match--matchmaking)** — Create/join PvP, PvE, hotseat games
   - [`POST /api/match/pvp/random`](#post-apimatchpvprandom) — Queue for a random PvP game (join an open room or create one)
   - [`POST /api/match/pvp/invite`](#post-apimatchpvpinvite) — Create a private PvP room with an invite code to share
   - [`POST /api/match/join/:code`](#post-apimatchjoincode) — Join a private PvP room using an invite code
   - [`POST /api/match/pve`](#post-apimatchpve) — Start a single-player game against bots
   - [`POST /api/match/create`](#post-apimatchcreate) — Create any game (PvP / PvE / hotseat) with full options

7. **[Match — Cleanup](#7-match--cleanup)** — Stale-game cleanup
   - [`POST /api/match/cleanup`](#post-apimatchcleanup) — Remove stale/abandoned match data

8. **[Game Actions — Room](#8-game-actions--room)** — Ready, resign, exit, abort, rejoin, invite
   - [`POST /api/game/:id/ready`](#post-apigameidready) — Mark yourself ready in a room so the game can start
   - [`POST /api/game/:id/resign`](#post-apigameidresign) — Forfeit / give up the current game
   - [`POST /api/game/:id/exit`](#post-apigameidexit) — Leave the post-game lobby
   - [`POST /api/game/:id/abort`](#post-apigameidabort) — Cancel a game that hasn't started yet
   - [`POST /api/game/:id/rejoin`](#post-apigameidrejoin) — Reconnect to a room you're seated in (e.g. after a page refresh)
   - [`POST /api/game/:id/invite`](#post-apigameidinvite) — Invite a friend into your waiting PvP room

9. **[Game Actions — Browse](#9-game-actions--browse)** — List games/rooms, find your rooms
   - [`GET /api/games/active`](#get-apigamesactive) — List all games currently in progress
   - [`GET /api/games/rooms`](#get-apigamesrooms) — Browse open (joinable) PvP rooms
   - [`GET /api/games/mine`](#get-apigamesmine) — List rooms you are seated in

10. **[Game End (engine callback)](#10-game-end-engine-callback)** — Engine reports game start/end
   - [`POST /api/game/end`](#post-apigameend) — (engine) Report a finished game; triggers scoring, ratings, achievements
   - [`POST /api/game/:id/started`](#post-apigameidstarted) — (engine) Mark a game as started once the ready check passes

11. **[Leaderboard](#11-leaderboard)** — Global rankings
   - [`GET /api/leaderboard`](#get-apileaderboard) — View the global rankings (optionally highlight your own rank)

12. **[Achievements](#12-achievements)** — Achievement progress and re-check
   - [`GET /api/achievements`](#get-apiachievements) — View your achievement progress and unlock targets
   - [`POST /api/achievements/check`](#post-apiachievementscheck) — Re-evaluate your achievements (silent backfill after rule changes)

13. **[Stats](#13-stats)** — Lifetime player statistics
   - [`GET /api/stats`](#get-apistats) — View your lifetime stats (rating, wins, losses, captures, …)

14. **[Friends — Requests](#14-friends--requests)** — Send/accept/decline friend requests
   - [`POST /api/friends/request/:userId`](#post-apifriendsrequestuserid) — Send a friend request to another user
   - [`POST /api/friends/accept/:requestId`](#post-apifriendsacceptrequestid) — Accept a pending friend request
   - [`POST /api/friends/decline/:requestId`](#post-apifriendsdeclinerequestid) — Decline a pending friend request
   - [`GET /api/friends/requests`](#get-apifriendsrequests) — View pending sent/received friend requests

15. **[Friends — Manage](#15-friends--manage)** — List, remove, block, unblock friends
   - [`DELETE /api/friends/remove/:friendId`](#delete-apifriendsremovefriendid) — Remove a friend
   - [`GET /api/friends`](#get-apifriends) — List your friends (optional `?username=` filter)
   - [`POST /api/friends/block/:userId`](#post-apifriendsblockuserid) — Block a user
   - [`GET /api/friends/blocked`](#get-apifriendsblocked) — List users you have blocked
   - [`POST /api/friends/unblock/:userId`](#post-apifriendsunblockuserid) — Unblock a user

16. **[Friends — Game Invites](#16-friends--game-invites)** — Invite friends to games, pending/dismiss
   - [`POST /api/friends/:friendId/invite`](#post-apifriendsfriendidinvite) — Invite a friend to a PvP game
   - [`GET /api/friends/invites/pending`](#get-apifriendsinvitespending) — Check whether you have a pending game invite
   - [`POST /api/friends/invites/dismiss`](#post-apifriendsinvitesdismiss) — Dismiss your pending game invite

17. **[Presence](#17-presence)** — Online/offline heartbeat
   - [`POST /api/presence/heartbeat`](#post-apipresenceheartbeat) — Tell the server you're online (sent ~every 20s while the app is open)
   - [`DELETE /api/presence/heartbeat`](#delete-apipresenceheartbeat) — Mark yourself offline (on logout)

18. **[Notifications](#18-notifications)** — Live stream + unread list + read state
   - [`GET /api/notifications/stream`](#get-apinotificationsstream) — Open a live stream of new notifications (SSE)
   - [`GET /api/notifications`](#get-apinotifications) — List your unread notifications (bell dropdown on load)
   - [`PATCH /api/notifications/:id/read`](#patch-apinotificationsidread) — Mark a single notification as read
   - [`POST /api/notifications/read-all`](#post-apinotificationsread-all) — Mark all notifications as read

19. **[Health](#19-health)** — Backend/database health check
   - [`GET /health`](#get-health) — Check the backend is up (verifies database connectivity)

### WebSocket APIs — Ludo Engine

20. **[Connection](#20-connection)** — Connect to the game engine with a match token
21. **[Client → Server Events](#21-client--server-events-emit)** — What the client sends: join, roll dice, move pieces, ready, end game
22. **[Server → Client Events](#22-server--client-events-on)** — What the client receives: state updates, dice/move results, game end
23. **[End-to-End Flow](#23-end-to-end-flow)** — A complete walkthrough from login to a finished game

---

## HTTP APIs — Backend (NestJS)

Base URL: `http://localhost:3000` (or `http://backend:3000` from Docker)

All endpoints return JSON. The backend runs on port 3000.

Auth is handled via **httpOnly cookies**:
- `token` — short-lived access token (15 min), set by login/register/refresh
- `refresh_token` — long-lived refresh token (7 days), path-scoped to `/api/auth`

No manual `Authorization` header is needed for cookie-authenticated requests.

### 1. Auth — Account & Sessions

#### `POST /api/auth/register`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Create a new user account. Sends a verification email; no session is set until the email is verified.

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
  "message": "Account created — check your email to verify your address."
}

```

**Errors:** 409 if username or email exists, 400 if validation fails.

---

#### `GET /api/auth/verify-email`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redeem an emailed verification link. Redirects to the SPA with a query param on success.

**Headers:** None  
**Query:** `token` — the 64-char hex token from the email link  
**Response:** 302 redirect to `{FRONTEND_URL}/login?verified=1` or `?error=invalid-verification-link`

---

#### `POST /api/auth/login`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Authenticate. With 2FA enabled, returns a `pendingToken` and emails a code; with 2FA disabled, sets the session cookies.

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
  "user": { "id": "uuid", "username": "string" }
}

```

**Response (2FA enabled):**

```json
{
  "twoFactorRequired": true,
  "pendingToken": "hex-string"
}

```

**Errors:** 401 if invalid credentials, 403 if email not verified.

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
  "user": { "id": "uuid", "username": "string" }
}

```

**Errors:** 401 if invalid/expired code or too many attempts.

---

#### `POST /api/auth/refresh`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Silent re-authentication. Trade a valid refresh token for a fresh access token + rotated refresh token.

**Headers:** None (refresh_token cookie is sent automatically)  
**Body:** None  
**Response:**

```json
{
  "user": { "id": "uuid", "username": "string" }
}

```

**Errors:** 401 if refresh token is missing, expired, or revoked.

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

#### `GET /api/auth/me`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Return the current user from the access token cookie.

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
{
  "user": { "id": "uuid", "username": "string" }
}

```

---

---

### 2. Auth — Profile & Password

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
  "message": "If that email is registered, a reset link is on its way."
}

```

---

#### `POST /api/auth/reset-password`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redeem a reset token and set a new password.

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
  "message": "Password updated — you can log in with it now."
}

```

**Errors:** 401 if token is invalid or expired.

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
    "providers": ["google", "github", "42"]
  }
}

```

---

#### `PATCH /api/auth/profile`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Update the logged-in user's profile (display name / username, email, etc.).

**Headers:** 🔒 (requires `token` cookie)  
**Body:** (any subset of the editable fields, validated by `UpdateProfileDto`)

```json
{
  "username": "new_username",
  "displayName": "New Display Name",
  "email": "new@example.com"
}

```

**Response:** the updated profile / success message.

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

**Response:**

```json
{ "message": "Password updated — you can log in with it now." }

```

---

---

### 3. Auth — 2FA

#### `GET /api/auth/2fa`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Get the current user's 2FA preference.

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
{
  "twoFactorEnabled": true
}

```

---

#### `PATCH /api/auth/2fa`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Toggle the user's 2FA preference.

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "enabled": true
}

```

**Response:**

```json
{
  "twoFactorEnabled": true
}

```

---

---

### 4. Auth — OAuth (Google / GitHub / 42)

#### `GET /api/auth/google`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redirect to Google OAuth consent screen.

**Headers:** None  
**Response:** 302 redirect.

---

#### `GET /api/auth/google/callback`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Google OAuth callback. Do not call directly.

**Headers:** None  
**Response:** 302 redirect to `FRONTEND_URL`.

---

#### `GET /api/auth/github`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redirect to GitHub OAuth consent screen.

**Headers:** None  
**Response:** 302 redirect.

---

#### `GET /api/auth/github/callback`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

GitHub OAuth callback. Do not call directly.

**Headers:** None  
**Response:** 302 redirect to `FRONTEND_URL`.

---

#### `GET /api/auth/42`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

Redirect to 42 (intra) OAuth consent screen.

**Headers:** None  
**Response:** 302 redirect.

---

#### `GET /api/auth/42/callback`

**Source:** `backend/src/auth/auth.controller.ts` — AuthModule

42 OAuth callback. Do not call directly.

**Headers:** None  
**Response:** 302 redirect to `FRONTEND_URL`.

---

---

### 5. User

#### `GET /api/user/:username`

**Source:** `backend/src/user/user.controller.ts` — UserModule

Get a user's public profile.

**Headers:** None  
**Path:** `:username` = username string  
**Response:**

```json
{
  "id": "uuid",
  "username": "string",
  "displayName": "string",
  "createdAt": "ISO-date-string",
  "avatarStyle": "string",
  "rating": 0,
  "highestRating": 0,
  "wins": 0,
  "losses": 0,
  "winStreak": 0,
  "bestWinStreak": 0,
  "botWins": 0,
  "humanWins": 0,
  "hasAvatarPhoto": false,
  "status": "online | playing | offline"
}

```

**Errors:** 404 if user not found.

---

#### `GET /api/user/:username/games`

**Source:** `backend/src/user/user.controller.ts` — UserModule

Get a user's game history.

**Headers:** None  
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

**Errors:** 404 if user not found.

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
  "message": "Avatar uploaded"
}

```

**Errors:** 400 if no file, wrong type, or too large.

---

#### `GET /api/user/:username/avatar`

**Source:** `backend/src/user/user.controller.ts` — UserModule

Retrieve a user's avatar image.

**Headers:** None  
**Path:** `:username` = username string  
**Response:** Binary image data with `Content-Type` set to the stored MIME type, served with `Cache-Control: no-store`. If the user has no uploaded photo (or the user is a bot), the server generates and serves a DiceBear pixel avatar (seeded by username) as `image/svg+xml` instead — avatar URLs never 404.

---

#### `DELETE /api/user/avatar`

**Source:** `backend/src/user/user.controller.ts` — UserModule

Delete the current user's custom avatar.

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
{
  "message": "Avatar deleted"
}

```

---

---

### 6. Match — Matchmaking

All match endpoints return `{ gameId, token, engineUrl }` (plus `inviteCode` for invite games).

- `gameId`: UUID of the new/pending match
- `token`: JWT to use when connecting to ludo-engine via Socket.IO
- `engineUrl`: Same-origin WebSocket URL (derived from `FRONTEND_URL`, e.g. `ws://localhost:8443`) — the browser connects to its own origin and nginx/Vite forwards `/socket.io/` to the engine
- `inviteCode`: 6-char shareable code (invite games only)

To connect to the engine:

```js
const io = require('socket.io-client');
const socket = io(window.location.origin, { // same-origin → nginx → ludo-engine
  auth: { token: '<token-from-response>' },
  transports: ['websocket'],
});

```

---

#### `POST /api/match/pvp/random`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Find or create a random PvP match.

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "clashEnabled": true,
  "safeZones": true
}

```

**Response:**

```json
{
  "gameId": "uuid",
  "token": "jwt-string",
  "engineUrl": "ws://localhost:8443",
  "color": "blue",
  "mode": "pvp",
  "playerCount": 4
}

```

**Notes:**
- If a WAITING PvP game with an open slot exists, joins it immediately.
- Otherwise, creates a new WAITING game.
- `clashEnabled` / `safeZones` are optional game modifiers (default `true`). Seat `color` is assigned by the server — clients can no longer pick their own color.

---

#### `POST /api/match/pvp/invite`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Create a PvP invite game with a shareable code.

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "clashEnabled": true,
  "safeZones": true
}

```

**Response:**

```json
{
  "gameId": "uuid",
  "inviteCode": "ABCD12",
  "token": "jwt-string",
  "engineUrl": "ws://localhost:8443",
  "color": "blue",
  "mode": "pvp",
  "playerCount": 4
}

```

**Notes:**
- Share `inviteCode` via chat/friend list.
- Recipient joins via `POST /api/match/join/:code`.
- `clashEnabled` / `safeZones` are optional game modifiers (default `true`). Seat `color` is assigned by the server.

---

#### `POST /api/match/join/:code`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Join a PvP game by invite code.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:code` = 6-char invite code  
**Body:** None (seat `color` is assigned by the server)

**Response:**

```json
{
  "gameId": "uuid",
  "token": "jwt-string",
  "engineUrl": "ws://localhost:8443",
  "color": "red",
  "mode": "pvp",
  "playerCount": 4
}

```

**Errors:** 404 if code not found/expired, 400 if joining own invite.

---

#### `POST /api/match/pve`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Start a PvE (vs bot) game.

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "playerCount": 2,
  "clashEnabled": true,
  "safeZones": true
}

```

**Response:**

```json
{
  "gameId": "uuid",
  "token": "jwt-string",
  "engineUrl": "ws://localhost:8443",
  "color": "blue",
  "mode": "pve",
  "playerCount": 2
}

```

**Notes:**
- Game is `ACTIVE` immediately.
- Bots fill remaining slots automatically.
- `playerCount` must be 2 or 4; `clashEnabled` / `safeZones` are optional modifiers (default `true`). Seat `color` is assigned by the server.

---

#### `POST /api/match/create`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Unified match creation — supports PvP, PvE, and hotseat modes.

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "mode": "pvp",
  "playerCount": 4,
  "botCount": 0,
  "clashEnabled": true,
  "safeZones": true,
  "botColors": ["red", "green"],
  "seatColors": ["yellow", "blue"]
}

```

**Response:**

```json
{
  "gameId": "uuid",
  "token": "jwt-string",
  "engineUrl": "ws://localhost:8443",
  "color": "blue",
  "mode": "pvp",
  "playerCount": 4,
  "inviteCode": "ABCD12"
}

```

**Notes:**
- `mode` is **required** and must be `pvp`, `pve`, or `hotseat` (no silent fallback).
- `playerCount` accepts 1-4; `botCount` must be 0 to `playerCount-1`. Bots are only allowed in PvE games.
- `clashEnabled` / `safeZones` are optional game modifiers (default `true`).
- `botColors` / `seatColors` (optional string arrays) can override the default slot colors. Seat `color` is otherwise assigned by the server.

---

### 7. Match — Cleanup

#### `POST /api/match/cleanup`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Clean up old match data and expired moves.

**Headers:** 🔒 (requires `token` cookie)  
**Body:** None  
**Response:** Returns count of cleaned-up games.

---

---

### 8. Game Actions — Room

#### `POST /api/game/:id/ready`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Signal that the current player is ready.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:id` = gameId  
**Body:** None  
**Response:**

```json
{
  "message": "Player ready",
  "gameId": "uuid"
}

```

---

#### `POST /api/game/:id/resign`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Forfeit the game.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:id` = gameId  
**Body:** None  
**Response:**

```json
{
  "message": "Game cancelled",
  "gameId": "uuid"
}

```

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
  "message": "Exited game",
  "gameId": "uuid"
}

```

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
  "message": "Game cancelled",
  "gameId": "uuid"
}

```

**Errors:** 404 if game not found, 403 if user is not a player.

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
  "engineUrl": "ws://localhost:8443"
}

```

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

---

---

### 9. Game Actions — Browse

#### `GET /api/games/active`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

List all currently active games.

**Headers:** 🔒 (requires `token` cookie)  
**Response:** Array of active game summaries.

---

#### `GET /api/games/rooms`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

List open (WAITING PvP) rooms that can be joined.

**Headers:** 🔒 (requires `token` cookie)  
**Response:** Array of joinable room summaries.

---

#### `GET /api/games/mine`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

List rooms (WAITING/ACTIVE) the current user is seated in — used to rejoin after a refresh.

**Headers:** 🔒 (requires `token` cookie)  
**Response:** Array of the user's room summaries.

---

---

### 10. Game End (engine callback)

#### `POST /api/game/end`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Called by ludo-engine when a game finishes. 🤖 Does not require JWT — authenticated via `x-engine-key` header.

**Headers:** `x-engine-key: <ENGINE_API_KEY>`  
**Body:**

```json
{
  "gameId": "uuid",
  "participants": [
    {
      "userId": "string (or 'ludo-bot')",
      "color": "'RED'|'GREEN'|'YELLOW'|'BLUE'",
      "rank": 1,
      "piecesCaptured": 3,
      "piecesInGoal": 4
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

**Errors:** 400 if `gameId` missing, or `participants` missing / < 2 entries. Re-sending the same `gameId` is safe (idempotent — returns `"Game already processed"` without double-awarding points).

**Side effects:**
- Writes `game` + `game_participant` rows to Postgres
- Updates the player's `User` row: `rating`, `winStreak`, `bestWinStreak`, `wins`, `losses`, `botWins`, `humanWins`, etc. (scoring via `ratingDeltaFor()`)
- Evaluates achievements for all participants (fires unlock notifications)
- Updates Redis `leaderboard:global` sorted set
- Refreshes `LeaderboardSnapshot` rows

---

#### `POST /api/game/:id/started`

**Source:** `backend/src/match/match.controller.ts` — MatchModule

Called by ludo-engine once the ready-check passes and the game transitions to ACTIVE. 🤖 Authenticated via `x-engine-key` header.

**Headers:** `x-engine-key: <ENGINE_API_KEY>`  
**Path:** `:id` = gameId  
**Body:** None  
**Response:**

```json
{ "ok": true }

```

- Deletes `match:{gameId}` from Redis

---

---

### 11. Leaderboard

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
      "username": "string",
      "rating": 1500,
      "rank": 1,
      "gamesPlayed": 42,
      "wins": 30,
      "losses": 12,
      "draws": 0,
      "winRate": 71.4,
      "avatarStyle": "bottts"
    }
  ],
  "total": 100,
  "page": 1,
  "limit": 20,
  "source": "postgres"
}

```

---

---

### 12. Achievements

#### `GET /api/achievements`

**Source:** `backend/src/achievements/achievements.controller.ts` — AchievementsModule

Get the current user's achievement report (unlocked state + progress + target per achievement).

**Headers:** 🔒 (requires `token` cookie)  
**Query Params:** optional `?username=<username>` returns another user's achievement report.  
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
  "achUnstoppable": { "unlocked": false, "progress": 0, "target": 3 },
  "achSteadyDefender": { "unlocked": false, "progress": 0, "target": 2 },
  "achMercilessAttacker": { "unlocked": false, "progress": 0, "target": 2 }
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
| `achSteadyDefender` | per-game | Defend ≥ 2 clashes in one game |
| `achMercilessAttacker` | per-game | Win ≥ 2 clash attacks in one game |

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

### 13. Stats

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

### 14. Friends — Requests

All friend endpoints require JWT auth via cookie.

#### `POST /api/friends/request/:userId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Send a friend request.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:userId` = target user ID  
**Body:** None  
**Response:** Returns the full friendship object with user and friend details.

**Errors:** 400 if already friends, request pending, or blocked; 403 if blocked by target; 404 if target user not found.

---

#### `POST /api/friends/accept/:requestId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Accept a friend request.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:requestId` = request UUID  
**Body:** None  
**Response:** Returns the updated friendship object with user and friend details.

**Errors:** 404 if request not found, 403 if not addressed to current user.

---

#### `POST /api/friends/decline/:requestId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Decline a friend request.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:requestId` = request UUID  
**Body:** None  
**Response:** `{ "message": "Friend request declined" }`

**Errors:** 404 if request not found.

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
      "avatarStyle": "bottts",
      "createdAt": "ISO-date-string"
    }
  ],
  "received": [
    {
      "id": "request-uuid",
      "userId": "sender-user-id",
      "username": "string",
      "avatarStyle": "bottts",
      "createdAt": "ISO-date-string"
    }
  ]
}

```

---

---

### 15. Friends — Manage

#### `DELETE /api/friends/remove/:friendId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Remove a friend.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:friendId` = friend's user ID  
**Body:** None  
**Response:** `{ "message": "Friend removed" }`

---

#### `GET /api/friends`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Get the current user's friends list.

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
[
  {
    "id": "user-id",
    "username": "string",
    "avatarStyle": "bottts",
    "rating": 1200,
    "friendsSince": "ISO-date-string"
  }
]

```

---

#### `POST /api/friends/block/:userId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Block a user.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:userId` = user ID to block  
**Body:** None  
**Response:** Returns the blocked friendship object with user and friend details.

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
    "rating": 1200,
    "blockedSince": "2026-08-01T00:00:00.000Z"
  }
]

```

---

#### `POST /api/friends/unblock/:userId`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Unblock a user.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:userId` = user ID to unblock  
**Body:** None  
**Response:**

```json
{ "message": "User unblocked" }

```

---

---

### 16. Friends — Game Invites

#### `POST /api/friends/:friendId/invite`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Invite a friend to a PvP game. Creates a match room and seats the friend; pushes a `game_invite` notification.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:friendId` = friend's user ID  
**Body:** None  
**Response:**

```json
{
  "message": "Invite sent",
  "gameId": "game-id",
  "token": "<jwt>",
  "engineUrl": "ws://localhost:8443",
  "color": "red",
  "inviteCode": "ABCD12"
}

```

---

#### `GET /api/friends/invites/pending`

**Source:** `backend/src/friends/friends.controller.ts` — FriendsModule

Get the current user's pending game invite (if any).

**Headers:** 🔒 (requires `token` cookie)  
**Response:** `null` or a pending-invite object.

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

### 17. Presence

#### `POST /api/presence/heartbeat`

**Source:** `backend/src/presence/presence.controller.ts` — PresenceModule

Send a presence heartbeat. Called every ~20s while the app is open.

**Headers:** 🔒 (requires `token` cookie)  
**Body:**

```json
{
  "playing": true
}

```

**Response:**

```json
{
  "ok": true
}

```

---

#### `DELETE /api/presence/heartbeat`

**Source:** `backend/src/presence/presence.controller.ts` — PresenceModule

Clear presence (e.g. on logout).

**Headers:** 🔒 (requires `token` cookie)  
**Body:** None  
**Response:**

```json
{
  "ok": true
}

```

---

#### `GET /api/presence/online-count`

**Source:** `backend/src/presence/presence.controller.ts` — PresenceModule

Get the site-wide count of currently online users (for the homepage badge bar).

**Headers:** 🔒 (requires `token` cookie)  
**Response:**

```json
{
  "count": 12
}

```

---

---

### 18. Notifications

#### `GET /api/notifications/stream`

**Source:** `backend/src/notification/notification.controller.ts` — NotificationModule

SSE stream — pushes new notifications to the browser in real time.

**Headers:** 🔒 (requires `token` cookie)  
**Response:** Server-Sent Events (`text/event-stream`); each event is a `NotificationPayload`:

```json
{
  "id": "notif-id",
  "type": "friend_request",
  "payload": { "fromUsername": "Alice" },
  "read": false,
  "createdAt": "2026-08-01T00:00:00.000Z"
}

```

Types: `friend_request` | `friend_accepted` | `friend_removed` | `friend_declined` | `game_invite` | `achievement` | `match_finished` | `match_cancelled` | `profile_updated` | `display_name_changed` | `friend_online` | `friend_offline` | `avatar_changed`

---

#### `GET /api/notifications`

**Source:** `backend/src/notification/notification.controller.ts` — NotificationModule

List unread notifications (populates the bell dropdown on page load).

**Headers:** 🔒 (requires `token` cookie)  
**Response:** Array of `NotificationPayload` (unread only, newest first, max 50).

---

#### `PATCH /api/notifications/:id/read`

**Source:** `backend/src/notification/notification.controller.ts` — NotificationModule

Mark a single notification as read.

**Headers:** 🔒 (requires `token` cookie)  
**Path:** `:id` = notification ID  
**Body:** None  
**Response:** Empty / `204`.

---

#### `POST /api/notifications/read-all`

**Source:** `backend/src/notification/notification.controller.ts` — NotificationModule

Mark all notifications as read.

**Headers:** 🔒 (requires `token` cookie)  
**Body:** None  
**Response:** Empty / `204`.

---

---

### 19. Health

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

## WebSocket APIs — Ludo Engine

### 20. Connection

The browser connects to the engine on its **own origin** — nginx (or the Vite dev proxy) forwards `/socket.io/` to the ludo-engine.

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
  "sub": "user-id",
  "userId": "user-id",
  "role": "player1" | "player",
  "color": "red"
}

```

**Health endpoint on the engine:** `GET http://localhost:3001/health` returns `{ "status": "ok", "uptime": 12345.67 }`.

---

### 21. Client → Server Events (emit)

#### `join_game`

**Source:** `backend/app/ludo-engine/src/socket/join-manager.ts` (`JoinManager.handleJoinGame`)

Join or create a game room. If all players have joined, transitions game from `waiting` to `active` automatically.

```js
socket.emit('join_game', gameId, playerColor, userId?);

```

| Param | Type | Notes |
|---|---|---|
| `gameId` | string | Match UUID |
| `playerColor` | `'red'` \| `'green'` \| `'yellow'` \| `'blue'` | Your chosen color |
| `userId` | string | (optional) Override for bots |

**Response:** `game_joined` event with full `GameState`

**Errors:** `error` event with message.

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

#### `player_ready`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handlePlayerReady`)

Mark the current player as ready in the lobby (triggers the ready-check that starts the game).

```js
socket.emit('player_ready');

```

**Response:** `lobby_update` broadcast (updated ready flags).

---

#### `select_color`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleSelectColor`)

Pick a seat color in the lobby.

```js
socket.emit('select_color', color);

```

| Param | Type | Notes |
|---|---|---|
| `color` | `'red'` \| `'green'` \| `'yellow'` \| `'blue'` | The requested color |

**Response:** `lobby_update` or `color_selected` broadcast.

---

#### `leave_game`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleLeaveGame`)

Leave the current game room (before it starts).

```js
socket.emit('leave_game');

```

**Response:** `lobby_update` broadcast to the remaining players.

---

#### `end_game`

**Source:** `backend/app/ludo-engine/src/socket/post-game.ts` (`PostGameManager.handleEndGame`)

End the game prematurely (host/admin action).

```js
socket.emit('end_game');

```

**Response:** `game_ended` / `player_aborted` broadcast.

---

#### `resign`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleResign`)

Forfeit the game voluntarily.

```js
socket.emit('resign');

```

**Response:** `player_exited` event (broadcast to all)

---

#### `disconnect`

**Source:** `backend/app/ludo-engine/src/socket/socket-handlers.ts` (`handleDisconnect`)

Automatically handled when the WebSocket connection drops. Marks player as disconnected and broadcasts `player_exited` after a timeout.

```js
// Socket.IO handles this automatically on connection loss

```

**Response:** `player_exited` event (broadcast to room).

---

### 22. Server → Client Events (on)

| Event | Payload | When |
|---|---|---|
| `game_joined` | `GameState` (full state) | After `join_game` |
| `dice_rolled` | `{ value, legalMoves, bonusRoll }` | After dice rolled |
| `piece_moved` | `MoveResult` | After piece moved |
| `game_started` | `{ gameId }` | Game transitions from waiting → active |
| `game_ended` | `{ winner, resultDetail }` | Game finished |
| `game_timeout` | none | Post-game lobby expired (60s) — room torn down |
| `game_expired` | none | Idle lobby expired (5 min, < 2 seated) |
| `player_exited` | `{ color }` | Player disconnected/resigned |
| `player_aborted` | `{ color, username }` | A player aborted the game |
| `player_disconnected` | `{ color }` | A player's connection dropped |
| `player_reconnected` | `{ color }` | A player reconnected |
| `lobby_update` | `{ players: [{ username, color, ready }] }` | Lobby seats changed (join/leave/ready) |
| `color_selected` | `{ color }` | A player selected a color in the lobby |
| `state_update` | `any` (parsed JSON) | Generic catch-all for any Redis pub/sub message |
| `error` | `string` | On invalid action |

---

### 23. End-to-End Flow

```

1. POST /api/auth/login
   → { user: { id, username } }
   ← Set-Cookie: token=<jwt> (httpOnly)

2. POST /api/match/pvp/random (or /pve, /invite, /create)
   → { gameId, token, engineUrl }

3. Connect to engine:
   io(engineUrl, { auth: { token } })

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

## Notes

- **Auth:** All auth endpoints use httpOnly cookies. Set automatically by login/register/refresh, cleared by logout. No `Authorization: Bearer` header is used.
- **JWT expiration:** 15 minutes for access tokens. Refresh tokens last 7 days and are rotated on each use.
- **Bot tokens:** `playerId` is `'ludo-bot'`, `role` is `'player'` / `'player1'`.
- **CORS:** Backend allows all origins by default in development.
- **Rate limiting:** Auth endpoints (`register`, `login`) have throttler guard enabled.