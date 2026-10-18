# Security measures

What the app does to protect itself, and what each measure defends against. The doc is ordered from
the network edge inward: exposure, transport, edge headers, rate limits, sessions, tokens, the game
engine boundary, input handling, and secrets.

In short: nginx is the only public entry point (TLS 1.2/1.3 with a pinned cipher list, a strict
Content-Security-Policy and the other security headers, per-IP rate and connection limits) and it
fronts a loopback-only backend, engine, database and cache. Sessions use httpOnly
cookies with rotating refresh tokens, passwords are bcrypt-hashed, every emailed token is single
use and stored only as a hash, and the game engine verifies its own signed token before a socket can
join a room.

Companion docs: [`architecture.md`](architecture.md) (which covers the game engine socket threat
model in full), [`deploy/nginx.md`](deploy/nginx.md) and [`deploy/tunnel.md`](deploy/tunnel.md) (how
the two TLS listeners work). The review that produced this list, together with the options that were
rejected, is kept in `security-review.md`, private working notes that are not part of this doc set.

Verified against the current repo: `compose.yaml`, `nginx/conf/nginx.conf`, `nginx/conf/app.inc`,
`nginx/Dockerfile`, `backend/src`, `backend/app/ludo-engine/src`, `backend/docker-entrypoint.sh`,
`backend/src/auth/auth.constants.ts`, `Makefile`.


## Table of Contents

Each entry's indented second line names the headline threats that section defends against; the
section itself lists them in full.

