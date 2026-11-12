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

> The Home page reads all of its data from the API; there is no mock data. It uses the retro/cyber styling (`NavDock`, the theme tables in `styles/themes/`).


---
---


## Files

| File | Role |
|------|------|
| `src/pages/Home.tsx` | Home page — hero header, arcade panel, friends list, footer |
| `src/heroScenes.ts` | One scene per theme (`SYNTHWAVE_80S_CFG`, `RETRO70_CFG`) behind `HERO_SCENES`: the palette, the crew's placement, the star count, the marquee colour, the 80s still's dim, and the artwork both scenes are made of (`sceneArt`) |
| `src/heroBackdrops.ts` | The attract-mode painters — `paintSynthwave`, `paintRoom` — plus the frame clocks, the star seeding, the still's placement and the `paintHero` dispatch |
| `src/hooks/useHeroScene.ts` | The cabinet's one canvas, one effect and one rAF loop; it preloads the still its scene names, and the marquee rides a ref so a language switch does not restart it |
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

The arcade panel renders its scene on one 720×400 canvas, and the theme decides which scene. Sixty times a second `useHeroScene` (`hooks/useHeroScene.ts`) advances two clocks and hands them, the scene's seeded star field, the still it preloaded and the localized marquee to `paintHero` (`heroBackdrops.ts`), which calls the painter the theme picked: `paintSynthwave` for the 80s card, or `paintRoom` for the 1970s lounge — a walnut wall, a porthole onto the orbital colony and the four seats standing in it as bobbleheads. The painters are plain functions over a 2D context, not components: one canvas, one effect and one rAF loop, so a theme flip tears the loop down and starts the other painter from frame zero instead of putting two animations on one screen.

The 80s card is made of its era's still: the cityscape the shell wears as its ground, cover-cropped to the card with its own horizon on the card's, dimmed and then given the drifting stars, the four army nodes and the marquee. Until that still decodes — or if it never does — the same painter draws the card it used to be, a banded sun over a horizon grid, and the still retires both when it arrives, because art that already carries a sun, a skyline and a grid must not be given a second of each. The two compositions are the same shot, so the swap does not jump.

Every number a painter draws with is a literal beside the call that uses it, and only colour comes from the scene. `heroScenes.ts` holds `SYNTHWAVE_80S_CFG` and `RETRO70_CFG` — the palette, the crew's placement, the star count, the marquee colour and the 80s still's two dim stops — behind one `HERO_SCENES: Record<ThemeType, HeroScene>` map, so a theme cannot ship unpainted. It is also the one place that knows which artwork belongs to which scene: `sceneArt` names the file (the 80s cityscape, the 70s colony), each sitting in its own theme's folder (todo.md 33, decision 19), and the hook preloads what it names. A painter that imported an asset itself would put a path in two modules.

Three painter details are load-bearing. The sun's disc and its scanlines share a single clip path, so a scanline stroke cannot extend past the disc even though each stroke is wider than the disc near its top. The room's sky is clipped to an aperture of 74..646 × 30..230: the frame, the ledge and the press-start card are three separate bands, so no sky is spent where the card would hide it. And the 80s still is positioned by its **horizon**, not its centre: cover-cropped to the card it is 720×483, the art draws its ground's haze 62 per cent down, and putting that row on the card's horizon at y 260 is what keeps the skyline above the grid. The room's sheet is cached under the marquee *and* whether the still has decoded, because a sheet painted before the colony arrived would otherwise be reused forever and a cold load would show a window with no colony in it.

### Localized hero and canvas strings

The hero title, the greeting, the canvas marquee, the arena title, the press-start copy and the footer line all come from the locale sheets, so they follow the language selector:

| Element | Key | English value |
|---------|-----|---------------|
| Hero title | `homeExtended.brandTitle` | `RETRO LUDO '42` |
| Greeting | `home.greeting` | `Welcome, Pilot {{name}}` |
| Canvas marquee | `homeExtended.heroMarquee` | `[ ft_Transcendence // Team: Pace 24 ]` |
| Arena title | `homeExtended.arcadeArenaTitle` | `RETRO LUDO '42 // ARCADE ARENA` |
| Press-start title (80s) | `homeExtended.pressStartTitleSynthwave` | `▶ INSERT COIN // PRESS START ◀` |
| Press-start subtitle (80s) | `homeExtended.pressStartSubSynthwave` | `[ CLICK SCREEN OR PRESS SPACEBAR ]` |
| Press-start title (70s) | `homeExtended.pressStartTitleRetro70` | `▶ INSERT COIN // LIFT OFF ◀` |
| Press-start subtitle (70s) | `homeExtended.pressStartSubRetro70` | `[ TAP THE SCREEN OR PRESS SPACEBAR ]` |
| Footer line | `home.footerLegal` | `© 1942-2026 RETRO LUDO '42 // 42KL // ALL RIGHTS RESERVED // WEB AUDIO & CANV-ARCADE` |

French swaps the brand for `LUDO RÉTRO`, the marquee team word for `Équipe` and the greeting for `Bienvenue, pilote {{name}}`. Malay uses `LUDO RETRO`, `Pasukan` and `Selamat datang, Pilot {{name}}`.

The marquee text is held in a ref inside `useHeroScene`, so a language switch only swaps the text and the loop keeps running: the star field is not reshuffled. The theme is the loop's only dependency, so a theme flip is the one thing that restarts it.


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
