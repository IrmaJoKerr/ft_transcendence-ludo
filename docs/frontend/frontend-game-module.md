# Frontend — Game

## Table of Contents

- [Overview](#overview): Ludo board screen with dice rolling and piece movement
- [Files](#files): Source file inventory
- [Key Types / Interfaces](#key-types--interfaces): Component props and state shapes
- [Core Logic / Flow](#core-logic--flow): Mermaid sequence diagrams for game interaction
- [Logic Paths Summary](#logic-paths-summary): Decision trees for dice roll and piece selection
- [Dependencies](#dependencies): Internal and external dependencies


---
---


## Overview

The Game page (`/game`) is the real-time gameplay screen. It has:

1. **Ludo board**: drawn by the `Board` component, with the four colored tracks.
2. **Dice roller**: the `Die` component, which animates the roll and shows 1-6.
3. **Piece interaction**: pieces drawn on the board; you can click them when it is your turn.
4. **Real-time engine connection**: connects to the Ludo Engine through Socket.IO (`connectSocket`), using the match token from `activeMatch`.

> **Note:** The Game page is fully real-time. It connects to the engine on the page's own origin (`/socket.io/`), sends `join_game`, `roll_dice` and `move_piece`, and renders state updates from the engine (`game_joined`, `dice_rolled`, `piece_moved`, `game_ended` and others). Game state is dispatched into `game/reducer.ts`; see `socket.ts` for the complete event contract.


---
---


## Files

| File | Role |
|------|------|
| `src/pages/Game.tsx` | Game page: engine socket connection, board, dice, pieces |
| `src/components/Board.tsx` | Board component: renders Ludo track, pieces, bases |
| `src/components/Die.tsx` | Die component: dice face rendering with roll animation |
| `src/game/reducer.ts` | Pure reducer that turns engine events into local view state |
| `src/game/types.ts` | GameState, PlayerColor, LegalMove, MoveResult and others |
| `src/socket.ts` | Socket.IO client: `connectSocket()`, typed Server/Client event maps |


---
---


## Key Types / Interfaces

### Game State (engine-driven)

```typescript
// The engine holds the authoritative state, delivered over Socket.IO (socket.ts
// ServerEvents); game/reducer.ts derives the local view state.
gameId: string            // activeMatch.gameId
color: PlayerColor        // activeMatch.color
state: GameState          // from 'game_joined' / 'state_update'
dice: number              // from 'dice_rolled'
legalMoves: LegalMove[]   // from 'dice_rolled'
```

### Seat

```typescript
type Seat =
  | { type: 'you' }
  | { type: 'bot'; name: string }
  | { type: 'player'; name: string }
  | { type: 'empty' }
```

### PlayerColor

```typescript
type PlayerColor = 'red' | 'green' | 'yellow' | 'blue'
```


---
---


## Core Logic / Flow

### 1. Engine Connection & Join

Sequence of steps when the Game page mounts with an active match.
```mermaid
sequenceDiagram
    participant Game as Game page
    participant Socket as Game socket
    participant Engine as ludo-engine

    Game->>Socket: Connect using the game token
    Socket->>Engine: Connect
    Game->>Socket: join_game (gameId, color)
    Engine-->>Game: game_joined (the board)
    Game->>Game: Draw the board and pieces
```

### 2. Dice Roll

Sequence of steps when the player clicks the die.
```mermaid
sequenceDiagram
    participant User
    participant Game as Game page
    participant Socket as Game socket
    participant Engine as ludo-engine

    User->>Game: Click the die
    Game->>Socket: roll_dice
    Engine->>Engine: Roll + work out legal moves
    Engine-->>Game: dice_rolled (value + movable pieces)
    Game->>Game: Highlight which pieces can move
```

### 3. Piece Movement

Sequence of steps after the player clicks a movable piece.
```mermaid
sequenceDiagram
    participant User
    participant Game as Game page
    participant Socket as Game socket
    participant Engine as ludo-engine

    User->>Game: Click a piece
    Game->>Game: Is that piece in the legal moves?
    alt Yes
        Game->>Socket: move_piece (pieceId)
        Engine-->>Game: piece_moved
        Game->>Game: Update the board
    else No
        Game->>User: Shake the piece ("can't move that one")
    end
```


---
---


## Logic Paths Summary

### Connect & Join Path
```
Game mounts with activeMatch
  ├── connectSocket(activeMatch.token)
  ├── on 'connect' → emit('join_game', gameId, color, userId, displayName)
  │    └── Hotseat: one join_game per local seat (a single socket controls every seat)
  ├── on 'game_joined' → dispatch into reducer
  ├── Hotseat turn rotation → re-emit join_game for the now-current seat so the
  │    engine's turn validation follows the seat actually being played
  └── Reconnect: on reconnect → re-emit join_game
```

### Dice Roll Path
```
User clicks die
  └── emit('roll_dice')
       └── on 'dice_rolled' → dispatch { value, legalMoves, bonusRoll, currentTurn } → highlight pieces
```

### Piece Move Path
```
User clicks piece
  ├── Check if piece is in legalMoves for current dice
  │   ├── Yes → emit('move_piece', pieceId)
  │   │   └── on 'piece_moved' → dispatch → update board
  │   └── No → show invalid feedback
```

### Game End Path
```
on 'game_ended' { winner, resultDetail }
  ├── setLastResult({ winner, resultDetail, mode, playerCount, players })
  └── Open the ResultsModal overlay in-game
```


---
---


## Implementation Notes

- **The socket effect depends on identity fields only.** The connect effect watches `activeMatch.gameId` and `.token`, never the whole `activeMatch` object. Changing `.mode`, `.color` or `.playerCount` after connect (a lobby seat or colour change) therefore cannot close and reopen the socket during the handshake. Long-lived handlers read the current value through `activeMatchRef`, so they never hold a stale `activeMatch`.
- **Duplicate-move guard.** `pendingMoveRef` is set as soon as `move_piece` is sent, and cleared when the server replies with `piece_moved` or a rejection. Without it, a second click on a piece that still looks legal, before the reply arrives, sends a duplicate `move_piece` that the engine rejects with "Invalid turn phase".
- **`canRoll` also requires `status === 'active'`.** This closes a short race condition (two operations competing in timing) at the end of a game: the winning move can leave the other roll inputs looking usable for one render before `game_ended` arrives, which would let a click through as a "Game not active" rejection.
- **Seat identity on the first render.** For a PvP (player versus player) joiner, `ck === view.myColor` can be out of date until the server replies: the engine assigns the seat through `lobby_update` → `my_color_changed`, which may arrive after the first render, so the seat briefly appears to belong to someone else. The page also accepts a direct `playerMeta.username === user.username` match (the same check the active-game pilot card uses) so it recognises the seat immediately.
- **Refresh safety for cached matches.** After a browser refresh, a cached `activeMatch` can arrive with no `mode`. The page reads it again from `GET /api/games/mine`, so a hotseat or PvE (player versus environment) game can never be treated as a plain PvP rejoin.
- **"RETURN TO LOBBY" does not leave the match.** The button only navigates back to `/gamelobby`: it emits no `leave_game` and calls no exit endpoint. Unmounting the page drops the socket, which opens the engine's 45 s disconnect grace window for that seat. Inside the window the lobby offers a **REJOIN** row for the room (`GET /api/games/rooms` → `mySeat: true`, and `GET /api/games/mine` still lists it), and rejoining restores the same colour and pieces. Once the window expires the engine marks the seat `exited` and parks its pieces at `step = -1`; both endpoints then stop advertising the room to that player: the seat stays behind as a ghost, and the player is free to start or join another game.
- **`dice_rolled` is matched to the turn before the event** (`game/reducer.ts`). On the no-move and third-six-forfeit paths the engine advances `currentTurn` before it emits, so the event's own `currentTurn` can already name the *next* player while the rolled value belongs to the player who rolled.
- **Bot names are translated.** Engine bots are named `bot-<color>`; `localizedBotName(t, name)` turns that into a translated "bot-<colour>" and keeps the "(assistant)" name the lobby assigned the seat, so French renders "bot-red (Siri)" as "bot-rouge (Siri)". Names that do not match are returned unchanged. Used by this page and `ResultsModal`.
- **Turn labels fall back to a translated colour word.** The live turn announcement pill, the game status marquee bar, the status line under the pilot banner, the turn-swap notice, the paused-reconnect banner and the roll-log and capture-log fallbacks all name the seat in control. When a seat has no name to show, they read the colour word through `localizedColor(t, color)`, which maps a `PlayerColor` to the shared `lobby.color*` keys, so French shows "Rouge" where English shows "Red". `utils/botName.ts` exports it next to `localizedBotName`, and the callers upper-case it where the English label is all caps.
- **`nextTurn` mirrors the engine's turn advance** (`game/reducer.ts`). It walks `state.players[]` in order and gives the turn to the next seat that has not left. A disconnected seat with an open grace window holds the turn, so the prediction must not skip past it; otherwise the board would name the wrong pilot in control between the move and the next server frame.
- **The waiting-for-reconnect banner has two triggers** (`pages/Game.tsx`). Either the engine set `paused` (a PvP player dropped during their own turn, so the pending dice and moves are frozen), or the turn is parked on a disconnected seat (they dropped during another player's turn and play continued until the turn reached them). While either holds, `isMyTurn` is false and `canRoll` is blocked, so no action can be sent on a frozen board. PvE and hotseat never pause.
- **An exited seat renders as gone but stays in the list.** Its pieces are off the board and it can never hold the turn, so the pilot card greys it out and never marks it as in control. The row itself is kept because the results card needs the full roster.
- **The rules deck is the one rules UI, and its last three pages are the room-rule copy.** `Game.tsx` renders nine pages inside the shared `CyberModal` (`isSystemModalOpen`), tabbed by `rulesTab0..8` and advanced with NEXT PAGE until the last page's START PLAYING closes it: 0-5 the classic deck (objective, rolling a 6, captures, stars, blockades, home lane), 6 clash, 7 hardcore, 8 free exit. Every string is `gameExtra.rulesPage*` in the three locales, and the source's `RulesDiagrams.tsx` diagram section was deliberately not ported, so the deck is the only rules surface (the older `rules.*` locale block belongs to the source's retired modal and no component reads it). The clash page's extra line (`rulesPage6Chain`) is the live chain rule: landing on a wall is one clash per defender, each round a fresh key race, which is the `captureCount` the board shows as a ×R badge and the overlay as a ROUND n / total pill. The hardcore page states both halves of `noSafeZones`: the stars stop protecting anywhere on the track (the four start squares are in the engine's `SAFE_TRACK_POSITIONS`, so they lose their immunity too; only the home lane still shields a piece), and a stack on a star - exempt in a standard room - blocks the path and, with clash mode on as well, is a wall that can be broken (`wallsAreBreakable`, clash AND hardcore). The free-exit page notes that a 6 keeps its bonus roll and that an exit never attacks a wall: it shares the square.
- **Every pilot card shows an avatar, bots included.** A seat with an account passes its `userId`, `hasAvatarPhoto` and `avatarStyle` to `UserAvatar`, which asks for the photo only when one is known to exist and otherwise renders the generated DiceBear avatar seeded from the seat's name. A bot has no account, so `seatAvatarName()` seeds it with the assistant name the lobby gave that seat (`avatarSeed()` in `utils/botName.ts`), which is the seed the lobby table and the results invoice reuse, and `isBot` keeps the photo request off. **In hotseat, only the host's seat can show a photo.** The engine leaves `userId` undefined for every local seat (one socket drives them all), so they take the generated path, seeded from the name typed into the lobby; the host's own seat is the exception, because it is the seat this device joined the match with (`activeMatch.color`, always slot 0). That card reads the store's `/me` facts instead (`user.id`, `user.hasAvatarPhoto`, `user.avatarStyle`), so the host keeps their uploaded photo, and it seeds the generated avatar with the account username, which is the seed the navbar and the lobby host row already use. No other local seat issues a photo request.
- **One helper builds the results handoff.** `toResultPlayers(players, winner?)` maps the live roster onto `LastResult.players` for all three builders (`game_ended`, the abandoned fallback, and `endGame`), so every path carries the same avatar facts to the invoice. It reads `activeMatchRef`/`userRef` rather than the render's own values, because the socket handlers outlive the render that created them. The optional `winner` records that seat as four pieces: the winning move can still be mid-animation when `game_ended` arrives, so the view lags the final count. Hotseat's host seat gets the store's `/me` identity stamped onto it (the same `activeMatch.color` test as the pilot card), which is what lets `ResultsModal` recognise the host's row by `userId` and show their photo. A bot row keeps its raw `bot-<color> (<assistant>)` label, because the invoice localizes it for display and seeds the generated avatar from it.


---
---


## Dependencies

| Dependency | Purpose |
|-----------|---------|
| `store.tsx` | `useApp` for activeMatch, lastResult, settings, setLastResult |
| `socket.ts` | `connectSocket` and the typed Socket.IO event maps |
| `game/reducer.ts` | Pure state reducer for engine events |
| `components/Board.tsx` | Renders Ludo board track, pieces, bases |
| `components/Die.tsx` | Renders the dice face and the roll animation |
| `components/UserAvatar.tsx` | Pilot-card avatar: the account photo when one is known to exist, otherwise the generated DiceBear avatar (bots and hotseat's local seats have no account, so they take the generated path; the host's own seat keeps the store's `/me` photo instead) |
| `theme.ts` | `SEAT_COLORS`, inline styles, keyframe CSS |
| `utils/audio.ts` | `retroAudio` sound effects |
| `utils/botName.ts` | `localizedColor` and `localizedBotName` for the turn labels and the seat names, and `avatarSeed` for the generated bot avatar |
