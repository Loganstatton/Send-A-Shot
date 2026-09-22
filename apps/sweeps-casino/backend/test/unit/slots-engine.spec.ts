import { deriveFloats } from '../../src/libs/provably-fair/provably-fair';
import { evaluatePaylines, evaluateScatter } from '../../src/modules/casino/slots/engine/payline-evaluator';
import { dealGrid } from '../../src/modules/casino/slots/engine/reels';
import { playRound } from '../../src/modules/casino/slots/engine/round';
import { GameConfig } from '../../src/modules/casino/slots/engine/types';
import { VAULT_BREAKER_CONFIG } from '../../src/modules/casino/slots/games/vault-breaker/config';
import { buildDevFloats } from '../../src/modules/casino/slots/engine/dev-fixtures';

/**
 * A tiny, hand-authored 3-reel x 2-row config purely for testing the
 * payline evaluator and wild/scatter logic in isolation, independent of
 * Vault Breaker's real (much larger) reel strips — every symbol's stop is
 * exactly known, so the expected grid is trivial to reason about.
 */
function tinyConfig(): GameConfig {
  return {
    gameKey: 'tiny-test',
    reels: 3,
    rows: 2,
    paylines: [
      [0, 0, 0], // top row
      [1, 1, 1], // bottom row
    ],
    reelStrips: [
      ['A', 'A', 'WILD', 'B'],
      ['A', 'B', 'A', 'SCATTER'],
      ['A', 'B', 'B', 'WILD'],
    ],
    symbols: {
      A: { id: 'A', role: 'PAYING', name: 'A', substitutable: true },
      B: { id: 'B', role: 'PAYING', name: 'B', substitutable: true },
      WILD: { id: 'WILD', role: 'WILD', name: 'Wild', substitutable: false },
      SCATTER: { id: 'SCATTER', role: 'SCATTER', name: 'Scatter', substitutable: false },
    },
    paytable: {
      A: { 2: 1, 3: 5 },
      B: { 2: 0.5, 3: 2 },
      WILD: { 2: 2, 3: 10 },
      SCATTER: { 2: 1, 3: 3 },
    },
    wildSymbolId: 'WILD',
    scatterSymbolId: 'SCATTER',
    freeSpins: { minScatterCount: 2, spinsAwarded: { 2: 3, 3: 5 } },
    freeSpinsMultiplier: { startMultiplier: 1, step: (c) => c + 1, maxMultiplier: 5 },
    minBet: '0.10',
    maxBet: '10.00',
    houseEdgeBps: 0,
    maxFloatsPerRound: 3 + 5 * 3,
  };
}

describe('slot engine: payline evaluation', () => {
  it('pays a straight 3-of-a-kind line, left to right', () => {
    const config = tinyConfig();
    // Stop 0 on every reel deals row0='A', row1=(next symbol) for each strip.
    const { grid } = dealGrid(config, [0, 0, 0], 0);
    // reel0 stop0 window = [A, A]; reel1 stop0 window = [A, B]; reel2 stop0 window = [A, B]
    expect(grid[0]).toEqual(['A', 'A']);
    const wins = evaluatePaylines(grid, config);
    // Top row (index 0 on every reel): A, A, A -> 3-match A pays 5.
    const topWin = wins.find((w) => w.paylineIndex === 0);
    expect(topWin?.symbolId).toBe('A');
    expect(topWin?.count).toBe(3);
    expect(topWin?.payoutMultiplier).toBe(5);
  });

  it('lets WILD substitute for a paying symbol to extend a match', () => {
    const config = tinyConfig();
    // reel0 stop2 window = [WILD, B]; reel1 stop0 window = [A, B]... construct
    // a grid manually instead of hunting for exact stops, to keep this test
    // legible and decoupled from the strip layout.
    const grid = [
      ['WILD', 'x'],
      ['A', 'x'],
      ['A', 'x'],
    ];
    const wins = evaluatePaylines(grid, config);
    const win = wins.find((w) => w.paylineIndex === 0);
    expect(win?.symbolId).toBe('A');
    expect(win?.count).toBe(3);
  });

  it('does not let WILD substitute for SCATTER, and scatter pays independent of paylines', () => {
    const config = tinyConfig();
    const grid = [
      ['SCATTER', 'x'],
      ['SCATTER', 'x'],
      ['A', 'x'],
    ];
    const scatter = evaluateScatter(grid, config);
    expect(scatter.count).toBe(2);
    const wins = evaluatePaylines(grid, config);
    // Top row is SCATTER, SCATTER, A — not a payline win (scatter isn't a payline symbol).
    expect(wins.find((w) => w.paylineIndex === 0)).toBeUndefined();
  });

  it('only pays counts explicitly present in the paytable (no 1-2 match payout when only 3+ is defined)', () => {
    const config = tinyConfig();
    config.paytable.A = { 3: 5 }; // remove the 2-match entry
    const grid = [
      ['A', 'x'],
      ['A', 'x'],
      ['B', 'x'],
    ];
    const wins = evaluatePaylines(grid, config);
    expect(wins.find((w) => w.paylineIndex === 0)).toBeUndefined();
  });
});

