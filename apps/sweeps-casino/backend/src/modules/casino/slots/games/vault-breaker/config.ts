import { GameConfig, MultiplierProgression } from '../../engine/types';
import { VAULT_BREAKER_SYMBOLS } from './symbols';
import { VAULT_BREAKER_PAYLINES } from './paylines';
import { VAULT_BREAKER_PAYTABLE } from './paytable';
import { VAULT_BREAKER_REEL_STRIPS } from './reel-strips';

const REELS = 5;
const ROWS = 4;

// scatterCount -> free spins awarded, per the design spec (3=8, 4=10, 5=12).
const FREE_SPINS_AWARDED: Record<number, number> = { 3: 8, 4: 10, 5: 12 };

// Persistent free-spins multiplier: 1x -> 2x -> 3x -> ... capped at 10x.
// The cap is a deliberate, documented design choice (the spec left the
// exact ceiling open — "or use another mathematically validated
// progression") to bound the theoretical max win to a sane, simulatable
// number; raise it only after re-running simulate.ts.
const FREE_SPINS_MULTIPLIER: MultiplierProgression = {
  startMultiplier: 1,
  step: (current) => current + 1,
  maxMultiplier: 10,
};

// Base spin needs 1 float/reel = 5. Free spins can award at most 12 spins
// (5-scatter trigger), each needing another 5 floats = 60. 5 + 60 = 65,
// rounded up for headroom — one (serverSeed, clientSeed, nonce) covers the
// whole round (base + full bonus sequence) deterministically, so the round
// is verifiable as a single unit like every other game in this codebase.
const MAX_FLOATS_PER_ROUND = 70;

export const VAULT_BREAKER_CONFIG: GameConfig = {
  gameKey: 'vault-breaker',
  reels: REELS,
  rows: ROWS,
  paylines: VAULT_BREAKER_PAYLINES,
  reelStrips: VAULT_BREAKER_REEL_STRIPS,
  symbols: VAULT_BREAKER_SYMBOLS,
  paytable: VAULT_BREAKER_PAYTABLE,
  wildSymbolId: 'WILD',
  scatterSymbolId: 'SCATTER',
  freeSpins: { minScatterCount: 3, spinsAwarded: FREE_SPINS_AWARDED },
  freeSpinsMultiplier: FREE_SPINS_MULTIPLIER,
  minBet: '0.20',
  maxBet: '100.00',
  // Reel strips + paytable already target ~96% RTP on their own merits
  // (see simulate.ts) — no further haircut stacked on top, unlike
  // Originals' formula-derived games which apply houseEdgeBps to an
  // otherwise-fair result. Revisit only after simulation shows the tuned
  // math needs a small adjustment to land exactly on target.
  houseEdgeBps: 0,
  maxFloatsPerRound: MAX_FLOATS_PER_ROUND,
};
