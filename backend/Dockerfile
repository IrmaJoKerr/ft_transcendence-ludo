# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
ARG DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npx prisma generate
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
# tsconfig.json is needed at runtime too: `prisma db seed` shells out to
# ts-node --project tsconfig.json, which fails without it.
COPY --from=builder /app/tsconfig.json ./
COPY --from=builder /app/package*.json ./
# Reuse the deps the builder stage already installed (same base image, same
# lockfile) instead of hitting the npm registry a second time for the exact
# same install — this stage's node_modules must match builder's anyway.
COPY --from=builder /app/node_modules ./node_modules
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
