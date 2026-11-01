# Frontend — Friends

## Table of Contents

- [Overview](#overview) — Friends list, requests, blocked users, invites
- [Files](#files) — Source file inventory
- [Key Types / Interfaces](#key-types--interfaces) — Data shapes
- [Core Logic / Flow](#core-logic--flow) — Mermaid sequence diagrams
- [Logic Paths Summary](#logic-paths-summary) — Decision trees
- [Dependencies](#dependencies) — Internal and external dependencies


---
---


## Overview

The Friends page (`/friends`, full-screen) manages friendships. It has:

1. **Friends list** — accepted friends with avatar, username, rating, and live presence status.
2. **Friend requests** — requests you have received and not yet answered, each with accept and decline actions; you can also send a request by username.
3. **Blocked list** — users you have blocked, each with an unblock action. The two lists are separate tabs: Friends and Blocked.
4. **Game invite** — invite a friend to a PvP (player versus player) game with `POST /api/friends/:friendId/invite`, which returns the match credentials. The invite creates the room *and* seats the friend, so it is refused with `403 MATCH_ACTIVE_GAME` while the caller or the friend already holds a seat in a live game (see [backend-match-module.md](../backend/backend-match-module.md) → Strict State Lock (`active-game.ts`)).

> **Note:** The Friends page reads its data from the backend API (Application Programming Interface) once, for first paint. Every later change arrives as a `friendship:changed` record on the session socket, so no list is polled.


---
---


## Files

| File | Role |
|------|------|
| `src/pages/Friends.tsx` | Friends page — lists, requests, blocked, invite, actions |
| `src/hooks/useFriendships.ts` | The feed: one snapshot read for first paint, then `friendship:changed` records merged over it |
| `src/friendshipFeed.ts` | Pure merge functions (friends / requests / blocked) — the record always wins over the snapshot |
| `src/components/UserAvatar.tsx` | Player avatars |



---
---


## Key Types / Interfaces

```typescript
type Friend = {
  id: string  // Unique ID
  username: string  // Player's username
  displayName?: string  // Name shown in the game
  avatarStyle: string | null  // Avatar style name
  avatarV?: number  // Avatar change stamp → the photo URL's `?v=`
  hasAvatarPhoto?: boolean  // Whether a custom photo is uploaded
  rating: number  // Player's rating (score)
  friendsSince: string | null  // When the current state began (friends since / blocked since / requested at)
  status: 'online' | 'playing' | 'offline'  // Online status
}

type FriendRequest = {
  id: string  // Pair row id — what accept/decline take
  userId: string  // ID of the other user
  username: string  // Player's username
  displayName?: string  // Name shown in the game
  avatarStyle: string | null  // Avatar style name
  avatarV?: number
  hasAvatarPhoto?: boolean  // Whether a custom photo is uploaded
  createdAt: string  // When the record was created
}

type BlockedUser = {
  id: string  // Unique ID
  username: string  // Player's username
  displayName?: string  // Name shown in the game
  avatarStyle: string | null  // Avatar style name
  avatarV?: number
  hasAvatarPhoto?: boolean  // Whether a custom photo is uploaded
  rating: number  // Player's rating (score)
  blockedSince: string  // When the user was blocked
}
```

> These three are the row shapes of `friendshipFeed.ts`. A `friendship:changed` record and a snapshot
> row produce the same object, so a row that arrived live needs no second fetch to render.


---
---


## Core Logic / Flow

### Friends Page Load

The three lists are derived, not fetched on a timer. `useFriendships()` reads each list once for first
paint and keeps the socket's records as the newer truth:

```mermaid
sequenceDiagram
    participant Page as Friends.tsx
    participant Hook as useFriendships()
    participant API as Backend
    participant Sock as session socket

    Page->>Hook: mount
    Hook->>Sock: on('friendship:changed')   (listener first)
    Hook->>API: GET /api/friends + /requests + /blocked
    API-->>Hook: snapshot
    Hook-->>Page: friends / requests / blocked (merged)
    Page->>Page: Render active tab (Friends / Blocked)
    Sock-->>Hook: friendship:changed { state, friend }
    Hook->>Hook: upsert by friend.id, apply avatarV, re-merge
    Hook-->>Page: one list changed; the other two unchanged
    Note over Hook: reconnect or window focus → one more snapshot read
```

**One record, three lists.** `state` is viewer-relative, so the same record decides where a row goes:
`accepted` → friends, `pending-in` / `pending-out` → requests received / sent, `blocked` → blocked,
`none` → removed from all three. `mergeFriends`, `mergeRequests` and `mergeBlocked` in
`friendshipFeed.ts` are pure, and the record always wins over a snapshot row for the same account, so a
late fetch cannot resurrect a row the socket already deleted.

**Presence dots** come from `useNotifications().friendPresence`: the provider keeps the last
`friend_online` / `friend_offline` edge per account (a toast is dismissible, that map is not), and the
merge overlays it on the snapshot's `status`. The record itself says nothing about presence, which is
why presence churn costs no record.

**Mutations stay REST.** `handleAddFriend`, accept, decline, remove, block and unblock post to the API
and then call `refresh()` — belt and braces, since the server has already published the record that
the acting tab receives over the socket.


---
---


## Logic Paths Summary

```
Add friend → GET /api/user/{username} → POST /api/friends/request/{userId}
Accept → POST /api/friends/accept/{requestId}
Decline → POST /api/friends/decline/{requestId}
Remove → DELETE /api/friends/remove/{friendId}
Block  → POST /api/friends/block/{friendId}
Unblock→ POST /api/friends/unblock/{userId}
Invite → POST /api/friends/{friendId}/invite → setActiveMatch(res) → navigate('/game?gameId={gameId}')
  └── Refused (403 MATCH_ACTIVE_GAME) while either side already holds a seat in a live game
```


---
---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `api.ts` | `postApi` and `fetch` request helpers |
| `store.tsx` | `useApp` for user, setActiveMatch (invite flow) |
| `router.tsx` | `navigate` |
| `i18n.ts` | `useTranslation` (`friends.*` keys) |

