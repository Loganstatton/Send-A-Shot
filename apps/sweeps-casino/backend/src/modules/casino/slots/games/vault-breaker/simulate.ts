/**
 * Headless RTP/hit-frequency simulator for Vault Breaker — no NestJS, no
 * DB, no rendering, just the pure math engine run N times with a fast PRNG
 * standing in for the real HMAC-based provably-fair float derivation
 * (deriveFloats() in libs/provably-fair is cryptographically strong but far
 * too slow to call millions of times here; simulate.ts is testing the GAME
 * MATH's statistical behavior, not the fairness mechanism, so a fast
 * uniform PRNG is the right tool and does not affect the validity of the
 * observed RTP/volatility numbers — those depend only on the reel strips +
 * paytable + paylines, which are identical to production).
 *
 * Run with:
 *   npx ts-node src/modules/casino/slots/games/vault-breaker/simulate.ts [rounds]
 */
import { playRound } from '../../engine/round';
import { VAULT_BREAKER_CONFIG } from './config';

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

function simulate(rounds: number) {
  const rand = mulberry32(0xc0ffee);
  const config = VAULT_BREAKER_CONFIG;

  let totalWagered = 0;
  let totalReturned = 0;
  let hits = 0;
  let bonusTriggers = 0;
  let bonusTotalReturned = 0;
  let maxWinMultiplier = 0;
  const symbolFrequency: Record<string, number> = {};
  const paylineContribution: number[] = new Array(config.paylines.length).fill(0);

  for (let i = 0; i < rounds; i++) {
    const floats: number[] = [];
    for (let f = 0; f < config.maxFloatsPerRound; f++) floats.push(rand());

    const result = playRound(config, floats);
    totalWagered += 1; // bet of 1 unit per round
    totalReturned += result.totalMultiplier;
    if (result.win) hits++;
    if (result.bonusTriggered) {
      bonusTriggers++;
      bonusTotalReturned += result.freeSpins?.totalMultiplier ?? 0;
    }
    if (result.totalMultiplier > maxWinMultiplier) maxWinMultiplier = result.totalMultiplier;

    for (const row of result.base.grid) {
      for (const sym of row) {
        symbolFrequency[sym] = (symbolFrequency[sym] ?? 0) + 1;
      }
    }
    result.base.paylineWins.forEach((w) => {
      paylineContribution[w.paylineIndex] += w.payoutMultiplier;
    });
  }

  const rtp = totalReturned / totalWagered;
  const hitFrequency = hits / rounds;
  const bonusFrequency = bonusTriggers / rounds;
  const avgBonusPayout = bonusTriggers > 0 ? bonusTotalReturned / bonusTriggers : 0;
  const totalSymbolsDealt = rounds * config.reels * config.rows;

  console.log(`\n=== Vault Breaker simulation: ${rounds.toLocaleString()} base rounds ===`);
  console.log(`Observed RTP:            ${(rtp * 100).toFixed(3)}%`);
  console.log(`Hit frequency:           ${(hitFrequency * 100).toFixed(2)}%`);
  console.log(`Bonus (free spins) freq: ${(bonusFrequency * 100).toFixed(3)}% (1 in ${Math.round(1 / bonusFrequency)})`);
  console.log(`Avg bonus payout:        ${avgBonusPayout.toFixed(2)}x bet`);
  console.log(`Max observed win:        ${maxWinMultiplier.toFixed(2)}x bet`);
  console.log(`\nSymbol frequency (base-game deal, ${totalSymbolsDealt.toLocaleString()} symbols dealt):`);
  Object.entries(symbolFrequency)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sym, count]) => {
      console.log(`  ${sym.padEnd(18)} ${((count / totalSymbolsDealt) * 100).toFixed(2)}%`);
    });
  console.log(`\nTop 5 paylines by total contribution:`);
  paylineContribution
    .map((v, idx) => ({ idx, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 5)
    .forEach(({ idx, v }) => console.log(`  Line ${idx}: ${v.toFixed(1)}x total`));
}

const rounds = parseInt(process.argv[2] ?? '1000000', 10);
simulate(rounds);
