# nginx

How nginx sits in front of everything, and why it's the one piece that lets
local, LAN, and ngrok tunnel mode all work without the frontend or backend
knowing which one is in play. Companion docs: [`lan.md`](./lan.md),
[`tunnel.md`](./tunnel.md).

Verified directly against the current repo (`nginx/conf/nginx.conf`,
`nginx/conf/app.inc`, `compose.yaml`) rather than copied from older docs —
see [Known gotcha](#known-gotcha) at the bottom for one place where a comment
in the code no longer matches what actually runs.

## The one idea that makes this simple

nginx is the **only** thing any client ever talks to. Browsers — local, LAN,
or tunnelled — hit `nginx` on port `443` (published on the host as `8443`)
and nothing else. `nginx` then proxies to `backend:3000` and
`ludo-engine:3001` over the internal Docker network. The frontend SPA only
ever calls relative paths (`/api/...`, `/socket.io/...`), so it never needs
to know or care which of the three modes it's running under — same-origin
`fetch`/WebSocket calls resolve against whatever host the browser actually
typed in the address bar.

```
                         ┌─────────────────────────────────────────┐
 browser  ── https ──►   │  nginx :443 (published as host :8443)   │
 (local / LAN / ngrok)   │  - TLS termination (self-signed cert)   │
                         │  - serves the built SPA from spa_dist   │
                         │  - proxies /api/       → backend:3000   │
                         │  - proxies /socket.io/ → ludo-engine:3001│
                         └─────────────────────────────────────────┘
```

Only `nginx`'s port is published on all interfaces (`"8443:443"` in
`compose.yaml`). Every other service — `backend`, `db`, `redis`, `studio`,
`ludo-engine` — publishes `127.0.0.1:<port>:<port>`, loopback-only, for
host-side debugging (`psql`, Prisma Studio, `npm run dev`'s Vite proxy).
Nothing but nginx is ever reachable from another device — that's what makes
[LAN mode](./lan.md) and [tunnel mode](./tunnel.md) need zero extra routing
config of their own.

## TLS

`nginx/Dockerfile` generates a self-signed cert at build time (`openssl req
-x509 ... -days 365`, CN `transcendence-ludo`) and bakes it into the image
at `/etc/nginx/ssl/`. This is why every mode — local, LAN, and even the
ngrok tunnel — shows a browser certificate warning once: nginx only ever
terminates TLS with this one self-signed cert, in every mode. `nginx.conf`
restricts it to `TLSv1.2`/`TLSv1.3` and sets the standard hardening headers
(`X-Frame-Options`, `HSTS`, a `Content-Security-Policy`, etc.) directly in
the `server {}` block.

## Serving the SPA

The frontend is a separate container (`frontend` service) that runs
`tsc -b && vite build` on every source change and publishes the output into
a shared named volume, `spa_dist`. nginx mounts that volume read-only at
`/usr/share/nginx/html` and just serves static files off disk — there is no
Node/Vite process involved at runtime. `location /` uses
`try_files $uri $uri/ /index.html` so client-side routes (React Router)
resolve correctly on a hard refresh instead of 404ing.

## Routing table (active config, in `nginx.conf`)

| Path | Behaviour |
|---|---|
| `/` | Serves the SPA; falls back to `/index.html` for client-side routes |
| `= /api/leaderboard` | GET-only, rate-limited 30 req/min (burst 20), proxied to `backend:3000` |
| `= /api/auth/login` | Rate-limited 5 req/min (burst 5) — brute-force defense in depth behind the backend's own throttler |
| `= /api/auth/refresh` | Rate-limited 30 req/min (burst 15) — `apiFetch` fires this automatically on any 401, so several tabs can legitimately burst at once |
| `/api/auth/` | Rate-limited 60 req/min (burst 20) — covers `/api/auth/me` and `/api/auth/logout`, which the SPA calls on every page load/tab |
| `/api/` | Generic proxy to `backend:3000`. `proxy_read_timeout`/`proxy_send_timeout` are raised to 3600s and buffering is off — needed for `/api/notifications/stream`, a long-lived SSE connection that can sit idle for minutes |
| `= /api/health` | Proxied to `backend:3000/health` (rewritten — NestJS mounts `/health` at its root, not under `/api`) |
| `/socket.io/` | Proxied to `ludo-engine:3001`, with the `Upgrade`/`Connection` headers set from the `map $http_upgrade $connection_upgrade` block so WebSocket upgrades work. Also 3600s timeouts, for long game sessions |
| `~ /\.` | Denies any dotfile path (`.env`, `.git`, etc.) |

All of the `/api/*` locations set `X-Real-IP`, `X-Forwarded-For`, and
`X-Forwarded-Proto` so the backend sees the client's real IP (used by its own
rate limiting) and knows the original request was HTTPS.

`resolver 127.0.0.11 valid=10s;` points nginx at Docker's embedded DNS and
caches service-name lookups for only 10s. Without this, `proxy_pass` would
resolve `backend`/`ludo-engine` once and cache the IP for the life of the
nginx worker — restarting either service in dev would leave nginx stuck
retrying a dead IP until nginx itself restarted.

## Known gotcha

**`nginx/conf/app.inc` is dead config.** It's copied into the nginx image
and bind-mounted by `compose.yaml`, and `nginx.conf`'s own comment claims
*"See conf/app.inc for the actual routing (shared so the local/LAN and
ngrok-tunnelled paths ... can't drift)"* — but `nginx.conf` never actually
`include`s it anywhere. The real, active routing is the inline `server {}`
block described above. `app.inc` looks like a leftover from an earlier
refactor (it's missing the rate-limiting locations that `nginx.conf` has,
for instance) that was never wired up, or was replaced and never deleted.

Not fixed here — flagging it rather than silently editing the config, since
that wasn't asked for.
