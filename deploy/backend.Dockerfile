# syntax=docker/dockerfile:1
# Deployed backend image (Render). Multi-stage: builds the frontend SPA and the
# NestJS backend, then bundles the SPA into the backend image at /app/public so
# the SPA, /api AND /socket.io all share ONE origin — the auth cookies are
# sameSite: lax, so a split-origin SPA would silently break login.
#
# NOT used by the local compose stack (backend/Dockerfile is) — that keeps the
# local/nginx path unchanged. The build context must be the repo root so both
# frontend/ and backend/ can be copied:
#   docker build -f deploy/backend.Dockerfile .
#
# Required runtime env (set via Render): DATABASE_URL (Supabase), REDIS_URL
# (Upstash), ENGINE_URL (engine's public URL), JWT_SECRET, ENGINE_API_KEY,
# FRONTEND_URL, OAuth client ids/secrets/callbacks. The docker-entrypoint.sh
# runs `prisma db push` on boot, so the Supabase schema is created/updated
# automatically.

# ── Frontend stage: build the SPA ───────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
RUN npm run build

# ── Backend stage: build the NestJS app ─────────────────────────────────────
FROM node:22-alpine AS backend
WORKDIR /be
RUN apk add --no-cache python3 make g++
COPY backend/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY backend/ ./
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

# ── Runtime: backend + SPA ──────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app
COPY --from=backend /be/dist ./dist
COPY --from=backend /be/generated ./generated
COPY --from=backend /be/prisma ./prisma
COPY --from=backend /be/prisma.config.ts ./
# tsconfig.json is needed at runtime too: `prisma db seed` shells out to
# ts-node --project tsconfig.json, which fails without it.
COPY --from=backend /be/tsconfig.json ./
COPY --from=backend /be/package*.json ./
# Reuse the deps the builder stage installed (same base image, same lockfile)
# instead of hitting the npm registry a second time.
COPY --from=backend /be/node_modules ./node_modules
# The built SPA — what ServeStaticModule (backend/src/app.module.ts) serves at /.
COPY --from=frontend /fe/dist ./public
COPY backend/docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
