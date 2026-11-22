import { SEAT_COLORS, type ColorKey } from '../theme';
import type { ChatAck, ChatMessage, SessionSocket } from '../sessionSocket';
import type { PlayerColor } from '../game/types';

export type AuthUser = {
  id: string;
  username: string;
  displayName?: string;
  email?: string | null;
  emailVerified?: boolean;
  pendingEmail?: string | null;
  twoFactorEnabled?: boolean;
  hasPassword?: boolean;
  avatarStyle?: string | null;
  hasAvatarPhoto?: boolean;
};

export type VerifyOutcome = 'signup' | 'change' | 'conflict' | 'invalid' | 'error';

// One card of the Lobby roster. A seated card owns its colour: the colour is the
// seat, so it is picked when the seat is taken and never re-derived from the card
// index afterwards. An empty card owns nothing (there is no colour to own yet).
export type Seat =
  | { type: 'you'; color: ColorKey }
  | { type: 'bot'; name: string; color: ColorKey }
  | { type: 'player'; name: string; color: ColorKey }
  | { type: 'empty' };

// A seat that occupies a card, and therefore holds one of the four corners.
export type OccupiedSeat = Exclude<Seat, { type: 'empty' }>;

// Narrows a roster card to the ones that own a colour.
export function isOccupiedSeat(seat: Seat): seat is OccupiedSeat {
  return seat.type !== 'empty';
}

// The corners nobody has claimed yet, in the canonical blue-first order. Every
// palette is built from this: a taken colour is never offered, so the picker
// cannot produce a duplicate (the server checks the same rule).
export function freeColors(seats: Seat[]): ColorKey[] {
  const taken = new Set(seats.filter(isOccupiedSeat).map((seat) => seat.color));
  return SEAT_COLORS.filter((color) => !taken.has(color));
}

export type PlayerCount = 2 | 3 | 4;

export type Lang = 'en' | 'fr' | 'ms';
export type ThemeType = 'retro80' | 'retro70';

// Languages offered in the account menu.
export const LANGUAGES: Array<{ code: Lang; label: string; flag: string }> = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'ms', label: 'Bahasa Melayu', flag: '🇲🇾' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
];

// The themes the shell offers, in the order the account menu lists them.
export const THEMES: Array<{ id: ThemeType; label: string; swatch: [string, string] }> = [
  { id: 'retro80', label: "RETRO 80'S", swatch: ['#ff007f', '#00f0ff'] },
  { id: 'retro70', label: "RETRO 70'S", swatch: ['#e5340b', '#ffb000'] },
];

export const RULES_ON_START_KEY = 'rulesShowOnStart';
// Defaults for the settings toggles, keyed "<group>-<row>".
export const SETTING_DEFAULTS: Record<string, boolean> = {
  '0-0': true, // Sound effects
  '0-1': true, // Music
  '1-0': true, // Auto-roll
  '1-1': false, // Fast animations
  '1-2': true, // Move hints
  '2-0': true, // Friend invites
  '2-1': false, // Weekly recap
};

// Credentials returned by POST /api/match/create: stored in context so Game page can connect to the engine.
export type ActiveMatch = {
  gameId: string;
  token: string;
  color: PlayerColor;
  inviteCode?: string;
  mode: 'pvp' | 'pve' | 'hotseat';
  playerCount: number;
  // A guest mint (POST /api/match/guest). Never persisted to sessionStorage: a
  // guest pressing Back must not re-enter a revoked room, and the exits branch
  // on this flag ("Back to login" vs "Back to lobby").
  isGuest?: boolean;
} | null;

// One invoice row: a seat plus the avatar facts the engine's roster reported for it.
//  Bots, hotseat seats and the lobby-seat fallback have no account, so they carry none.
export type ResultPlayer = {
  color: PlayerColor;
  username: string;
  isBot: boolean;
  // Absent when the room could not report it: a seat recorded at its own departure
  // has no piece count, and its card prints the name without one rather than "0/4".
  piecesInGoal?: number;
  userId?: string;
  hasAvatarPhoto?: boolean;
  avatarStyle?: string | null;
  // The seat left before the match finished. It renders as no result: excluded from
  // the podium order and never given a rank badge.
  abandoned?: boolean;
};

// Snapshot of a finished match's outcome: set from Game.tsx's `game_ended` handler so Results.tsx can render real data instead of mock podium rows.
export type LastResult = {
  // Null when nothing finished: an abandoned room has no champion, and inventing one
  // (the seat whose turn it was) put a dropped player on the podium.
  winner: PlayerColor | null;
  resultDetail: string;
  mode: 'pvp' | 'pve' | 'hotseat';
  playerCount: number;
  players: ResultPlayer[];
    // True when the match was abandoned/expired: a different Results card (no winner/podium).
  abandoned?: boolean;
} | null;

