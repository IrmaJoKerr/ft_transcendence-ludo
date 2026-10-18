# nginx

How nginx sits in front of everything, and why it's the one piece that lets
local, LAN, and ngrok tunnel mode all work without the frontend or backend
knowing which one is in play. Companion docs: [`lan.md`](./lan.md),
[`tunnel.md`](./tunnel.md), [`security_measures.md`](../security_measures.md).

Verified directly against the current repo (`nginx/conf/nginx.conf`,
`nginx/conf/app.inc`, `compose.yaml`). The shared routing/limits live in `nginx/conf/app.inc`; see
[Static-asset delivery](#static-asset-delivery) at the bottom for how the SPA is
served.


---
---


## The one idea that makes this simple

nginx is the **only** server that any client communicates with, and it exposes
**two** TLS listeners that share one server body:

- **`:443`** (published on the host as `8443`, on all interfaces) serves direct
  clients — a browser on your machine, or another device on the LAN.
- **`:444`** (published as `127.0.0.1:8444`, loopback only) serves the ngrok
  tunnel agent and nothing else.

The routing itself — serving the SPA, proxying `/api/*` and `/socket.io/*`, the
security headers, the rate-limit locations — does not live in either listener.
It lives once in `nginx/conf/app.inc`, which both `server {}` blocks `include`,
so the two modes cannot drift.

`nginx` then proxies to `backend:3000` and `ludo-engine:3001` over the internal
Docker network. The frontend SPA only ever calls relative paths (`/api/...`,
`/socket.io/...`), so it never needs to know or care which mode it's running
under — same-origin `fetch`/WebSocket calls resolve against whatever host the
browser actually typed in the address bar.

```
                    ┌────────────────────────────────────────────────┐
 browser ─https──►  │ nginx :443   ·  host :8443  ·  all interfaces  │
 (local / LAN)      │   direct listener — no header trust            │
                    ├────────────────────────────────────────────────┤
 ngrok agent ─────► │ nginx :444   ·  host 127.0.0.1:8444 · loopback │
 (tunnel)           │   tunnel listener — trusts X-Forwarded-For     │
                    └────────────────────────────────────────────────┘
                              both include nginx/conf/app.inc:
                                serves SPA · proxies:
                                /api/        → backend:3000
                                /socket.io/  → ludo-engine:3001
```

Why two listeners rather than one: throttling keys on the client address, and the
two entry paths see that address very differently. Direct clients reach `:443`
through Docker's port forwarding, which rewrites the peer address to the bridge
gateway — so no header trust is possible there, and the limits are honestly a
shared bucket. The ngrok agent reaches `:444` from inside the host, and the
loopback-only publish means it is the only process that can — so `:444` can
safely believe `X-Forwarded-For`, which is what makes per-visitor throttling
actually work behind the tunnel. See [Rate limiting](#rate-limiting).

Only `nginx`'s `"8443:443"` mapping is published on all interfaces; the
`"127.0.0.1:8444:444"` tunnel mapping is loopback-only, like every other
service's debugging port (`backend`, `db`, `redis`, `studio`, `ludo-engine`
publish `127.0.0.1:<port>:<port>` for host-side `psql`, Prisma Studio and
`npm run dev`). Nothing but nginx's `:443` is reachable from another device —
that's what makes [tunnel mode](./tunnel.md) need zero extra routing config of
its own.

Neither mapping sits behind a compose profile, so both are created every time
the stack starts: `8444` is bound even with no ngrok agent running, and
`compose up` fails if the host already has either port in use. The agent itself
also binds `127.0.0.1:4040` while a tunnel runs, for its local API, which
`make tunnel-url` reads.


---
---


## TLS

`nginx/Dockerfile` generates a self-signed cert at build time (`openssl req
-x509 ... -days 365`, CN `transcendence-ludo`) and bakes it into the image
at `/etc/nginx/ssl/`. This is why every mode — local and the ngrok tunnel —
shows a browser certificate warning once: nginx only ever
terminates TLS with this one self-signed cert, in every mode. Each `server {}`
block in `nginx.conf` declares that same `ssl_certificate`/`ssl_certificate_key`
pair, restricts to `TLSv1.2`/`TLSv1.3`, and inherits one pinned ECDHE cipher list
(`ssl_ciphers`, `ssl_prefer_server_ciphers off`, `ssl_session_tickets off`) from
the shared `http` block. The standard hardening headers (`X-Frame-Options`, a
`Content-Security-Policy`, `Permissions-Policy`, etc.) live once in the shared
`nginx/conf/app.inc` that both listeners `include`; `HSTS` is the exception and
is set in each `server {}` block instead, because only the direct listener may
pin subdomains (the tunnel listener serves an ngrok subdomain it does not own).


---
---


## Serving the SPA

The frontend is a separate container (`frontend` service) that runs
`tsc -b && vite build` on every source change and publishes the output into
a shared named volume, `spa_dist`. nginx mounts that volume read-only at
`/usr/share/nginx/html` and just serves static files off disk — there is no
Node/Vite process involved at runtime. `location /` uses
`try_files $uri $uri/ /index.html` so client-side routes (React Router)
resolve correctly on a hard refresh instead of 404ing.


---
---


## Routing table (active config, in `nginx/conf/app.inc`)

| Path | Behaviour |
|---|---|
| `/` | Serves the SPA; falls back to `/index.html` for client-side routes |
| `= /api/leaderboard` | GET-only, rate-limited 30 req/min (burst 20), proxied to `backend:3000` |
| `= /api/auth/login` | Rate-limited 5 req/min (burst 5) — brute-force defense in depth behind the backend's own throttler |
| `= /api/auth/refresh` | Rate-limited 30 req/min (burst 15) — `apiFetch` fires this automatically on any 401, so several tabs can legitimately burst at once |
| `/api/auth/` | Rate-limited 60 req/min (burst 20) — covers `/api/auth/me`, which the SPA calls on page load for non-public routes (the probe is skipped on `/`, `/login`, `/signup`), and `/api/auth/logout` |
| `/api/` | Rate-limited 600 req/min (burst 100) — the loose ceiling over everything under `/api/` not matched above. Generic proxy to `backend:3000`; `proxy_read_timeout`/`proxy_send_timeout` are raised to 3600s and `proxy_buffering` is off — needed for `/api/notifications/stream`, a long-lived SSE response that can sit idle for minutes between notifications. nginx's 60s default was closing that stream mid-chunk (the client saw `ERR_INCOMPLETE_CHUNKED_ENCODING`), and buffering held back the events that did arrive |
| `= /api/health` | Proxied to `backend:3000/health` (rewritten — NestJS mounts `/health` at its root, not under `/api`) |
| `/socket.io/` | Proxied to `ludo-engine:3001`, with the `Upgrade`/`Connection` headers set from the `map $http_upgrade $connection_upgrade` block so WebSocket upgrades work. Also 3600s timeouts, for long game sessions. The browser therefore never opens a socket to `ludo-engine:3001` itself: a plain `ws://` call would be blocked as mixed content on an HTTPS page, and that port is not published for the host |
| `~ /\.` | Denies any dotfile path (`.env`, `.git`, etc.) |

All of the `/api/*` locations set `X-Real-IP`, `X-Forwarded-For`, and
`X-Forwarded-Proto`. On the direct `:443` listener these carry the peer address
(the Docker gateway) and `$scheme`; on the `:444` tunnel listener the `real_ip`
module has already rewritten `$remote_addr` to the real visitor, so the backend
sees the visitor's address rather than ngrok's.

`resolver 127.0.0.11 valid=10s;` points nginx at Docker's embedded DNS and
caches service-name lookups for only 10s. Without this, `proxy_pass` would
resolve `backend`/`ludo-engine` once and cache the IP for the life of the
nginx worker — restarting either service in dev would leave nginx stuck
retrying an unreachable IP address until nginx itself restarted.


---
---


## Rate limiting

Every `/api/**` route is also throttled inside the backend by the NestJS throttler;
nginx adds a per-IP layer in front of it, so a burst is stopped before it reaches
Node. nginx keys its buckets on `$binary_remote_addr`. On the direct `:443`
listener that is the connection's peer address, which a client cannot spoof; on
the `:444` tunnel listener the `real_ip` module first rewrites `$remote_addr`
from `X-Forwarded-For`, so each visitor gets their own bucket instead of every
tunnel request sharing ngrok's address (see
[The one idea that makes this simple](#the-one-idea-that-makes-this-simple)).

`limit_req` is a leaky bucket, not a per-minute quota: `rate=60r/m` refills one token
per second, and `burst=N nodelay` allows up to `N` tokens to be spent at once without
delay. The zones and the locations that spend them:

| Zone | Rate | Burst | Used by | Notes |
|------|------|-------|---------|-------|
| `leaderboard` | 30 r/m | 20 | `= /api/leaderboard` | Enough for normal page loads and filter changes, tight against scripted hammering |
| `login` | 5 r/m | 5 | `= /api/auth/login` | Brute-force defense |
| `refresh` | 30 r/m | 15 | `= /api/auth/refresh` | `apiFetch` fires this automatically on any 401, so several tabs resuming at once burst legitimately. Kept in step with the route's `@Throttle` in `auth.controller.ts` |
| `auth` | 60 r/m | 20 | `/api/auth/` prefix, which covers `/api/auth/me` and `/api/auth/logout` | The SPA calls these on every page load and in every tab; at the earlier 10 r/m a handful of tabs spent the bucket and got a 503 mid-session |
| `api` | 600 r/m | 100 | `/api/` prefix — everything not matched above (user, friends, game, notifications, stats) | Deliberately loose: one SPA page load fans out across several of these, so it is a ceiling on hammering rather than a usage quota |
| `guest` | 10 r/m | 5 | `= /api/match/guest` | The only account-less room allocator. The loose `api` budget would let one address mint rooms in a burst; the six-hour budgets in `GuestLimitService` sit behind this zone |

`limit_req_status 429;` makes a throttled request answer `429 Too Many Requests`,
matching the NestJS throttler. nginx's default is `503`, which reads as a broken
server: clients retry it and monitoring counts it as an outage.

Requests already in flight are capped separately, because `limit_req` bounds how fast
requests arrive, not how many are open at once: `limit_conn conn` allows 100
simultaneous requests per address on `:443` (all direct clients share one address
behind Docker's NAT, so the value is deliberately high) and 30 on `:444`, where the
address is a real visitor. `limit_conn_status 429;` keeps the status consistent with a
throttled request. Both the `limit_req` and the `limit_conn` zones are declared in the
`http` block of `nginx.conf`.

Location precedence matters here, because nginx matches exact (`=`) locations before
prefixes: `/api/auth/login` is handled by the `login` zone rather than the `auth`
prefix, `/api/match/guest` by the `guest` zone rather than the `api` prefix, and
`/api/leaderboard` never reaches the generic `/api/` block (it also rejects every
method but `GET` with a 405). Everything else under `/api/` falls through to the loose
`api` zone.


---
---


## Vite dev proxy (`frontend-dev`)

Under `make dev` the SPA is served by Vite on :8080 instead of nginx, so `vite.config.ts` repeats the two proxy `location` blocks from `nginx.conf`:

| Prefix | In-container target | Host (`npm run dev` - outside compose) target | Env override |
|---|---|---|---|
| `/api` | `http://backend:3000` | `http://localhost:3000` | `VITE_API_TARGET` |
| `/socket.io` | `http://ludo-engine:3001` | `http://localhost:3001` | `VITE_ENGINE_TARGET` (with `ws: true`) |

`VITE_IN_CONTAINER=true` (set by `Dockerfile.dev`) selects the in-container service names; otherwise the host's published ports are used. Repeating `nginx.conf` here is intentional: nginx, this dev server, and (for the engine) direct Docker DNS all behave identically, so no absolute backend URL ever leaks into the SPA and the browser never needs to know the engine's real address.


---
---


## Static-asset delivery

The SPA is served straight off the `spa_dist` volume by the shared
`nginx/conf/app.inc` body (`root /usr/share/nginx/html;` plus
`try_files $uri $uri/ /index.html`). The current config sets **no compression
and no explicit cache policy**: `gzip` is not enabled, and there is no
`expires`/`Cache-Control` override for `/assets/` or `/index.html`, so assets
go out uncompressed and are revalidated through nginx's default
`ETag`/`Last-Modified` handling. (Adding `gzip` and an `expires` policy later
is an `app.inc`-only change.) `text/event-stream` is not compressed either, so
`/api/notifications/stream` keeps flushing events live.

### `nginx/conf/app.inc` — the shared server body

`app.inc` holds everything a `server {}` needs to serve traffic:

- the security headers (`X-Frame-Options`, `CSP`, `Permissions-Policy`, …), minus
  `HSTS`, which has to differ per listener,
- `root`/`index` and the `/` SPA fallback,
- every `location` block, including the `limit_req` and `limit_conn` caps listed above
  (the zone declarations themselves are in the `http` block of `nginx.conf`),
- the upstream targets (`backend:3000`, `ludo-engine:3001`).

`nginx/conf/nginx.conf` holds the `http` block and the two `server {}` blocks: the
`listen`/`ssl` directives, the shared cipher list and connection-cap zone, what
has to differ per listener (`HSTS`, and on `:444` the `real_ip` block and its
`limit_conn` value), and each block ends with `include /etc/nginx/app.inc;`.
There is no duplicated routing to keep in sync: one body, two listeners.

Both the `Dockerfile` (`COPY conf/app.inc /etc/nginx/app.inc`) and `compose.yaml`
(`./nginx/conf/app.inc:/etc/nginx/app.inc:ro`) supply the file, so the image is
runnable standalone and config edits need only a container restart. Remove
either while `nginx.conf` still `include`s it and nginx fails to start — the
include and its two providers move together.
