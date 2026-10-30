# ═══════════════════════════════════════════════════════════
# Shared server body: security headers, SPA routing and proxying.
# ═══════════════════════════════════════════════════════════

# Security headers, all with `always` so error responses carry them too.
# CSP allows inline styles plus the Google Fonts, FontAwesome and Codepen origins.
# HSTS is set per listener in nginx.conf, next to each host.
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "geolocation=(), camera=(), microphone=()" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; upgrade-insecure-requests;" always;

# Root directory of the React SPA static files
root /usr/share/nginx/html;
index index.html;

# ═══════════════════════════════════════════════════════
# SPA ROUTING: all non-file requests serve index.html.
# ═══════════════════════════════════════════════════════
location / {
    try_files $uri $uri/ /index.html;
}

# ═══════════════════════════════════════════════════════
# LEADERBOARD API: GET-only, per-IP throttled.
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
# AUTH API: per-IP throttled, tighter than the generic /api/ prefix.
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

# API PROXY: forwards /api/* to backend. The guest allocator has its own zone,
# in step with its @Throttle and the counters in GuestLimitService.
location = /api/match/guest {
    limit_req zone=guest burst=5 nodelay;
    set $backend_upstream http://backend:3000;
    proxy_pass $backend_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /api/ {
    # The generic prefix had no limit before: everything under /api/ not matched
    # above (user, friends, game, notifications, stats) was unthrottled. Loose on
    # purpose, since one page load fans out across several of these.
    limit_req zone=api burst=100 nodelay;
    set $backend_upstream http://backend:3000;
    proxy_pass $backend_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    # /api/notifications/stream is a long-lived SSE connection that can sit idle
    # for minutes. The 60 s default cut it mid-chunk, so match /socket.io/ and
    # disable buffering so events flush immediately.
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
# ENGINE WEBSOCKET PROXY: same-origin wss://<host>/socket.io/ to ludo-engine.
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

# ═══════════════════════════════════════════════════════
# SESSION WEBSOCKET PROXY: same-origin wss://<host>/ws-socket.io/ to backend.
# One socket per tab, authenticated by the `token` cookie; its own path so it
# cannot collide with the engine's default /socket.io/ above.
# ═══════════════════════════════════════════════════════
location /ws-socket.io/ {
    set $backend_upstream http://backend:3000;
    proxy_pass $backend_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Long-lived sockets: an idle SPA tab must not be cut at the 60s default.
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# Deny access to hidden files (e.g. .htaccess, .git, .env)
location ~ /\. {
    deny all;
    access_log off;
    log_not_found off;
}
