import type { RedisGameStore } from './redis';
import {
  ClashManager,
  CLASH_SWEEP_GRACE_MS,
  CLASH_TARGET,
  CLASH_RESULT_MS,
  CLASH_RESULT_FREEZE_MS,
  CLASH_BOT_WIN_MS_BASE,
  CLASH_BOT_LOSE_MS_BASE,
  CLASH_BOT_JITTER_MS,
  CLASH_BOT_VS_BOT_WIN_CHANCE,
  CLASH_BOT_VS_HUMAN_WIN_CHANCE,
} from './clash';
import { MoveValidator } from './move-validator';
import { applyMoveOutcome } from './turn';
import type { PlayerColor, GameEvent, ClashState, PendingCapture, PieceId, ChainRound } from './types';

// Cadence of the clash recovery sweep (re-arms stale phase timers).
const CLASH_SWEEP_INTERVAL_MS = 5000;

// The chain, read out of a deferred capture as plain arrays so one round can be
// resolved without touching the persisted object's shape. A capture written
// before the chain existed carries no ledger: it resolves as a single round
// (R = 1) that sends the whole recorded stack home, which is exactly what that
// state meant when it was written.
type ChainLedger = {
  round: number;
  totalRounds: number;
  remaining: PieceId[];
  beaten: PieceId[];
};

function chainLedgerOf(pc: PendingCapture): ChainLedger {
  return {
    round: pc.round ?? 1,
    totalRounds: pc.totalRounds ?? 1,
    remaining: [...(pc.remainingDefenderIds ?? pc.capturedPieceIds ?? [])],
    beaten: [...(pc.beatenDefenderIds ?? [])],
  };
}

