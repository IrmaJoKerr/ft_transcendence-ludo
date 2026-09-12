# ═══════════════════════════════════════════════════════════
# Shared server body, included by the :443 TLS listener (local and
# ngrok — `make tunnel` points ngrok straight at this same HTTPS port,
# there is no separate plain :80 hop).
# ═══════════════════════════════════════════════════════════

# Security headers
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header Content-Security-Policy "default-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com; font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com; img-src 'self' data: https:; connect-src 'self' ws: wss:;" always;

# SPA static files, published into a shared volume by the frontend
# build container. nginx reads them off disk — there is no frontend
# process at runtime.
root /usr/share/nginx/html;
index index.html;

# ═══════════════════════════════════════════════════════
# SPA ROUTING — all non-file requests serve index.html
# so React Router handles the frontend navigation
# ═══════════════════════════════════════════════════════
location / {
    try_files $uri $uri/ /index.html;
}

# Vite emits content-hashed filenames, so assets are safe to cache hard.
# index.html must never be cached or clients pin to a stale bundle.
#
# `expires` ONLY — deliberately no add_header here. An add_header in a
# location cancels every add_header inherited from the server block, which
# would silently strip CSP/HSTS/X-Frame-Options from these responses (and
# "/" lands here, since try_files internally redirects it to /index.html).
location /assets/ {
    expires 1y;
}

location = /index.html {
    expires -1;
}

# ═══════════════════════════════════════════════════════
# API PROXY — forwards /api/* requests to the NestJS backend.
# Carries the WebSocket upgrade so wss:// works on the same
# origin as the page, in every mode (local / ngrok).
# ═══════════════════════════════════════════════════════
location /api/ {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    # Hardcoded, not $scheme: the client-facing scheme is https in every
    # mode (nginx only terminates TLS on :443, and ngrok tunnels straight
    # into that same port).
    proxy_set_header X-Forwarded-Proto https;
    # Long-lived sockets: don't cut idle connections at the default 60s
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    # SSE: flush events immediately instead of buffering them.
    proxy_buffering off;
}

# ═══════════════════════════════════════════════════════
# GAME ENGINE PROXY — forwards Socket.IO traffic to ludo-engine.
# Mounted at socket.io's own default handshake path (/socket.io/) so
# the frontend needs no custom `path` option: it just connects to the
# page's own origin, same as it already does for /api/. This is what
# makes the connection work identically under nginx (local/ngrok)
# and under the Vite dev proxy (see frontend/vite.config.ts) — the
# browser never needs to know ludo-engine's real hostname or port.
# ═══════════════════════════════════════════════════════
location /socket.io/ {
    proxy_pass http://ludo-engine:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# Build health check — external probes hit this; NestJS mounts /health at
# its root (main.ts), not under /api, hence the rewrite instead of a plain proxy_pass.
location = /api/health {
    proxy_pass http://backend:3000/health;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

# Deny access to hidden files (e.g. .htaccess, .git, .env)
location ~ /\. {
    deny all;
    access_log off;
    log_not_found off;
}