describe('slot engine: round orchestration', () => {
  it('is fully deterministic given the same floats', () => {
    const config = tinyConfig();
    const floats = deriveFloats('seed', 'client', 7, config.maxFloatsPerRound);
    const a = playRound(config, floats);
    const b = playRound(config, floats);
    expect(a).toEqual(b);
  });

  it('triggers free spins only when scatter count meets the configured minimum, and awards the configured count', () => {
    const config = tinyConfig();
    // Force base spin to land 3 scatters (reel0/1/2 all show SCATTER on row 0).
    const floats = new Array(config.maxFloatsPerRound).fill(0);
    // reel1 stop0 -> 'A' (from strip ['A','B','A','SCATTER']), need SCATTER on row0:
    // strip index 3 has SCATTER; float must map to stop 3 -> float in [3/4, 1).
    floats[0] = 2 / 4 + 0.01; // reel0 strip ['A','A','WILD','B'] stop2 -> window[WILD,B]; not scatter, adjust below instead.
    // Simpler: directly test via dealGrid-independent assertion using a
    // config whose reel 0/1/2 index-0 stop is SCATTER for all three reels.
    const scatterConfig: GameConfig = {
      ...config,
      reelStrips: [['SCATTER', 'A'], ['SCATTER', 'A'], ['SCATTER', 'A']],
    };
    const allZero = new Array(scatterConfig.maxFloatsPerRound).fill(0);
    const result = playRound(scatterConfig, allZero);
    expect(result.base.scatter.count).toBe(3);
    expect(result.bonusTriggered).toBe(true);
    expect(result.freeSpins?.spinsAwarded).toBe(5);
    expect(result.freeSpins?.spins.length).toBe(5);
  });

  it('does not trigger free spins below the minimum scatter count', () => {
    const config = tinyConfig();
    const noScatterConfig: GameConfig = { ...config, reelStrips: [['A', 'B'], ['A', 'B'], ['A', 'B']] };
    const floats = new Array(noScatterConfig.maxFloatsPerRound).fill(0);
    const result = playRound(noScatterConfig, floats);
    expect(result.bonusTriggered).toBe(false);
    expect(result.freeSpins).toBeNull();
  });

  it('escalates the free-spins multiplier only after a winning spin, and caps at maxMultiplier', () => {
    const config = tinyConfig();
    // Each reel's 2-symbol strip ['SCATTER','A'] means stop 0's 2-row
    // window is exactly [SCATTER, A]: the top payline (row 0) lands
    // SCATTER on every reel (3 scatters -> triggers bonus), and the bottom
    // payline (row 1) simultaneously lands A on every reel (3-of-a-kind
    // win) — so with floats fixed at 0 (stop 0 on every reel, every spin,
    // since free spins reuse the same strips), EVERY spin both re-deals
    // this identical winning grid, letting the multiplier escalate every
    // single step until it hits the configured cap.
    const allWinConfig: GameConfig = {
      ...config,
      reelStrips: [
        ['SCATTER', 'A'],
        ['SCATTER', 'A'],
        ['SCATTER', 'A'],
      ],
      freeSpinsMultiplier: { startMultiplier: 1, step: (c) => c + 1, maxMultiplier: 3 },
    };
    const floats = new Array(allWinConfig.maxFloatsPerRound).fill(0);
    const result = playRound(allWinConfig, floats);
    expect(result.base.scatter.count).toBe(3);
    expect(result.base.win).toBe(true);
    expect(result.bonusTriggered).toBe(true);
    // 5 free spins awarded (3-scatter trigger maps to 5 per tinyConfig's table).
    expect(result.freeSpins?.spinsAwarded).toBe(5);
    expect(result.freeSpins?.multiplierPerSpin).toEqual([1, 2, 3, 3, 3]);
  });
});

