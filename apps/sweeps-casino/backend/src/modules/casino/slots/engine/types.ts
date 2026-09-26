import { SymbolDef } from './symbols';

/** A payline is one row-index per reel, read left-to-right. */
export type Payline = number[];

/** payout[symbolId][matchCount] = multiplier of TOTAL bet (not bet-per-line). */
export type Paytable = Record<string, Record<number, number>>;

export interface FreeSpinsTrigger {
  /** Minimum scatter count anywhere on the grid that arms free spins at all. */
  minScatterCount: number;
  /** scatterCount -> number of free spins awarded. */
  spinsAwarded: Record<number, number>;
}

/**
 * Free-spins persistent multiplier progression. `startMultiplier` applies to
 * the first free spin. After each free spin that pays a nonzero win, the
 * multiplier advances via `progression` for every *subsequent* spin (the
 * win that triggered the step is paid at the multiplier active going into
 * that spin, not the stepped-up one).
 */
export interface MultiplierProgression {
  startMultiplier: number;
  /** step(currentMultiplier) -> next multiplier, applied after a winning free spin. */
  step: (current: number) => number;
  /** Hard ceiling so the progression can't run away in an unbounded config. */
  maxMultiplier: number;
}

export interface GameConfig {
  gameKey: string;
  reels: number;
  rows: number;
  paylines: Payline[];
  reelStrips: string[][];
  symbols: Record<string, SymbolDef>;
  paytable: Paytable;
  wildSymbolId: string | null;
  scatterSymbolId: string | null;
  freeSpins: FreeSpinsTrigger | null;
  freeSpinsMultiplier: MultiplierProgression | null;
  minBet: string;
  maxBet: string;
  /**
   * House-edge haircut applied to every payout, same convention as
   * Originals' houseEdgeBps (basis points, e.g. 400 = 4%). The raw
   * paytable/reel-strip math should already target ~96% RTP on its own;
   * this is layered on top like every other game in this codebase, so the
   * *credited* RTP is slightly below the *fair* RTP the reel math implies —
   * keep this small (or 0) once the reel strips are actually simulated and
   * tuned, since stacking a further haircut on top of tuned math will pull
   * the observed RTP below the ~96% design target. Currently 0 — see
   * simulate.ts's run before changing this.
   */
  houseEdgeBps: number;
  /** Max floats a single round could ever need (base spin + max free spins), so one seed/nonce covers the whole round deterministically. */
  maxFloatsPerRound: number;
}
