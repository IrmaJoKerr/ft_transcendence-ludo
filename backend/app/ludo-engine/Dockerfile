# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm install

COPY tsconfig.json ./
COPY src/ ./src/
# `common/src` from compose's named `shared` context: the tree's `prebuild` finds the
# copy already in place and skips its own sync (the engine's rootDir is ./src, so this
# has to land inside it).
COPY --from=shared /src ./src/__shared__/

RUN npm run build

FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

EXPOSE 3001

CMD ["npm", "start"]