- [Network exposure](#network-exposure): the one port reachable from another machine, and why the rest are loopback-only
  - ↳ threats: a direct connection to the database, the cache or the engine from the LAN or through the tunnel, and port scanning from another device
- [Transport security (TLS)](#transport-security-tls): TLS 1.2/1.3 and the pinned cipher list on both listeners, HSTS, and the self-signed certificate
  - ↳ threats: a downgrade to a broken TLS version or to a weak, non-forward-secret cipher suite, decryption of recorded sessions from a captured ticket key, and passive interception of credentials or cookies
- [Edge headers and static content](#edge-headers-and-static-content): the headers both listeners set, the strict CSP, and the static-file rules
  - ↳ threats: clickjacking, MIME sniffing, referrer leakage, inline script execution from any injection point, and data exfiltration through an image or a `fetch`
- [Rate limiting](#rate-limiting): the nginx per-address zones and connection caps, the address each listener trusts, the API throttler, and the per-account login lockout
  - ↳ threats: credential brute force and distributed credential stuffing, verification and reset mail spam, repeated 2FA guessing, and one client holding connections open to exhaust worker connections — at the stated cost of a 15-minute denial for a real user
- [Sessions and authentication](#sessions-and-authentication): cookie shape, CSRF and re-auth controls, token lifetimes, rotation and replay detection, bcrypt, 2FA
  - ↳ threats: session theft by an injected script, cross-site request forgery, reuse of a captured refresh token, escalation of a stolen session into email/2FA/OAuth changes, and offline cracking of stored passwords
- [Emailed link tokens](#emailed-link-tokens): what the app emails, each token's lifetime, and the single-use rule
  - ↳ threats: replay of an emailed link, a stale link remaining valid after a newer one was issued, and token exposure through a dump or a backup of the data store
- [Emailed links cannot reach a log](#emailed-links-cannot-reach-a-log): why an emailed token never reaches a proxy access log
  - ↳ threats: a verification or reset token being recorded in plaintext by the reverse proxy, where a reader of the logs could redeem another user's link
- [Game engine boundary](#game-engine-boundary): how a socket proves it may join a game, and what the engine refuses
  - ↳ threats: forging a game credential from another token or key, claiming a seat the caller does not own, and one socket tying the engine up with oversized or rapid events
- [Input validation and uploads](#input-validation-and-uploads): body validation, avatar signature checks, parameterized queries
  - ↳ threats: mass assignment through extra JSON properties, a script disguised as an image behind a benign declared type, and SQL injection through user input
- [Data stores, secrets and configuration](#data-stores-secrets-and-configuration): where secrets live, what Redis holds, no browser credential
  - ↳ threats: recovering a token or a password from a cache dump, and a service starting with an empty secret, which would make signatures forgeable
- [References](#references): the companion docs, and where each detail is documented in full


---


## Network exposure

Only one port is meant to be reachable from another machine. Every other publish is bound to
`127.0.0.1`, so a device on the same WiFi can reach the app and nothing else.

| Port | Service | Bound to | Purpose |
|---|---|---|---|
| `8443` | nginx direct TLS listener | all interfaces | the app entry point |
| `8080` | Vite dev server | all interfaces | `dev` profile only (`make dev`); never in a production stack |
| `8444` | nginx tunnel TLS listener | `127.0.0.1` | the local ngrok agent is the only process that may connect |
| `3000` | backend API | `127.0.0.1` | host debugging; the SPA reaches it through nginx `/api` |
| `3001` | ludo-engine | `127.0.0.1` | host debugging; the browser reaches it through nginx `/socket.io/` |
| `5432` | PostgreSQL | `127.0.0.1` | `psql` from the host |
| `6479` | Redis | `127.0.0.1` | seed and maintenance scripts from the host |
| `5555` | Prisma Studio | `127.0.0.1` | interactive database browsing from the host |
| `4040` | ngrok agent local API | `127.0.0.1` | exists only while `make tunnel` runs |

Cross-container traffic stays on the private `transcendence_network`, so the database, the cache and
the engine are addressed by service name and never leave the Docker network.

**Mitigates:** direct connections to the database, the cache or the game engine from the LAN or
through the tunnel; port scanning from another device; a raw database browser that has no
application-level authentication being reachable from the network.


---


## Transport security (TLS)

- Both listeners serve **TLS 1.2 and TLS 1.3 only** (`ssl_protocols TLSv1.2 TLSv1.3`). SSLv3, TLS 1.0
  and TLS 1.1 are refused.
- **The TLS 1.2 cipher list is pinned** (`ssl_ciphers`, in the shared `http` block so the two
  listeners cannot drift) to six ECDHE suites that all use an AEAD cipher: AES-GCM or
  ChaCha20-Poly1305. **Session tickets are off** (`ssl_session_tickets off`), so a captured ticket key
  cannot decrypt recorded sessions, and `ssl_prefer_server_ciphers off` leaves the choice to the
  client, which on any current browser is that same ECDHE set. TLS 1.3 fixes its own ciphersuites and
  is unaffected. See [The headers, file by file](#the-headers-file-by-file) for what the default
  list leaves open.
- nginx has **no plain-HTTP listener**. Both `server {}` blocks use `listen ... ssl`, and the only
  published nginx ports are `443` and `444`.
- **HSTS is set per listener, and only one of them pins subdomains.** The direct listener sends
  `Strict-Transport-Security: max-age=31536000; includeSubDomains`, so a browser that has seen the app
  once keeps using HTTPS for that host and everything under it. The tunnel listener sends the bare
  `max-age=31536000`: its public host is an ngrok subdomain, so `includeSubDomains` there would claim
  authority over a domain we do not own while protecting nothing of ours.
- The certificate is self-signed and generated at image build time (`nginx/Dockerfile`, `openssl req
  -x509 -days 365`, CN `transcendence-ludo`). This is why the first visit shows a browser warning.
- `make tunnel` points ngrok at `https://localhost:$(NGROK_PORT)`, so the agent speaks TLS to nginx
  instead of forwarding plain HTTP at a TLS-only port. The visitor's connection to ngrok is TLS too.

**Mitigates:** downgrade to a broken TLS version or to a weak, non-forward-secret cipher suite,
decryption of recorded sessions from a captured ticket key, passive interception of credentials or
session cookies on the network, and plaintext capture of the first request.


---


## Edge headers and static content

`nginx/conf/app.inc` is included by both listeners, so the two modes cannot drift apart.

| Header | Value | Mitigates |
|---|---|---|
| `X-Frame-Options` | `SAMEORIGIN` | clickjacking, where another site frames the app and overlays it |
| `X-Content-Type-Options` | `nosniff` | MIME sniffing, where a stored file is interpreted as a script |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | leaking full URLs, and any path or query data in them, to third-party sites |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` on the direct listener, bare `max-age=31536000` on the tunnel listener | protocol downgrade and cookie theft over plain HTTP, without claiming subdomains of a domain we do not own (see [Transport security](#transport-security-tls)) |
| `Content-Security-Policy` | the explicit policy below, with no wildcards | anything the policy does not name: an inline script, an external script, or an image or a fetch to a foreign origin |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` | the page, or any script that later runs in it, asking the browser for a location, a camera or a microphone. The app uses none of the three, so the header removes the capability instead of relying on a prompt |

### The Content-Security-Policy

```
default-src 'self';
script-src  'self';
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com;
font-src    'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com;
img-src     'self' data:;
connect-src 'self';
object-src  'none';
base-uri    'self';
frame-ancestors 'self';
form-action 'self';
upgrade-insecure-requests;
```

- `script-src 'self'` is the load-bearing directive: it is what makes a single injection point
  non-exploitable, because there is no inline script for an injected payload to ride on.
- `style-src` keeps `'unsafe-inline'` deliberately. React inline `style` attributes and Tailwind
  require it, and a style cannot execute script. The two third-party origins are the Google Fonts and
  FontAwesome stylesheets the SPA loads.
- `font-src` keeps the same origins for the font files themselves, plus `data:` for the icons bundled
  into the build.
- `object-src 'none'` removes `<object>`, `<embed>` and legacy plugin content, which nothing in the
  app uses and which `script-src` does not always govern.
- `base-uri 'self'` stops an injected `<base href>` from re-pointing every relative URL on the page at
  another origin.
- `frame-ancestors 'self'` is the CSP-level form of `X-Frame-Options`, and is enforced by browsers
  that ignore the older header.
- `form-action 'self'` stops a form on the page from posting to another origin.
- `upgrade-insecure-requests` rewrites any stray `http://` subresource request to `https://`.

Additional edge behaviour:

- Every header is set with `always`, so it is sent on error responses (`4xx`, `5xx`) too, not only
  on `200`.
- `server_tokens off` removes the nginx version from responses and error pages.
- `location ~ /\.` denies hidden files (`.env`, `.git` and similar), with `access_log off` so a probe
  leaves no useful noise behind either.
- `client_max_body_size 3M` bounds the request body at the edge. The largest legitimate body is a 2 MB
  avatar upload, so this leaves room for multipart overhead and stays far below the previous `10M`.
  nginx buffers a body up to the limit before the API can reject it, so headroom beyond that is
  memory and disk a client can spend on requests that were always going to fail validation.

### The headers, file by file

`app.inc` carries what both listeners share; `nginx.conf` carries what is per listener or per connection,
including transport and connection caps. Each table lists a directive the files set today and the attack
it closes.

#### `nginx/conf/app.inc`

Every directive the policy needs is named. A widening fallback is not used: `'unsafe-inline'` would
execute any inline script, a bare `https:` would accept an image from any host, and a bare `ws:` or
`wss:` would accept a socket to any host. `X-XSS-Protection` is not set either: the legacy reflection
filter is absent from Chrome, was never in Firefox, and where it remains it can introduce a
vulnerability by rewriting a page. The CSP is the control.

| Directive | The attack it closes |
|---|---|
| `Permissions-Policy: geolocation=(), camera=(), microphone=()` | a page script asking for a location, a camera or a microphone. The app uses none of the three, so the capability is removed rather than left to a prompt a user could be talked into accepting |
| `default-src 'self'` | every fetch directive the policy does not name, which now falls back to same-origin only |
| `script-src 'self'` | injected script. The build has no inline script and the SPA uses no `eval`, `new Function` or `dangerouslySetInnerHTML`, so an injection point has nothing to execute |
| `img-src 'self' data:` | image-based exfiltration, while still covering every image the app renders: same-origin avatars, bundled `data:` icons and the DiceBear `data:` fallback |
| `connect-src 'self'` | scripted exfiltration and command-and-control channels, while leaving the same-origin Socket.IO connection working |
| `object-src 'none'` | plugin content (`<object>`, `<embed>`), which nothing in the app uses and which `script-src` does not always govern |
| `base-uri 'self'` | an injected `<base href>` re-pointing every relative URL on the page at another origin |
| `frame-ancestors 'self'` | clickjacking, in the form browsers honour even when they ignore `X-Frame-Options` |
| `form-action 'self'` | a form on the page posting to another origin |
| `upgrade-insecure-requests` | a stray `http://` subresource request being fetched in the clear |

#### `nginx/conf/nginx.conf`

| Directive | The attack it closes |
|---|---|
| `Strict-Transport-Security: max-age=31536000; includeSubDomains` on the direct listener | protocol downgrade and cookie theft over plain HTTP, for our own host and its subdomains |
| `Strict-Transport-Security: max-age=31536000` on the tunnel listener | the same for the ngrok host, without claiming subdomains of a domain we do not own |
| `ssl_ciphers` (six ECDHE suites, all AEAD) with `ssl_prefer_server_ciphers off` | a downgrade attack that forces RSA key exchange, which has no forward secrecy, or a CBC suite, which has measurable padding weaknesses. Left at the build default, the strongest suite is optional rather than required. Rationale under [Transport security](#transport-security-tls) |
| `ssl_session_tickets off` | decryption of recorded sessions from a single captured ticket key, which is the forward secrecy the ECDHE suites were chosen to give. Rationale under [Transport security](#transport-security-tls) |
| `limit_conn_zone $binary_remote_addr zone=conn:10m` | nothing on its own: it is the bucket the two caps below count in |
| `limit_conn_status 429` | a capped request answering nginx's default `503`, which clients retry while monitoring counts it as an outage |
| `limit_conn conn 100` on the direct listener | one client holding connections open until worker connections run out. Every direct client shares one address behind Docker's NAT, so the value is deliberately high. See [Rate limiting](#rate-limiting) |
| `limit_conn conn 30` on the tunnel listener | the same abuse from the internet, keyed on the real visitor recovered from `X-Forwarded-For`, so here it is a true per-visitor cap. See [Rate limiting](#rate-limiting) |
| `client_max_body_size 3M` | a body large enough to spend the edge's memory and disk, while still leaving room for a 2 MB avatar plus its multipart overhead |

**Mitigates:** clickjacking, MIME sniffing, referrer leakage, inline script execution from any
injection point, data exfiltration through an image or a `fetch`, plugin content invoked through
`<object>`, form redirection to a foreign origin, and a page script asking for a camera, a microphone
or a location.


---


## Rate limiting

### At the edge (nginx, keyed on the client address)

| Zone | Rate | Burst | Applies to |
|---|---|---|---|
| `login` | 5 r/m | 5 | `= /api/auth/login` only |
| `refresh` | 30 r/m | 15 | `= /api/auth/refresh` only |
| `auth` | 60 r/m | 20 | the `/api/auth/` prefix (`/me`, `/logout` and the rest of the auth flows) |
| `leaderboard` | 30 r/m | 20 | `= /api/leaderboard`, which also rejects every method but `GET` with a `405` |
| `api` | 600 r/m | 100 | every other `/api/` route (user, friends, game, notifications, stats) |
| `guest` | 10 r/m | 5 | `= /api/match/guest`, the only account-less room allocator |

- `limit_req_status 429` makes a throttled request answer `429 Too Many Requests`, matching the
  NestJS throttler. nginx's default `503` reads as a broken server, so clients retry it and
  monitoring counts it as an outage.
- Location precedence does the routing: nginx matches an exact location before a prefix, so
  `/api/auth/login` uses the tight `login` zone rather than the `auth` prefix, and a request that a
  tighter zone matched never reaches the loose `api` zone.
- The `api` zone is deliberately loose: one SPA page load fans out across several endpoints, so it is
  a ceiling on hammering rather than a usage quota.
- The `guest` zone fronts `= /api/match/guest`, the only account-less room allocator. Two more layers
  sit behind it: the route's own `@Throttle` (20/min) and the six-hour per-address budgets in
  `GuestLimitService` (mint ladder to 40, 3 live rooms per address, 50 live rooms overall). See
  [guest-mode.md](guest-mode.md).

### Connection cap (nginx `limit_conn`)

A rate limit bounds how fast requests arrive, not how many are open at once. A client that reads
slowly, or that holds the notification SSE stream and the game socket open, passes every rate limit
while holding server resources. Each listener therefore caps requests in flight per address as well:

| Listener | Cap | Keyed on | Why this value |
|---|---|---|---|
| `8443` direct | `limit_conn conn 100` | the bridge address every direct client shares | Docker's NAT collapses all direct clients onto one address, so this is a shared ceiling rather than a per-client one. Set high on purpose: it bounds a runaway client without policing normal use. |
| `8444` tunnel | `limit_conn conn 30` | the real visitor, resolved from `X-Forwarded-For` | On this path the address is genuinely per visitor, so this is a real per-visitor cap. A page plus a game socket and a notification stream uses a handful. |

`limit_conn_status 429` answers a capped request with the same status as a throttled one, so a client
gets a consistent signal instead of nginx's default `503`.

**Mitigates:** one client, or one script, holding many connections open at once to exhaust worker
connections or upstream sockets, including the slow-read case that a request rate limit does not
cover.

### Which client address each listener trusts

Throttling is only as good as the address it keys on, so the two listeners differ on purpose:

- **`8443` (direct):** no forwarded header is trusted. Docker's port publishing rewrites the peer
  address to the bridge gateway, so the limits there are honestly a shared bucket. The only
  alternative would be a client-supplied header, and trusting it would let any client choose its own
  bucket.
- **`8444` (tunnel):** the client is resolved from `X-Forwarded-For` with `set_real_ip_from` for the
  private ranges, `real_ip_header X-Forwarded-For` and `real_ip_recursive on`. This is safe because
  the port is published on loopback only, so the ngrok agent is the only possible peer. The recursive
  walk takes the first address from the right that is not in a trusted range, so a value the visitor
  sent themselves is never the one chosen.
- nginx overwrites `X-Forwarded-For` with `$remote_addr` before proxying, so the backend never sees a
  client-supplied value.
- The backend sets `trust proxy` to `loopback`, `linklocal` and `uniquelocal`, so `req.ip` is a real
  client address for its own throttler and cannot be spoofed from outside those ranges.

### In the API (NestJS throttler)

A global default of 300 requests per minute per client, plus per-route overrides. Every override lives
in one table, `backend/src/common/throttles.ts`, grouped by controller, so the coverage can be audited
in a single place; `app.module.ts` installs the guard.

| Route | Limit |
|---|---|
| `POST /api/auth/register` | 5 per hour |
| `POST /api/auth/login` | 5 per minute |
| `POST /api/auth/2fa/verify` | 5 per minute |
| `POST /api/auth/2fa/resend` | 5 per hour |
| `PATCH /api/auth/2fa` | 10 per hour |
| `POST /api/auth/refresh` | 30 per minute (kept in step with the nginx zone) |
| `POST /api/auth/forgot-password` | 3 per hour |
| `POST /api/auth/reset-password` | 5 per 15 minutes |
| `POST /api/auth/resend-verification` | 3 per hour |
| `PATCH /api/auth/profile` | 10 per hour |
| `POST /api/auth/profile/resend-email-change` | 5 per hour |
| `PATCH /api/auth/profile/password` | 5 per hour |
| `DELETE /api/auth/profile` | 5 per hour |
| Friends writes (`request`, `block`, `unblock`, invite) | 20 per minute |
| Friends writes (`accept`, `decline`, `remove`, `dismiss`) | 30–60 per minute |
| Match creation (`create`, `pve`, `pvp/invite`) | 10 per minute |
| Match actions (`join`, `invite`, `exit`, `abort`) | 20–30 per minute |
| Match ready / rejoin | 60 per minute |
| `GET /api/notifications/stream` | 60 connections per minute |
| Notification reads (`markRead`) / `read-all` | 120 / 30 per minute |
| Presence heartbeat / logout clear | 60 / 10 per minute |
| Avatar upload / delete | 10 per hour each |
| `POST /api/achievements/check` | 30 per hour |

The notification SSE stream additionally caps **5 open streams per user** (F-11): the sixth answers
`429 NOTIFICATION_STREAM_LIMIT` before it registers a Subject or a Redis subscription, so one account
cannot grow the process's stream list without bound.

Per-account limits complement the per-address ones: at most 3 email-change links per hour per user (a
Redis counter with a rolling window), at most 3 resends of a 2FA code per hour, and 5 wrong 2FA
codes invalidate the challenge outright.

**Mitigates:** credential brute force, verification and reset mail spam (which also turns the app
into a nuisance mail sender aimed at a victim's inbox), repeated 2FA code guessing, scripted
hammering of the API and of the heavy mutating routes, and SSE-subscription exhaustion.

### Per-account login lockout

Everything above counts the caller's address, which leaves one gap: an attacker rotating through
proxies gets a fresh budget at every address. `LoginLockoutService`
(`backend/src/auth/login-lockout.service.ts`) counts failures against the account instead, so a
single account is only attacked as fast as its own streak allows.

Failures are stored in Redis as `login:fail:<sha256(identifier)>`: hashed, so the store holds no
usernames or addresses, and case-folded, so one account cannot be given two separate budgets by
alternating the case of its name.

| Failed logins in the streak | Effect on the next attempt |
|---|---|
| 0–4 | none: the password is checked as usual |
| 5–9 | held back by `min(2^n, 30)` s before the password is checked (2, 4, 8, 16, then 30) |
| 10+ | refused outright: every attempt returns `401 AUTH_INVALID_CREDENTIALS` before the password is checked, so refusals do not extend the count; the lock lifts 15 minutes after the 10th failure |
| any, once the correct password is given | the counter is deleted |

The counter expires 15 minutes after the last recorded failure. Thresholds are tunables in
`AUTH.loginLockout` (`auth.constants.ts`). An identifier that does not exist is counted and delayed
exactly like a real one, so the lockout says nothing about which accounts exist.

Every refusal returns the body a wrong password returns (`401 AUTH_INVALID_CREDENTIALS`), for two
reasons: a distinct "account locked" message would be an enumeration oracle, and the SPA already
renders that code in all three locales, so the lockout adds no user-visible string. Redis is already
required to finish a login (the refresh-token session store lives there), so this adds no new
dependency, and a Redis outage fails closed rather than skipping the count.

**Mitigates:** distributed credential stuffing: guesses at one account are capped by that account's own
failure streak, however many addresses the caller rotates through. The cost is that an attacker who
knows a username can deny its owner a login for 15 minutes; that is the deliberate trade, and the
account recovers on its own.


---


## Sessions and authentication

- **Access token:** a JWT with `iss: ft_transcendence`, `aud: ft_transcendence-api`, a string `sub`
  (the user id), `HS256` and a 15 minute lifetime. `JwtStrategy` enforces the issuer, the audience
  and the algorithm, and rejects a token whose `sub` is missing or not a string, so a malformed token
  cannot widen a database query.
- **Delivery:** both tokens travel in cookies that are `httpOnly` (script cannot read them),
  `SameSite=Lax` (a cross-site form post does not carry them) and `Secure` in production. The access
  cookie is scoped to `path=/`; the refresh cookie is scoped to `path=/api/auth`, so the browser only
  sends it to the refresh and logout routes.
- **CSRF:** every mutating request under `/api` must satisfy two independent checks (`common/csrf.ts`,
  mounted before the routes in `main.ts`). The `Origin` header (or `Referer` when `Origin` is absent)
  must name this host or a published frontend origin (`FRONTEND_URL`, `NGROK_FRONTEND_URL`, the LAN
  origin, or the Vite dev origin), and the `csrf_token` cookie — script-readable, `SameSite=Lax`,
  `Secure` in production — must be echoed in `X-CSRF-Token`. The cookie is `nonce.HMAC` with a key
  derived from `JWT_SECRET`, so a subdomain that can write cookies still cannot mint a valid pair; a
  missing or mismatched pair is `403 CSRF_TOKEN_INVALID`, a foreign origin `403 CSRF_ORIGIN_REJECTED`.
  `GET /api/auth/csrf` bootstraps the cookie and `api.ts` retries once with a fresh token. The two
  engine callbacks are exempt: they are authenticated by `x-engine-key` and carry no browser session.
- **Re-authentication for sensitive profile changes:** changing the email, toggling 2FA, or
  unlinking an OAuth provider (and the API's `oauthToAdd` field) requires `currentPassword` on an
  account that has one (`AUTH_CURRENT_PASSWORD_INCORRECT` otherwise). The SPA's "Add a sign-in
  method" button opens the provider's login instead, which is itself a fresh authentication.
  OAuth-only accounts have no password to confirm and are trusted through the active session; their
  email change still requires setting a password first. The SPA asks for the password in the
  Edit-Profile card and in the navbar 2FA control.
- **Refresh token:** 32 random bytes, 7 days, stored in Redis only as a SHA-256 hash
  (`refresh:<hash>` maps to the user id). Every refresh consumes the old token atomically (`GETDEL`)
  and issues a new one in the same step, so two simultaneous callers cannot both redeem it. The
  consumed hash is remembered for the refresh lifetime (`refresh-used:<hash>`): a replay inside the
  15 s grace window whose replacement is still live is the documented two-tab race and is answered as
  expired without revoking anything, while a later replay revokes **every** session of that user and
  returns `401 AUTH_SESSION_REUSED`. Each hash is also indexed under `sessions:<userId>`, which lets
  logout revoke one session while a password reset or an account deletion revokes every session at
  once.
- **Logout** revokes the refresh token server-side and clears both cookies, repeating the path each
  cookie was set with.
- **Passwords:** bcrypt with cost 10. The policy is at least 12 characters with an upper-case letter,
  a lower-case letter, a digit and a special character, and at most 72 bytes, which is the point past
  which bcrypt ignores input. The same rules are mirrored in the client for immediate feedback.
- **Two-factor authentication:** a 6-digit code, stored in Redis as a SHA-256 hash with a 5 minute
  TTL and an attempt counter. 5 wrong codes invalidate the challenge; resends are capped at 3 per
  hour.
- **OAuth:** the callback step carries its own token type (`aud: oauth-link`, signed with a separate
  `OAUTH_STATE_SECRET`, 10 minute TTL). Because each guard requires its own audience, an OAuth
  callback token cannot be used as a session and a session token cannot complete a link. Strategy
  selection is per request: the backend picks the tunnel callback URL when the `Host` header contains
  `ngrok`, so a local client and a tunnelled client can sign in at the same time without crossing
  over.

**Mitigates:** session theft by an injected script (httpOnly), cross-site request forgery from another
site (SameSite plus the signed double-submit token and origin allow-list), session-riding of a stale
refresh token (atomic rotation with replay revocation), long-lived credential theft (short access token
plus rotation), password-less escalation of a stolen session into email/2FA/OAuth changes (re-auth),
offline cracking of stored passwords (bcrypt), silent truncation of long passwords, 2FA code guessing,
and confusion between session and OAuth tokens.


---


## Emailed link tokens

Every link the app emails carries a token of 32 random bytes. Only its SHA-256 hash is stored, so a
dump or an operational listing of Redis reveals no usable token.

| Link | Redis key | TTL | Notes |
|---|---|---|---|
| Signup verification | `verify:<sha256>` | 24 hours | single use |
| Password reset | `reset:<sha256>` | 1 hour | single use; completing a reset revokes every live session |
| Email change | `emailchange:<sha256>` | 15 minutes | single use; staged, not committed until the link is opened |

- A token is consumed as it is read: the value is fetched and deleted in the same operation, so a
  second use of the same link finds nothing.
- An email change is **verify-then-commit**. The new address is staged in Redis and the user row is
  not touched until the link is opened, at which point the address is written and the change is
  refused with a conflict if the address has been taken meanwhile.
- Requesting a new email-change link invalidates the previous one: the old key is deleted as the new
  one is written.
- At most 3 email-change links per user per hour (a Redis counter with a rolling window), on top of
  the route-level throttle.

**Mitigates:** replay of an emailed link, a stale link remaining valid after a newer one was issued,
token exposure through a dump or a backup of the data store, and an unverified address being written
into the user row.


---


## Emailed links cannot reach a log

Every emailed link points at the SPA with the token in the **URL fragment**: as in
`https://<host>/verify-email#token=<64 hex characters>` and
`https://<host>/reset-password#token=<64 hex characters>`. A fragment is never sent to the server,
so it cannot appear in the nginx access log, the nginx error log, browser history or a `Referer`
header.

The SPA reads the fragment on first render, removes it with `history.replaceState` before the
request is made, and sends the token in the body of the matching `POST` route. The body is not
logged.

The fragment also closes a second channel that a query string leaves open: nginx sends
`Referrer-Policy: strict-origin-when-cross-origin`, which still puts the full URL, query string
included, in the `Referer` of same-origin subresource requests, so a token in the query string
would be re-logged on every asset and `/api` request the page makes. A fragment is never part of a
`Referer`.

- `POST /api/auth/verify-email` answers with one of `signup`, `change`, `conflict` or `invalid`, so
  the page can route without any secret coming back. There is no `GET` variant of the route: a link
  minted by an older build fails instead of falling back to a URL the proxy logs.
- `POST /api/auth/reset-password` takes the token and the new password in the body, and revokes the
  account's live sessions when the reset succeeds.

**Mitigates:** single-use verification and reset tokens being recorded in plaintext by the reverse
proxy, where anyone with access to the logs (or to a log-forwarding destination) could redeem
another user's link.


---


## Game engine boundary

- **The engine is not reachable directly.** It publishes on loopback only, and the SPA connects to
  `/socket.io/` on its own origin, which nginx proxies over TLS. A loopback connection on its own is
  never enough to reach a game.
- **Every socket is authenticated by an engine-issued credential.** A match token is signed with a
  dedicated secret (`ENGINE_JWT_SECRET`) that is separate from the session secret; the engine refuses
  to boot without it, and the backend entrypoint preflight aborts when it is missing. A guest token
  is the opaque registry entry described in the next bullet.
- **A guest socket is authenticated by an opaque token, not a JWT.** `POST /api/match/guest` mints
  `g_<32 random bytes>` and stores `guesttok:<sha256(token)>` in Redis with a 1 h TTL. The engine
  branches on the `g_` prefix, resolves the record and takes the room and seat from it; a forged or
  expired token is simply not found. Guests also drive an allow-list (`GUEST_EVENTS`) and cannot
  reach the account-shaped events. See [guest-mode.md](guest-mode.md).
- **A signed match token must be `HS256`**, must carry the `aud: ludo-engine` claim, its signature is
  compared with `timingSafeEqual` (constant time) and its `exp` is honoured. A session access token
  fails all three checks.
- **The token, not the client, names the room and the seat.** The engine keeps the token's match id
  and colour as authoritative; the argument a client passes to `join_game` is only a fallback. A
  refused join leaves the room and clears the socket's binding, so its later disconnect cannot mark a
  live player as gone.
- **The backend mints a token only for a seat the caller still owns**, in a match the engine has
  neither started nor finalized. The engine's own state is read for that decision; the cached
  `match:*` hash is never trusted on its own.
- **The engine calls back into the backend** with an `X-Engine-Key` header holding `ENGINE_API_KEY`,
  so the game-result endpoints do not accept an ordinary user session. The header is compared in
  constant time (`verifySecret` hashes both sides before `timingSafeEqual`, so a wrong-length key
  cannot throw or leak its length), and neither side has a default: the backend preflight and the
  engine boot both refuse to start when the variable is empty.
- **Only the app's own origins may open a socket.** The engine answers a Socket.IO handshake only for
  origins on the allow-list compose builds from `FRONTEND_URL` and `NGROK_FRONTEND_URL` (the LAN and
  tunnel origins). An empty list stops the process instead of widening to `origin: '*'`, so a missing
  value cannot silently hand every website a handshake. A token is still needed to join a game, so
  this closes the connection itself rather than the seat.
- **What a socket may send is bounded.** Events are capped at 64 KB (`maxHttpBufferSize`, the OWASP
  figure, against the 1 MB default), one account may hold at most 4 sockets (the fifth handshake is
  refused, which still leaves room for a stale socket during a refresh and a clash pipe), the engine pings every 10 s and drops a socket that takes more than 15 s to
  answer, and inbound events are metered per socket by a 20-event token bucket that refills over 5 s.
  A socket that drains the bucket is closed, which runs the same disconnect path as a dropped
  connection, so its seat falls into the normal reconnect grace window (45 s) rather than being held
  open by a flood.

The twelve holes found in the first version of this boundary, and the rule that now closes each one,
are tabulated in [`architecture.md`](architecture.md) (Security & Threat Model); the engine-side
detail is in [`ludo-engine/ludo-engine-socket-system.md`](ludo-engine/ludo-engine-socket-system.md)
(CORS allow-list and socket limits).

**Mitigates:** forging a game credential from any other token or key that shares the session secret,
joining a room or claiming a seat the caller does not own, a refused socket continuing to receive a
game's broadcasts, a stale duplicate socket closing a seat that is live, a foreign page opening a
socket against the engine, and one connected socket tying the engine up with oversized or rapid
events.


---


## Input validation and uploads

- Every request body is validated by `class-validator` decorators through a global `ValidationPipe`
  with `whitelist: true` (unknown properties are stripped before a handler sees them) and
  `transform: true` (declared types are coerced).
- Validation failures return a stable code that the SPA localizes, so an error response never carries
  internals.
- Fields with a meaningful shape have explicit rules, including the verification token, which must be
  exactly 64 hex characters: a malformed body is rejected before any data-store lookup.
- **Avatars** are validated before anything is stored. The upload is limited to 2 MB and to PNG,
  JPEG, GIF or WebP, and the server compares the leading bytes of the file against the signature of
  the declared type (`89 50 4E 47 0D 0A 1A 0A` for PNG, `FF D8 FF` for JPEG, `47 49 46 38` for GIF,
  `52 49 46 46` plus `57 45 42 50` for WebP), because the declared MIME type is only what the client
  claims. A mismatch is refused before a single byte is written. The check reads the signature only
  and does not decode the image, so a file truncated after its signature is stored, and the client
  falls back to the generated avatar when the browser cannot render it.
- Accepted bytes are stored in Postgres in a `Bytes` column through Prisma and sent back with the
  stored `Content-Type`. The database never executes or opens the file.
- Database access goes through Prisma's parameterized query builder. The one raw statement in the
  backend is the `SELECT 1` health probe.

**Mitigates:** malformed or oversized payloads, mass assignment through extra JSON properties, a
script disguised as an image behind a benign declared type, and SQL injection through user input.


---


## Data stores, secrets and configuration

- **PostgreSQL and Redis are container-internal** and published on loopback only. Both require
  credentials from the root `.env`, and every client connects with the password: the Redis server is
  started with `REDIS_PASSWORD`, each client passes it, and the healthcheck authenticates with it.
- **Redis holds derived data only:** SHA-256 hashes of the refresh, verification, reset, email-change
  and 2FA tokens, plus presence and game keys. A dump yields no usable credential.
- **Configuration lives in one gitignored `.env`** at the repo root and is loaded into containers
  with compose's `env_file`. `.env.example` is the shared template and documents every key.
- **The stack refuses to start with a missing secret.** `make env` runs before every build and fails
  with the list of empty keys; the backend reads its secrets through `requireSecret()`, which throws
  at boot rather than signing with `undefined`; the backend entrypoint preflight aborts on a missing
  `DATABASE_URL`, `JWT_SECRET`, `ENGINE_JWT_SECRET`, `OAUTH_STATE_SECRET` or `ENGINE_API_KEY`, and the
  engine exits when `ENGINE_API_KEY` or `CORS_ORIGIN` is empty rather than substituting a default.
- **A schema change cannot destroy data unattended.** The backend entrypoint applies `prisma db push`
  without `--accept-data-loss`, so drift that would drop or narrow a column aborts the boot instead of
  being applied. A fresh database and additive changes still apply as before.
- **The frontend stores no session credential.** The session lives in the httpOnly cookies only; nothing
  session-like is kept in `localStorage` or `sessionStorage`. The one token that is stored is the engine
  *match* ticket: `sessionStorage['lr.activeMatch']` (`store.tsx`) holds
  `{ gameId, token, color, mode, playerCount }` so a page refresh can rejoin the same seat. It is signed
  with `ENGINE_JWT_SECRET` (not the session secret), carries `aud: "ludo-engine"`, is bound to one
  game/seat, lives 24 h, and is rejected by the backend API, so it cannot be replayed as a session.
  CSP `script-src 'self'` (set by nginx) is the standing XSS defence for that stored value.
- **CORS is not enabled on the backend.** Every call the SPA makes is same-origin through nginx, so
  the backend emits no cross-origin permission at all: there is no allow-list to get wrong and no
  `Access-Control-Allow-Origin` for another site's page to make use of. The engine, which browsers
  reach over the WebSocket transport, is the one service with a CORS list, and that list is an
  allow-list of the app's own origins (never `*`) — see
  [Game engine boundary](#game-engine-boundary).

**Mitigates:** recovering a token or a password from a cache dump, starting a service with an empty
secret (which would make signatures forgeable), a session being readable by an injected script, and a
cross-origin page calling the API with the user's cookies.


---


## References

- [`architecture.md`](architecture.md): topology, request paths, and the game engine socket threat
  model in full.
- [`deploy/nginx.md`](deploy/nginx.md) and [`deploy/tunnel.md`](deploy/tunnel.md): the two TLS
  listeners, the rate-limit zones, and the ngrok callback setup.
- [`backend/backend-auth-module.md`](backend/backend-auth-module.md): the session, token and
  verification flows in detail.
- [`ludo-engine/ludo-engine-socket-system.md`](ludo-engine/ludo-engine-socket-system.md): the
  handshake, `join_game` and disconnect rules.
- `security-review.md`: the review behind this list, private working notes that are not part of this
  doc set.
