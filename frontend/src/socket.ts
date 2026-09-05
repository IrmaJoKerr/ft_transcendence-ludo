import { io, Socket } from 'socket.io-client'
import type { GameState, PlayerColor, LegalMove, MoveResult, ClashPhase } from './game/types'

export type ServerEvents = {
  game_joined: (state: GameState & { hostId?: string }) => void
  dice_rolled: (e: { value: number; legalMoves: LegalMove[]; bonusRoll: boolean; currentTurn: PlayerColor; forfeited?: boolean }) => void
  piece_moved: (e: MoveResult) => void
  game_started: (e: { gameId: string }) => void
  game_ended: (e: { winner: PlayerColor; resultDetail: string }) => void
  clash_start: (e: { attackerKey: string; defenderKey: string; target: number; duration: number; attacker: PlayerColor; defender: PlayerColor; phase: ClashPhase; startAt: number; announceDeadline: number; countdownDeadline: number; pressDeadline: number; attackerPresses: number; defenderPresses: number }) => void
  clash_phase: (e: { phase: ClashPhase; countdownDeadline: number; pressDeadline: number }) => void
  clash_press: (e: { color: PlayerColor; presses: number }) => void
  clash_result: (e: { winner: PlayerColor; loser: PlayerColor; winnerPresses: number; loserPresses: number }) => void
  player_exited: (e: { color: PlayerColor }) => void
  player_aborted: (e: { color: PlayerColor; username: string }) => void
  player_disconnected: (e: { color: PlayerColor }) => void
  player_reconnected: (e: { color: PlayerColor }) => void
  lobby_update: (e: { players: Array<{ username: string; color: PlayerColor; ready: boolean }>; hostId?: string }) => void
  modifiers_updated: (e: { clashEnabled: boolean; safeZones: boolean }) => void
  game_timeout: () => void
  game_expired: () => void
  game_created: (newGameId: string) => void
  state_update: (payload: GameState) => void
  error: (msg: string) => void
}

export type ClientEvents = {
  join_game: (gameId: string, color: PlayerColor, userId?: string, displayName?: string) => void
  roll_dice: () => void
  move_piece: (pieceId: string) => void
  clash_input: (key: string) => void
  player_ready: () => void
  select_color: (color: PlayerColor) => void
  update_modifiers: (clashEnabled: boolean, safeZones: boolean) => void
  leave_game: () => void
  resign: () => void
  end_game: () => void
  rematch: () => void
  exit_post_game: () => void
}

// Always connects to the page's own origin — nginx (or, in dev, the Vite
// proxy) forwards /socket.io/ to the engine; in the deployed (no-nginx)
// topology the backend proxies /socket.io to the engine too, so the browser
// keeps a single origin end to end. See nginx/conf/app.inc and vite.config.ts.
export function connectSocket(token: string): Socket<ServerEvents, ClientEvents> {
  return io(window.location.origin, {
    auth: { token },
    transports: ['websocket'],
    reconnectionAttempts: 5,
  })
}
