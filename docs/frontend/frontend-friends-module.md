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
4. **Two places to offer a game** (19.6). **CHALLENGE** posts `POST /api/friends/:friendId/challenge` with `{ hostColor }`, the corner the challenger will host in: it creates nothing, answers `{ ok, kind: 'challenge' }`, and the page says the challenge is out (`friends.challengeSent`) rather than navigating. The room appears when the friend accepts — the server sends `challenge_accepted`, and the challenger enters it from the toast, the bell, or the dock's rejoin banner. A **room invite** (`POST /api/friends/:friendId/invite` with `{ gameId }`) is the other act and belongs to the surfaces that already sit in a room: the lobby's name card and the waiting room's INVITE COMMS column.
5. **The grey state is the server's**, not a client TTL: `useChallenges` reads `GET /api/friends/challenges/sent` (on mount, and again on window focus) and adds the echo of its own presses. A greyed CHALLENGE stays pressable; the press asks, and the 409 prints in the page's band — `errors.CHALLENGE_ALREADY_SENT`, or `errors.CHALLENGE_COOLDOWN` while a refusal of the friend's still runs.
6. **BLOCK and REMOVE confirm** through `ConfirmActionModal` (the same gate both name cards block through), because neither can be undone from this screen: `friends.block*` and `friends.remove*` carry the two questions.

> **Note:** The Friends page reads its data from the backend API (Application Programming Interface) once, for first paint. Every later change arrives as a `friendship:changed` record on the session socket, so no list is polled.


---
---


## Files

| File | Role |
|------|------|
| `src/pages/Friends.tsx` | Friends page — lists, requests, blocked, the challenge row, the two confirms |
| `src/hooks/useFriendships.ts` | The feed: one snapshot read for first paint, then `friendship:changed` records merged over it |
| `src/hooks/useChallenges.ts` | The two send routes (challenge and room invite): the server's sent list, the press, and the 409s, with no client window |
| `src/components/ConfirmActionModal.tsx` | The shared confirm for BLOCK and REMOVE (and both name cards) |
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

**A block is also a chat filter, and only the side that placed it can apply one.** The public channel
has no per-seat cut of its own (it is one `chat:history` frame and one fan-out to every signed-in
socket), so `LobbyChat` filters the ring it paints against `useFriendships().blocked`: the blocker
stops seeing the blocked pilot's lines at once, and unblocking brings them back without a refetch. The
blocked side keeps seeing the blocker's lines, because a block is never disclosed to them — a room,
which seats both and holds the ledger in `blockedPairs`, is the one place the cut runs both ways
(`filterChatForSeat`).


---
---


## Logic Paths Summary

```
Add friend → GET /api/user/{username} → POST /api/friends/request/{userId}
Accept → POST /api/friends/accept/{requestId}
Decline → POST /api/friends/decline/{requestId}
Remove → DELETE /api/friends/remove/{friendId}   (after a ConfirmActionModal)
Block  → POST /api/friends/block/{friendId}      (after a ConfirmActionModal)
Unblock→ POST /api/friends/unblock/{userId}
Challenge (greyed by) → GET /api/friends/challenges/sent
Challenge (press)     → POST /api/friends/{friendId}/challenge { hostColor } → friends.challengeSent in the band (stays on the page)
  ├── 409 CHALLENGE_ALREADY_SENT → errors.CHALLENGE_ALREADY_SENT in the band, and the row greys itself
  ├── 409 CHALLENGE_COOLDOWN     → errors.CHALLENGE_COOLDOWN (the friend refused a challenge recently)
  └── 403 MATCH_ALREADY_SEATED   → errors.MATCH_ALREADY_SEATED (a duel seats the challenger first, so a held seat refuses the send)
The room then arrives on its own: challenge_accepted → toast/bell ENTER TABLE → /gamelobby?join={code} → rejoin
```


---
---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `api.ts` | `postApi`, `fetchWithCsrf` and `translateErrorCode` request helpers |
| `hooks/useChallenges.ts` | The two send routes (challenge / room invite) and the server's sent list (the grey state) |
| `components/ConfirmActionModal.tsx` | The confirm both destructive row presses open |
| `store.tsx` | `useApp` for user and the presence feed behind the list |
| `router.tsx` | `navigate` |
| `i18n.ts` | `useTranslation` (`friends.*` keys) |

