import type { RedisGameStore } from './redis';
import type { ClashManager } from './clash';
import {
  CLASH_SWEEP_GRACE_MS,
  CLASH_TARGET,
  CLASH_RESULT_MS,
  CLASH_RESULT_FREEZE_MS,
  CARD_HOLD_MIN_MS,
  CLASH_BOT_FAST_VS_BOT,
  CLASH_BOT_FAST_VS_HUMAN,
} from './clash';
import { MoveValidator } from './move-validator';
import { applyMoveOutcome } from './turn';
import { BARRIER_BUSTER_TOKEN_CAP } from './types';
import { createRng, seedFrom } from './rng';
import type { Rng } from './rng';
import { botPace, botPressTimes } from './clash-pace';
import type { BotPace } from './clash-pace';
import type {
  PlayerColor,
  GameEvent,
  GameState,
  ClashState,
  PendingCapture,
  PieceId,
  ChainRound,
} from './types';

// Cadence of the clash recovery sweep (re-arms stale phase timers).
import { CLASH_PRESS_MS, CLASH_SWEEP_INTERVAL_MS } from './timing';

// The chain ledger, read from a deferred capture as plain arrays so one round
// resolves without changing the persisted shape. A capture written before the
// chain has no ledger and resolves as one round that sends the stack home.
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

// ClashEngine owns the clash QTE: phase timers, boot recovery, bot pressers,
// presses and deferred-capture resolution. LudoEngine injects the game lock and
// emit hook, so serialization and the event stream stay single-owned.
export class ClashEngine {
  // One timeout per live clash: resolves by most presses once the window ends.
  private clashTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // One timer per game for a chain's inter-round gap: while a round's result card
  // shows there is no live clash, so this is the timer that starts the next one.
  private chainTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Result-card release handshake: the card, the users allowed to report on it and
  // who already did. Keyed by game; a receipt can only shorten `resultCardUntil`.
  // Memory only, so a restart drops the handshake and the ceiling takes over.
  private cardHolds = new Map<
    string,
    { id: string; users: Set<string>; ready: Set<string>; midChain: boolean }
  >();

  constructor(
    private store: RedisGameStore,
    private clashManager: ClashManager,
    private emit: (event: GameEvent) => void,
    private withGameLock: <T>(gameId: string, fn: () => Promise<T>) => Promise<T>,
    // Entropy for a clash: its keys, the bot pre-rolls and the press jitter.
    // LudoEngine passes its own source in, so one harness generator steers the
    // whole write path; standalone callers keep the global.
    private random: Rng = Math.random,
  ) {}

