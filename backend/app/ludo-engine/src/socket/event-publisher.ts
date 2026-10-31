import type { RedisGameStore } from '../redis';
import type { GameEvent } from '../types';

// EventPublisher: the only place that publishes game lifecycle events. Each
// engine event goes to Redis pub/sub so every client receives it.
export class EventPublisher {
  constructor(private store: RedisGameStore) {}

  // Publish an engine event to Redis pub/sub, broadcast to the game room
  // via the Redis subscriber in server.ts.
  publish(event: GameEvent): void {
    const { gameId } = event;

    switch (event.type) {
      case 'dice_rolled':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'dice_rolled',
            // The true roller: the turn may already have advanced (a no-move roll or
            // the third-six forfeit), so the client cannot take it from currentTurn.
            color: event.color,
            value: event.value,
            legalMoves: event.legalMoves,
            bonusRoll: event.bonusRoll,
            currentTurn: event.currentTurn,
            forfeited: event.forfeited,
            // The lines this roll wrote to the log, so a live client renders the
            // engine's own entry instead of re-deriving one.
            log: event.log,
          }),
        );
        break;

      case 'piece_moved':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'piece_moved',
            ...event.result,
            log: event.log,
          }),
        );
        break;

      // A held turn passed without a move: the Skip on an armed Wall Breaker exit.
      // Carries the seat that takes over, because the clients have no other way to
      // learn it; without this frame they keep rendering the skipped turn.
      case 'turn_skipped':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'turn_skipped',
            gameId,
            currentTurn: event.currentTurn,
            log: event.log,
          }),
        );
        break;

      case 'game_ended':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'game_ended',
            winner: event.winner,
            resultDetail: event.resultDetail,
          }),
        );
        break;

      case 'player_exited':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'player_exited',
            color: event.color,
          }),
        );
        break;

      case 'game_started':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'game_started',
            gameId: event.gameId,
          }),
        );
        break;

      // Clash QTE (capture mini-game). The client renders each phase from these
      // frames; the mashing client's own key sends clash_input back.
      case 'clash_start':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'clash_start',
            attackerKey: event.attackerKey,
            defenderKey: event.defenderKey,
            // Key-shift schedule: the letters each side will be asked for, and the
            // instants they change. Constant field set: empty arrays and 0 on a room
            // with the mutator off, so a client never has to guess at the shape.
            attackerKeys: event.attackerKeys,
            defenderKeys: event.defenderKeys,
            switchAt: event.switchAt,
            keyShift: event.keyShift,
            serverNow: event.serverNow,
            target: event.target,
            duration: event.duration,
            attacker: event.attacker,
            defender: event.defender,
            phase: event.phase,
            startAt: event.startAt,
            announceDeadline: event.announceDeadline,
            countdownDeadline: event.countdownDeadline,
            pressDeadline: event.pressDeadline,
            attackerPresses: event.attackerPresses,
            defenderPresses: event.defenderPresses,
            // Chain fields: the round, the rounds the attack costs and the defenders
            // standing (the round's defender first). A single-defender clash reads 1/1.
            // Null and [] defaults keep the frame's field set constant.
            round: event.round ?? 1,
            totalRounds: event.totalRounds ?? 1,
            defenderPieceId: event.defenderPieceId ?? null,
            remainingDefenderIds: event.remainingDefenderIds ?? [],
          }),
        );
        break;

      case 'clash_phase':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'clash_phase',
            phase: event.phase,
            countdownDeadline: event.countdownDeadline,
            pressDeadline: event.pressDeadline,
          }),
        );
        break;

      // One phase frame per registered press: this is the live meter every client
      // (and the pressing client) reads, so no per-press ack exists.
      case 'clash_press':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'clash_press',
            color: event.color,
            presses: event.presses,
          }),
        );
        break;

      case 'clash_result':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'clash_result',
            cardId: event.cardId,
            // Named before the winner because the client's result FX is picked from
            // it: `winner === attacker` splits won from lost, and the chain flags
            // split the won cases into ropes, brick and crumble.
            attacker: event.attacker,
            winner: event.winner,
            loser: event.loser,
            winnerPresses: event.winnerPresses,
            loserPresses: event.loserPresses,
            // Chain fields: the round that ended, whether the square still holds
            // defenders, the defender that lost and who is left standing. A single
            // clash publishes 1/1 with continues false.
            round: event.round ?? 1,
            totalRounds: event.totalRounds ?? 1,
            resultCardUntil: event.resultCardUntil ?? null,
            continues: event.continues ?? false,
            defenderPieceId: event.defenderPieceId ?? null,
            remainingDefenderIds: event.remainingDefenderIds ?? [],
          }),
        );
        break;

      // The result card's hold ended: the clients' own forecasts shortened the freeze,
      // so the engine hands the new deadline over. Without this frame a client that lost
      // its card timer would keep a stale clash forever.
      case 'clash_card_released':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'clash_card_released',
            gameId,
            resultCardUntil: event.resultCardUntil,
          }),
        );
        break;

      // Host changed the room rules while the room was still waiting. One object
      // out, the same three fields the panel sent in.
      case 'modifiers_updated':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'modifiers_updated',
            gameId: event.gameId,
            clashEnabled: event.clashEnabled,
            noSafeZones: event.noSafeZones,
            freeExit: event.freeExit,
            clashKeyShift: event.clashKeyShift,
          }),
        );
        break;

      // Room teardown (quorum lost, single-instance disconnect expiry, idle
      // lobby). Emitted by teardownRoom so every surviving client leaves the
      // closed room cleanly.
      case 'game_expired':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'game_expired',
            gameId: event.gameId,
          }),
        );
        break;

      case 'color_selected':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'color_selected',
            gameId: event.gameId,
            userId: event.userId,
            color: event.color,
          }),
        );
        break;

      case 'lobby_update':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'lobby_update',
            gameId: event.gameId,
            players: event.players,
          }),
        );
        break;

      case 'player_aborted':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'player_aborted',
            color: event.color,
            username: event.username,
            log: event.log,
          }),
        );
        break;

      case 'player_disconnected':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'player_disconnected',
            color: event.color,
          }),
        );
        break;

      case 'state_update': {
        // The log is stripped: it ships in game_joined (the snapshot a client joins
        // ON) and rides each event frame's own `log`. Re-sending 30 entries on every
        // full-state frame would be the one place the log costs bandwidth.
        const state = { ...event.state };
        delete state.log;
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'state_update',
            ...state,
          }),
        );
        break;
      }

      case 'player_reconnected':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'player_reconnected',
            color: event.color,
            // The name the reconnecting client reported : it may have renamed
            // while it was away, and the other clients only see this event.
            displayName: event.displayName,
          }),
        );
        break;
    }
  }
}
