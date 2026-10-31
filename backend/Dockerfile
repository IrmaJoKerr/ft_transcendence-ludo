# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm install
COPY . .
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine
# /app is created owned by `node`: the runtime user below must be able to create
# files there (the entrypoint's `prisma db push` and Node's caches write inside
# the app directory), and a root-owned WORKDIR would deny that.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/generated ./generated
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./
# tsconfig.json is needed at runtime too: `prisma db seed` shells out to
# ts-node --project tsconfig.json, which fails without it.
COPY --chown=node:node --from=builder /app/tsconfig.json ./
COPY --chown=node:node --from=builder /app/package*.json ./
# Reuse the deps the builder stage already installed (same base image, same
# lockfile) instead of hitting the npm registry a second time for the exact
# same install: this stage's node_modules must match builder's anyway.
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
# Least privilege: nothing in this image needs root. The server binds an
# unprivileged port, reads its config from the environment and writes only
# inside /app, so an RCE in the app (or in an image decoder) starts as `node`
# instead of as root-inside-the-container.
USER node
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