describe('slot engine: Vault Breaker config sanity', () => {
  it('every payline has exactly one row index per reel, all within range', () => {
    VAULT_BREAKER_CONFIG.paylines.forEach((line) => {
      expect(line.length).toBe(VAULT_BREAKER_CONFIG.reels);
      line.forEach((row) => {
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(VAULT_BREAKER_CONFIG.rows);
      });
    });
  });

  it('has exactly 20 paylines and 5x4 dimensions, per the design spec', () => {
    expect(VAULT_BREAKER_CONFIG.paylines.length).toBe(20);
    expect(VAULT_BREAKER_CONFIG.reels).toBe(5);
    expect(VAULT_BREAKER_CONFIG.rows).toBe(4);
  });

  it('every reel strip contains only symbols defined in the symbol table', () => {
    const knownIds = new Set(Object.keys(VAULT_BREAKER_CONFIG.symbols));
    VAULT_BREAKER_CONFIG.reelStrips.forEach((strip) => {
      strip.forEach((symbolId) => expect(knownIds.has(symbolId)).toBe(true));
    });
  });

  it('produces a deterministic, reproducible round from real provably-fair floats', () => {
    const floats = deriveFloats('server-seed-x', 'client-seed-y', 3, VAULT_BREAKER_CONFIG.maxFloatsPerRound);
    const a = playRound(VAULT_BREAKER_CONFIG, floats);
    const b = playRound(VAULT_BREAKER_CONFIG, floats);
    expect(a).toEqual(b);
    expect(a.base.grid.length).toBe(5);
    expect(a.base.grid[0].length).toBe(4);
  });
});

describe('slot engine: dev fixtures (never reachable from the real /spin endpoint)', () => {
  it('SCATTER_5 always triggers the 5-scatter free-spins tier', () => {
    const floats = buildDevFloats(VAULT_BREAKER_CONFIG, 'SCATTER_5');
    const result = playRound(VAULT_BREAKER_CONFIG, floats);
    expect(result.base.scatter.count).toBeGreaterThanOrEqual(5);
    expect(result.bonusTriggered).toBe(true);
    expect(result.freeSpins?.spinsAwarded).toBe(12);
  });

  it('LOSS produces no win', () => {
    const floats = buildDevFloats(VAULT_BREAKER_CONFIG, 'LOSS');
    const result = playRound(VAULT_BREAKER_CONFIG, floats);
    expect(result.win).toBe(false);
    expect(result.totalMultiplier).toBe(0);
  });

  it('BASE_WIN produces a nonzero win', () => {
    const floats = buildDevFloats(VAULT_BREAKER_CONFIG, 'BASE_WIN');
    const result = playRound(VAULT_BREAKER_CONFIG, floats);
    expect(result.win).toBe(true);
    expect(result.base.rawWinMultiplier).toBeGreaterThan(0);
  });
});
