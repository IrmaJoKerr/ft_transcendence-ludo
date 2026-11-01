# Frontend — Home Page

## Table of Contents

- [Overview](#overview) — Main landing page for signed-in users
- [Files](#files) — Source file inventory
- [Key Types / Interfaces](#key-types--interfaces) — Data shapes
- [Core Logic / Flow](#core-logic--flow) — Mermaid sequence diagram of home rendering
- [Logic Paths Summary](#logic-paths-summary) — Decision trees for content display
- [Dependencies](#dependencies) — Internal and external dependencies


---
---


## Overview

The Home page is the main landing page after login (`/home`, full-screen). It also acts as the player dashboard, and shows:

1. **Hero header** — the localized brand title, a greeting with the player's display name, and a live online-player count pushed over the session socket (`counts:online` from the store, no request).
2. **Arcade panel** — a window titled with the localized arena title, holding a 720×400 canvas that draws the sun, the star field, the horizon grid, four army nodes and the localized marquee, with a "press start" overlay. Clicking it, or pressing Space or Enter, opens `/gamelobby`.
3. **Friends widget** — read from `GET /api/friends` + `GET /api/friends/requests` once, then kept current by `friendship:changed` records on the session socket; shows live presence status.
4. **Notifications** — bell icon and toasts from `useNotifications()`, which listens on the session socket (`notification` frames, plus the `notifications:unread` snapshot on connect).
5. **Footer** — the copyright line and the Privacy Policy and Terms of Service modals.

> The Home page reads all of its data from the API; there is no mock data. It uses the retro/cyber styling (`NavDock`, `retrowave.css`).


---
---


## Files

| File | Role |
|------|------|
| `src/pages/Home.tsx` | Home page — hero header, arcade panel, friends list, footer |
| `src/hooks/useNotifications.tsx` | Notification bell + toasts (session socket, Redis bell) |
| `src/components/UserAvatar.tsx` | Avatar rendering |
| `src/components/NavDock.tsx` | The seated navigation dock (bar + chat slot) |
| `src/components/NotificationToast.tsx` | Toast notifications |


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
  friendsSince: string | null  // When the current state began
  status: 'online' | 'playing' | 'offline'  // Online status
}

type PlayerStats = {
  rating: number  // Player's rating (score)
  highestRating: number  // Best rating ever reached
  totalGames: number  // Total games played
  wins: number  // Games won
  losses: number  // Games lost
  totalCaptures: number  // Total pieces captured
  totalPiecesInGoal: number  // Total pieces that reached home
  avgCapturesPerGame: number  // Average captures per game
}
```


---
---


## Core Logic / Flow

### Home Page Render

Sequence of steps when the home page loads.
```mermaid
sequenceDiagram
    participant App as App.tsx
    participant Home as Home.tsx
    participant Hook as useFriendships()
    participant API as Backend
    participant Store as store.tsx
    participant Notif as useNotifications()

    App->>Home: <Home /> (full-screen route)
    Home->>Notif: useNotifications() → bell + toasts
    Home->>Hook: mount
    Hook->>API: GET /api/friends + /api/friends/requests + /api/friends/blocked
    Home->>Store: onlineCount (pushed as counts:online)
    API-->>Hook: snapshot
    Hook-->>Home: friends (sorted by rating) + received requests
    Home->>Home: Render the arcade panel and the friends list
    Note over Home: No interval: friendship:changed updates the column and the<br/>request badge; counts:online updates the online badge
```

### Arcade attract-mode canvas

The arcade panel renders its scene on one 720×400 canvas: the background gradient, the sun, the star field, the horizon grid, the four army nodes and the marquee. The sun's disc and its scanlines are drawn under a single clip path, so a scanline stroke cannot extend past the disc even though each stroke is wider than the disc near its top.

### Localized hero and canvas strings

The hero title, the greeting, the canvas marquee, the arena title and the footer line all come from the locale sheets, so they follow the language selector:

| Element | Key | English value |
|---------|-----|---------------|
| Hero title | `homeExtended.brandTitle` | `RETRO LUDO '42` |
| Greeting | `home.greeting` | `Welcome, Pilot {{name}}` |
| Canvas marquee | `homeExtended.heroMarquee` | `[ ft_Transcendence // Team: Pace 24 ]` |
| Arena title | `homeExtended.arcadeArenaTitle` | `RETRO LUDO '42 // ARCADE ARENA` |
| Footer line | `home.footerLegal` | `© 1942-2026 RETRO LUDO '42 // 42KL // ALL RIGHTS RESERVED // WEB AUDIO & CANV-ARCADE` |

French swaps the brand for `LUDO RÉTRO`, the marquee team word for `Équipe` and the greeting for `Bienvenue, pilote {{name}}`. Malay uses `LUDO RETRO`, `Pasukan` and `Selamat datang, Pilot {{name}}`.

The marquee text is held in a ref, so a language switch only swaps the text and the canvas effect keeps running: the star field is not reshuffled.


---
---


## Logic Paths Summary

### Home Render Path
```
<Home />
  ├── useNotifications() → notifications, unreadCount, markRead, markAllRead
  ├── Fetch /api/friends + /api/friends/requests
  │   └── Friends → render the friends list with presence
  ├── Read onlineCount from the store → render the hero badge (no request, D11)
  ├── Draw the arcade canvas (gradient, sun, stars, grid, army nodes, marquee)
  └── Space/Enter or a click on the arcade panel → navigate('/gamelobby')
```


---
---


## Hero Badge Bar

The hero section shows a live site-wide badge with the number of **online players**. It has no request
of its own: the store's session socket receives `counts:online` on every connection edge, and the
gateway also hands a freshly connected socket the last number it pushed, so the badge paints as soon
as the socket registers (D11 removed the old first-paint `GET`).


---
---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `api.ts` | `getApi` for `/api/friends`, `/api/friends/requests` |
| `store.tsx` | `useApp` for user, settings and the badge's `onlineCount` (pushed over the session socket) |
| `hooks/useNotifications.tsx` | Real-time notification bell + toasts |
| `router.tsx` | `navigate` to `/gamelobby` and `/profile` |
| `utils/audio.ts` | `retroAudio` sound effects |
| `styles/tw.ts` | The hero, window and arcade class constants |
