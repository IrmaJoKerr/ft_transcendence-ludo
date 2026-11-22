# Frontend — Shared Components

## Table of Contents

- [Overview](#overview): Reusable UI (user interface) components used across pages
- [Files](#files): Source file inventory
- [Key Types / Interfaces](#key-types--interfaces): Component props and shared helpers
- [Core Logic / Flow](#core-logic--flow): Mermaid sequence diagrams for each component
- [Logic Paths Summary](#logic-paths-summary): Decision trees for rendering
- [Tailwind Utilities (`styles/tw.ts`)](#tailwind-utilities-stylestwts): The shared utility-class constants
- [Implementation Notes](#implementation-notes): Portals, compact mode, nav-label auto-sizing, avatar attributes, CJK (Chinese, Japanese and Korean) text sizing
- [Dependencies](#dependencies): Internal and external dependencies


---
---


## Overview

The shared components are reusable UI (user interface) building blocks used on several pages. They are:

1. **NavDock / RetroNavbar / LobbyChat**: the seated navigation column. `NavDock` owns the `<aside>` spacer and the dock's width; `RetroNavbar` renders the rail inside it; `LobbyChat` fills the chat slot at the bottom of the dock, and `ChatNameCard` is the card a press on a name opens, mounted by the lobby and by the room (19.7).
2. **RetroAuthLayout**: centered layout for the authentication pages (login, signup, 2FA, forgot/reset password).
3. **Board / Die**: the Ludo board and the animated die.
4. **UserAvatar**: avatar rendering.
5. **OAuthButtons**: Google, GitHub and 42 provider buttons.
6. **NotificationBell / NotificationToast**: the notification bell and toasts.
7. **CyberModal / ResultsModal / GameRulesModal**: cyber-styled modal base, the post-game results overlay, and the ten-page rules deck the game and the lobby both mount.


---
---


## Files

| File | Role |
|------|------|
| `src/components/NavDock.tsx` | The dock every docked page mounts: the sticky `<aside>` spacer, the width, and the forwarding to `RetroNavbar`. Width and chat state come from `hooks/useDockPrefs.ts`, so the spacer and the bar cannot disagree. Mounted by exactly six screens (Home, Leaderboard, Friends, Profile ×2, LudoLobby, Squads); `/game`, `/gamelobby/table` and `/guest` mount no dock |
| `src/components/RetroNavbar/` | The bar inside the dock: account pill and popover, five nav buttons with auto-fitted labels, the rejoin banner, and the notification bell. The banner speaks for a PvE or PvP seat only (`rejoinableRoom()`, so a hotseat room costs the dock nothing and cannot hide a simulation), fills its first line from the row's own `gameType` through `navbar.rejoinModeLabel` (`REJOIN PVE MATCH`), and draws its `ROOM:` line only when the row has a code (20.6). Takes its geometry (`isCompact`, `chatOn`, `onToggleChat`) from `NavDock`. Its bell block is marked `data-chat-reserve`, the floor the dock's chat card measures itself against (19.3) |
| `src/components/LobbyChat/` | The dock's chat slot, wired to the public channel: the header and ON/OFF pill, a screen that previews the newest three lines, and the card it portals to `document.body` (its floor is the bell row the bar marks `data-chat-reserve`, one pixel of gap, and its size is `ChatCard.tsx`'s `CHAT_CARD_WIDTH` 480 × `chatCardHeight()` — `CHAT_CARD_MIN_HEIGHT` 420 / `CHAT_CARD_VH` 0.6 / `CHAT_CARD_MAX_HEIGHT` 720 with `CHAT_CARD_MARGIN` 16 — shortened by a short window). The card carries the transcript (newest at the bottom, merged by message id), a composer that is disabled while the socket is down, and one reserved status line under it whose height fits every string it can show in every language. A name in the transcript opens `ChatNameCard.tsx`'s card (19.7), the same one the room opens: ADD FRIEND asks on its first press and sends on its second, ACCEPT REQUEST answers a pending one, and BLOCK sits last but one under a rule, confirmed through `ConfirmActionModal`; every outcome lands in the status line rather than in a toast. What the lobby adds to that card is CHALLENGE, passed only for a friend while the viewer is in a PvP room: the app's one route through `useChallenges` with the viewer's own `gameId`, greyed from the server's sent list. The feed is filtered against the viewer's own block list, so a blocked pilot's lines leave the plate and the transcript (and return on unblock) without a refetch; the plate's preview and the card paint that same filtered list. Since M3 the head, the transcript **and the composer** are imported from `ChatCard.tsx`, since 19.8 the reserved band under the composer is too (`ChatStatusBand`), and the head it shares carries no panel switch here, so the lobby and the board paint one channel, count one counter and reserve one height. The ring itself is `hooks/useChatFeed.ts`'s, the same hook the room drives |
| `src/components/ChatCard/` | The chat card, in one place (M3): `ChatCardHead` (the channel, its scope, the way out, and — when a host has a panel — that panel's switch beside CLOSE: the INVITE COMMS glyph in a doubled 44 × 36 box with its title as a caption under the press, absent in the lobby), `ChatCardFeed` (a system line is one centred muted row rendered from its `code`, a player's line is two rows), `ChatStatusBand` (the reserved line under the composer, exported since 19.8: one grid whose text cell is as tall as the longest string the band can hold in this language, and nothing else — a control is the head's, so a switch never changes what the band reserves), `ChatCardComposer` (`n / 300` from `chatLength`, the same helper both pre-send guards call, so the counter and the refusal count one unit; disabled when the transport is down or a clash is up) and `ChatCard` — the compact slot (`gameChat.slotTitle`, `ENCRYPTED COMMS`: the room's channel is the private one and its name says so, 20.3, against the lobby's public `# HYPERSPACE COMMS`; the newest three lines) that opens the same card as an overlay anchored to the slot's rectangle, with an optional `sidePanel` portaled 8 px past the card's right edge (or its left, when the right will not fit, both clamped inside the viewport), opened by the head's switch and closed by it, by Escape or by closing the card, plus `inert` while a clash runs. `onOpenName` hands the host the pressed name and its rectangle, so the card a host opens lands beside it; a press inside any `[data-chat-overlay]` or above an open modal is not the transcript's outside press, and Escape stands down while an overlay is up, so the stack dismisses one press at a time. The card's size is this file's too (19.3): `CHAT_CARD_WIDTH` (480), `CHAT_CARD_MIN_HEIGHT` (420), `CHAT_CARD_VH` (0.6), `CHAT_CARD_MAX_HEIGHT` (720), `CHAT_CARD_MARGIN` (16) and `chatCardHeight()` are exported, so the dock draws the board's card at the board's size, and the height is a budget rather than a ceiling — the head and the reserved band are drawn inside it, so the transcript gives up the rows and the card never grows under what a channel has to say. The shell it wears — the account popover's gradient under `blur(24px) saturate(180%)`, a 1px cyan edge and an outside glow, radius 10, padding 14 — is `chatSurface.ts`'s `CHAT_SURFACE` since 24, one recipe for this card, the lobby's copy of it and the INVITE COMMS panel, and a module of its own because `react/only-export-components` accepts a number beside the components but not an object literal |
| `src/components/chatCardTypes.ts` | `ChatCardLine` (id, sender, text, `at` as ms), `ChatCardStatus` (a resolved one-line refusal or confirmation), `ChatHeadGlyph` (the head's switch: glyph, label, pressed, press) and `systemLineText` (a stored line's `code` → this reader's locale). Split out so `ChatCard.tsx` exports components (and the card's one size, 19.3) only, and so the page, the store's socket types and the profile's transcript renderer can share the shape without importing the card. The character cap and its counter are **not** here: `CHAT_MAX_CHARS` and `chatLength` live in `common/src/chat.constants.ts` (`../__shared__/chat.constants` is this tree's copy) because both servers count the same units |
| `src/components/ChatNameCard.tsx` | The card a name opens (M3/19.7), one component for both channels so a pilot met in the lobby and a pilot met across the board are offered the same acts: the pressed name, the friendship state the host read (`friends`, `requests`, `loading`), ADD FRIEND (two presses — the first relabels the button to `chat.card.addFriendConfirm`, the second sends, because a request cannot be withdrawn), ACCEPT REQUEST, and BLOCK last but one under a rule, confirmed through `ConfirmActionModal`, whose consequence is the friendship sentence when there is a friendship or a pending request to lose and the stranger's sentence when there is not. CHALLENGE is the one optional act (`challenge?: { sent, onPress }`): the lobby passes it for a friend while it has a PvP room, and that press is a room invite rather than a duel (19.6), while a room passes nothing because inviting from a room belongs to the occupancy panel. It portals itself at z-10005, over the transcript's 10004, placed once off the pressed rectangle (220 px wide, clamped inside the window), closes on Escape or an outside press (both standing down while the confirm is up), and reports every outcome to the host's band before closing, so one surface reports and none repeats it |

| `src/components/InviteComms.tsx` | The waiting room's INVITE COMMS panel (M3), mounted through `ChatCard`'s `sidePanel` and only while the room is `WAITING`: the friends whose presence reads `online` and who are not in `view.players`, challenging through `useChallenges` with the room's own `gameId` (`POST /api/friends/:friendId/invite`), greyed from the server's sent list and answering in a band under the well. Off by default behind the card head's switch, 240 px wide in a portal beside the card, scrolling inside it — and since 19.8 it costs the board's column nothing, so a full room says nobody is free instead of vanishing. Since 24 it wears the card's shell (`CHAT_SURFACE`), the card's head, well, rows and band, and the card's height rather than a ceiling, so an empty panel is card-shaped; the head's second line states the room's occupancy (`{{seated}} / {{capacity}} SEATS TAKEN`). Since 19.7 its friend list is the page's one `useFriendships` read, passed in, so a waiting room opens the page and the panel with one snapshot rather than two |
| `src/hooks/useChatFeed.ts` | The transcript both channels paint (19.8): the ring, its cap, a `chat:history` frame that replaces it and a `chat:message` frame that appends after an id check, so the lobby (`store/store.tsx`, capped at `CHAT_HISTORY`) and the room (`Game.tsx`, capped at `CHAT_LINES_KEPT` = 200) cannot order or dedupe differently. A transport-free state container: the host owns the socket and the events |
| `src/components/ConfirmActionModal.tsx` | The app's one destructive confirm: `CyberModal` on its own portaled layer at z-10006, above the name card's 10005 and the transcript's 10004, so a gate opened from a stacked surface sits on top of it. The friends screen's BLOCK and REMOVE and both name cards' BLOCK (`ChatNameCard`, 19.7) render it |
| `src/components/railButton.ts` | Shared rail-button styles: `railButtonStyle(active)` and `railHoverHandlers(active, edge)`, used by the navbar rail buttons |
| `src/components/RetroAuthLayout.tsx` | Retro-styled authentication page container (`tag`, optional `topRight` pinned 12px inside the card's top-right corner, `children`), `LandscapeNotice` (the bordered strip above the card, mounted here only: the table screen and the PvP waiting room mount no copy), and `NeonCheck`: the terms tick glyph |
| `src/components/LanguageSwitcher.tsx` | Segmented EN/MS/FR switch in two renderings: the compact `pill` used by `Login` (`topRight`) and `LegalPage`, and the two-line `tabs` used by the `RetroNavbar` account popover |
| `src/components/ThemeSwitcher.tsx` | The theme picker in the same popover: one row per entry in `THEMES`, each a two-tone chip of that theme's own token pair, the active row ringed in `--accent-cyan` with a checked tick and a 4 px inset edge. It lists both themes rather than offering "the other one", so the row says what is on *and* what else exists, and a third theme arrives as a third row. Writes through `setTheme`, which persists `retro_theme` and stamps both `data-theme` attributes |
| `src/components/PieceFigure.tsx` | A piece as SVG, from the parts in `src/game/pieceParts70/` (the 1970s bobbleheads) or `src/game/pieceParts80/` (the 1980s characters), chosen by a `set` prop: one component for the board's `Sphere` and the clash result's cast, so the two screens cannot draw two different pieces. Both sets are 100-unit art with feet on the same line, and each set resolves its own palette (`piecePalette` / `piecePalette80`). A `pose` prop (`front` by default, `left`, `right`) turns the **face, never the head**, and it is one rule for both sets: `poseTurn` is one matrix about x 50 built from `CREW_TURN`, squash `0.8` and slide `6`, with no per-set number anywhere, and it is applied to the run a `PieceLayers` list marks `turn` — `PIECE_LAYERS` for the 70s (the helmet's `visor` turns, its pods and aerial do not) and `cutAtNeck(parts, PIECE_HEAD_80[ck], PIECE_FACE_80[ck])` for the 80s, which cuts each head into outline / face plate / outline / body and turns only the plate. Both of those numbers are the generator's, so a plate that overran its own head cannot ship (`todo.md` [30](todo.md#rv30-set)). `PieceLayers` is an ordered list of runs, not three named layers, because the two tables draw in different orders — the 80s authors each figure head first, so its collar is painted over its chin — and the component draws them in the table's own order, which is what makes `front` pixel-identical to the flat art (`todo.md` [29.3](todo.md#rv29-jaw)). Nothing is mirrored and no gradient is reversed: the 80s figures carry nothing in their hands and are symmetric about x 50, so a posed figure is still lit from the side it was drawn with. Bare `<g>` content, so the caller owns the frame |
| `src/components/Board/` | Ludo board: tracks, bases, pieces, legal-move highlights. Every safe square (the four tinted starts and the four pre-start cells) wears the same `SafeStar` — white core, black outline, so it stays legible on both the near-black track and the four neon start cells — and the `noSafeZones` rule withholds all eight together. Cell geometry (step → board cell) lives in `src/game/boardGeometry.ts`, and the capture burst it draws is `src/components/CaptureBurst.tsx` |
| `src/components/CaptureBurst.tsx` | The capture burst: one expanding ring plus eight sparks, drawn around a 0×0 anchor at the caller's origin so the caller decides where on screen it goes. `opacity` scales the whole thing. Pure cosmetic, no input |
| `src/components/GoalBurst.tsx` | The goal's arrival, on the same anchor rule as `CaptureBurst`: twelve rays on a 30° pitch (long and short alternating, the seat's hue alternating with white), a hot core and one shock ring, all inside `GOAL_BURST_MS` 700 read through `game/timing.ts`. Mounted by the setter that lands a path's last tick, so the piece never leaves an empty cell between frames |
| `src/components/GoalConfetti.tsx` | The goal's celebration with the room's effects rule **off**: twenty hand-laid pieces thrown from the cell the piece left, each with its own drift, spin and delay, every one of them ending exactly on `GOAL_FX_MS`. The overlay is the rule's; the starburst and the fanfare are not |
| `src/components/GoalCard.tsx` | The goal's celebration with the rule **on**: the goal counter made spatial — the home stretch as a ramp with four stations, filled bottom to top, `PieceFigure` climbing from the ramp's foot to the station this move filled (the higher the count, the longer the climb) and the station flashing on the landing. Exports its frame (`GOAL_CARD_MAX_PX` 336, `GOAL_CARD_VIEWBOX`, `GOAL_CARD_ASPECT`), the flash card's width cap at this card's own ratio |
| `src/components/Die.tsx` | The die as one cube: six faces painted once from `PIP_MAP` and turned by `FACE_ROTATIONS`, normalised onto the nearest full turn at rest. The acts come from `common/src/timing.constants.ts` — ACCEL up onto a corner, a four-beat SPIN about the vertical, then SLOWDOWN and one to three FLOPs untapped, or ACUTE, its three-quarter slowdown and the same FLOPs when the die is caught — with the tail planned backwards from the face it settles on. Each era paints the faces itself (`diceParts70.ts`, `diceParts80.ts`, the pair the piece sets set) and every colour is one of the eight `--dice-*` tokens; the roll's three cues (`playDiceSpinTick`, `playDiceFlop`, `playDiceSettle`) are scheduled off the same plan. Exports `DiceFace`, so the roster's 38 px die is the same face |
| `src/components/ColorPaletteModal.tsx` | The colour picker for one seat: a fixed 2×2 in board-quadrant order (`BOARD_QUADRANTS`) with a taken corner drawn as an inert dashed slot, and a turn-order diagram beside it — four numbered rings joined by clockwise arrows, numerals and arcs derived from `SEAT_COLORS`, corners not on offer dimmed to 35 %. `sm:max-w-2xl` with the diagram in a 150 px left column (stacked and centred below `sm`), and the whole body scrolls inside `max-h-[90vh]` |
| `src/components/RoomRuleToggle.tsx` | One room-rule row, shared by the create screen's rules panel (`pages/Lobby/Lobby.tsx`) and the host's in-game one (`pages/Game/Game.tsx`): glyph, label, description and the on/off switch, with the 520/320 Hz toggle blip. The caller owns the order, so both panels read clash → mid-clash key shift → free exit → no safe zones → the cosmetic attack animations last |
| `src/components/UserAvatar.tsx` | Avatar image: keyed by the immutable `userId`; requests the photo only when the seat is not a bot and a photo is known to exist (payload flag or a live `avatar_changed` override, which the backend pushes to that user's own clients only), otherwise renders the DiceBear default. A failed load marks that id broken for the session so it is not retried; an optional `onPhotoError` callback runs when that happens, so a parent component can show a message (the Profile page uses it to show a warning in the user's language) |
| `src/dicebear.ts` | DiceBear helper: generates an avatar data URI (Uniform Resource Identifier) (`avataaars`/`bottts`/`identicon`) |
| `src/components/OAuthButtons.tsx` | OAuth provider buttons (42, GitHub, Google) |
| `src/components/NotificationBell.tsx` | Bell icon, unread badge and dropdown — an **index**, not an action surface (22.7): every stored row either routes or is a receipt, and the accept/join/enter-table verbs the panel used to carry are gone. A router takes you where the state lives (`notificationDestination.destinationFor()`) and clears the whole family that lands there (`markReadMany` over the rows sharing the destination string, which is why the `?tab=` is part of the key); a stamp clears itself and goes nowhere. A lapsed `game_invite` is a stamp whatever its type: its payload carries `expiresAt`, its row prints `EXPIRED`, and nothing is offered that cannot be accepted. Renders at most 60 rows, the same bound as the store and the batch route |
| `src/components/NotificationToast/` | The live cards and the boot digest, on one clock (`TOAST_AUTOCLOSE_MS` = 8000, and the `notifAutoClose` preference can switch the clock off). An action **deletes** the entry it spoke for (`dismissToast(id, 'read')` → `markReadMany`), while the clock only hides a card (`'timeout'`), leaving its entry unread in the bell; the digest is a report on the load — rows and total computed once from the handshake snapshot and frozen, and built from every stored type *minus* the two the reader performed themselves: `profile_updated`, and `match_abandoned`, whose entry a page refresh writes about the seat that reloaded (the bell keeps it; the report is news from elsewhere) — not a window on a burst. A `game_invite` is answered here by one of two presses: a `challenge` (no room yet) posts the accept route, prints any of the four named failures in its own band (`CHALLENGER_OFFLINE` / `_BUSY`, `CHALLENGEE_OFFLINE` / `_BUSY`) and only then navigates, while a `room` invite carries the room code to the lobby and nothing more — a notification reports an event and never ends a game, so a seat already held is released by the player's own Abort. Its tag and its `DUEL`/`INVITE` badge both come from `payload.kind` through `notificationParts`, and so does the bell's, so the two surfaces cannot drift; a `challenge_accepted` frame offers one ENTER TABLE press, because the challenger is already seated in the room it names |
| `src/components/notificationParts.ts` | What the bell, its rows and the digest share so they cannot drift (22.2/22.9): `parseNotificationPayload` (the defensive parse for rows that arrived as JSON strings), `getNotificationTypeBadge(type, payload)` (the bracketed tag and its colour, where `game_invite` keys off `payload.kind` — a room invite prints `[MATCH_INVITE]`, a challenge `[MATCH_CHALLENGE]`), `offerMechanism` / `offerMechanismLabel` (the mechanism an offer travelled by, `'challenge'` or `'room'`, rendered `DUEL` / `INVITE`; never a headcount, because a challenge builds its four-seat room at the accept), `notificationAge` (just now / minutes / hours / days) and the two liveness tests, `isOfferExpired` for a bell row and `isPendingOfferLapsed` for a strip row |
| `src/components/NotificationRow.tsx` | One stored entry drawn as a row — unread diamond, tag, age, sentence — moved out of the bell when the digest report needed the same sentence for the same type. The sentence is a switch over the stored types (`friend_request`, `match_finished`, `profile_updated` with its seven `profileItem*` labels, …), a `game_invite` reads `matchChallengeText` or `matchInviteText` by mechanism, and the tag is `notificationParts`', so the bell and the report cannot word one entry two ways. A lapsed offer prints `EXPIRED` in the tag slot and its press is an acknowledgement |
| `src/components/notificationDestination.ts` | `destinationFor(n)`, one pure function returning the route a row click takes, or `null` for a stamp (22.7). The returned string is **also** the prune key: a click marks read every row that shares it. Routers: `friend_request`, `friend_accepted` and a challenge → `/friends?tab=friends`; a room invite and `challenge_accepted` → `/gamelobby?join=<code>`; `achievement` → `/profile?tab=achievements`; `match_finished` / `match_abandoned` / `match_cancelled` → `/profile?tab=history`. Stamps: `friend_removed` and `friend_declined` (no page shows a severed link), `profile_updated` (its detail is in the row), and a lapsed offer whatever its type |
| `src/components/PendingOffers.tsx` | The live offers strip on the Friends page (22.9), above the search field in the friends tab: one row per offer still open, newest first — the sender's handle, the mechanism word (`DUEL` or `INVITE`), the age, then one verb — ten rows and it scrolls, `EXPIRED` where a verb was. ACCEPT posts `/api/friends/challenges/:fromUserId/accept`, takes the seat and lands on the game through `setActiveMatch`, exactly as the toast does; JOIN is `navigate('/gamelobby?join=<code>')` and nothing else, because a room invite is an address; the four named refusals print in one band above the rows. It recomputes on mount, on window focus, and once at the nearest `expiresAt`: no poll, no Redis event, no push |
| `src/components/AutoCloseToggle.tsx` | The `notifAutoClose` switch, one component with two homes (`RetroNavbar`'s account popover and the bell panel). The preference rides `store/store.tsx` and defaults on; it decides only whether a card obeys the clock — the bell keeps every entry either way, and the toggle itself is never what dismisses anything |
| `src/components/ProfileEditModal/` | Edit-profile dialog |
| `src/components/DeleteAccountModal.tsx` | Delete-account dialog (sets a password first for OAuth-only accounts) |
| `src/components/LegalModal.tsx` | Privacy Policy / Terms of Service popup, opened from Home's footer and from the Signup terms link |
| `src/components/MarkdownViewer.tsx` | Renders the markdown legal documents |
| `src/components/CyberModal.tsx` | Cyber-styled modal base (`CyberButton`, `CyberModal`) used for confirmations and dialogs |
| `src/components/ControlsSettingsModal.tsx` | The in-game controls popover (`pages/Game/Game.tsx`): three key rows — dice, select piece, goal count — then the four preferences in the dock's own running order (language, auto-close, master audio, theme) on the `LegalModal` shell, 340 px wide, closed by the backdrop or Escape; only the rows scroll (`calc(100dvh - 2rem)`, `overflowY: auto`) and the audio switch is a row in the middle of them, at the dock's third position, rather than a fixed footer |
| `src/components/GameRulesModal/` | The ten-page rules deck (34, item 2), on `CyberModal`: the tab strip (`rulesTab0..9`), NEXT PAGE on pages 0-8 and START PLAYING on the last, copy from `gameExtra.rulesPage*`, and a 700 Hz beep on each turn. Its page lives inside it and resets on the way **out** (`closeModal()` zeroes it, and both the cancel and the last page's proceed go through that), so every open — from the game's GAME RULES button or from the lobby's — starts at the objective and no caller has to know about the counter. The page column is capped at `calc(100vh - 300px)` with its own `overflowY: 'auto'` and `scrollbarGutter: 'stable'`, and carries `key={rulesPage}` so the scroll returns to the top on every turn: pages 7, 9 and 10 are taller than a 900 px window, and uncapped they grew the centred `CyberModal` box to 1020 px and pushed its footer — CLOSE and NEXT PAGE — 86 px below the fold. The cap lives here and not in `CyberModal`, whose confirm dialogs want no scroll area. It is the only rules surface: there is no second deck and no diagram component |
| `src/components/ResultsModal.tsx` | Post-game results overlay: podium, rank badges, outcome title, return-to-lobby; guest-only Play again, exit label and refusal text |
| `src/avatarCache.ts` | Avatar state store, keyed by immutable user id: live `avatar_changed` overrides (`{has, style}`, delivered only to the owner's own clients, so its value is always about this user's own photo), a remount stamp per user, and a `broken` set so a failed photo is not retried |


---
---


## Key Types / Interfaces

### RetroAuthLayout Props

```typescript
type RetroAuthLayoutProps = {
  tag?: string;          // Optional tagline displayed above the form
  children: ReactNode;   // Form content
}
```

### NeonCheck Props

```typescript
type NeonCheckProps = {
  offsetTop?: boolean;   // Nudges the box down 1px to line up with the first text line
  checked?: boolean;     // Draws the tick and the glow; an empty box when false
  className?: string;    // Extra classes, such as the focus ring Signup passes in
}
```

### Board Component

Presentational: it takes all game state as props and never reads the store itself.

```typescript
type BoardProps = {
  pieces?: Array<{ id: string; color: string; step: number; isInGoal: boolean; isInBase: boolean }>
  players?: Array<{ color: string; status: string }>
  legalMoves?: Array<{ pieceId: string; from: number; to: number; isCapture: boolean; isHomeEntry: boolean }>
  onPieceClick?: (pieceId: string) => void
  animating?: { pieceId: string; step: number } | null  // renders that piece at `step` during the move animation
  fx?: { color: string; to: number } | null             // transient capture-burst overlay
}
```

### CaptureBurst Component

```typescript
type CaptureBurstProps = {
  color: string;      // the seat's base colour, used by the ring and half the sparks
  opacity?: number;   // multiplies the whole burst; the clash card's copy uses
                      // CAPTURE_FX_CARD_OPACITY (0.7), the board's uses 1
}
```

No positioning props: the burst is drawn around a 0×0 anchor at its parent's origin and
the caller places the parent. The board puts that anchor in the landing cell's centre
(`gridRow`/`gridColumn` + `alignSelf`/`justifySelf: center`), and `Game.tsx` pins it over
the same cell in viewport coordinates for the clash card's dim copy.

### Die Component

```typescript
type DieProps = {
  value: number;                // 1-6, the face the engine sent; the die rests on it
  rolling?: boolean;            // true while a roll's acts play
  startAt?: number | null;      // performance.now() when this device's roll began;
                                //   null for a roll this device only watches
  spinMs?: number;              // the spin this roll drew (DICE_SPIN_MAX_MS by default,
                                //   the ceiling, for a roll nobody here started)
  tappedAt?: number | null;     // the catch's own instant, null until the die is caught
}
```

One cube, six faces painted once from `PIP_MAP` and turned by `FACE_ROTATIONS`, which is
normalised onto the nearest full turn at rest so the angle cannot grow across a match. A pose is
`rotateY(spin) rotateX(x) rotateY(y)`, and all three terms are always written: a transform list
interpolates term by term only while both ends are the same list, and the leading spin is the turn
about the vertical that neither of the other two can reach once the cube stands on a corner. The acts
come from `common/src/timing.constants.ts`: ACCEL tips the die off the face it is resting on and up
onto a corner — a body diagonal, `atan(√2)` of lean and a corner's own 45° across, half a turn already
on it — SPIN turns it there in four beats with a lean that decays beat by beat, which is the nutation
a top reads as, and then SLOWDOWN finishes the spin on a whole turn and drops it onto an edge, or
ACUTE takes the spin two turns further and its three-quarter slowdown does the same when `tappedAt`
falls inside SPIN; either way FLOP flops it over one, two or three edges. The tail is planned
BACKWARDS from the face the engine sent — the die is balanced one tip short of the face it has to fall
towards — so its last flop is the settle, the face is never left mid-turn, and the count only decides
how many faces are seen on the way there. How many flops and which way is the component's own draw,
because the tail's length is `DICE_FLOP_MS` whatever it draws and nothing outside the file reads it.
There is no `brakeTo` and no near-miss face: the faces never move, the cube does.

**The faces are the era's.** Two modules draw them, `diceParts70.ts` and `diceParts80.ts`, the pair
`game/pieceParts70/` and `pieceParts80.ts` already set: each returns a flat list of `DicePart`s (a
disc or a rounded rect, painted with a slot name rather than a colour) in the piece sets' 100-unit
box, and `Die` renders that list into one `<svg viewBox="0 0 100 100">` inside the face div, which
keeps the gradient, the border and the `translateZ` that place it on the cube. The 70s face is a
molded body: a bevel highlight, a well sunk into it, and a pip with an ink rim and a sheen. The 80s
face is a device: a recessed core, an LED strip in two passes (every segment unlit, then the lit ones
dashed over them) and a pip that is a seven-disc rosette, with the bloom as a `box-shadow` on the
face div rather than an SVG filter — six blurred faces inside a tumbling `preserve-3d` transform is a
per-frame cost, and a filter needs an id namespace the six faces would share. Faces 4 and 6 take
`--dice-pip-alt` in both eras. The era is read from the store, as `Board.tsx` reads it for the piece
set, so the five props stay five and no call site passes a theme. Eight `--dice-*` tokens carry every
colour, mapped from a slot to a token in one table in the component, so neither face module holds a
literal.

**The roll is heard as well as seen** (`playDiceSpinTick`, `playDiceFlop`, `playDiceSettle` in
`utils/audio/audio.ts`), and every cue is scheduled off the plan that turns the cube: a tick per quarter
turn of SPIN, a flop per landing of the tail, and the settle on the last one, which is the landing.
The era is passed as an argument, and no cue adds a length the acts do not already have — the tick's
spacing is `spinMs / 16`, the flops are `DICE_FLOP_MS`'s own shares. A replan (a catch, or the face
arriving mid-spin) only voices the instants still ahead, so a caught roll never replays its rattle.

The whole turn is behind the stylesheet's `prefers-reduced-motion` gate (`.die-cube`). The
component's own box is the die at rest — `SIZE`, 80 px — and the plate it turns on belongs to the
page: `DIE_STAGE` (180 px) in `pages/Game/Game.tsx` is sized to the roll's own silhouette (121 px wide stood
on its corner and 139 px tall, 140 × 139 once the spin's wobble is counted under the 520 px
perspective), so the acts turn inside the plate instead of over the status line and the ROLL button,
and the column does not reflow when a roll starts.

`DiceFace` is exported: the painted face alone, at any size, sharing the same `PIP_MAP` and the same
tokens. The roster rows' `MiniDie` (38 px) in `pages/Game/Game.tsx` is that component and nothing else, so
the small die is not a second drawing of a die.

### OAuthButtons

No props; it renders the three provider buttons.


---
---


## Core Logic / Flow

### 1. RetroAuthLayout

Sequence of steps when an authentication page renders.
```mermaid
sequenceDiagram
    participant Login as Login.tsx
    participant RetroAuthLayout as RetroAuthLayout.tsx

    Login->>RetroAuthLayout: <RetroAuthLayout topRight={…}>
    RetroAuthLayout->>RetroAuthLayout: Render a transparent 100vw x 100vh shell (the plate is html, body's)
    RetroAuthLayout->>RetroAuthLayout: Render the LandscapeNotice strip
    RetroAuthLayout->>RetroAuthLayout: Render the glass card, {children} inside it
    Note over Login,RetroAuthLayout: No tag chip: the layout still takes an optional `tag`<br/>and prints it under the card when one is passed, and no auth page passes one
```

### 2. Board

Sequence of steps when the game board renders.
```mermaid
sequenceDiagram
    participant Game as Game.tsx
    participant Board as Board.tsx

    Game->>Board: <Board pieces={pieces} players={players} legalMoves={legalMoves} onPieceClick={onPieceClick} animating={animating} fx={fx} />
    Board->>Board: Map each piece's logical step to a board cell
    Board->>Board: Render base areas for each color
    Board->>Board: Render track paths (colored cells)
    Board->>Board: Render home stretch + goal area
    Board->>Board: Render pieces for each player
    Board->>Board: Anchor CaptureBurst on the landing cell (fx prop)
    Board->>Board: Highlight legal moves when dice rolled
```

### 3. Die

Sequence of steps when the die renders.
```mermaid
sequenceDiagram
    participant Game as Game.tsx
    participant Die as Die.tsx

    Game->>Die: <Die value={dice} rolling={rolling} startAt={start} spinMs={spin} tappedAt={tap} />
    alt rolling = true
        Die->>Die: ACCEL up onto a corner; plan the acts from that pose and draw the tail
        alt tappedAt inside SPIN
            Die->>Die: Cut the spin at the catch, then ACUTE + its 420 ms slowdown
        else untapped
            Die->>Die: SPIN to its drawn end (four beats, a lean that decays), then SLOWDOWN
        end
        Die->>Die: Onto the edge the tail falls off, then 1-3 FLOPs, the last exactly on the engine's face
    else rolling = false
        Die->>Die: Rest on value (the stored angle's nearest full turn)
    end
    Die->>retroAudio: A tick per quarter turn, a flop per landing, the settle on the last
    Die->>Die: Render the six faces from the era's module (diceParts70 or diceParts80), slots to --dice-* tokens
```

### 4. OAuthButtons

Sequence of steps when the provider buttons render.
```mermaid
sequenceDiagram
    participant Login as Login.tsx
    participant OAuth as OAuthButtons.tsx
    participant Browser

    Login->>OAuth: <OAuthButtons />
    OAuth->>OAuth: Render three provider buttons
    loop For each provider
        OAuth->>OAuth: Render icon (42, GitHub, Google)
        OAuth->>OAuth: Render label
    end
    OAuth->>Browser: onClick → window.location.href = '/api/auth/{provider}'
```


---
---


## Logic Paths Summary

### RetroAuthLayout Path
```
<RetroAuthLayout tag={tag}>
  └── Transparent full-bleed shell (the era plate shows through from html, body)
       ├── LandscapeNotice strip
       ├── Glass card (0.78), {children} and the optional topRight slot inside
       └── Tag chip (the card's own glass, solid cyan)
```

### Board Path
```
<Board />
  └── useApp() → mode, seats, dice, rolling, turn
       ├── Calculate geometry for mode
       ├── Render base areas (4 corners)
       ├── Render track cells (colored paths)
       ├── Render home stretches
       ├── Render goal area
       ├── Render pieces
       ├── fx set → anchor CaptureBurst on that cell
       └── Highlight legal moves
```

### Die Path
```
<Die value={dice} rolling={rolling} startAt={start} spinMs={spin} tappedAt={tap} />
  ├── rolling = true → ACCEL up onto a corner, SPIN (cut at the catch), ACUTE + acute slowdown or SLOWDOWN, 1-3 FLOPs
  └── rolling = false → rest on the engine's face (nearest full turn of the stored angle)
       └── Six 3x3 pip faces, turned by FACE_ROTATIONS, drawn by the era's module, coloured by the --dice-* tokens
```

### OAuthButtons Path
```
<OAuthButtons />
  ├── Render 42 button → onClick → '/api/auth/42'
  ├── Render GitHub button → onClick → '/api/auth/github'
  └── Render Google button → onClick → '/api/auth/google'
```

### RetroNavbar Account Popover Path
```
<RetroNavbar /> account button
  ├── Render avatar button with initials
  ├── onClick → toggle popover
  ├── Language option → setLang(lang)
  └── Sign out → logout() → POST /api/auth/logout → navigate('/login')
```


---
---


## Tailwind Utilities (`styles/tw.ts`)

`src/styles/tw.ts` holds Tailwind class strings that several components share, so the same long list of utility classes is not written out at every place it is used.

Rules that apply to the whole file:

- **No theme logic.** Every colour comes from the custom properties declared on `:root, [data-theme='retro80']` in `styles/themes/retro80/theme.css`, whose sibling table `styles/themes/retro70/theme.css` declares the same names with the other era's values.
- **`!` (the important modifier) marks a real specificity conflict.** Four constants need it: `GAME_WINDOW_HEADER_EXTRA`, `CYBER_BTN_PINK`, `CYBER_BTN_YELLOW` and `CYBER_BTN_DANGER`, where another utility of the same specificity would otherwise win.
- **`@keyframes` and custom easing curves** (`--flicker`) cannot be written as utility classes, so they stay in `styles/app.css` and are referenced with `var()` or arbitrary `animation:` values.
- **State controlled by JavaScript** (open/closed, glitching, an active LED) is written as a literal or conditional class, or as a `data-*` attribute read through a `group-data-` variant.

Per-constant notes:

| Constant | Notes |
|---|---|
| `THEME_TRIGGER_BTN_BASE` | The account and notification trigger buttons. Callers set inline background, border and shadow; `active` is a literal class set by JavaScript, so `&.active` matches it. |
| `THEME_POPOVER_MENU_BASE` | The account popover panel, coloured by the `--fs-*` custom properties. Open/closed/up/down is JavaScript state (`THEME_POPOVER_MENU_HIDDEN` / `_ACTIVE_DOWN` / `_ACTIVE_UP`); the `popover-slide-*` keyframes stay in CSS. |
| `CRT_SCREEN` | The "page shell" shared by Home, Profile, Leaderboard, Friends, Lobby, Game and LudoLobby. Every value comes from a custom property. |
| `GRID_BACKGROUND` | The fixed, paint-free frame Home hangs the 80s `STATIC_GRID` in. It carried the cityscape itself until `3e974df` moved the plate onto `html, body` (`--shell-image`); the per-route mounts, empty since then, were dropped in `todo.md` 33 step 3, so Home is its only reader. |
| `GAME_WINDOW_HEADER_EXTRA` | The Game.tsx-only header look. `!bg-[#140a35]` beats `WINDOW_HEADER`'s plain default. |
| `ARCADE_START_TITLE` | `whitespace-nowrap` is required: at 1.5px letter-spacing the heading and its spaced arrows are wider than the overlay, so the arrows would wrap onto their own lines. |
| `CYBER_MODAL_*` | CyberModal's overlay, box, body and glitch layers. The modal state travels through the `data-modal-state` and `data-glitching` attributes, read with `group-data-` variants. |
| `CYBER_BTN_*` | The modal buttons. `_PINK`, `_YELLOW` and `_DANGER` use `!` on their `--btn-accent`/`--btn-shadow` overrides so they beat `CYBER_BTN_BASE`'s defaults. |
| `RESULTS_INVOICE` / `TICKET_CONTAINER` / `INVOICE_VALUE` | ResultsModal's "vending machine ticket", printed by the `printVendingTicketJitter` keyframe; the invoice uses Atkinson Hyperlegible Mono with `top-6` and `z-5`. |
| `PAY_TAG_BASE` / `PAY_TAG_*` | The payment tags: border, background and colour come from the rank modifier class. |


---
---


## Implementation Notes

- **Overlays rendered through a portal.** `NotificationBell`'s dropdown and `RetroNavbar`'s account popover both render into `<body>`. A high `z-index` cannot escape an ancestor's stacking context (the sticky sidebar's `position: sticky` creates one, which traps even very large z-indices), so the overlays render outside it. Their position comes from the trigger's current `getBoundingClientRect()` instead of CSS anchoring.
- **Avatars are keyed by the immutable user id, and a version marker is appended when the URL changes.** `UserAvatar` takes `userId` (the photo key) and keeps `username` only as the DiceBear seed and alt text, so a display-name rename can never invalidate an avatar URL. It requests `/api/user/id/<userId>/avatar` only when the seat is not a bot **and** a photo is known to exist: the payload's `hasAvatarPhoto` or a live `avatar_changed` override in `avatarCache.ts` (the socket `avatar_changed` frame is pushed to that user's own clients only, so this only matters for the signed-in user's own photo). Anything else renders the DiceBear default, so a user without a photo never causes a 404 request. **A change also appends `?v=<stamp>`**, because React re-rendering is not enough on its own: a byte-identical image URL can be served from the browser's in-memory image cache without any request, so `no-cache` never gets the chance to revalidate. The stamp value comes from the socket frame (or `Date.now()` for the uploader's own client, so its own view needs no frame); the event only ever reaches the owner's own clients, so other accounts pick the change up on their next profile/roster fetch. A failed load records that id in the store's `broken` set, so the session stops retrying it. `ResultsModal` passes each row's own `userId`, `hasAvatarPhoto`, and `avatarStyle` from `LastResult` (carried from the engine's roster), so an opponent with a photo is shown with it, a bot or a non-host hotseat seat renders the generated avatar, and no row requests a URL that would 404. In hotseat, `Game.tsx` stamps the store's `/me` id onto the host's own seat (the colour that device joined the match with), so the host's row is the one local seat that keeps a photo. The viewer's own row keeps the store's live `/me` flag instead, because the profile page writes it on upload or delete. **The arena lobby's seat roster and the game's pilot cards use the same three-field contract**: the host's own seat passes the store's `/me` facts (photo, style), while each local hotseat pilot seat passes only its typed-in name and a bot seat passes its assistant-name label, so those seats render the generated avatar and request nothing. The full pipeline (storage, the shared Redis record, caching and freshness) is described in [`avatar-system.md`](../avatar-system.md).
- **`DeleteAccountModal` is a two-step dialog.** Accounts created through a provider have no password, so they set one first, because deletion always requires the password. They then confirm with that password and an acknowledgement checkbox. On success the store's `logout()` clears the session and the user lands on `/login`.
- **The capture burst is one visual, placed by its callers.** `CaptureBurst` renders a ring and eight sparks around a 0×0 anchor at its parent's origin and takes no position of its own: the board anchors it inside the landing cell, and `Game.tsx` re-anchors the same component in viewport coordinates when a clash result card is covering the board. The two copies therefore cannot drift apart, and `CAPTURE_FX_MS` is the single source for how long a burst runs (it is interpolated into the inline `animation` strings; the keyframes carry no duration). The burst's keyframes are injected once by the component under `capture-fx-keyframes`, so the board and the card share one definition.
- **CJK label sizing (`RetroNavbar` account popover).** CJK (Chinese, Japanese and Korean) glyphs fill the em box, while Latin letters take up roughly half of it, so Latin labels use a smaller px value and look the same size.
- **Dock widths and the compact rail.** `useDockPrefs` (`src/hooks/useDockPrefs.ts`) is the single source: `WIDE_MIN_PX` (1280) is the compact threshold, and the dock is `DOCK_CHAT_PX` (360) above it and `DOCK_RAIL_PX` (88) below. Two widths, not three: the chat does not resize the dock, because a dock that resizes when a decoration toggles drags the page sideways and re-wraps every column of the dashboard under the reader. `NavDock` puts that number on the sticky `<aside>` and has nothing to animate; `RetroNavbar` is `width: 100%`, so the spacer and the bar cannot drift apart. The preference is `localStorage`'s `retro_chat`, read synchronously on first render so the dock never paints one chat state and then flips to the other. Below the threshold the labels are hidden from JavaScript rather than by CSS, because parts of the bar are plain inline styles, and the chat slot is not rendered at all.
- **The dock's height is a flex budget.** The nav track is `flex: 0 1 auto` (content height, shrinkable, `overflow-y: auto`), the chat slot is `flex: 1 1 0` with a 112 px floor on the screen in both states, and the notifications are pinned last. At 720p the fixed stack is 531 px of the 656 px dock, so the panel gets the remaining 125 and the track is not the box that shrinks; below about 707 px of window height the track scrolls, with a thin cyan scrollbar rather than the default light one. The slack above and below the track therefore becomes the panel: no fixed height anywhere.
- **The chat screen's OFF state is the same plate, black.** OFF mounts no picture, so the rows are not tab stops and no live region announces into a tube that is not showing one, and the plate keeps its footprint, so the switch moves nothing outside itself. The ON/OFF pill in the header is drawn in both states, so turning the screen off never removes the way back on. The switch only ever animates the inside of the plate: `chat-screen--on` opens a raster from a line to the frame and brings the picture up under a bloom (420 ms), `chat-screen--off` collapses it to a dot (260 ms), and both sit inside `@media (prefers-reduced-motion: no-preference)` so a reduced-motion user gets the same two states with no movement.
- **RetroNavbar track layout.** The nav track uses `overflow-y: auto` only as a fallback. The track is not shifted vertically, because at short window heights a shift pushes the last item over the theme button.
- **RetroNavbar nav-label auto-sizing.** The five nav labels differ in width by language (for example `HOME` against `LEADERBOARD` and `CARTA KEDUDUKAN`), so one fixed font size would either truncate the longest label or look too small for the others. Instead the rail measures its widest label and applies the largest font size that fits the button to all five labels, so they stay uniform. A hidden probe `span` copies the label typography (Atkinson Hyperlegible Next, weight 900, 1px letter-spacing) at `NAV_PROBE_PX` (100px); text width scales linearly with font size, so the fitted size is `(available - letter-spacing total) * 100 / glyph width`. The available width is the button content box minus its 14px side padding, the 34px icon, the 12px icon-to-label gap and a 2px safety margin. The result is clamped between `NAV_LABEL_MIN_PX` (9) and `NAV_LABEL_MAX_PX` (20); `NAV_LABEL_BASE_PX` (13.6, about 0.85rem) is only the value used before the first measurement. The measurement re-runs on language change, window resize and `document.fonts.ready`, because the display-font metrics are only final once the web font has loaded. In compact mode the labels are not rendered, so the measurement is skipped.


---
---


## Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `RetroAuthLayout` | `react`, `react-i18next` | The auth card and its notice strip, all transparent: the era plate is `html, body`'s, and no theme import is needed to paint over it |
| `Board` | `theme.ts`, `game/boardGeometry.ts`, `CaptureBurst` | `COL`, the step → cell mapping, and the landing cell's burst |
| `CaptureBurst` | `react`, `game/timing.ts` | Its own keyframes and the burst's one duration constant; no theme import, the caller passes the CSS colour |
| `GoalBurst` | `react`, `game/timing.ts` | Its own keyframes and `GOAL_BURST_MS`; no theme import, the caller passes the anchor and the seat's colour |
| `GoalConfetti` | `react`, `__shared__/timing.constants` | Its own keyframes and `GOAL_FX_MS`, the shared figure the engine's bot waits on too; no theme import |
| `GoalCard` | `react`, `theme.ts`, `store/store.tsx`, `PieceFigure`, `__shared__/timing.constants` | `COL` for the seat's hue, `useApp` for the theme — which picks the piece set the climbing figure is drawn in (`retro70` or `retro80`), the same choice the board makes, so a card can never show the other decade's cast — `PieceFigure` itself, and `GOAL_CARD_MS` for the climb's own timeline |
| `Die` | `react`, `store/store.tsx`, `utils/audio/audio.ts`, `components/diceParts70.ts`, `components/diceParts80.ts` | `useApp` for the era the faces are painted in, `retroAudio` for the roll's three cues, and the two face modules (one per era, both drawn in the piece sets' 100-unit box) |
| `OAuthButtons` | `styles/tw.ts` | `OAUTH_BTN`, the class form of the deleted `btnOutline` style object |
| `NavDock` | `hooks/useDockPrefs.ts`, `RetroNavbar`, `LobbyChat` | The dock's width and chat preference, forwarded into the bar |
| `RetroNavbar` | `store/store.tsx` | `useApp` for `user`, `lang`, `setLang`, `logout` |
