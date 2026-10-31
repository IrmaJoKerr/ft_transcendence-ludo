# Frontend — Lobby

## Table of Contents

- [Overview](#overview): Pre-game lobby for seat setup, bot setup and mode selection
- [Files](#files): Source file inventory
- [Key Types / Interfaces](#key-types--interfaces): Seat, PlayerCount and BOT_POOL types
- [Core Logic / Flow](#core-logic--flow): Mermaid sequence diagrams for lobby setup and game start
- [Logic Paths Summary](#logic-paths-summary): Decision trees for seat management and game start
- [Strict State Lock Hint](#strict-state-lock-hint): One live game per player, mirrored as a UI hint
- [Dependencies](#dependencies): Internal and external dependencies


---
---


## Overview

The lobby is at `/gamelobby` (`LudoLobby.tsx`), with a separate table/room screen at `/gamelobby/table` (`Lobby.tsx`). Players set up and start a game here. It has:

1. **Seat setup**: player count (2-4, read from the `?mode=` query param) and seat assignment (`you`, `player`, `bot`, or empty).
2. **Bot setup**: add or remove bots.
3. **Mode selection**: PvP (player versus player), PvE (player versus environment) or hotseat.
4. **Match creation**: `LudoLobby.tsx` lists the rooms the caller may enter (`GET /api/games/rooms`; each row carries `mySeat`, where `true` means "you hold a seat here, so this is a REJOIN row": including a room whose game already started, as long as your seat is still inside its 45 s grace window) and the games they are seated in (`GET /api/games/mine`), and joins them (`POST /api/match/join/:code`, `POST /api/game/:id/rejoin`) or creates a PvP (player versus player) invite (`POST /api/match/pvp/invite`); for local PvE/hotseat play it hands off to the table screen (`/gamelobby/table?mode=…`). The table screen (`Lobby.tsx`) is the one that calls `POST /api/match/create` with the exact `seatColors` and `botNames`, stores the returned `activeMatch` (gameId and engine token) in the store, then navigates to `/game`, where the Socket.IO connection starts.

> **Note:** The lobby communicates with the real backend. Creating a match returns engine credentials (`gameId`, `token`, `engineUrl`), which the Game page uses to connect through Socket.IO.

**Guest mode.** `/guest` renders the same screen with the `guest` prop set: bots fill every other seat, there is no mode picker and no active-game poll, and the launch posts `POST /api/match/guest` instead of `POST /api/match/create`. The payload is kept in the store as `guestSetup` so the end card's **Play again** can mint the same room again, and the return button goes to `/login`. See [`../guest-mode.md`](../guest-mode.md).

**Landscape notice.** `common.landscapeNotice` is mounted by the auth shell only (`LandscapeNotice` in `components/RetroAuthLayout.tsx`, the bordered strip above the card). The table screen and the PvP waiting room mount no copy of it, so the landscape/keyboard warning appears once, before sign-in, and the two waiting screens stay uniform.

**Room browser.** The "OPEN QUANTUM ROOMS" window is a six-column table: sector code, host
callsign, capacity, stakes, modes, and action. Its header carries the page's error line, the room-code
field and the **ACCESS ROOM** button: uppercase on change, 8 characters maximum, Enter submits, and the
field is disabled while `GET /api/games/mine` reports a room (the same lock as the host pass).
`GET /api/games/rooms` also returns the room's three
rule flags, so the MODES cell names the variant before a player takes a seat: `BASE GAME` when no
mutator is on, otherwise only the active ones (`CLASH MODE`, `FREE EXIT`, `NO SAFE ZONES`), with the
same icons and accent colours as the create-screen toggles. The cell's `title` carries the full
localized list, so a chip clipped by a narrow column still resolves without a hover-only "i" (which
touch users could not reach). Header and rows live in one scroll box with a sticky header, and the
shared template pins every track (`minmax(0, …)` for the flexible ones plus a fixed action width):
a scrollbar on the rows alone, a long chip, or a wider JOIN/REJOIN button sizing only its own grid
would otherwise resolve the two grids differently and leave each label a few pixels to the right of
the value below it, worse from left to right. The scroll box has no height of its own: the window takes
the height the passes leave behind, so the box fills it and scrolls, and the window's lower edge lands on
the dock's lower edge from about 900 px of viewport height upward (measured: 1280×900, 1440×1024,
1920×1080 and 1920×1200 all end flush with the dock and need no page scroll). Below that the window's
180 px floor wins and the page scrolls, which is the only way a 720p window can keep a usable list
(measured: 125 px of scroll at 1280×720, 45 px at 1280×800).

**Empty list.** One centred line of `--text-soft` at `calc(0.78rem + 1pt)` in the list's own box
(`padding: 28px 0`): `NO OPEN PVP ARENAS FOUND. INITIALIZE AN ARENA AT LEVEL 1`
(`ludoLobbyPasses.noOpenRooms`). It names the thing the window actually holds (arenas, not "combat
rooms") and the one control that makes one, the Level 01 pass directly above it, instead of pointing at a
"pass #01" the page does not label that way. The sentence is short enough to stay on one line where the
older copy wrapped: 489 px of text in the 840 px the list has at 1280 (FR 515, MS 419), and still one
line in a 556 px box, where the previous EN and MS lines broke to two. The translations use the
vocabulary the rest of the page already uses (`ARÈNE PVP` / `NIVEAU`, `ARENA PVP` / `TAHAP`).

**Entry passes.** Three ticket passes stack above the rooms window in a flex column as tall as the dock
(`calc(100vh - 64px)`): host a new arena, hotseat, and bots. They sit **3 px apart**, so they read as one
stack of tickets rather than three separate cards, and each is `RETRO_TICKET_PASS`, 124 px minimum (157 px
at the 1280 content width, where the host copy wraps to three lines). The three action pills share one
width, the widest label the active language can produce, because each pill stacks every label in a single
grid cell, hidden (`PassActionPill`): no measuring, and a translation needs no code. The 1.5 px transparent
border on `TICKET_ACTION_PILL` is part of that, so the borderless host pill is not 3 px narrower than the
other two.

**The error line.** The page's error channel rides in the rooms window's header, on the title's own line:
`OPEN QUANTUM ROOMS (n)`, then the message, then the code field. It is centred in the row's slack —
`justifyContent: 'center'` on the span it lives in — so it reads as a line of its own between the counter
and the field instead of a caption appended to the counter: equidistant air on both sides, in whichever of
the three locales the message arrives. One row of white, 0.75 rem mono text with the localized
`ludoLobbyExtra.errorPrefix` in front of it and a red bloom behind it, ellipsised with the whole sentence in
`title`. The span is mounted in both states with `width: 0` and `flex: 1 1 0`. The zero *basis* alone is not
enough: the text still counts towards the group's max-content size and the header grew 57 → 87 px with a
long message, so the definite zero width is what keeps the message out of the header's line-breaking maths;
`grow` then hands it every pixel the row has left, and an empty span leaves the row exactly as it was.
Measured header height with and without the `MATCH_ACTIVE_GAME` sentence: 57 px at 1280×720, 1280×900,
1536×900 and 1920×1080, and 87 px at 556×800 in both states — the title and the field stay vertically
centred on one line wherever they already shared it, so a failure never moves the passes, resizes the window
or reflows the list. The room the line gets is the row's slack: 360 px at 1280×900, 616 at 1536×900 and
1000 at 1920×1080, where the 726 px EN sentence fits whole and sits with 155 px of air either side. Below
that the message fills the slack and ellipsises (`// ERROR: You already have an active game. L…`), which is
where its 4 px margin comes in: 4 px + the group's 8 px gap on the left equals the header's own 12 px gap on
the right, so even a full-width message keeps the same 12 px of air on both sides (measured 12.0 / 12.0 in
EN, FR and MS at 1280×900 and 1024×768; the message's own midpoint lands on the span's to within 0.1 px at
1920×1080, FR `// ERREUR : Vous avez déjà…` and MS `// RALAT: Anda sudah…` included). The full sentence is
the tooltip, and the shorter failures (`Invite code not found or expired`) centre with even more air.
`role="status"` sits on the always-mounted span, so the message is announced when it arrives instead of only
when it is looked at.

The column is one stack, so it is a flex column rather than a 12-column grid: one `gap: 3px`, the same air
the passes keep between themselves and the same 3 px that separates Level 03 from the rooms window's top
edge. The window closes the stack with `flex: 1 1 0` and a 180 px floor, the list filling whatever height is
left (see above). Nothing else reserves space in the column: with the error line in the header, the 3 px
gutter is the only strip that is not content.


---
---


## Files

| File | Role |
|------|------|
| `src/pages/LudoLobby.tsx` | Main lobby page (`/gamelobby`): mode/seat setup, match creation |
| `src/pages/Lobby.tsx` | Table view (`/gamelobby/table`): room state, ready, invites |


---
---


## Key Types / Interfaces

### Seat

```typescript
export type Seat =
  | { type: 'you' }
  | { type: 'bot'; name: string }
  | { type: 'player'; name: string }
  | { type: 'empty' }
```

### PlayerCount

```typescript
export type PlayerCount = 2 | 3 | 4
```

### BOT_POOL

```typescript
// From theme.ts
export const BOT_POOL = ['Siri', 'Alexa', 'Cortana']
```

Bot assistant names, shown as-is because they need no translation. Three is enough:
seat 0 is always you, so a 4-seat table holds at most 3 bots.

The chosen name is also the in-game label. `Lobby.tsx` sends the names as `botNames`,
the backend stores them on the seats as `displayName` (`bot-<color> (<assistant>)`), and
the engine hands them back in the game state, so the table screen and the game screen
agree. Detail: [backend-match-module.md](../backend/backend-match-module.md),
[frontend-game-module.md](frontend-game-module.md).


---
---


## Core Logic / Flow

### 1. Lobby Rendering

Sequence of steps when the lobby page loads.
```mermaid
sequenceDiagram
    participant App as App.tsx
    participant Lobby as LudoLobby.tsx
    participant Router as useRoute()
    participant Store as useApp()

    App->>Lobby: <LudoLobby /> (route /gamelobby)
    Lobby->>Router: useRoute() → { query }
    Lobby->>Store: useApp() → playerCount, seats, settings, user
    Lobby->>Lobby: Render mode/seat setup, bot controls, start button
```

**The seat roster shows an avatar on every occupied seat.** The host's own seat renders `UserAvatar` with
the store's `/me` facts, so it shows the uploaded photo when one exists and the generated avatar
otherwise. Each `type: 'player'` seat is a *local* hotseat pilot: it has no account, so it renders the
generated DiceBear avatar seeded from the name typed for it here (renaming the seat re-seeds the
avatar), and it issues no photo request at all. A `type: 'bot'` seat takes that same generated path,
seeded from the assistant name (`BOT_POOL`) this roster assigned it, which is the seed the arena and the
results invoice reuse. This is the lobby half of the same rule the game board follows; see
[avatar-system.md](../avatar-system.md) → 4. Game seats.

**The launch panel's bot tally.** `// BOT UNITS:` (`lobby.botUnitsLabel`, `lobby.unitsCount`) is a row of
the ARENA LAUNCH CONTROL window, and it renders only where a bot can actually be seated: the same
`allowAddPlayers` flag that decides whether a seat offers **+ ADD AI BOT** in the first place. Hotseat
arrives as `bots=0&local=1`, so its panel has no bot row at all and runs pilots → arena mode → sector
matrix → win condition, with the rows' 14 px gap closing up where the row was; the PvE and guest
variants keep it. Nothing is lost, because in hotseat `canStart` asks for two local pilots rather than
one bot, so that line could only ever read a permanent `0 UNITS`.

### 2. Start Game Flow

The lobby (`/gamelobby`) sets up the seats and then hands off to the table screen
(`/gamelobby/table`); the table screen creates the match.

```mermaid
sequenceDiagram
    participant User
    participant Lobby as LudoLobby.tsx
    participant Table as Lobby.tsx (table)
    participant API as Backend
    participant Store as AppProvider
    participant Router as navigate

    User->>Lobby: Choose a mode / seats, click start
    Lobby->>Router: navigate('/gamelobby/table?mode=…&bots=…&local=…')
    Note over Lobby: Or join directly (POST /api/match/join/:code, POST /api/game/:id/rejoin, POST /api/match/pvp/invite)
    Table->>API: POST /api/match/create { mode, playerCount, botCount, seatColors, botNames }
    API-->>Table: { gameId, token, engineUrl, color, inviteCode? }
    Table->>Store: setActiveMatch({ gameId, token, color, mode, playerCount, inviteCode })
    Table->>Router: navigate('/game?gameId=…') → Game connects via Socket.IO
```

### 3. Strict State Lock Hint

The backend allows **one live game per player** (see
[backend-match-module.md](../backend/backend-match-module.md) → Strict State Lock
(`active-game.ts`)). Both lobby screens mirror that rule as a hint, never as the
gate:

| Screen | Source of truth | What it does |
|--------|-----------------|--------------|
| `LudoLobby.tsx` (`/gamelobby`) | `GET /api/games/mine` once on mount (and on every socket reconnect), then the `rooms:mine` push | Greys out the host pass and the code field in the rooms window header, and disables the JOIN button on rooms the caller holds no seat in (a REJOIN row stays enabled), each with a tooltip and an inline message. The header seat badge reads `ACTIVE ROOM: YES [IN-FLIGHT]` |
| `Lobby.tsx` (table, `/gamelobby/table`) | one-shot `GET /api/games/mine` on mount | Greys out LAUNCH and shows the lock message in the status box, with a tooltip |

The lobby's room list follows the same shape: one `GET /api/games/rooms` for first paint, then
`rooms:list` from the session socket (see
[backend-match-module.md](../backend/backend-match-module.md) → Lobby invalidation). Neither the list
nor the lock is polled.

Neither screen trusts the store's persisted `activeMatch`: it survives a closed tab
and would lock the screens forever after a game that ended off-screen. The
authoritative `GET /api/games/mine` empties itself as soon as the room is gone, so
the buttons come back on the next read. A create or join that still slips through
(another tab started a game in the meantime) is refused by the backend with
`403 MATCH_ACTIVE_GAME`, which `api.ts` renders as the localized
`errors.MATCH_ACTIVE_GAME` message in the rooms window's header.


---
---


## Logic Paths Summary

### Lobby Render Path
```
<LudoLobby /> (/gamelobby)
  ├── useRoute() → query (mode preselect)
  ├── useApp() → playerCount, seats, settings, user
  ├── Render seat grid for seats[0..playerCount)
  │   ├── type = 'you' → host seat (account avatar: uploaded photo, else generated)
  │   ├── type = 'bot' → bot name + remove button + generated avatar (assistant-name seed)
  │   ├── type = 'player' → named local pilot seat + generated avatar seeded from the name
  │   └── type = 'empty' → "+ Add" card
  └── Render Start button (enabled when a valid setup is chosen)
```

### Match Creation Path
```
LudoLobby.tsx (/gamelobby)
  ├── Local setup → navigate('/gamelobby/table?mode=…&bots=…&local=…')
  ├── Create room → POST /api/match/pvp/invite
  │   └── Refused while GET /api/games/mine is non-empty (you are already seated somewhere);
  │       the same signal greys out the host pass and the join controls
  ├── Room row → room.mySeat → POST /api/game/:id/rejoin (REJOIN row, own seat)
  │              otherwise → POST /api/match/join/:code (JOIN row)
  ├── Invite-code field (rooms window header) → a code matching one of your own row → rejoin
  │                     any other code → POST /api/match/join/:code
  └── Success → setActiveMatch(result) → navigate('/game?gameId=…')

Lobby.tsx (table, /gamelobby/table)
  ├── LAUNCH disabled while GET /api/games/mine reports a room (one-shot read on mount)
  ├── POST /api/match/create { mode, playerCount, botCount, seatColors, botNames }
  │   ├── Error (bad mode / bots in non-pve) → show message
  │   └── Success → setActiveMatch(result)
  └── navigate('/game?gameId=…') → Game connects via Socket.IO
```

### Seat Management Path
```
addBot(i)
  └── Find unused bot name from BOT_POOL → seats[i] = { type: 'bot', name }

removeBot(i) / removePlayer(i)
  └── seats[i] = { type: 'empty' }

addPlayer(i)
  └── seats[i] = { type: 'player', name }
```


---
---


## How Seat Colours Are Sent

For hotseat and PvE, the created game is exactly the occupied seats (the host is always seat 0 / blue, then each added local player or bot in seat order). `Lobby.tsx` therefore sends the **exact** `seatColors` list rather than a count. Without it, the engine's `playerCount`-based default fills the gaps again and brings back seats the user deliberately skipped.


---
---


## Implementation Notes

- **Rule toggles reuse the seat sounds** (`components/RoomRuleToggle.tsx`, shared by `Lobby.tsx` and `Game.tsx`). Switching a rule on plays the seat-added blip (520 Hz); switching one off plays the seat-removed blip (320 Hz). Both use the shared 0.05 s duration, so the rules panel sounds like the seat controls beside it.


---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `store.tsx` | `useApp` for mode, seats and game actions |
| `router.tsx` | `navigate('/game')` on start |
| `theme.ts` | `BOT_POOL` constant, inline styles |
| `components/UserAvatar.tsx` | Seat avatar: the host's uploaded photo when one exists, otherwise the generated DiceBear avatar seeded from the seat name (local hotseat pilots have no account, so they only ever get the generated one) |