// The guest setup payload, kept in memory so the end card's "Play again" can
// mint another room with the same seats and rules without re-walking the setup
// screen. Not persisted: a guest session dies with the tab.
export type GuestSetup = {
  botCount: number;
    // The guest's own corner: the palette is theirs too, and there is no default.
  hostColor: string;
  botColors?: string[];
  botNames?: string[];
  clashEnabled: boolean;
  noSafeZones: boolean;
  freeExit: boolean;
  // The attack animations: positive flag, independent of clash mode.
  captureFx: boolean;
};

export type AppState = {
  user: AuthUser | null;
  setUser: (u: AuthUser | null) => void;
  authReady: boolean;
    // Factor one. `identifier` is a username or email. Session = {}, emailed
  //  code = { pendingToken }; otherwise { error }.
  login: (
    identifier: string,
    password: string,
  ) => Promise<{ error?: string; pendingToken?: string; notVerified?: boolean }>;
    // Success = { username } (verification email sent, no session yet); failure = { error }.
  register: (
    username: string,
    password: string,
    email: string,
  ) => Promise<{ error?: string; username?: string }>;
    // Factor two. Success = null (session cookie set, user in store); failure = message.
  verify2fa: (pendingToken: string, code: string) => Promise<string | null>;
    // Re-issues the login code for a live 2FA challenge. Success = null.
  resend2fa: (pendingToken: string) => Promise<string | null>;
    // Emails a reset link. Always resolves null (generic response: no account enumeration).
  forgotPassword: (email: string) => Promise<string | null>;
    // Redeems a reset token and sets a new password. Success = null; failure = message.
  resetPassword: (token: string, password: string) => Promise<string | null>;
    // Resends a signup verification link (public). Success = null.
  resendVerification: (email: string) => Promise<string | null>;
    // Redeems an emailed verify link (signup or email-change).
  verifyEmail: (token: string) => Promise<VerifyOutcome>;
  logout: () => Promise<void>;
  playerCount: PlayerCount;
  seats: Seat[];
  dice: number;
  rolling: boolean;
  turn: number;
  settings: Record<string, boolean>;
  setPlayerCount: (c: PlayerCount) => void;
    // Seats the host (`you`) on card `i` with the picked colour. One host card only: a re-pick moves the seat.
  placeHost: (i: number, color: ColorKey) => void;
    // Seats a bot on card `i` at the picked colour.
  addBot: (i: number, color: ColorKey) => void;
    // Seats a local hotseat pilot on card `i` at the picked colour.
  addPlayer: (i: number, color: ColorKey) => void;
    // Empties card `i`, host card included: an emptied card gives its colour back.
  removeSeat: (i: number) => void;
  renamePlayer: (i: number, name: string) => void;
    // Clears every card: call when entering the sub-lobby so a fresh room never inherits seats from a previous session.
  resetSeats: () => void;
    // False until the host is seated: every other card is added after the host's colour is theirs.
  startGame: () => boolean;
  roll: () => void;
  endTurn: () => void;
  settingOn: (key: string) => boolean;
  toggleSetting: (key: string) => void;
  theme: ThemeType;
  setTheme: (t: ThemeType) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
    // True when a notification card closes itself (22.5). Off means it stays until
  // its `x`, and it governs the boot report as well as the live cards. Stored
  // under `lr.notifAutoClose`, on when the key is absent.
  notifAutoClose: boolean;
  setNotifAutoClose: (on: boolean) => void;
  setPlaying: (playing: boolean) => void;
    // The session socket, or null while signed out (a guest never opens one).
  // Presence rides on it; screens subscribe to its pushes.
  sessionSocket: SessionSocket | null;
    // The last site-wide online count the socket pushed. The badge's only source
  // (D11): there is no REST read, and it survives a screen remount because this
  // listener lives as long as the connection. Null until the first push.
  onlineCount: number | null;
    // Whether the session socket is up right now. The chat composer is disabled
  // while it is not: an emit made offline would be queued and land minutes later.
  sessionConnected: boolean;
    // The public channel's transcript, oldest first, at most `CHAT_HISTORY` lines. Held
  // above the panel so a collapsed channel and `/game` both keep it current.
  chatLog: ChatMessage[];
    // Sends one line to the public channel. The ack reports a refusal (too long,
  // too soon, empty, or the transport being down) for the panel's status line.
  sendChat: (text: string, done?: (reply: ChatAck) => void) => void;
  activeMatch: ActiveMatch;
  setActiveMatch: (match: ActiveMatch) => void;
  guestSetup: GuestSetup | null;
  setGuestSetup: (setup: GuestSetup | null) => void;
  lastResult: LastResult;
  setLastResult: (result: LastResult) => void;
};
