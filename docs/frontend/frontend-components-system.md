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

1. **RetroNavbar**: top navigation bar used by every page (logo, nav links, language selector, user menu).
2. **RetroAuthLayout**: centered layout for the authentication pages (login, signup, 2FA, forgot/reset password).
3. **Board / Die**: the Ludo board and the animated die.
4. **UserAvatar**: avatar rendering.
5. **OAuthButtons**: Google, GitHub and 42 provider buttons.
6. **NotificationBell / NotificationToast**: the notification bell and toasts.
7. **CyberModal / ResultsModal**: cyber-styled modal base and the post-game results overlay.


---
---


## Files

| File | Role |
|------|------|
| `src/components/RetroNavbar.tsx` | Top navigation bar: logo, nav links, language selector, user menu, sign out (used by every page) |
| `src/components/railButton.ts` | Shared rail-button styles: `railButtonStyle(active)` and `railHoverHandlers(active, edge)`, used by the navbar rail buttons |
| `src/components/RetroAuthLayout.tsx` | Retro-styled authentication page container (`tag`, optional `topRight` pinned 12px inside the card's top-right corner, `children`), and `NeonCheck`: the terms tick glyph |
| `src/components/LanguageSwitcher.tsx` | Segmented EN/MS/FR switch in two renderings: the compact `pill` used by `Login` (`topRight`) and `LegalPage`, and the two-line `tabs` used by the `RetroNavbar` account popover |
| `src/components/Board.tsx` | Ludo board: tracks, bases, pieces, legal-move highlights. Every safe square (the four tinted starts and the four pre-start cells) wears the same `SafeStar` — white core, black outline, so it stays legible on both the near-black track and the four neon start cells — and the `noSafeZones` rule withholds all eight together |
| `src/components/Die.tsx` | Dice component: face rendering with roll animation |
| `src/components/UserAvatar.tsx` | Avatar image: keyed by the immutable `userId`; requests the photo only when the seat is not a bot and a photo is known to exist (payload flag or a live `avatar_changed` override, which the backend pushes to that user's own clients only), otherwise renders the DiceBear default. A failed load marks that id broken for the session so it is not retried; an optional `onPhotoError` callback runs when that happens, so a parent component can show a message (the Profile page uses it to show a warning in the user's language) |
| `src/dicebear.ts` | DiceBear helper: generates an avatar data URI (Uniform Resource Identifier) (`avataaars`/`bottts`/`identicon`) |
| `src/components/OAuthButtons.tsx` | OAuth provider buttons (42, GitHub, Google) |
| `src/components/NotificationBell.tsx` | Bell icon, unread badge and dropdown |
| `src/components/NotificationToast.tsx` | Toast notifications: friend requests, game challenges, match cancellations. Accepting a `game_invite` aborts a game still stored in the store's `activeMatch` (`POST /api/game/:id/abort`, which marks that room `ABORTED`) before switching rooms, so a mid-game accept never trips the backend's one-live-game lock |
| `src/components/ProfileEditModal.tsx` | Edit-profile dialog |
| `src/components/DeleteAccountModal.tsx` | Delete-account dialog (sets a password first for OAuth-only accounts) |
| `src/components/LegalModal.tsx` | Privacy Policy / Terms of Service popup, opened from Home's footer and from the Signup terms link |
| `src/components/MarkdownViewer.tsx` | Renders the markdown legal documents |
| `src/components/CyberModal.tsx` | Cyber-styled modal base (`CyberButton`, `CyberModal`) used for confirmations and dialogs |
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

### Die Component

```typescript
type DieProps = {
  value: number;         // 1-6
  rolling?: boolean;     // If true, shows rolling animation
}
```

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

    Login->>RetroAuthLayout: <RetroAuthLayout tag={t('auth.loginTag')}>
    RetroAuthLayout->>RetroAuthLayout: Render centered container
    RetroAuthLayout->>RetroAuthLayout: Render logo mark (gradient ring)
    RetroAuthLayout->>RetroAuthLayout: Render tagline
    RetroAuthLayout->>RetroAuthLayout: Render children (form)
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
    Board->>Board: Highlight legal moves when dice rolled
```

### 3. Die

Sequence of steps when the die renders.
```mermaid
sequenceDiagram
    participant Game as Game.tsx
    participant Die as Die.tsx

    Game->>Die: <Die value={dice} rolling={rolling} />
    alt rolling = true
        Die->>Die: Apply shake animation CSS
        Die->>Die: Cycle through random face values
    else rolling = false
        Die->>Die: Render static face for value
    end
    Die->>Die: Render 3x3 pip grid for face value
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
  └── Render centered container
       ├── Logo mark (CSS gradient ring)
       ├── Tagline text
       └── {children}
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
       └── Highlight legal moves
```

### Die Path
```
<Die value={dice} rolling={rolling} />
  ├── rolling = true → shake animation, cycle faces
  └── rolling = false → render static face
       └── Render 3x3 pip grid for value
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

- **No theme logic.** Every colour comes from the custom properties declared on `:root, [data-theme='synthwave']` in `retrowave.css`.
- **`!` (the important modifier) marks a real specificity conflict.** Four constants need it: `GAME_WINDOW_HEADER_EXTRA`, `CYBER_BTN_PINK`, `CYBER_BTN_YELLOW` and `CYBER_BTN_DANGER`, where another utility of the same specificity would otherwise win.
- **`@keyframes` and custom easing curves** (`--flicker`) cannot be written as utility classes, so they stay in `retrowave.css` and are referenced with `var()` or arbitrary `animation:` values.
- **State controlled by JavaScript** (open/closed, glitching, an active LED) is written as a literal or conditional class, or as a `data-*` attribute read through a `group-data-` variant.

Per-constant notes:

| Constant | Notes |
|---|---|
| `THEME_TRIGGER_BTN_BASE` | The account and notification trigger buttons. Callers set inline background, border and shadow; `active` is a literal class set by JavaScript, so `&.active` matches it. |
| `THEME_POPOVER_MENU_BASE` | The account popover panel, coloured by the `--fs-*` custom properties. Open/closed/up/down is JavaScript state (`THEME_POPOVER_MENU_HIDDEN` / `_ACTIVE_DOWN` / `_ACTIVE_UP`); the `popover-slide-*` keyframes stay in CSS. |
| `CRT_SCREEN` | The "page shell" shared by Home, Profile, Leaderboard, Friends, Lobby, Game and LudoLobby. Every value comes from a custom property. |
| `GRID_BACKGROUND` | The fixed cityscape background layer used by RetroAuthLayout and the page shells, with a darkening gradient on its `after:` layer. |
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
- **Avatars are keyed by the immutable user id, and a version marker is appended when the URL changes.** `UserAvatar` takes `userId` (the photo key) and keeps `username` only as the DiceBear seed and alt text, so a display-name rename can never invalidate an avatar URL. It requests `/api/user/id/<userId>/avatar` only when the seat is not a bot **and** a photo is known to exist: the payload's `hasAvatarPhoto` or a live `avatar_changed` override in `avatarCache.ts` (the SSE event is pushed to that user's own clients only, so this only matters for the signed-in user's own photo). Anything else renders the DiceBear default, so a user without a photo never causes a 404 request. **A change also appends `?v=<stamp>`**, because React re-rendering is not enough on its own: a byte-identical image URL can be served from the browser's in-memory image cache without any request, so `no-cache` never gets the chance to revalidate. The stamp value comes from the SSE event (or `Date.now()` for the uploader's own client, so its own view needs no SSE); the event only ever reaches the owner's own clients, so other accounts pick the change up on their next profile/roster fetch. A failed load records that id in the store's `broken` set, so the session stops retrying it. `ResultsModal` passes each row's own `userId`, `hasAvatarPhoto`, and `avatarStyle` from `LastResult` (carried from the engine's roster), so an opponent with a photo is shown with it, a bot or a non-host hotseat seat renders the generated avatar, and no row requests a URL that would 404. In hotseat, `Game.tsx` stamps the store's `/me` id onto the host's own seat (the colour that device joined the match with), so the host's row is the one local seat that keeps a photo. The viewer's own row keeps the store's live `/me` flag instead, because the profile page writes it on upload or delete. **The arena lobby's seat roster and the game's pilot cards use the same three-field contract**: the host's own seat passes the store's `/me` facts (photo, style), while each local hotseat pilot seat passes only its typed-in name and a bot seat passes its assistant-name label, so those seats render the generated avatar and request nothing. The full pipeline (storage, the shared Redis record, caching and freshness) is described in [`avatar-system.md`](../avatar-system.md).
- **`DeleteAccountModal` is a two-step dialog.** Accounts created through a provider have no password, so they set one first, because deletion always requires the password. They then confirm with that password and an acknowledgement checkbox. On success the store's `logout()` clears the session and the user lands on `/login`.
- **CJK label sizing (`RetroNavbar` account popover).** CJK (Chinese, Japanese and Korean) glyphs fill the em box, while Latin letters take up roughly half of it, so Latin labels use a smaller px value and look the same size.
- **RetroNavbar compact mode.** Below Tailwind's `xl` breakpoint (1280px) the sidebar collapses to an icon-only rail. The labels are hidden from JavaScript rather than by CSS, because parts of the bar are plain inline styles. Every page that renders the bar uses the same threshold with `w-[88px] xl:w-[270px]`.
- **RetroNavbar track layout.** The nav track uses `overflow-y: auto` only as a fallback. The track is not shifted vertically, because at short window heights a shift pushes the last item over the theme button.
- **RetroNavbar nav-label auto-sizing.** The five nav labels differ in width by language (for example `HOME` against `LEADERBOARD` and `CARTA KEDUDUKAN`), so one fixed font size would either truncate the longest label or look too small for the others. Instead the rail measures its widest label and applies the largest font size that fits the button to all five labels, so they stay uniform. A hidden probe `span` copies the label typography (Atkinson Hyperlegible Next, weight 900, 1px letter-spacing) at `NAV_PROBE_PX` (100px); text width scales linearly with font size, so the fitted size is `(available - letter-spacing total) * 100 / glyph width`. The available width is the button content box minus its 14px side padding, the 34px icon, the 12px icon-to-label gap and a 2px safety margin. The result is clamped between `NAV_LABEL_MIN_PX` (9) and `NAV_LABEL_MAX_PX` (20); `NAV_LABEL_BASE_PX` (13.6, about 0.85rem) is only the value used before the first measurement. The measurement re-runs on language change, window resize and `document.fonts.ready`, because the display-font metrics are only final once the web font has loaded. In compact mode the labels are not rendered, so the measurement is skipped.


---
---


## Dependencies

| Component | Depends On | Purpose |
|-----------|-----------|---------|
| `RetroAuthLayout` | `styles/tw.ts` | `GRID_BACKGROUND` class constant, inline styles |
| `Board` | `theme.ts` | `COL`, inline styles |
| `Die` | `react` | Inline `shake` animation and pip-grid faces (no theme import) |
| `OAuthButtons` | `theme.ts` | `btnOutline` style |
| `RetroNavbar` | `store.tsx` | `useApp` for `user`, `lang`, `setLang`, `logout` |
