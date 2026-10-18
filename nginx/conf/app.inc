# ═══════════════════════════════════════════════════════════
# Shared server body: security headers, SPA routing and all proxying.
#
# Included by BOTH TLS listeners in nginx.conf so the two cannot drift:
#   :443  direct clients (localhost / LAN), remote_addr is the peer
#   :444  tunnel clients via ngrok, remote_addr is resolved from
#         X-Forwarded-For by the real_ip module (see nginx.conf)
#
# Every rate-limit zone used below keys on $binary_remote_addr, so each
# listener limits on whatever its own block established as the client
# address. Nothing here needs to know which mode it is serving.
# ═══════════════════════════════════════════════════════════

# Security headers, all with `always` so error responses carry them too.
# CSP keeps style-src 'unsafe-inline' (React inline styles and Tailwind need it)
# and allows the Google Fonts, FontAwesome and Codepen font origins only.
# HSTS is not here: it is set per listener in nginx.conf, next to each host.
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), camera=(), microphone=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; upgrade-insecure-requests;" always;

# Root directory of the React SPA static files
root /usr/share/nginx/html;
index index.html;

# ═══════════════════════════════════════════════════════
# SPA ROUTING: all non-file requests serve index.html
# so React Router handles the frontend navigation
# ═══════════════════════════════════════════════════════
location / {
    try_files $uri $uri/ /index.html;
}

# ═══════════════════════════════════════════════════════
# LEADERBOARD API: GET-only, per-IP throttled. Exact match
# wins over the generic /api/ prefix below.
# ═══════════════════════════════════════════════════════
location = /api/leaderboard {
    if ($request_method !~ ^(GET)$) {
        return 405;
    }
    limit_req zone=leaderboard burst=20 nodelay;
    set $backend_upstream http://backend:3000;
    proxy_pass $backend_upstream;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ═══════════════════════════════════════════════════════
# AUTH API: per-IP throttled, tighter than the generic /api/
# prefix below. Exact match on /api/auth/login wins over the
# broader /api/auth/ prefix, which wins over /api/.
# ═══════════════════════════════════════════════════════
location = /api/auth/login {
    limit_req zone=login burst=5 nodelay;
    set $backend_upstream http://backend:3000;
    proxy_pass $backend_upstream;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# Exact match, so it wins over the /api/auth/ prefix below.
location = /api/auth/refresh {
    limit_req zone=refresh burst=15 nodelay;
    set $backend_upstream http://backend:3000;
    proxy_pass $backend_upstream;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/auth/ {
    limit_req zone=auth burst=20 nodelay;
    set $backend_upstream http://backend:3000;
    proxy_pass $backend_upstream;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

# ═══════════════════════════════════════════════════════
# API PROXY: forwards /api/* requests to backend
# ═══════════════════════════════════════════════════════
location /api/ {
    # The generic prefix had no limit at all: everything under /api/ that is
    # not matched by a more specific location above (user, friends, game,
    # notifications, stats) was unthrottled. Deliberately loose, since the SPA
    # is chatty and a single page load fans out across several of these.
    limit_req zone=api burst=100 nodelay;
    set $backend_upstream http://backend:3000;
    proxy_pass $backend_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    # /api/notifications/stream is a long-lived SSE connection that can
    # sit idle for minutes between notifications. nginx's 60s default
    # proxy_read_timeout was cutting it mid-chunk (client sees
    # ERR_INCOMPLETE_CHUNKED_ENCODING) even though the connection was
    # still healthy: match the timeout /socket.io/ already uses below,
    # and disable buffering so SSE events flush immediately.
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
}

# Build health check: returns backend status through nginx
location = /api/health {
    set $backend_upstream http://backend:3000;
    proxy_pass $backend_upstream/health;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
}

# ═══════════════════════════════════════════════════════
# ENGINE WEBSOCKET PROXY: forwards Socket.IO traffic to the
# ludo-engine over the same secure origin (wss://<host>/socket.io/).
# Gives the browser a same-origin, TLS path to the engine so it
# never has to reach ludo-engine:3001 directly (blocked as mixed
# content, and unresolvable from the host anyway).
# ═══════════════════════════════════════════════════════
location /socket.io/ {
    set $engine_upstream http://ludo-engine:3001;
    proxy_pass $engine_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Long-lived sockets: don't cut idle gameplay connections at 60s.
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# Deny access to hidden files (e.g. .htaccess, .git, .env)
location ~ /\. {
    deny all;
    access_log off;
    log_not_found off;
}
