import { dealGrid, Grid } from './reels';
import { evaluatePaylines, evaluateScatter, scatterPayout, PaylineWin, ScatterResult } from './payline-evaluator';
import { GameConfig } from './types';

export interface SpinResult {
  grid: Grid;
  stops: number[];
  paylineWins: PaylineWin[];
  scatter: ScatterResult;
  scatterPayoutMultiplier: number;
  /** Sum of all payline wins + scatter payout, as a multiplier of total bet, BEFORE any free-spins multiplier is applied. */
  rawWinMultiplier: number;
  /** rawWinMultiplier * whatever multiplier was in effect for this spin (1 for the base spin, the current free-spins multiplier during bonus). */
  appliedMultiplier: number;
  win: boolean;
}

export interface FreeSpinsResult {
  spinsAwarded: number;
  spins: SpinResult[];
  /** The persistent multiplier value that was in effect for each spin, same length/order as `spins`. */
  multiplierPerSpin: number[];
  /** Multiplier value the progression ended on (informational). */
  finalMultiplier: number;
  totalMultiplier: number;
}

export interface RoundResult {
  base: SpinResult;
  bonusTriggered: boolean;
  freeSpins: FreeSpinsResult | null;
  /** base.appliedMultiplier + (freeSpins?.totalMultiplier ?? 0) — the number the caller multiplies bet by for the credited win. */
  totalMultiplier: number;
  win: boolean;
  floatsConsumed: number;
}

function runSpin(config: GameConfig, floats: number[], floatOffset: number, multiplierInEffect: number) {
  const { grid, stops, floatsConsumed } = dealGrid(config, floats, floatOffset);
  const paylineWins = evaluatePaylines(grid, config);
  const scatter = evaluateScatter(grid, config);
  const scatterMult = scatterPayout(scatter, config);
  const rawWinMultiplier =
    paylineWins.reduce((sum, w) => sum + w.payoutMultiplier, 0) + scatterMult;
  const appliedMultiplier = rawWinMultiplier * multiplierInEffect;
  const result: SpinResult = {
    grid,
    stops,
    paylineWins,
    scatter,
    scatterPayoutMultiplier: scatterMult,
    rawWinMultiplier,
    appliedMultiplier,
    win: appliedMultiplier > 0,
  };
  return { result, floatsConsumed };
}

/**
 * Runs one full round: the base spin, and — if it triggers — the entire
 * free-spins bonus sequence, all derived deterministically from `floats`
 * (which must have at least `config.maxFloatsPerRound` entries, one seed +
 * nonce's worth). There is no player decision point during free spins (the
 * whole sequence is automatic), so it's safe and correct to resolve the
 * *entire* bonus here in one shot rather than requiring per-spin
 * round-trips — the frontend receives the complete, already-determined
 * sequence and animates through it. This keeps the engine's outcome
 * boundary identical to every other game in this codebase: the server
 * computes the whole result before the client renders anything.
 */
export function playRound(config: GameConfig, floats: number[]): RoundResult {
  let offset = 0;
  const { result: base, floatsConsumed: baseFloats } = runSpin(config, floats, offset, 1);
  offset += baseFloats;

  const trigger = config.freeSpins;
  const scatterCount = base.scatter.count;
  const bonusTriggered = !!trigger && scatterCount >= trigger.minScatterCount;

  let freeSpins: FreeSpinsResult | null = null;
  if (bonusTriggered && trigger && config.freeSpinsMultiplier) {
    const spinsAwarded = trigger.spinsAwarded[scatterCount] ?? trigger.spinsAwarded[trigger.minScatterCount] ?? 0;
    const spins: SpinResult[] = [];
    const multiplierPerSpin: number[] = [];
    let currentMultiplier = config.freeSpinsMultiplier.startMultiplier;

    for (let i = 0; i < spinsAwarded; i++) {
      multiplierPerSpin.push(currentMultiplier);
      const { result, floatsConsumed } = runSpin(config, floats, offset, currentMultiplier);
      offset += floatsConsumed;
      spins.push(result);
      if (result.win) {
        currentMultiplier = Math.min(
          config.freeSpinsMultiplier.maxMultiplier,
          config.freeSpinsMultiplier.step(currentMultiplier),
        );
      }
    }

    const totalMultiplier = spins.reduce((sum, s) => sum + s.appliedMultiplier, 0);
    freeSpins = {
      spinsAwarded,
      spins,
      multiplierPerSpin,
      finalMultiplier: currentMultiplier,
      totalMultiplier,
    };
  }

  const totalMultiplier = base.appliedMultiplier + (freeSpins?.totalMultiplier ?? 0);

  return {
    base,
    bonusTriggered,
    freeSpins,
    totalMultiplier,
    win: totalMultiplier > 0,
    floatsConsumed: offset,
  };
}