  // Start the QTE and arm its phase timers. Bot pressers begin exactly at
  // press-phase start, because they press their own side instead of hunting keys:
  // each bot side is handed a pace profile (fast 38 presses / casual 33, see
  // clash-pace.ts) and paces itself from the window's real opening. The profile
  // also fixes its reaction pause — 120 ms for a touch-typist, 500 ms of choice
  // reaction for a casual one — so the hesitation is a constant, not a draw.
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
    // One generator per clash, seeded once here and carried through the key draws
    // (inside the manager), the switch schedule and the bot presses, so a round's
    // whole random shape replays from a single seed.
    const rng = createRng(seedFrom(this.random));
    await this.clashManager.startClash(gameId, attacker, defender, info, rng);
    this.armClashPhaseTimers(gameId, (pressStartAt) => {
      if (!attackerIsBot && !defenderIsBot) return;
      const round = info?.round ?? 1;
      if (attackerIsBot && defenderIsBot) {
        // The ASSIGNMENT is drawn, not the outcome: one side runs the fast
        // profile and the other the casual one, so a bot-vs-bot chain does not
        // always favour the attacker.
        const attackerFast = rng() < CLASH_BOT_FAST_VS_BOT;
        this.simulateBotPressers(
          gameId,
          attacker,
          botPace(attackerFast ? 'fast' : 'casual'),
          round,
          pressStartAt,
          rng,
        );
        this.simulateBotPressers(
          gameId,
          defender,
          botPace(attackerFast ? 'casual' : 'fast'),
          round,
          pressStartAt,
          rng,
        );
      } else {
        const botSide = attackerIsBot ? attacker : defender;
        const fast = rng() < CLASH_BOT_FAST_VS_HUMAN;
        this.simulateBotPressers(
          gameId,
          botSide,
          botPace(fast ? 'fast' : 'casual'),
          round,
          pressStartAt,
          rng,
        );
      }
    });
  }

  // Arm the announce/countdown/press timers off the deadlines ClashManager
  // already persisted. The delays are computed against `now`, so a re-arm after
  // a restart resumes a clash mid-phase instead of restarting its window.
  private armClashPhaseTimers(
    gameId: string,
    // Called when the press phase opens, with the absolute time it opened: bot
    // pressers schedule against that anchor, not against the timer's own firing
    // moment, so a late phase flip cannot shift their whole schedule.
    onPressStart?: (pressStartAt: number) => void,
  ): void {
    const existing = this.clashTimers.get(gameId);
    if (existing) clearTimeout(existing);

    void this.store.loadClashState(gameId).then((clash) => {
      if (!clash) return;
      const now = Date.now();
      // The round these timers belong to. A chain writes a new clash every round,
      // so a timer armed for round N must not act on round N+1. Each callback
      // bails when the live round is no longer its own.
      const armedRound = clash.round ?? 1;
      const schedule = (delay: number, fn: () => Promise<void>) => {
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
      const scheduleUnlocked = (delay: number, fn: () => Promise<void>) => {
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
        if (st?.clash?.phase !== 'announce') return;
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
        if (st?.clash?.phase !== 'countdown') return;
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
        // The window opens exactly at the deadline the state carries, so that is
        // the anchor handed to the pressers (a bot pays its reaction from here).
        onPressStart?.(st.clash.pressDeadline - CLASH_PRESS_MS);
      });
      // press -> resolve
      scheduleUnlocked(Math.max(0, clash.pressDeadline - now), () =>
        this.resolveClashOnTimeout(gameId, armedRound),
      );
    });
  }

  // Boot-time re-arm: rebuild the phase timers from the persisted deadlines of
  // every active game with a clash. This is the clash half of the wake pass, so
  // the QTE resumes where it stopped.
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
          void this.startNextRound(gameId).catch((err) => {
            console.error('[clash] re-arm next round failed', gameId, err);
          });
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
              if (st?.status !== 'active') continue;
              // A chain between rounds has no live clash but keeps its ledger. The
              // sweep is the backstop for a gap timer that never fired, and it picks
              // the chain up after a paused seat reconnects.
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

  // Timeout fallback: most presses wins; a tie goes to the attacker. Routine early
  // returns log nothing so the 5 s sweep stays quiet. `armedRound` makes a leftover
  // timer a no-op instead of an early resolve.
  private async resolveClashOnTimeout(gameId: string, armedRound?: number): Promise<void> {
    try {
      const state = await this.store.loadGameState(gameId);
      if (state?.status !== 'active') return;
      const clash: ClashState | undefined = state.clash;
      if (!clash) return;
      if (armedRound !== undefined && (clash.round ?? 1) !== armedRound) return;
      if (clash.phase !== 'pressing') return;
      // The press-deadline timer can fire a tick before its stamp: the delay uses
      // Date.now() while the timer runs on the event loop clock, which can be ahead.
      // A timer-armed call re-arms the remainder; the sweep passes no round.
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

  // Re-arm a press deadline that arrived slightly early, plus 1 ms so the retry
  // clears the same comparison. This uses the game's pending-clash timer slot, and
  // the callback carries its round, so a retry cannot act on a later round.
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
    count = 1,
  ): Promise<number> {
    return this.withGameLock(gameId, async () => {
      const meter = await this.clashManager.recordPress(gameId, color, key ?? '', isBot, count);
      if (meter >= CLASH_TARGET) {
        setTimeout(() => void this.resolveClashOutcome(gameId, color), 0);
      }
      return meter;
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
      if (state?.status !== 'active') return;
      const pc = state.pendingCapture;
      if (!pc) return;

      const attackerWon = pc.attacker === winner;
      // The round's defender, not the capture's first defender: a chain can fight
      // a different colour every round (a mixed square), and the frames must name
      // whoever actually lost this round.
      const ledger = chainLedgerOf(pc);
      const defenderPieceId = ledger.remaining[0] ?? '';
      const defenderPiece = state.pieces.find((p) => p.id === defenderPieceId);
      const defenderColor = defenderPiece?.color ?? pc.defender;
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
        // INTERMEDIATE round: the defender goes home, the ledger advances, and the
        // next round waits for the card. The move-level calls (executeMove, recordMove,
        // applyMoveOutcome, piece_moved) run once when the chain ends, never here.
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
        // The card a client is about to show, and the users who may report on it.
        const cardId = this.cardIdFor(pc.attacker, defenderColor, state.moveCounter);
        this.armCardHold(state, cardId, [pc.attacker, defenderColor], true);
        const paused = Boolean(state.paused);
        await this.store.saveGameState(gameId, state);

        // A paused chain publishes nothing further: it waits for the dropped seat.
        // Its reconnect, or the sweep after unpause, starts the next round (see
        // startNextRound); never a timer armed here.
        if (paused) return;

        this.emit({
          type: 'clash_result',
          gameId,
          cardId,
          attacker: pc.attacker,
          winner: pc.attacker,
          loser: defenderColor,
          winnerPresses: aCount,
          loserPresses: dCount,
          round: ledger.round,
          totalRounds: ledger.totalRounds,
          resultCardUntil: state.resultCardUntil,
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
        // Never isCapture: every beaten defender is already at step 0, so re-deriving
        // the capture would report nothing or only the last defender. The ledger
        // below is applied explicitly instead.
        isCapture: false,
        isHomeEntry: pc.enteredHome,
        // The defenders stamped when the clash began: 1 for a single piece, R for a
        // wall. A full clear sends exactly that many home, so the count describes
        // the move that was chosen.
        captureCount: pc.capturedPieceIds.length,
      };

      const result = MoveValidator.executeMove(state, pendingMove, pc.diceValue);
      if (!attackerWon) {
        // REPULSE: the attacker goes home and the defender holds the square.
        // executeMove walked the mover to `to` with isCapture=false, so re-home it and
        // report it captured by its own failed attack. Earlier defenders stay home.
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
          // The Barrier Buster credit (achTearDownThisWall): 1 when the landing square
          // stood 2 or more defenders, stamped at move time. Only a chain won end to end
          // reaches here. `?? 0` keeps an older seat record from turning the tally to NaN.
          if (pc.barrierBattles) {
            attackerMeta.stats.barrierBreaks =
              (attackerMeta.stats.barrierBreaks ?? 0) + pc.barrierBattles;
          }
          // Token income: a clash won against exactly one defender pays one token
          // back, up to the cap. A won barrier pays nothing. Same branch as the credit
          // above, so the money and the tally cannot drift apart.
          if (capturedIds.length === 1) {
            attackerMeta.barrierTokens = Math.min(
              BARRIER_BUSTER_TOKEN_CAP,
              (attackerMeta.barrierTokens ?? 0) + 1,
            );
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
      // bots are already frozen by the scheduler's clash-card delay). The handshake
      // can shorten this to the clients' own forecasts; the ceiling is the net.
      state.resultCardUntil = Date.now() + CLASH_RESULT_FREEZE_MS;
      const cardId = this.cardIdFor(pc.attacker, defenderColor, state.moveCounter);
      this.armCardHold(state, cardId, [pc.attacker, defenderColor], false);
      await this.store.saveGameState(gameId, state);

      this.emit({ type: 'piece_moved', gameId, result });
      // A won chain can move the attacker's hand (a lone defender pays one token
      // back, a wall pays nothing) and a chain also ends any staged capture, so the
      // clients get a full-state frame to refresh the token column.
      this.emit({ type: 'state_update', gameId, state });
      this.emit({
        type: 'clash_result',
        gameId,
        cardId,
        // The attacker is named even when they LOST this round: the client picks the
        // shield gesture from `winner !== attacker`, and the seat colour of the card
        // from it.
        attacker: pc.attacker,
        winner: attackerWon ? pc.attacker : defenderColor,
        loser: attackerWon ? defenderColor : pc.attacker,
        winnerPresses: attackerWon ? aCount : dCount,
        loserPresses: attackerWon ? dCount : aCount,
        // A single-defender clash reports 1/1 and a finished chain (continues
        // false), so the client reads one shape for both.
        round: ledger.round,
        totalRounds: ledger.totalRounds,
        resultCardUntil: state.resultCardUntil,
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
      setTimeout(
        () => {
          this.chainTimers.delete(gameId);
          void this.startNextRound(gameId).catch((err) => {
            console.error('[clash] next round failed', gameId, err);
          });
        },
        Math.max(0, delayMs),
      ),
    );
  }

  // The result card's id: the two seats by colour plus the move counter, which
  // separates repeated clashes between the same pair. The game is the hold map's
  // key, so it is not repeated here.
  private cardIdFor(attacker: PlayerColor, defender: PlayerColor, moveCounter: number): string {
    return `${attacker}-${defender}-${moveCounter}`;
  }

  // Record the result card a client is about to show. `seats` are the two sides of
  // the clash; their NON-BOT owners (by user id, so hotseat collapses to one) are the
  // clients that may report. An empty set (bot against bot) keeps the short card.
  private armCardHold(
    state: GameState,
    cardId: string,
    seats: PlayerColor[],
    midChain: boolean,
  ): void {
    const users = new Set<string>();
    for (const color of seats) {
      const seat = state.players.find((p) => p.color === color);
      if (seat?.isBot) continue;
      if (seat?.userId) users.add(seat.userId);
    }
    const ceiling = midChain ? CLASH_RESULT_MS : CLASH_RESULT_FREEZE_MS;
    state.resultCardUntil = Math.min(
      state.resultCardUntil ?? Number.MAX_SAFE_INTEGER,
      Date.now() + (users.size === 0 ? CLASH_RESULT_MS : ceiling),
    );
    this.cardHolds.set(state.id, { id: cardId, users, ready: new Set(), midChain });
  }

  // A client's forecast for its own card ("done in holdMs"). Clamped to a minimum
  // only, so a receipt never extends the wait, and accepted only from a live user
  // seated in that card. Once every participant reports, the engine releases.
  async holdCard(gameId: string, userId: string, cardId: string, holdMs: number): Promise<boolean> {
    let released = false;
    let midChain = false;
    await this.withGameLock(gameId, async () => {
      const state = await this.store.loadGameState(gameId);
      if (state?.status !== 'active') return;
      const hold = this.cardHolds.get(gameId);
      // A stale or unknown card (an old round, a resolved game, a crafted id) is
      // dropped silently: the ceiling is still doing its job.
      if (hold?.id !== cardId) return;
      // A HOTSEAT card has no user ids: join-manager leaves them undefined for local
      // seats, so there is nobody to authorise. The card runs on the short ceiling and
      // ignores receipts; without this guard every local receipt threw and logged.
      if (hold.users.size === 0) return;
      if (!hold.users.has(userId)) throw new Error('Not a participant of this clash');
      hold.ready.add(userId);
      const asked = Math.min(
        Math.max(Math.round(holdMs) || 0, CARD_HOLD_MIN_MS),
        CLASH_RESULT_FREEZE_MS,
      );
      const ceiling = state.resultCardUntil ?? Date.now() + asked;
      state.resultCardUntil = Math.min(ceiling, Date.now() + asked);
      await this.store.saveGameState(gameId, state);
      if (![...hold.users].every((u) => hold.ready.has(u))) return;
      this.cardHolds.delete(gameId);
      released = true;
      midChain = hold.midChain;
      this.emit({ type: 'clash_card_released', gameId, resultCardUntil: state.resultCardUntil });
    });
    // A mid-chain card gates the next round through the stored gap, so the chain's
    // one entry point re-arms against the shortened deadline. Outside the lock, and
    // the gap timer it replaces is cancelled so the round cannot be started twice.
    if (released && midChain) {
      const timer = this.chainTimers.get(gameId);
      if (timer) clearTimeout(timer);
      this.chainTimers.delete(gameId);
      setImmediate(() => void this.startNextRound(gameId).catch(() => undefined));
    }
    return released;
  }

  // Start the next round of a chain from the ledger. This is the one entry point
  // between rounds: the gap timer, the boot re-arm, the 5s sweep and a reconnect
  // all call it. The game lock and a ledger re-read make a duplicate call a no-op.
  async startNextRound(gameId: string): Promise<void> {
    return this.withGameLock(gameId, async () => {
      const state = await this.store.loadGameState(gameId);
      if (state?.status !== 'active') return;
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

      const defenderColor = defenderPiece.color;
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

  // Bot mashing at a fitted human pace. `pace` is the profile — 38 presses on
  // fast, 33 on casual — and botPressTimes owns the whole shape (the profile's
  // constant reaction pause, the opening ramp, jitter as the mash tempo, one
  // stumble), so the COUNT is what the profile says rather than a side effect of
  // an interval. `armedRound` keeps a previous round's presser out of the next.
  // `startAt` anchors the schedule to the press window's real opening, and each
  // timer targets an absolute time on that anchor, so a late hop shortens the next
  // wait instead of pushing the rest of the schedule out of the window. `rng` is
  // the clash's own generator, so the pacing replays with the round.
  private simulateBotPressers(
    gameId: string,
    botColor: PlayerColor,
    pace: BotPace,
    armedRound = 1,
    startAt = Date.now(),
    rng: Rng = createRng(seedFrom(this.random)),
  ): void {
    const times = botPressTimes(pace, startAt, rng);
    let next = 0;
    const schedulePress = () => {
      if (next >= times.length) return;
      // Re-anchored every hop: a press that lands late shortens the next wait
      // instead of pushing the rest of the schedule back with it.
      const delay = Math.max(0, times[next] - Date.now());
      setTimeout(() => {
        void (async () => {
          try {
            const cur = await this.store.loadGameState(gameId);
            if (cur?.status !== 'active' || !cur.clash) return; // resolved
            if ((cur.clash.round ?? 1) !== armedRound) return; // a later round
            if (Date.now() >= cur.clash.pressDeadline) return; // timeout handles it

            // No lock here: this chain is armed from inside the lock and
            // recordClashPress would re-enter it and deadlock. The single chain
            // plus the press cap make the counting idempotent. This call also
            // bypasses CLASH_PRESS_CAP_MS (the cap lives in ClashManager), which is
            // why the fast base is 111 and not something under it.
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
          next += 1;
          schedulePress();
        })();
      }, delay);
    };
    schedulePress();
  }
}
