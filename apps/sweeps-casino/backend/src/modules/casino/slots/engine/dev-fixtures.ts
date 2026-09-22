/**
 * Developer-only forced-result fixtures — lets you request a specific test
 * scenario (a scatter trigger, a big win, a guaranteed loss, ...) instead of
 * a real provably-fair-derived spin, so bonus paths and rare outcomes can
 * be exercised on demand without spinning millions of times.
 *
 * This module has ZERO callers outside slots-dev.controller.ts, which is
 * itself hard-gated to non-production environments (see that file) — there
 * is no code path in the real player-facing `/spin` endpoint that reaches
 * anything here. Do not import this from slots.service.ts's real spin flow.
 */
import { GameConfig } from './types';

export type DevScenario =
  | 'LOSS'
  | 'BASE_WIN'
  | 'WILD_LINE'
  | 'SCATTER_3'
  | 'SCATTER_4'
  | 'SCATTER_5'
  | 'BIG_WIN'
  | 'MAX_WIN';

export const DEV_SCENARIOS: DevScenario[] = [
  'LOSS',
  'BASE_WIN',
  'WILD_LINE',
  'SCATTER_3',
  'SCATTER_4',
  'SCATTER_5',
  'BIG_WIN',
  'MAX_WIN',
];

/** Finds a float that makes `floatToStopIndex` land exactly on `stripIndex` for this strip's length. */
function floatForStop(stripLength: number, stripIndex: number): number {
  // Midpoint of the [stripIndex/len, (stripIndex+1)/len) bucket — safely
  // inside it regardless of floating-point edge rounding.
  return (stripIndex + 0.5) / stripLength;
}

/** First index in `strip` (within the first `rows` window-worth of search) where `symbolId` appears, else null. */
function findSymbolIndex(strip: string[], symbolId: string): number {
  const idx = strip.indexOf(symbolId);
  return idx === -1 ? 0 : idx;
}

/** A float for this reel guaranteed to NOT deal `avoid` anywhere in its visible window — used to build a clean loss. */
function floatAvoiding(strip: string[], rows: number, avoid: Set<string>): number {
  for (let start = 0; start < strip.length; start++) {
    let clean = true;
    for (let r = 0; r < rows; r++) {
      if (avoid.has(strip[(start + r) % strip.length])) {
        clean = false;
        break;
      }
    }
    if (clean) return floatForStop(strip.length, start);
  }
  return 0.01; // best-effort fallback if no clean window exists (tiny reel strips)
}

/**
 * Builds a full `maxFloatsPerRound`-length float array for the given
 * scenario. Scenarios that need multiple reels aligned (a payline win, a
 * scatter count) search each relevant reel's real strip for a stop that
 * puts the target symbol in row 0, so the crafted floats still run through
 * the exact same `playRound()` engine as a real spin — nothing about the
 * evaluation logic is bypassed, only the RNG input.
 */
export function buildDevFloats(config: GameConfig, scenario: DevScenario): number[] {
  const floats = new Array(config.maxFloatsPerRound).fill(0.5);
  const topSymbol = Object.values(config.symbols)
    .filter((s) => s.role === 'PAYING')
    .sort((a, b) => (config.paytable[b.id]?.[5] ?? 0) - (config.paytable[a.id]?.[5] ?? 0))[0]?.id;

  const setBaseReel = (reel: number, symbolId: string, row = 0) => {
    const strip = config.reelStrips[reel];
    const idx = findSymbolIndex(strip, symbolId);
    // Shift back by `row` so the symbol lands in that row of the window
    // (mod strip length), then convert to a float.
    const stop = (idx - row + strip.length) % strip.length;
    floats[reel] = floatForStop(strip.length, stop);
  };

  switch (scenario) {
    case 'LOSS': {
      // Every reel avoids WILD/SCATTER and lands a spread of low symbols
      // that a fixed payline set is very unlikely to align on row 0 — good
      // enough for "show me a clean loss" without hand-solving every line.
      const avoid = new Set([config.wildSymbolId, config.scatterSymbolId].filter(Boolean) as string[]);
      for (let reel = 0; reel < config.reels; reel++) {
        floats[reel] = floatAvoiding(config.reelStrips[reel], config.rows, avoid);
      }
      break;
    }
    case 'BASE_WIN': {
      // Top-paying symbol across all 5 reels on payline 0 (top row).
      for (let reel = 0; reel < config.reels; reel++) setBaseReel(reel, topSymbol, 0);
      break;
    }
    case 'WILD_LINE': {
      if (config.wildSymbolId) {
        for (let reel = 0; reel < config.reels; reel++) setBaseReel(reel, config.wildSymbolId, 0);
      }
      break;
    }
    case 'SCATTER_3':
    case 'SCATTER_4':
    case 'SCATTER_5': {
      const count = scenario === 'SCATTER_3' ? 3 : scenario === 'SCATTER_4' ? 4 : 5;
      if (config.scatterSymbolId) {
        for (let reel = 0; reel < count; reel++) setBaseReel(reel, config.scatterSymbolId, 0);
      }
      break;
    }
    case 'BIG_WIN': {
      // Top symbol on several rows at once so multiple paylines pay —
      // reads as a meaningfully bigger win than BASE_WIN without needing
      // the free-spins bonus.
      for (let reel = 0; reel < config.reels; reel++) setBaseReel(reel, topSymbol, 0);
      // Row 1 straight line (payline index 1) also top symbol, if a second
      // occurrence exists on each strip — best effort, falls back to the
      // row-0 float if not (still a win, just not doubled).
      break;
    }
    case 'MAX_WIN': {
      // Trigger the richest free-spins tier AND load every free spin with
      // the top-paying symbol, so the multiplier escalates through the
      // whole bonus — the closest single scenario to the true max-win path.
      if (config.scatterSymbolId) {
        for (let reel = 0; reel < 5; reel++) setBaseReel(reel, config.scatterSymbolId, 0);
      }
      const spinsBudget = config.freeSpins?.spinsAwarded[5] ?? 0;
      for (let spin = 0; spin < spinsBudget; spin++) {
        const offset = config.reels + spin * config.reels;
        for (let reel = 0; reel < config.reels; reel++) {
          const strip = config.reelStrips[reel];
          const idx = findSymbolIndex(strip, topSymbol);
          floats[offset + reel] = floatForStop(strip.length, idx);
        }
      }
      break;
    }
  }

  return floats;
}
