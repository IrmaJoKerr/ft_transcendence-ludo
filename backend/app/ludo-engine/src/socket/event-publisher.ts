import { RedisGameStore } from '../redis';
import { GameEvent } from '../types';

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
        this.store.publish(
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
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'piece_moved',
            ...event.result,
          }),
        );
        break;

      case 'game_ended':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'game_ended',
            winner: event.winner,
            resultDetail: event.resultDetail,
          }),
        );
        break;

      case 'player_exited':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'player_exited',
            color: event.color,
          }),
        );
        break;

      case 'player_resigned':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'player_resigned',
            color: event.color,
          }),
        );
        break;

      case 'game_started':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'game_started',
            gameId: event.gameId,
          }),
        );
        break;

      case 'color_selected':
        this.store.publish(
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
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'lobby_update',
            gameId: event.gameId,
            players: event.players,
            hostId: event.hostId,
          }),
        );
        break;

      case 'clash_start':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'clash_start',
            gameId: event.gameId,
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
            resultMs: event.resultMs,
          }),
        );
        break;

      case 'clash_phase':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'clash_phase',
            gameId: event.gameId,
            phase: event.phase,
            countdownDeadline: event.countdownDeadline,
            pressDeadline: event.pressDeadline,
          }),
        );
        break;

      case 'clash_press':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'clash_press',
            gameId: event.gameId,
            color: event.color,
            presses: event.presses,
          }),
        );
        break;

      case 'clash_result':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'clash_result',
            gameId: event.gameId,
            winner: event.winner,
            loser: event.loser,
            winnerPresses: event.winnerPresses,
            loserPresses: event.loserPresses,
          }),
        );
        break;

      case 'modifiers_updated':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'modifiers_updated',
            gameId: event.gameId,
            clashEnabled: event.clashEnabled,
            safeZones: event.safeZones,
          }),
        );
        break;

      case 'player_aborted':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'player_aborted',
            color: event.color,
            username: event.username,
          }),
        );
        break;

      case 'player_disconnected':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'player_disconnected',
            color: event.color,
          }),
        );
        break;

      case 'player_reconnected':
        this.store.publish(
          gameId,
          JSON.stringify({
            type: 'player_reconnected',
            color: event.color,
          }),
        );
        break;
    }
  }
}
