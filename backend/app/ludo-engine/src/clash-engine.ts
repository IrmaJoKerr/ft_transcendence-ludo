import { RedisGameStore } from './redis';
import {
  ClashManager,
  CLASH_SWEEP_GRACE_MS,
  CLASH_TARGET,
  CLASH_RESULT_FREEZE_MS,
  CLASH_BOT_WIN_MS_BASE,
  CLASH_BOT_LOSE_MS_BASE,
  CLASH_BOT_JITTER_MS,
  CLASH_BOT_VS_BOT_WIN_CHANCE,
  CLASH_BOT_VS_HUMAN_WIN_CHANCE,
} from './clash';
import { MoveValidator } from './move-validator';
import { applyMoveOutcome } from './turn';
import type { PlayerColor, GameEvent, ClashState, ClashPhase } from './types';

// Cadence of the boot-time clash recovery sweep (re-arms stale phase timers).
const CLASH_SWEEP_INTERVAL_MS = 5000;

/**
 * ClashEngine owns the clash QTE: phase timers, the recovery sweep + re-arm,
 * bot presser simulation, press recording, and deferred-capture resolution.
 * LudoEngine injects the game lock and the emit hook so serialization and the
 * event stream stay single-owned.
 */
export class ClashEngine {
  // One timeout per live clash : resolves by most-presses once the window ends.
  private clashTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private store: RedisGameStore,
    private clashManager: ClashManager,
    private emit: (event: GameEvent) => void,
    private withGameLock: <T>(gameId: string, fn: () => Promise<T>) => Promise<T>,
  ) {}

  /** Start the QTE and arm its phase timers; bot pressers begin at press-phase start. */
  async startClash(gameId: string, attacker: PlayerColor, defender: PlayerColor, attackerIsBot: boolean, defenderIsBot: boolean): Promise<void> {
    await this.clashManager.startClash(gameId, attacker, defender);
    this.armClashPhaseTimers(gameId, () => {
      // Bot pressers begin EXACTLY at press-phase start (they don't hunt keys).
      if (attackerIsBot || defenderIsBot) {
        if (attackerIsBot && defenderIsBot) {
          const attackerWins = Math.random() < CLASH_BOT_VS_BOT_WIN_CHANCE;
          this.simulateBotPressers(gameId, attacker, attackerWins);
          this.simulateBotPressers(gameId, defender, !attackerWins);
        } else {
          const botSide = attackerIsBot ? attacker : defender;
          const botWins = Math.random() < CLASH_BOT_VS_HUMAN_WIN_CHANCE;
          this.simulateBotPressers(gameId, botSide, botWins);
        }
      }
    });
  }

  /** Arm the announce/countdown/press timers off the PERSISTED deadlines already stored by ClashManager.startClash. */
  private armClashPhaseTimers(gameId: string, onPressStart?: () => void): void {
    const existing = this.clashTimers.get(gameId);
    if (existing) clearTimeout(existing);

    void this.store.loadClashState(gameId).then((clash) => {
      if (!clash) return;
      const now = Date.now();
      const schedule = (delay: number, phase: ClashPhase, fn: () => void) => {
        if (delay > 0) this.clashTimers.set(gameId, setTimeout(() => { void this.withGameLock(gameId, async () => { try { await fn(); } catch (err) { console.error('[clash] phase error', gameId, err); } }); }, delay));
        else void fn();
      };
      // No lock wrapper : resolveClashOutcome already locks; wrapping would deadlock.
      const scheduleUnlocked = (delay: number, fn: () => void) => {
        if (delay > 0) this.clashTimers.set(gameId, setTimeout(() => { void (async () => { try { await fn(); } catch (err) { console.error('[clash] resolve error', gameId, err); } })(); }, delay));
        else void fn();
      };
      // announce -> countdown
      schedule(Math.max(0, clash.announceDeadline - now), 'countdown', async () => {
        const st = await this.store.loadGameState(gameId);
        if (!st?.clash || st.clash.phase !== 'announce') return;
        st.clash.phase = 'countdown';
        await this.store.saveGameState(gameId, st);
        this.emit({ type: 'clash_phase', gameId, phase: 'countdown', countdownDeadline: st.clash.countdownDeadline, pressDeadline: st.clash.pressDeadline });
      });
      // countdown -> pressing (bot pressers start here)
      schedule(Math.max(0, clash.countdownDeadline - now), 'pressing', async () => {
        const st = await this.store.loadGameState(gameId);
        if (!st?.clash || st.clash.phase !== 'countdown') return;
        st.clash.phase = 'pressing';
        await this.store.saveGameState(gameId, st);
        this.emit({ type: 'clash_phase', gameId, phase: 'pressing', countdownDeadline: st.clash.countdownDeadline, pressDeadline: st.clash.pressDeadline });
        onPressStart?.();
      });
      // press -> resolve
      scheduleUnlocked(Math.max(0, clash.pressDeadline - now), () => this.resolveClashOnTimeout(gameId));
    });
  }

  /** Boot-time re-arm: restore exact phase timers from persisted deadlines. */
  private async reArmClashTimers(): Promise<void> {
    try {
      const keys = await this.store.scanGameKeys();
      for (const key of keys) {
        const gameId = key.replace('game:', '');
        const st = await this.store.loadGameState(gameId);
        if (st?.status === 'active' && st.clash) {
          this.armClashPhaseTimers(gameId);
        }
      }
    } catch { /* transient : boot re-arm is best-effort; the sweep covers it */ }
  }

  /** Boot-time clash recovery: re-arm phase timers for any persisted clashes
   *  and sweep every 5s for orphaned/stalled QTE states. */
  startRecoverySweep(): void {
    void this.reArmClashTimers();
    const tick = () => {
      void (async () => {
        try {
          const keys = await this.store.scanGameKeys();
          for (const key of keys) {
            const gameId = key.replace('game:', '');
            try {
              const st = await this.store.loadGameState(gameId);
              if (!st || st.status !== 'active' || !st.clash) continue;
              const clash = st.clash;
              const now = Date.now();
              // Phase advance (never skip a phase):
              if (clash.phase === 'announce' && now >= clash.announceDeadline) {
                clash.phase = 'countdown';
              }
              if (clash.phase === 'countdown' && now >= clash.countdownDeadline) {
                clash.phase = 'pressing';
              }
              await this.store.saveGameState(gameId, st);
              // Resolution only after the full press window:
              if (clash.phase === 'pressing' && now >= clash.pressDeadline) {
                await this.resolveClashOnTimeout(gameId);
              } else if (now - clash.startedAt >= CLASH_SWEEP_GRACE_MS) {
                // Orphaned (timers lost to crash/restart): force-resolve by meters.
                await this.resolveClashOnTimeout(gameId);
              }
            } catch { /* transient : continue */ }
          }
        } catch { /* scan errors are transient : retry next tick */ }
      })();
    };
    setInterval(tick, CLASH_SWEEP_INTERVAL_MS);
  }

  /** Timeout fallback: most-presses wins; TIE → ATTACKER (uniform rule). */
  private resolveClashOnTimeout(gameId: string): Promise<void> {
    return (async () => {
      try {
        const state = await this.store.loadGameState(gameId);
        if (!state || state.status !== 'active') { console.error(`[clash] timeout: inactive ${gameId}`); return; }
        const clash: ClashState | undefined = state.clash;
        if (!clash) { console.error(`[clash] timeout: no clash ${gameId}`); return; }
        if (clash.phase !== 'pressing') { console.error(`[clash] timeout: phase=${clash.phase} ${gameId}`); return; }
        if (Date.now() < clash.pressDeadline) { console.error(`[clash] timeout: not due ${gameId}`); return; }
        const winner =
          clash.attackerPresses >= clash.defenderPresses
            ? clash.attacker
            : clash.defender;
        console.error(`[clash] timeout resolving ${gameId} winner=${winner} A=${clash.attackerPresses} D=${clash.defenderPresses}`);
        await this.resolveClashOutcome(gameId, winner);
        console.error(`[clash] timeout resolved ${gameId}`);
      } catch (err) {
        console.error(`[clash] timeout ERROR ${gameId}:`, err);
      }
    })();
  }

  /**
   * Locked press recorder (humans and bots). On reaching CLASH_TARGET the
   * resolve is scheduled outside the lock : a re-entrant self-lock would deadlock.
   */
  async recordClashPress(gameId: string, color: PlayerColor, key?: string, isBot = false): Promise<number> {
    return this.withGameLock(gameId, async () => {
      const count = await this.clashManager.recordPress(gameId, color, key ?? '', isBot);
      if (count >= CLASH_TARGET) {
        setTimeout(() => void this.resolveClashOutcome(gameId, color), 0);
      }
      return count;
    });
  }

  /** Resolve a deferred capture: attacker wins → capture, defender wins → repulse; then completes the move like the normal path. */
  async resolveClashOutcome(gameId: string, winner: PlayerColor): Promise<void> {
    return this.withGameLock(gameId, async () => {
      const t = this.clashTimers.get(gameId);
      if (t) {
        clearTimeout(t);
        this.clashTimers.delete(gameId);
      }

      const state = await this.store.loadGameState(gameId);
      if (!state || state.status !== 'active') return;
      const pc = state.pendingCapture;
      if (!pc) return;

      const attackerWon = pc.attacker === winner;
      // Per-player clash counters (drive achSteadyDefender / achMercilessAttacker).
      const attackerMeta = state.players.find(p => p.color === pc.attacker);
      const defenderMeta = state.players.find(p => p.color === pc.defender);
      if (attackerWon) {
        if (attackerMeta) attackerMeta.stats.clashAttacksWon++;
      } else {
        if (defenderMeta) defenderMeta.stats.clashDefends++;
      }
      const pendingMove = {
        pieceId: pc.pieceId,
        from: pc.from,
        to: pc.to,
        isCapture: attackerWon,
        isHomeEntry: pc.enteredHome,
      };

      const result = MoveValidator.executeMove(state, pendingMove, pc.diceValue);
      const aCount = state.clash?.attackerPresses ?? 0;
      const dCount = state.clash?.defenderPresses ?? 0;
      if (!attackerWon) {
        // REPULSE: the attacker's piece is sent home; the defender holds the square.
        // (executeMove walked the mover to `to` with isCapture=false; re-home it.)
        const moverPiece = state.pieces.find(p => p.id === pc.pieceId);
        if (moverPiece) {
          moverPiece.step = 0;
          moverPiece.isInBase = true;
          moverPiece.isInGoal = false;
        }
        result.captured = true;
        result.capturedPieceIds = [pc.pieceId];
        result.bonusRoll = false;
        result.clashOutcome = 'defender_won';
      } else {
        result.clashOutcome = 'attacker_won';
      }

      // Apply the move outcome and clear clash/pendingCapture on the same object before one save.
      await this.store.recordMove(gameId, {
        ply: result.ply,
        color: result.color,
        diceValue: result.diceValue,
        pieceId: result.pieceId,
        from: result.from,
        to: result.to,
        captured: result.captured,
        enteredHome: result.enteredHome,
        timestamp: Date.now(),
      });
      applyMoveOutcome(state, result, pc.diceValue, attackerWon);
      delete state.clash;
      delete state.pendingCapture;
      // Freeze all input during the result card (covers human/hotseat; bots are already frozen).
      state.resultCardUntil = Date.now() + CLASH_RESULT_FREEZE_MS;
      await this.store.saveGameState(gameId, state);

      this.emit({ type: 'piece_moved', gameId, result });
      this.emit({
        type: 'clash_result',
        gameId,
        winner: attackerWon ? pc.attacker : pc.defender,
        loser: attackerWon ? pc.defender : pc.attacker,
        winnerPresses: attackerWon ? aCount : dCount,
        loserPresses: attackerWon ? dCount : aCount,
      });
    });
  }

  /**
   * Bot mashing at a human-realistic jittered pace. The caller pre-rolls the
   * winner: it presses fast (CLASH_BOT_WIN_MS_BASE ± jitter), the loser slow
   * (CLASH_BOT_LOSE_MS_BASE ± jitter), so the winner reaches target first.
   */
  private simulateBotPressers(gameId: string, botColor: PlayerColor, winner: boolean): void {
    const schedulePress = () => {
      const base = winner ? CLASH_BOT_WIN_MS_BASE : CLASH_BOT_LOSE_MS_BASE;
      const delay = base + Math.random() * CLASH_BOT_JITTER_MS;
      setTimeout(() => {
        void (async () => {
          try {
            const cur = await this.store.loadGameState(gameId);
            if (!cur || cur.status !== 'active' || !cur.clash) return; // clash already resolved
            if (Date.now() >= cur.clash.pressDeadline) return; // timeout handles it

            // No lock here : armed from inside the lock chain; recordClashPress would
            // re-enter it and deadlock. Single-chain + press-cap make races idempotent.
            const count = await this.store.recordClashPress(gameId, botColor);
            // Broadcast so every client's bars advance live (store doesn't publish; humans get it via ClashManager).
            this.emit({ type: 'clash_press', gameId, color: botColor, presses: count });
            if (count >= CLASH_TARGET) {
              // Early win : schedule outside any lock (resolveClashOutcome self-locks).
              setTimeout(() => void this.resolveClashOutcome(gameId, botColor), 0);
              return;
            }
          } catch (err) {
            console.error(`[clash] bot press ERROR ${gameId}/${botColor}:`, err);
            return; // do NOT re-arm on persistent failure : recovery sweep cleans up
          }
          schedulePress();
        })();
      }, delay);
    };
    schedulePress();
  }
}
