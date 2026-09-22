/**
 * Weighted reel-strip generation. `SYMBOL_WEIGHTS` is the single source of
 * truth for symbol frequency (a symbol with weight 6 appears 6 times in
 * the strip, weight 1 appears once) — this is what actually determines hit
 * frequency and RTP, not the paytable alone. The five strips are built
 * from the same weight table but shuffled with different (fixed, code-
 * documented) seeds so the reels don't all show the same symbol order,
 * while staying fully deterministic and reviewable — nothing here is
 * randomized at runtime; this file's output is static game config, generated
 * once when the module loads.
 *
 * These weights are a starting point for `simulate.ts` to validate against
 * the ~96% RTP / high-volatility design target, not a final verified
 * table — see paytable.ts's header comment.
 */

const SYMBOL_WEIGHTS: Record<string, number> = {
  TEN: 6,
  JACK: 6,
  QUEEN: 5,
  KING: 5,
  ACE: 4,
  COIN_STACK: 4,
  LASER_DEVICE: 3,
  VAULT_KEY: 3,
  DIAMOND: 2,
  GOLD_BAR: 2,
  VAULTLINE_EMBLEM: 1,
  WILD: 2,
  SCATTER: 1,
};

/** mulberry32 — tiny deterministic PRNG, used only to shuffle this static config at module-load time (never for round outcomes). */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildStrip(seed: number): string[] {
  const bag: string[] = [];
  for (const [symbol, weight] of Object.entries(SYMBOL_WEIGHTS)) {
    for (let i = 0; i < weight; i++) bag.push(symbol);
  }
  const rand = mulberry32(seed);
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

// Fixed per-reel seeds — arbitrary but constant, so the strips never change
// between server restarts/deploys (they're baked into this file's export,
// evaluated once at module load).
export const VAULT_BREAKER_REEL_STRIPS: string[][] = [1, 2, 3, 4, 5].map((seed) => buildStrip(seed * 7919));

export { SYMBOL_WEIGHTS as VAULT_BREAKER_SYMBOL_WEIGHTS };
