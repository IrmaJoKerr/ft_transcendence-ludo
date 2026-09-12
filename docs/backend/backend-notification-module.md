# Notification Module

## Table of Contents

- [Overview](#overview) — Real-time notifications via SSE + Redis pub/sub
- [SSE & Redis Pub/Sub transport](#sse--redis-pubsub-transport) — how events bridge Redis → SSE
- [Failure contract](#failure-contract) — notifications never throw; delivery is best-effort
- [Files](#files) — Source file inventory
- [Key Types / Interfaces](#key-types--interfaces) — NotificationType, NotificationPayload
- [API Endpoints](#api-endpoints) — REST + SSE routes
- [Core Logic / Flow](#core-logic--flow) — Mermaid sequence diagram of notify → SSE delivery
- [Logic Paths Summary](#logic-paths-summary) — Decision trees
- [Dependencies](#dependencies) — Internal and external dependencies

---

## Overview

The Notification module delivers real-time, persisted notifications to users. It combines two mechanisms:

1. **Persistence** — every notification is written to the `Notification` table (PostgreSQL), so missed notifications appear in the bell dropdown on next page load.
2. **Real-time push** — a Server-Sent Events (SSE) stream (`/api/notifications/stream`) delivers new notifications instantly to open tabs, bridged via Redis Pub/Sub.

Notification types: `friend_request`, `friend_accepted`, `friend_removed`, `friend_declined`, `game_invite`, `achievement`, `match_finished`, `match_cancelled`, `profile_updated`, `display_name_changed`, `friend_online`, `friend_offline`, `avatar_changed`.

> `avatar_changed` is a TRANSIENT state update rather than a notification: its payload is `{ userId, username, has, style, v, updatedAt }`. Clients use it to flip that user's avatar immediately — to the photo on upload (`has: true`) or back to the generated avatar on delete (`has: false`) — and put `v` in the photo URL so the browser is forced to fetch the new bytes. It never reaches the bell.
>
> The stream also emits a 20 s `ping` keep-alive (`SSE_HEARTBEAT_MS` in `notification.controller.ts`). This is the **server → client** direction: the SSE response is byte-silent for minutes between notifications, and ngrok's HTTP/2 edge resets an idle stream (`net::ERR_HTTP2_PROTOCOL_ERROR`), so the periodic frame keeps the tunnel's socket requirements satisfied and the stream is never treated as dead. It is unrelated to the **client → server** presence heartbeat (`POST /api/presence/heartbeat`, `PRESENCE_HEARTBEAT_MS`) — that is a separate request that writes nothing into this response, so it cannot keep the stream alive. Because SSE has no replay, keeping the stream up is also what stops live events from being lost. See [`../architecture.md`](../architecture.md) → Connection liveness (two-direction heartbeats).

> The module is imported by `FriendsModule`, `MatchModule`, `AchievementsModule`, `PresenceModule`, `AuthModule`, and `UserModule`, which inject `NotificationService` and call `notify()` / `notifyTransient()`. It exports `NotificationService` so any module can send a notification.

---

## SSE & Redis Pub/Sub transport

Notifications move over two linked transports:

- **Redis Pub/Sub** is the message bus. `notify()` publishes the event to the
  recipient's per-user channel (`notify:<userId>`); `broadcast()` publishes to
  the global channel (`notify:all`). Redis decouples the emitter from the SSE
  layer — any backend service can publish without knowing who is connected.
- **SSE** is the last mile to the browser. Each open tab holds one
  `GET /api/notifications/stream` connection, backed by an rxjs `Subject` in
  the service's in-memory `clients` map (one user, multiple tabs ⇒ multiple
  Subjects) plus `broadcastClients` (every Subject, for `notify:all`).

A subscriber handler on the Redis client bridges the two: a message on
`notify:<userId>` is pushed into every Subject for that user, and a message on
`notify:all` into every broadcast Subject; NestJS then writes each emission as
an SSE `data:` frame. Teardown is symmetric: when the HTTP stream closes, NestJS
unsubscribes, the service's `finalize(() => subject.complete())` completes the
Subject, and `removeClient()` drops it from the maps and unsubscribes from the
per-user Redis channel when the last tab for that user closes.

---

## Failure contract

Notifications are a **non-critical side effect** of the actions that trigger them
(friend request/accept/decline/remove, game invite, game end, achievement unlock,
avatar update, …). A notification failure must never make a successful action look
failed, and must never partially fail the action it accompanies. The service
therefore guarantees:

- **`notify()`, `broadcast()` and `notifyTransient()` never throw.** No caller
  needs a try/catch around them; any existing `.catch()` is defensive only.
- **`notify()` persists to Postgres first.** If the persist fails, the
  notification is dropped and logged (`[notifications] persist failed …`) — the
  caller's action is unaffected. If only the live Redis publish fails, the
  persisted row is kept: the recipient still sees it in the bell on their next
  page load, just without a real-time toast (`[notifications] live push
  failed …`).
- **`broadcast()` / `notifyTransient()` are purely ephemeral** (SSE toast only,
  nothing persisted). A failed publish logs a warning and nothing is lost —
  there was nothing to persist in the first place.
- **SSE connection teardown is wired for real.** `subscribe()` returns the
  per-tab Subject wrapped in `finalize(() => subject.complete())`. When NestJS
  unsubscribes on a closed connection (tab close, navigation, network drop) —
  it does *not* complete the observable — the finalize completes the Subject,
  which fires the service's `complete` handler → `removeClient()` removes the
  Subject from the in-memory maps and unsubscribes from Redis when the last tab
  for a user closes. No dead Subjects accumulate.

---

## SSE & Redis Pub/Sub transport

Notifications move over two linked transports:

- **Redis Pub/Sub** is the message bus. `notify()` publishes the event to the
  recipient's per-user channel (`notify:<userId>`); `broadcast()` publishes to
  the global channel (`notify:all`). Redis decouples the emitter from the SSE
  layer — any backend service can publish without knowing who is connected.
- **SSE** is the last mile to the browser. Each open tab holds one
  `GET /api/notifications/stream` connection, backed by an rxjs `Subject` in
  the service's in-memory `clients` map (one user, multiple tabs ⇒ multiple
  Subjects) plus `broadcastClients` (every Subject, for `notify:all`).

A subscriber handler on the Redis client bridges the two: a message on
`notify:<userId>` is pushed into every Subject for that user, and a message on
`notify:all` into every broadcast Subject; NestJS then writes each emission as
an SSE `data:` frame. Teardown is symmetric: when the HTTP stream closes, NestJS
unsubscribes, the service's `finalize(() => subject.complete())` completes the
Subject, and `removeClient()` drops it from the maps and unsubscribes from the
per-user Redis channel when the last tab for that user closes.

---

## Failure contract

Notifications are a **non-critical side effect** of the actions that trigger them
(friend request/accept/decline/remove, game invite, game end, achievement unlock,
avatar update, …). A notification failure must never make a successful action look
failed, and must never partially fail the action it accompanies. The service
therefore guarantees:

- **`notify()`, `broadcast()` and `notifyTransient()` never throw.** No caller
  needs a try/catch around them; any existing `.catch()` is defensive only.
- **`notify()` persists to Postgres first.** If the persist fails, the
  notification is dropped and logged (`[notifications] persist failed …`) — the
  caller's action is unaffected. If only the live Redis publish fails, the
  persisted row is kept: the recipient still sees it in the bell on their next
  page load, just without a real-time toast (`[notifications] live push
  failed …`).
- **`broadcast()` / `notifyTransient()` are purely ephemeral** (SSE toast only,
  nothing persisted). A failed publish logs a warning and nothing is lost —
  there was nothing to persist in the first place.
- **SSE connection teardown is wired for real.** `subscribe()` returns the
  per-tab Subject wrapped in `finalize(() => subject.complete())`. When NestJS
  unsubscribes on a closed connection (tab close, navigation, network drop) —
  it does *not* complete the observable — the finalize completes the Subject,
  which fires the service's `complete` handler → `removeClient()` removes the
  Subject from the in-memory maps and unsubscribes from Redis when the last tab
  for a user closes. No dead Subjects accumulate.

---

## Files

| File | Role |
|------|------|
| `notification.controller.ts` | HTTP routes: SSE stream, list unread, mark read / all read |
| `notification.service.ts` | Redis pub/sub bridging, per-user SSE Subjects, persistence, `notify()` helper |
| `notification.module.ts` | NestJS module — registers controller/service, exports `NotificationService` |

---

## Key Types / Interfaces

### NotificationType

```typescript
export type NotificationType =
  | 'friend_request'
  | 'friend_accepted'
  | 'friend_removed'
  | 'friend_declined'
  | 'game_invite'
  | 'achievement'
  | 'match_finished'
  | 'match_cancelled'
  | 'profile_updated'
  | 'display_name_changed'
  | 'friend_online'
  | 'friend_offline'
  | 'avatar_changed';
```

### NotificationPayload

```typescript
export interface NotificationPayload {
  id: string;  // Unique ID
  type: NotificationType;  // Type of notification
  payload: Record<string, unknown>; // per-type data (e.g. { fromUsername, gameId, ... })
  read: boolean;  // Whether it has been read
  createdAt: string; // ISO string
}
```

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/notifications/stream` | JWT | SSE stream — pushes new notifications in real time |
| `GET` | `/api/notifications` | JWT | List unread notifications (for the bell dropdown on load) |
| `PATCH` | `/api/notifications/:id/read` | JWT | Mark one notification read |
| `POST` | `/api/notifications/read-all` | JWT | Mark all notifications read |

---

## Core Logic / Flow

### 1. Notify → SSE Delivery

Sequence of steps when any service calls `notificationService.notify(userId, type, payload)`.
```mermaid
sequenceDiagram
    participant App as Any part of the backend
    participant Notify as NotificationService
    participant DB as Database
    participant Stream as Live message stream

    App->>Notify: Send a notification (userId, type, payload)
    Notify->>DB: Save the notification
    Notify->>Stream: Push it to that user's live stream
    Stream-->>User's Browser: The notification pops up instantly
```

### 2. SSE Subscribe

When a client opens `/api/notifications/stream`, the service creates an rxjs `Subject`, adds it to a per-user array (supporting multiple tabs), and — on first tab for a user — subscribes to `notify:<userId>` on Redis. Closing the last tab unsubscribes.

---

## Logic Paths Summary

### Open SSE Stream
```
GET /api/notifications/stream (JWT)
  ├── Look up in-memory clients map for userId
  │   ├── First tab → subscribe to notify:<userId> on Redis
  │   └── Existing → append Subject to the user's array
  └── Pipe Subject into SSE response; push each event as a data frame
```

### List Unread / Mark Read
```
GET /api/notifications (JWT)
  └── notification.findMany({ userId, read: false }, take 50, by createdAt desc)

PATCH /api/notifications/:id/read (JWT)
  └── notification.updateMany({ id, userId }, { read: true })

POST /api/notifications/read-all (JWT)
  └── notification.updateMany({ userId, read: false }, { read: true })
```

---

## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `PrismaService` | Persist notifications (Notification model) |
| `ioredis` | Pub/Sub bridging (publish + subscribe) |
| `@nestjs/sse` via `@Sse` decorator | SSE stream controller |
| `rxjs` | Observable/Subject streaming |
| `secrets.ts` | Redis password (`REDIS_PASSWORD`) |
| `JwtAuthGuard` | Protects all notification endpoints |

---

## Configuration / Environment

| Variable | Default | Used By |
|----------|---------|---------|
| `REDIS_HOST` | `redis` | Pub/Sub connection |
| `REDIS_PORT` | `6479` | Pub/Sub connection |
| `REDIS_PASSWORD` | (from secrets) | Redis authentication |
