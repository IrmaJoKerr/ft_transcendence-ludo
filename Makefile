COMPOSE_FILE   = compose.yaml

env_get = $(shell grep -m1 '^$(1)=' .env 2>/dev/null | cut -d= -f2-)
NGROK_PORT    := $(or $(call env_get,NGROK_PORT),8443)
NGROK_DOMAIN  := $(call env_get,NGROK_DOMAIN)
HTTPS_PORT    := $(or $(call env_get,HTTPS_PORT),8443)
NGROK_AUTHTOKEN := $(call env_get,NGROK_AUTHTOKEN)
NGROK_FLAGS    = $(if $(NGROK_DOMAIN),--url=https://$(NGROK_DOMAIN),)
# LAN IP is AUTO-DETECTED first — the stored .env value can go stale when DHCP
# hands the machine a new address (which silently breaks the "Other devices on
# this WiFi" URL). Detection falls back to the .env value only when the machine
# has no LAN address (e.g. not on WiFi). The env target re-writes the detected
# value back into .env so the config never drifts.
LAN_IP        := $(or $(shell ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'),$(shell ipconfig getifaddr en0 2>/dev/null),$(shell ipconfig getifaddr en1 2>/dev/null),$(call env_get,LAN_IP))
OAUTH_VARS     = GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_CALLBACK_URL \
                 GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_CALLBACK_URL \
                 FORTYTWO_CLIENT_ID FORTYTWO_CLIENT_SECRET FORTYTWO_CALLBACK_URL
# ngrok tunnel credentials: the backend's ngrok OAuth strategies requireSecret()
# these at boot (they fail-fast if absent), and NGROK_AUTHTOKEN/DOMAIN/FRONTEND_URL
# are what `make tunnel` needs. Required by the preflight below.
TUNNEL_VARS    = NGROK_AUTHTOKEN NGROK_DOMAIN NGROK_FRONTEND_URL \
                 NGROK_GOOGLE_CLIENT_ID NGROK_GOOGLE_CLIENT_SECRET NGROK_GOOGLE_CALLBACK_URL \
                 NGROK_GITHUB_CLIENT_ID NGROK_GITHUB_CLIENT_SECRET NGROK_GITHUB_CALLBACK_URL \
                 NGROK_FORTYTWO_CLIENT_ID NGROK_FORTYTWO_CLIENT_SECRET NGROK_FORTYTWO_CALLBACK_URL
# Everything the stack hard-requires: core secrets/DB/URLs + OAuth apps. These
# are validated (and never auto-generated — a real .env is copied from a
# teammate). LAN_IP is deliberately not in the list.
CORE_VARS      = JWT_SECRET POSTGRES_PASSWORD REDIS_PASSWORD ENGINE_API_KEY \
                 POSTGRES_USER POSTGRES_DB DATABASE_URL CONTAINER_DATABASE_URL \
                 FRONTEND_URL NGROK_PORT HTTPS_PORT

all: build start
	@ echo "Frontend: https://localhost:$(HTTPS_PORT)"

# Config validation + LAN_IP refresh: fails hard if .env is missing or any
# required value is absent/empty (core secrets/DB/URLs, OAuth apps, ngrok
# tunnel credentials — the backend's requireSecret() fails fast on boot
# without them). Nothing is auto-generated: a real .env is copied from a
# teammate. LAN_IP is best-effort — empty is allowed, but if the current
# machine address can be detected it is written back so `make lan`'s URL
# never goes stale. Used by every build/start path exactly once. Values live
# in .env now, one KEY=VALUE per line, read directly by compose's env_file:
# and by dotenv on the host side.
env:
	@if [ ! -f .env ]; then \
	  echo "❌ Build aborted — .env not found. Ensure you have copied over the correct .env file with all relevant credentials"; \
	  exit 1; \
	fi; \
	set -e; \
	get() { grep -m1 "^$$1=" .env 2>/dev/null | cut -d= -f2-; }; \
	set_kv() { \
	  if grep -q "^$$1=" .env 2>/dev/null; then \
	    tmp=$$(mktemp); awk -F= -v k="$$1" -v v="$$2" 'BEGIN{OFS="="} $$1==k{$$0=k"="v} {print}' .env > "$$tmp" && mv "$$tmp" .env; \
	  else \
	    printf '%s=%s\n' "$$1" "$$2" >> .env; \
	  fi; \
	}; \
	missing=""; \
	for v in $(CORE_VARS) $(OAUTH_VARS) $(TUNNEL_VARS); do [ -n "$$(get $$v)" ] || missing="$$missing $$v"; done; \
	if [ -n "$$missing" ]; then \
	  echo "❌ Preflight failed — required values missing or empty in .env:"; \
	  for v in $$missing; do echo "      $$v"; done; \
	  echo "   Fill them in (see .env.example), or ask a teammate for the values."; \
	  exit 1; \
	fi; \
	lan_ip=$$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'); \
	[ -n "$$lan_ip" ] || lan_ip=$$(ipconfig getifaddr en0 2>/dev/null); \
	[ -n "$$lan_ip" ] || lan_ip=$$(ipconfig getifaddr en1 2>/dev/null); \
	if [ -n "$$lan_ip" ]; then set_kv LAN_IP "$$lan_ip"; fi; \
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


# ── DB RESET ─────────────────────────────────────────────────────────────────
# Wipes the Postgres container + its db_data volume, rebuilds the db image, and
# relinks the services that depend on it (backend/studio reconnect). The
# backend's entrypoint re-runs `prisma db push` on boot, so the (empty) schema
# is recreated automatically. Redis and the SPA build volume are untouched.
dbreset: env
	@echo "🗑️  Destroying the database (container + data volume)…"
	@docker compose -f $(COMPOSE_FILE) rm -sfv db 2>/dev/null || true
	@docker volume rm -f $$(docker volume ls --format '{{.Name}}' | grep '_db_data$$' || true) 2>/dev/null || true
	@echo "🏗️  Rebuilding the db image…"
	@docker compose -f $(COMPOSE_FILE) build db
	@echo "🔗 Relinking db + dependents (backend, studio)…"
	@docker compose -f $(COMPOSE_FILE) up -d --force-recreate db backend studio
	@echo ""
	@echo "✅ Database reset — empty schema recreated via 'prisma db push'."
	@echo "   Want sample data?  →  cd backend && npm run db:seed"


# ── LAN MODE ────────────────────────────────────────────────────────────────
# Same WiFi. No OAuth env changes needed: nginx single-origins /api, so relative
# paths resolve against whatever host the client typed. LAN_IP is auto-detected
# and written back into .env on every build (see the env target), so the URL
# printed below always matches the machine's current address.
lan: all
	@if [ -z "$(LAN_IP)" ]; then echo "❌  No LAN IP on en0/en1 — are you on WiFi?"; exit 1; fi
	@echo ""
	@echo "🌐  LAN mode up.  Other devices on this WiFi:"
	@echo "      https://$(LAN_IP):$(HTTPS_PORT)"
	@echo ""
	@echo "    Self-signed cert → tap through the browser warning once."
	@echo "    Nothing shows up? Campus/corporate WiFi client isolation blocks"
	@echo "    device-to-device traffic — use a phone hotspot to test."

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
        dev stop down logs clean fclean prune re dbreset \
        lan ngrok-auth tunnel tunnel-url dev-tunnel stop-tunnel