// ClashEngine owns the clash QTE: the phase timers, the boot recovery (re-arm
// plus sweep), bot pressers, press recording, and the deferred-capture
// resolution. LudoEngine injects the game lock and the emit hook, so
// serialization and the event stream stay single-owned.
export class ClashEngine {
  // One timeout per live clash: resolves by most presses once the window ends.
  private clashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // One timer per game for a chain's inter-round gap: while a round's result card
  // shows there is no live clash, so this is the timer that starts the next one.
  private chainTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private store: RedisGameStore,
    private clashManager: ClashManager,
    private emit: (event: GameEvent) => void,
    private withGameLock: <T>(gameId: string, fn: () => Promise<T>) => Promise<T>,
  ) {}

  // Start the QTE and arm its phase timers. Bot pressers begin exactly at
  // press-phase start, because they press their own side instead of hunting keys.
  // `info` names the round inside a chain (absent: the single-defender case).
  async startClash(
    gameId: string,
    attacker: PlayerColor,
    defender: PlayerColor,
    attackerIsBot: boolean,
    defenderIsBot: boolean,
    info?: ChainRound,
  ): Promise<void> {
    // A live round owns the game's timeline: drop a pending inter-round gap timer
    // (the sweep may have re-armed one a moment ago) so nothing can start a second
    // round on top of this one.
    const pendingGap = this.chainTimers.get(gameId);
    if (pendingGap) {
      clearTimeout(pendingGap);
      this.chainTimers.delete(gameId);
    }
    await this.clashManager.startClash(gameId, attacker, defender, info);
    this.armClashPhaseTimers(gameId, () => {
      if (attackerIsBot || defenderIsBot) {
        if (attackerIsBot && defenderIsBot) {
          const attackerWins = Math.random() < CLASH_BOT_VS_BOT_WIN_CHANCE;
          this.simulateBotPressers(gameId, attacker, attackerWins, info?.round ?? 1);
          this.simulateBotPressers(gameId, defender, !attackerWins, info?.round ?? 1);
        } else {
          const botSide = attackerIsBot ? attacker : defender;
          const botWins = Math.random() < CLASH_BOT_VS_HUMAN_WIN_CHANCE;
          this.simulateBotPressers(gameId, botSide, botWins, info?.round ?? 1);
        }
      }
    });
  }

  // Arm the announce/countdown/press timers off the deadlines ClashManager
  // already persisted. The delays are computed against `now`, so a re-arm after
  // a restart resumes a clash mid-phase instead of restarting its window.
  private armClashPhaseTimers(gameId: string, onPressStart?: () => void): void {
    const existing = this.clashTimers.get(gameId);
    if (existing) clearTimeout(existing);

    void this.store.loadClashState(gameId).then((clash) => {
      if (!clash) return;
      const now = Date.now();
      // The round these timers belong to. A chain writes a NEW clash for every
      // round, so a timer armed for round N must never act on round N+1: the
      // callbacks below bail when the live round is no longer theirs. Without
      // this a phase timer left over from a round resolved inside its own
      // announce window would land in the next round and skip its countdown.
      const armedRound = clash.round ?? 1;
      const schedule = (delay: number, fn: () => void) => {
        if (delay > 0) {
          this.clashTimers.set(
            gameId,
            setTimeout(() => {
              void this.withGameLock(gameId, async () => {
                try {
                  await fn();
                } catch (err) {
                  console.error('[clash] phase error', gameId, err);
                }
              });
            }, delay),
          );
        } else {
          void fn();
        }
      };
      // No lock wrapper here: resolveClashOutcome locks on its own, so wrapping
      // it would deadlock against the lock this timer chain already holds.
      const scheduleUnlocked = (delay: number, fn: () => void) => {
        if (delay > 0) {
          this.clashTimers.set(
            gameId,
            setTimeout(() => {
              void (async () => {
                try {
                  await fn();
                } catch (err) {
                  console.error('[clash] resolve error', gameId, err);
                }
              })();
            }, delay),
          );
        } else {
          void fn();
        }
      };
      // announce -> countdown
      schedule(Math.max(0, clash.announceDeadline - now), async () => {
        const st = await this.store.loadGameState(gameId);
        if (!st?.clash || st.clash.phase !== 'announce') return;
        if ((st.clash.round ?? 1) !== armedRound) return;
        st.clash.phase = 'countdown';
        await this.store.saveGameState(gameId, st);
        this.emit({
          type: 'clash_phase',
          gameId,
          phase: 'countdown',
          countdownDeadline: st.clash.countdownDeadline,
          pressDeadline: st.clash.pressDeadline,
        });
      });
      // countdown -> pressing (bot pressers start here)
      schedule(Math.max(0, clash.countdownDeadline - now), async () => {
        const st = await this.store.loadGameState(gameId);
        if (!st?.clash || st.clash.phase !== 'countdown') return;
        if ((st.clash.round ?? 1) !== armedRound) return;
        st.clash.phase = 'pressing';
        await this.store.saveGameState(gameId, st);
        this.emit({
          type: 'clash_phase',
          gameId,
          phase: 'pressing',
          countdownDeadline: st.clash.countdownDeadline,
          pressDeadline: st.clash.pressDeadline,
        });
        onPressStart?.();
      });
      // press -> resolve
      scheduleUnlocked(Math.max(0, clash.pressDeadline - now), () =>
        this.resolveClashOnTimeout(gameId, armedRound),
      );
    });
  }

  // Boot-time re-arm: rebuild the exact phase timers from the persisted
  // deadlines of every active game that still holds a clash. This is the clash
  // half of the engine's wake pass: the containers restart, Redis keeps the
  // window, and the QTE resumes where it stopped.
  private async reArmClashTimers(): Promise<void> {
    try {
      const keys = await this.store.scanGameKeys();
      for (const key of keys) {
        const gameId = key.replace('game:', '');
        const st = await this.store.loadGameState(gameId);
        if (st?.status !== 'active') continue;
        if (st.clash) {
          this.armClashPhaseTimers(gameId);
        } else if (st.pendingCapture) {
          // A chain interrupted between rounds (its gap timer died with the
          // process): the ledger, not the vanished clash, is what resumes it.
          void this.startNextRound(gameId).catch((err) =>
            console.error('[clash] re-arm next round failed', gameId, err),
          );
        }
      }
    } catch {
      // Best-effort: the sweep below covers anything the re-arm misses.
    }
  }

  // Boot recovery: re-arm persisted clashes, then sweep every 5s for stalled or
  // orphaned QTE states (timers lost to a crash, or a phase that never fired).
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
              if (!st || st.status !== 'active') continue;
              // A chain between rounds (no live clash, ledger left): the sweep is
              // the backstop for a gap timer that never fired, and it is also what
              // picks a chain up once a paused seat reconnects. A paused chain is
              // left alone: the reconnect starts it.
              if (!st.clash) {
                if (st.pendingCapture && !st.paused) await this.startNextRound(gameId);
                continue;
              }
              const clash = st.clash;
              const now = Date.now();
              // Phase advance never skips a phase, so a clash resumed mid-window
              // still shows both earlier phases in order.
              if (clash.phase === 'announce' && now >= clash.announceDeadline) {
                clash.phase = 'countdown';
              }
              if (clash.phase === 'countdown' && now >= clash.countdownDeadline) {
                clash.phase = 'pressing';
              }
              await this.store.saveGameState(gameId, st);
              // Resolution only after the full press window has run.
              if (clash.phase === 'pressing' && now >= clash.pressDeadline) {
                await this.resolveClashOnTimeout(gameId);
              } else if (now - clash.startedAt >= CLASH_SWEEP_GRACE_MS) {
                // Orphaned clash (its timers are gone): force-resolve by meters.
                await this.resolveClashOnTimeout(gameId);
              }
            } catch {
              // Transient per-game failure: continue with the next game.
            }
          }
        } catch {
          // Transient scan failure: retry on the next tick.
        }
      })();
    };
    setInterval(tick, CLASH_SWEEP_INTERVAL_MS);
  }

  // Timeout fallback: most presses wins, and a tie goes to the attacker (one
  // rule for both clients, so neither side can claim a tie-break edge). The
  // routine early returns are silent: the 5s sweep would otherwise log noise for
  // clashes that are simply not due yet. `armedRound` (the round the timer was
  // armed for, absent when the sweep calls us) makes a timer left over from an
  // earlier round a no-op instead of an early resolve of the current one.
  private async resolveClashOnTimeout(gameId: string, armedRound?: number): Promise<void> {
    try {
      const state = await this.store.loadGameState(gameId);
      if (!state || state.status !== 'active') return;
      const clash: ClashState | undefined = state.clash;
      if (!clash) return;
      if (armedRound !== undefined && (clash.round ?? 1) !== armedRound) return;
      if (clash.phase !== 'pressing') return;
      // The armed press-deadline timer can fire a millisecond BEFORE the stamp it
      // was scheduled for: its delay is `deadline - now` with both read off
      // Date.now(), but the timer expires on the event loop's own millisecond
      // clock, which can be a tick ahead of that. Returning here would drop the
      // round quietly and leave the QTE frozen in front of both players until the
      // 15s sweep (up to ~20s) or a reconnect, so a timer-armed call re-arms the
      // remainder instead. The sweep passes no round and retries on its own
      // cadence, so it simply returns.
      const earlyBy = clash.pressDeadline - Date.now();
      if (earlyBy > 0) {
        if (armedRound !== undefined) this.armResolveAtDeadline(gameId, armedRound, earlyBy);
        return;
      }
      const winner =
        clash.attackerPresses >= clash.defenderPresses ? clash.attacker : clash.defender;
      console.log(
        `[clash] timeout resolving ${gameId} winner=${winner} A=${clash.attackerPresses} D=${clash.defenderPresses}`,
      );
      await this.resolveClashOutcome(gameId, winner);
    } catch (err) {
      console.error(`[clash] timeout ERROR ${gameId}:`, err);
    }
  }

  // Re-arm a press-deadline resolution that arrived a hair early, plus one
  // millisecond so the retry clears the same comparison. The map is the game's
  // pending-clash timer slot (the one the phase timers and resolveClashOutcome
  // already use), and the callback carries its round, so a retry can never act on
  // a later round of the same chain.
  private armResolveAtDeadline(gameId: string, armedRound: number, afterMs: number): void {
    const existing = this.clashTimers.get(gameId);
    if (existing) clearTimeout(existing);
    this.clashTimers.set(
      gameId,
      setTimeout(() => {
        void this.resolveClashOnTimeout(gameId, armedRound);
      }, afterMs + 1),
    );
  }

  // Locked press recorder for humans and bots. Reaching CLASH_TARGET schedules
  // the resolve OUTSIDE the lock: a re-entrant self-lock would deadlock.
  async recordClashPress(
    gameId: string,
    color: PlayerColor,
    key?: string,
    isBot = false,
  ): Promise<number> {
    return this.withGameLock(gameId, async () => {
      const count = await this.clashManager.recordPress(gameId, color, key ?? '', isBot);
      if (count >= CLASH_TARGET) {
        setTimeout(() => void this.resolveClashOutcome(gameId, color), 0);
      }
      return count;
    });
  }

  // Resolve a deferred capture: attacker wins → the capture applies, defender
  // wins → the attacker is repulsed (sent home). Either way the move completes
  // exactly like the normal path: history, stats, bonus/turn advance, one save.
  async resolveClashOutcome(gameId: string, winner: PlayerColor): Promise<void> {
    return this.withGameLock(gameId, async () => {
      // Drop this clash's armed press timer: the resolution is happening now.
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
      // The round's defender, not the capture's first defender: a chain can fight
      // a different colour every round (a mixed square), and the frames must name
      // whoever actually lost this round.
      const ledger = chainLedgerOf(pc);
      const defenderPieceId = ledger.remaining[0] ?? '';
      const defenderPiece = state.pieces.find((p) => p.id === defenderPieceId);
      const defenderColor = (defenderPiece?.color as PlayerColor | undefined) ?? pc.defender;
      // A round WITH defenders still standing after it is an intermediate round:
      // the chain continues, so nothing about the move itself is applied yet.
      const continues =
        attackerWon && ledger.round < ledger.totalRounds && ledger.remaining.length > 1;
      // Per-player clash counters (drive achSteadyDefender / achMercilessAttacker).
      const attackerMeta = state.players.find((p) => p.color === pc.attacker);
      const defenderMeta = state.players.find((p) => p.color === defenderColor);
      const aCount = state.clash?.attackerPresses ?? 0;
      const dCount = state.clash?.defenderPresses ?? 0;

      if (continues) {
        // INTERMEDIATE round: the defender that lost this round goes home now, the
        // ledger advances, and the next round waits for the result card. No
        // executeMove / recordMove / applyMoveOutcome / piece_moved here: those
        // belong to the move as a whole and run ONCE, when the chain ends. Emitting
        // piece_moved mid-chain would also schedule the next bot turn inside the
        // card freeze.
        if (attackerMeta) attackerMeta.stats.clashAttacksWon++;
        if (defenderPiece) {
          defenderPiece.step = 0;
          defenderPiece.isInBase = true;
          defenderPiece.isInGoal = false;
        }
        pc.beatenDefenderIds = [...ledger.beaten, defenderPieceId];
        pc.remainingDefenderIds = ledger.remaining.slice(1);
        pc.round = ledger.round + 1;
        // The round's clash is over; the next round's startClash writes a fresh one
        // with its own keys, countdown and press window.
        delete state.clash;
        // The SHORT gap: the client's result card, then the kick-back animation.
        state.resultCardUntil = Date.now() + CLASH_RESULT_MS;
        const paused = Boolean(state.paused);
        await this.store.saveGameState(gameId, state);

        // A paused chain publishes NOTHING further: it waits for the dropped seat.
        // What starts the next round is that seat's reconnect, or the sweep a
        // moment after the game unpauses (see startNextRound); never a timer armed
        // in here.
        if (paused) return;

        this.emit({
          type: 'clash_result',
          gameId,
          winner: pc.attacker,
          loser: defenderColor,
          winnerPresses: aCount,
          loserPresses: dCount,
          round: ledger.round,
          totalRounds: ledger.totalRounds,
          continues: true,
          defenderPieceId,
          remainingDefenderIds: [...pc.remainingDefenderIds],
        });
        this.armChainTimer(gameId, CLASH_RESULT_MS);
        return;
      }

      if (attackerWon) {
        if (attackerMeta) attackerMeta.stats.clashAttacksWon++;
      } else {
        if (defenderMeta) defenderMeta.stats.clashDefends++;
      }
      const pendingMove = {
        pieceId: pc.pieceId,
        from: pc.from,
        to: pc.to,
        // NEVER isCapture: every beaten defender of the chain is already at step 0,
        // so the square no longer holds the wall that was there at move time and
        // re-deriving the capture would report nothing (or, worse, only the last
        // defender). The ledger below is applied explicitly instead.
        isCapture: false,
        isHomeEntry: pc.enteredHome,
        // The defenders stamped when the clash began: 1 for a single piece, R for a
        // wall. A full clear sends exactly that many home, so the count describes
        // the move that was chosen.
        captureCount: pc.capturedPieceIds.length,
      };

      const result = MoveValidator.executeMove(state, pendingMove, pc.diceValue);
      if (!attackerWon) {
        // REPULSE: the attacker's piece goes home and the defender holds the
        // square. executeMove walked the mover to `to` with isCapture=false, so
        // re-home it and report the piece as captured by its own failed attack.
        // Defenders already beaten in earlier rounds stay home: the trade stands.
        const moverPiece = state.pieces.find((p) => p.id === pc.pieceId);
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
        // FINAL APPLICATION: the ledger decides who goes home, not the board. A
        // legacy capture (R = 1, no ledger) sends its whole recorded stack home
        // here, exactly as it did before the chain existed.
        const capturedIds = [...ledger.beaten, ...ledger.remaining];
        for (const id of capturedIds) {
          const captured = state.pieces.find((p) => p.id === id);
          if (!captured) continue;
          captured.step = 0;
          captured.isInBase = true;
          captured.isInGoal = false;
        }
        result.captured = capturedIds.length > 0;
        result.capturedPieceIds = capturedIds;
        result.bonusRoll = pc.diceValue === 6 || result.captured;
        if (attackerMeta) {
          if (capturedIds.length > 0) attackerMeta.stats.captures += capturedIds.length;
          // The Barrier Buster credit (achTearDownThisWall): the battles of this move
          // that stood 2 or more defenders, stamped on pendingCapture at move time.
          // Only a chain won END TO END reaches this branch — a repulse leaves the
          // wall standing. `?? 0` keeps a seat record written before the field existed
          // from turning the tally into NaN.
          if (pc.barrierBattles) {
            attackerMeta.stats.barrierBreaks =
              (attackerMeta.stats.barrierBreaks ?? 0) + pc.barrierBattles;
          }
        }
        result.clashOutcome = 'attacker_won';
      }

      // Record history, apply the outcome, then clear clash + pendingCapture on
      // the same object so everything lands in one save.
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
      // Freeze all input while the result card shows (covers human and hotseat;
      // bots are already frozen by the scheduler's clash-card delay).
      state.resultCardUntil = Date.now() + CLASH_RESULT_FREEZE_MS;
      await this.store.saveGameState(gameId, state);

      this.emit({ type: 'piece_moved', gameId, result });
      this.emit({
        type: 'clash_result',
        gameId,
        winner: attackerWon ? pc.attacker : defenderColor,
        loser: attackerWon ? defenderColor : pc.attacker,
        winnerPresses: attackerWon ? aCount : dCount,
        loserPresses: attackerWon ? dCount : aCount,
        // A single-defender clash reports 1/1 and a finished chain (continues
        // false), so the client reads one shape for both.
        round: ledger.round,
        totalRounds: ledger.totalRounds,
        continues: false,
        defenderPieceId,
        remainingDefenderIds: [],
      });
    });
  }

  // Arm the chain's next round after `delayMs`. One timer per game: a re-arm
  // replaces the pending one instead of stacking a second.
  private armChainTimer(gameId: string, delayMs: number): void {
    const existing = this.chainTimers.get(gameId);
    if (existing) clearTimeout(existing);
    this.chainTimers.set(
      gameId,
      setTimeout(() => {
        this.chainTimers.delete(gameId);
        void this.startNextRound(gameId).catch((err) =>
          console.error('[clash] next round failed', gameId, err),
        );
      }, Math.max(0, delayMs)),
    );
  }

  // Start the next round of a chain, from the ledger. This is the ONE entry point
  // for a chain that is between rounds: the gap timer, the boot re-arm, the 5s
  // sweep, and a reconnect that resumes a paused chain all call it. The game lock
  // plus a re-read of the ledger make a duplicate call a no-op (the second one
  // finds a live clash and returns).
  async startNextRound(gameId: string): Promise<void> {
    return this.withGameLock(gameId, async () => {
      const state = await this.store.loadGameState(gameId);
      if (!state || state.status !== 'active') return;
      // A live clash (or a chain the resolution already finished) is not waiting
      // for a round.
      if (state.clash) return;
      // A paused chain belongs to the seat that dropped: its reconnect is what
      // resumes it, so the sweep must leave it alone.
      if (state.paused) return;
      const pc = state.pendingCapture;
      if (!pc) return;

      const ledger = chainLedgerOf(pc);
      const defenderPieceId = ledger.remaining[0];
      const defenderPiece = state.pieces.find((p) => p.id === defenderPieceId);
      if (!defenderPiece || ledger.round > ledger.totalRounds) return;
      // The round that just resolved stamped the result-card gap: starting the
      // next round on top of its card would cut the kick-back animation. Re-arm
      // for the rest of the gap instead (the re-check above keeps this idempotent).
      const gap = (state.resultCardUntil ?? 0) - Date.now();
      if (gap > 0) {
        this.armChainTimer(gameId, gap);
        return;
      }

      const defenderColor = defenderPiece.color as PlayerColor;
      // The ledger stays the single source of truth for who this round fights.
      pc.defender = defenderColor;
      state.pendingCapture = pc;
      await this.store.saveGameState(gameId, state);

      const attackerIsBot = state.players.find((p) => p.color === pc.attacker)?.isBot ?? false;
      const defenderIsBot = state.players.find((p) => p.color === defenderColor)?.isBot ?? false;
      await this.startClash(gameId, pc.attacker, defenderColor, attackerIsBot, defenderIsBot, {
        round: ledger.round,
        totalRounds: ledger.totalRounds,
        defenderPieceId,
        remainingDefenderIds: ledger.remaining,
      });
    });
  }

  // Bot mashing at a human-realistic jittered pace. The caller pre-rolls the
  // winner: it presses fast (CLASH_BOT_WIN_MS_BASE ± jitter) and the loser slow
  // (CLASH_BOT_LOSE_MS_BASE ± jitter), so the winner reaches target first.
  // `armedRound` is the round this presser belongs to: inside a chain the next
  // round is a fresh clash with its own keys and window, so a chain left over
  // from the previous round must not press into it (its press cap alone would
  // not stop it in a back-to-back chain).
  private simulateBotPressers(
    gameId: string,
    botColor: PlayerColor,
    winner: boolean,
    armedRound = 1,
  ): void {
    const schedulePress = () => {
      const base = winner ? CLASH_BOT_WIN_MS_BASE : CLASH_BOT_LOSE_MS_BASE;
      const delay = base + Math.random() * CLASH_BOT_JITTER_MS;
      setTimeout(() => {
        void (async () => {
          try {
            const cur = await this.store.loadGameState(gameId);
            if (!cur || cur.status !== 'active' || !cur.clash) return; // resolved
            if ((cur.clash.round ?? 1) !== armedRound) return; // a later round
            if (Date.now() >= cur.clash.pressDeadline) return; // timeout handles it

            // No lock here: this chain is armed from inside the lock and
            // recordClashPress would re-enter it and deadlock. The single chain
            // plus the press cap make the counting idempotent.
            const count = await this.store.recordClashPress(gameId, botColor);
            // Broadcast so every client's bars advance live (the store does not
            // publish; human presses get there via ClashManager).
            this.emit({ type: 'clash_press', gameId, color: botColor, presses: count });
            if (count >= CLASH_TARGET) {
              // Early win: schedule outside any lock (resolveClashOutcome self-locks).
              setTimeout(() => void this.resolveClashOutcome(gameId, botColor), 0);
              return;
            }
          } catch (err) {
            console.error(`[clash] bot press ERROR ${gameId}/${botColor}:`, err);
            return; // Never re-arm on persistent failure: the sweep cleans up.
          }
          schedulePress();
        })();
      }, delay);
    };
    schedulePress();
  }
}




