COMPOSE_FILE   = compose.yaml

env_get = $(shell grep -m1 '^$(1)=' .env 2>/dev/null | cut -d= -f2-)
NGROK_PORT    := $(or $(call env_get,NGROK_PORT),8444)
NGROK_DOMAIN  := $(call env_get,NGROK_DOMAIN)
HTTPS_PORT    := $(or $(call env_get,HTTPS_PORT),8443)
NGROK_FLAGS    = $(if $(NGROK_DOMAIN),--url=https://$(NGROK_DOMAIN),)
LAN_IP        := $(or $(shell ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'),$(shell ipconfig getifaddr en0 2>/dev/null),$(shell ipconfig getifaddr en1 2>/dev/null),$(call env_get,LAN_IP))
OAUTH_VARS     = GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_CALLBACK_URL \
                 GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET GITHUB_CALLBACK_URL \
                 FORTYTWO_CLIENT_ID FORTYTWO_CLIENT_SECRET FORTYTWO_CALLBACK_URL
# ngrok tunnel credentials: the backend's ngrok OAuth strategies requireSecret()
# these at boot (they fail-fast if absent), and NGROK_AUTHTOKEN/DOMAIN/FRONTEND_URL
# are what `make tunnel` needs. Required by the preflight below.
TUNNEL_VARS    = NGROK_AUTHTOKEN NGROK_DOMAIN NGROK_FRONTEND_URL \
                 NGROK_GOOGLE_CALLBACK_URL NGROK_GITHUB_CALLBACK_URL NGROK_FORTYTWO_CALLBACK_URL
# Everything the preflight requires: core secrets/DB/URLs + OAuth apps. These
# are validated (and never auto-generated: a real .env is copied from a
# teammate). SMTP_CREDENTIALS counts too: without it mail only gets logged, but
# an empty value still means the .env was copied incompletely. LAN_IP is the
# only key left out of the list (`make env` writes it itself).
CORE_VARS      = JWT_SECRET ENGINE_JWT_SECRET OAUTH_STATE_SECRET POSTGRES_PASSWORD REDIS_PASSWORD ENGINE_API_KEY \
                 POSTGRES_USER POSTGRES_DB DATABASE_URL CONTAINER_DATABASE_URL \
                 FRONTEND_URL NGROK_PORT HTTPS_PORT SMTP_CREDENTIALS

all: build start
	@ echo "Frontend: https://localhost:$(HTTPS_PORT)"

# Checks .env before any build or start. Every var in the three lists above
# must be non-empty or we stop here, since the backend's requireSecret()
# would only fail later at boot. Nothing is generated: copy a real .env from
# a teammate. LAN_IP is the exception, optional and overwritten with this
# machine's current address so `make lan` can't print a stale URL.
env:
	@if [ ! -f .env ]; then \
	  echo "❌ Build aborted: .env not found. Ensure you have copied over the correct .env file with all relevant credentials"; \
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
	  echo "❌ Preflight failed. Required values missing or empty in .env:"; \
	  for v in $$missing; do echo "      $$v"; done; \
	  echo "   Fill them in (see .env.example), or ask a teammate for the values."; \
	  exit 1; \
	fi; \
	lan_ip=$$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p'); \
	[ -n "$$lan_ip" ] || lan_ip=$$(ipconfig getifaddr en0 2>/dev/null); \
	[ -n "$$lan_ip" ] || lan_ip=$$(ipconfig getifaddr en1 2>/dev/null); \
	if [ -n "$$lan_ip" ]; then set_kv LAN_IP "$$lan_ip"; fi; \
	chmod 600 .env; \
	echo "✅ .env ready: all required values present"

# Regenerates `src/__shared__` in all three trees from `common/src`: each build is its
# own root and cannot import a sibling folder, so every tree carries a generated copy
# (gitignored, never hand edited). The images get theirs from compose's named `shared`
# context; this keeps the host copies current for `docker compose` runs, where the
# frontend tree arrives as a bind mount. `npm run build`/`dev` in any tree does the same
# for that tree alone through its `prebuild`/`predev` hook.
shared:
	@cd frontend && node scripts/sync-shared.mjs
	@cd backend && node scripts/sync-shared.mjs
	@cd backend/app/ludo-engine && node scripts/sync-shared.mjs

build: env shared
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
dev: down env shared
	@echo "🔥 HMR dev server:    http://localhost:8080"
	@echo "🔒 nginx (built SPA): https://localhost:8443"
	@docker compose -f $(COMPOSE_FILE) --profile dev watch

logs:
	@docker compose -f $(COMPOSE_FILE) --profile dev logs -f

# Dropping the generated `src/__shared__` copies is part of a clean: they are build
# output, never source, so a clean must not leave one behind for the next run to pick up.
# `shared` (a dependency of `build` and `dev`) writes them again from `common/src`.
clean:
	@echo "🗑️  Cleaning all Docker data..."
	@rm -rf frontend/src/__shared__ backend/src/__shared__ backend/app/ludo-engine/src/__shared__
	@echo "🧹  Removed the generated src/__shared__ copies"
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

# LAN Mode
lan: all
	@if [ -z "$(LAN_IP)" ]; then echo "❌  No LAN IP on en0/en1: are you on WiFi?"; exit 1; fi
	@echo ""
	@echo "🌐  LAN mode up.  Other devices on this WiFi:"
	@echo "      https://$(LAN_IP):$(HTTPS_PORT)"
	@echo ""
	@echo "    Self-signed cert → tap through the browser warning once."
	@echo "    Nothing shows up? Campus/corporate WiFi client isolation blocks"
	@echo "    device-to-device traffic: use a phone hotspot to test."


# NGROK Mode
ngrok-auth:
	@token=$$(grep -m1 '^NGROK_AUTHTOKEN=' .env 2>/dev/null | cut -d= -f2-); \
	if [ -z "$$token" ]; then echo "❌  ngrok authtoken missing: set NGROK_AUTHTOKEN in .env"; exit 1; fi; \
	ngrok config add-authtoken "$$token" >/dev/null && echo "🔑  ngrok authtoken configured"

# Tunnels nginx's TLS listener (127.0.0.1:8443): the address is given as
# https:// so ngrok speaks TLS to the local backend instead of forwarding
# plain HTTP at it. ngrok doesn't verify the upstream cert by default (that's
# opt-in via --upstream-tls-verify), so the self-signed cert isn't a problem.
tunnel: all ngrok-auth
	@echo "🔀  Backend picks tunnel vs localhost per request from the Host header."
	@echo "🚇  Tunnelling https://127.0.0.1:$(NGROK_PORT) … (URL also shown by: make tunnel-url)"
	@ngrok http https://localhost:$(NGROK_PORT) $(NGROK_FLAGS)

# Public URL of a tunnel that's already running, from ngrok's local API.
tunnel-url:
	@url=$$(curl -s http://127.0.0.1:4040/api/tunnels | grep -o 'https://[^"]*\.ngrok[^"]*' | head -1); \
	if [ -n "$$url" ]; then echo "$$url"; else echo "No tunnel running: start one with make tunnel"; fi

# One command: build + start the stack (detached), then open the public tunnel.
# Stack runs in the background; ngrok stays in the foreground (Ctrl-C stops the
# tunnel, containers keep running: use `make stop-tunnel` to stop everything).
tunnel_up: all tunnel

dev-tunnel:
	@osascript -e 'tell application "Terminal" to do script "cd $(PWD) && make dev"'
	@osascript -e 'tell application "Terminal" to do script "cd $(PWD) && make tunnel"'

stop-tunnel:
	@pkill -f ngrok 2>/dev/null || true
	@docker compose -f $(COMPOSE_FILE) --profile dev stop
	@echo "Stopped."

.PHONY: all build start env shared \
        dev stop down logs clean fclean prune re \
        lan ngrok-auth tunnel tunnel-url tunnel_up dev-tunnel stop-tunnel
