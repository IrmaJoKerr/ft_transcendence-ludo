COMPOSE_FILE   = compose.yaml

env_get = $(shell grep -m1 '^$(1)=' .env 2>/dev/null | cut -d= -f2-)
NGROK_PORT    := $(or $(call env_get,NGROK_PORT),8443)
NGROK_DOMAIN  := $(call env_get,NGROK_DOMAIN)
HTTPS_PORT    := $(or $(call env_get,HTTPS_PORT),8443)
NGROK_AUTHTOKEN := $(call env_get,NGROK_AUTHTOKEN)
NGROK_FLAGS    = $(if $(NGROK_DOMAIN),--url=https://$(NGROK_DOMAIN),)
OAUTH_VARS     = GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_CALLBACK_URL \
                 GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_CALLBACK_URL \
                 FORTYTWO_CLIENT_ID FORTYTWO_CLIENT_SECRET FORTYTWO_CALLBACK_URL
# ngrok tunnel credentials: the backend's ngrok OAuth strategies requireSecret()
# these at boot (they fail-fast if absent), and NGROK_AUTHTOKEN/DOMAIN/FRONTEND_URL
# are what `make tunnel` needs. Required by the preflight below.
TUNNEL_VARS    = NGROK_AUTHTOKEN NGROK_DOMAIN NGROK_FRONTEND_URL \
                 NGROK_GOOGLE_CALLBACK_URL NGROK_GITHUB_CALLBACK_URL NGROK_FORTYTWO_CALLBACK_URL
# Everything the stack hard-requires: core secrets/DB/URLs + OAuth apps. These
# are validated (and never auto-generated — a real .env is copied from a
# teammate). SMTP_CREDENTIALS is deliberately not in the list.
CORE_VARS      = JWT_SECRET POSTGRES_PASSWORD REDIS_PASSWORD ENGINE_API_KEY \
                 POSTGRES_USER POSTGRES_DB DATABASE_URL CONTAINER_DATABASE_URL \
                 FRONTEND_URL NGROK_PORT HTTPS_PORT

all: build start
	@ echo "Frontend: https://localhost:$(HTTPS_PORT)"

# Config validation: fails hard if .env is missing or any
# required value is absent/empty (core secrets/DB/URLs, OAuth apps, ngrok
# tunnel credentials — the backend's requireSecret() fails fast on boot
# without them). Nothing is auto-generated: a real .env is copied from a
# teammate. Used by every build/start path exactly once. Values live
# in .env now, one KEY=VALUE per line, read directly by compose's env_file:
# and by dotenv on the host side.
env:
	@if [ ! -f .env ]; then \
	  echo "❌ Build aborted — .env not found. Ensure you have copied over the correct .env file with all relevant credentials"; \
	  exit 1; \
	fi; \
	set -e; \
	get() { grep -m1 "^$$1=" .env 2>/dev/null | cut -d= -f2-; }; \
	missing=""; \
	for v in $(CORE_VARS) $(OAUTH_VARS) $(TUNNEL_VARS); do [ -n "$$(get $$v)" ] || missing="$$missing $$v"; done; \
	if [ -n "$$missing" ]; then \
	  echo "❌ Preflight failed — required values missing or empty in .env:"; \
	  for v in $$missing; do echo "      $$v"; done; \
	  echo "   Fill them in (see .env.example), or ask a teammate for the values."; \
	  exit 1; \
	fi; \
	chmod 600 .env; \
	echo "✅ .env ready — all required values present"

build: env
	@docker compose -f $(COMPOSE_FILE) build

start:
	@docker compose -f $(COMPOSE_FILE) up -d

# stop/down/logs carry --profile dev so they still reach frontend-dev; without
# it compose ignores profiled services and leaves the container orphaned.
stop:
	@docker compose -f $(COMPOSE_FILE) --profile dev stop

down:
	@docker compose -f $(COMPOSE_FILE) --profile dev down

# Brings up the whole stack plus the Vite HMR server, then stays attached in
# watch mode: `compose watch` builds+starts everything first (like `up -d
# --build`), then rebuilds/restarts backend and ludo-engine on source changes
# per their `develop.watch` rules in compose.yaml (frontend-dev already
# hot-reloads on its own via Vite + bind mount, so it has none). Both front
# doors stay live: 8080 serves source with hot reload, 8443 serves the built
# SPA through nginx, so the production path can still be checked without
# tearing anything down. The dev profile is off by default, hence --profile
# here but not in all. Ctrl-C stops watching; the containers keep running
# (use `make stop`/`make down`).
dev: down env
	@echo "🔥 HMR dev server:    http://localhost:8080"
	@echo "🔒 nginx (built SPA): https://localhost:8443"
	@docker compose -f $(COMPOSE_FILE) --profile dev watch

logs:
	@docker compose -f $(COMPOSE_FILE) --profile dev logs -f

clean:
	@echo "🗑️  Cleaning all Docker data..."
	@docker stop $$(docker ps -qa) 2>/dev/null; \
	docker rm $$(docker ps -qa) 2>/dev/null; \
	docker rmi -f $$(docker images -qa) 2>/dev/null; \
	docker volume rm $$(docker volume ls -q) 2>/dev/null; \
	docker network rm $$(docker network ls -q) 2>/dev/null; \
	echo "✅  Done."

prune:
	@docker system prune -af --volumes

fclean: prune clean

# Full reset: nuke everything (images, volumes, networks), then rebuild fresh
# from a clean slate (env preflight re-runs against .env).
re: fclean all

# ── NGROK MODE ──────────────────────────────────────────────────────────────
ngrok-auth:
	@if [ -z "$(NGROK_AUTHTOKEN)" ]; then echo "❌  ngrok authtoken missing — set NGROK_AUTHTOKEN in .env"; exit 1; fi; \
	ngrok config add-authtoken "$(NGROK_AUTHTOKEN)" >/dev/null && echo "🔑  ngrok authtoken configured"

# Tunnels nginx's TLS listener (localhost:8443) — the address is given as
# https:// so ngrok speaks TLS to the local backend instead of forwarding
# plain HTTP at it. ngrok doesn't verify the upstream cert by default (that's
# opt-in via --upstream-tls-verify), so the self-signed cert isn't a problem.
# Builds + starts the stack first (via `all`), then opens the tunnel.
# Ctrl-C stops ngrok only; containers keep running (use `make stop-tunnel`).
tunnel: all ngrok-auth
	@echo "🔀  Switching backend into tunnel mode (ngrok OAuth apps)…"
	@TUNNEL_MODE=true docker compose -f $(COMPOSE_FILE) up -d --no-deps backend
	@echo "🚇  Tunnelling https://localhost:$(NGROK_PORT) … (URL also shown by: make tunnel-url)"
	@ngrok http https://localhost:$(NGROK_PORT) $(NGROK_FLAGS)

# Public URL of a tunnel that's already running, from ngrok's local API.
tunnel-url:
	@url=$$(curl -s http://localhost:4040/api/tunnels | grep -o 'https://[^"]*\.ngrok[^"]*' | head -1); \
	if [ -n "$$url" ]; then echo "$$url"; else echo "No tunnel running — start one with: make tunnel"; fi

dev-tunnel:
	@osascript -e 'tell application "Terminal" to do script "cd $(PWD) && make dev"'
	@osascript -e 'tell application "Terminal" to do script "cd $(PWD) && make tunnel"'

stop-tunnel:
	@pkill -f ngrok 2>/dev/null || true
	@docker compose -f $(COMPOSE_FILE) --profile dev stop
	@echo "Stopped."

.PHONY: all build start env \
        dev stop down logs clean fclean prune re \
        ngrok-auth tunnel tunnel-url dev-tunnel stop-tunnel
