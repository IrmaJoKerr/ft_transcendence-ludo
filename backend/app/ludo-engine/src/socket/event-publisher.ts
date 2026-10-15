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
            value: event.value,
            legalMoves: event.legalMoves,
            bonusRoll: event.bonusRoll,
            currentTurn: event.currentTurn,
            forfeited: event.forfeited,
          }),
        );
        break;

      case 'piece_moved':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'piece_moved',
            ...event.result,
          }),
        );
        break;

      // A held turn passed without a move: the Skip on an armed Barrier Buster
      // exit. Carries the seat that takes over, because the clients have no other
      // way to learn it: without this case the engine advanced the turn in Redis
      // while every client kept rendering the skipped turn and its armed move
      // (the SPA's reducer and its skip log line both wait on this frame).
      case 'turn_skipped':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'turn_skipped',
            gameId,
            currentTurn: event.currentTurn,
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
            // Chain fields: which round this is, how many the attack costs, and
            // the defenders standing on the square (the round's defender first).
            // `info` is always supplied on the engine's capture path, so these
            // reach the client for every clash; a single-defender clash reads
            // 1/1 and the client shows no round badge. Defaults rather than
            // omission (null / [] instead of undefined) keep the frame's field
            // set CONSTANT, which is what the clash probe asserts.
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
            winner: event.winner,
            loser: event.loser,
            winnerPresses: event.winnerPresses,
            loserPresses: event.loserPresses,
            // Chain fields: the round that just ended, whether the square still
            // holds defenders (the client then keeps the boards up for the next
            // round), the defender that lost it and who is left standing. A
            // single clash publishes 1/1 with continues false, so the client
            // reads one shape.
            round: event.round ?? 1,
            totalRounds: event.totalRounds ?? 1,
            continues: event.continues ?? false,
            defenderPieceId: event.defenderPieceId ?? null,
            remainingDefenderIds: event.remainingDefenderIds ?? [],
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
          }),
        );
        break;

      // Room teardown (quorum lost, single-instance disconnect expiry, idle
      // lobby). Emitted by teardownRoom so every surviving client leaves the
      // dead room cleanly.
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

      case 'state_update':
        void this.store.publish(
          gameId,
          JSON.stringify({
            type: 'state_update',
            ...event.state,
          }),
        );
        break;

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
