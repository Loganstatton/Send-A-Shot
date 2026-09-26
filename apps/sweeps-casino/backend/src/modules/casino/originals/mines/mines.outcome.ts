/**
 * Mines — pure floats -> outcome mapping.
 *
 * Shared by POST /casino/originals/mines/play (legacy single-shot, still
 * live for provably-fair/verify parity — see outcome.dispatcher.ts) and by
 * the interactive round flow in mines-round.service.ts, which drives the
 * real casino-style "pick one tile at a time, cash out whenever" mechanic
 * via POST /casino/originals/mines/{start,:roundId/pick,:roundId/cashout}.
 * Both flows share this exact module: `deriveMinePositions` (the seeded
 * Fisher-Yates mine layout) and `computeMinesMultiplier` (the fair-
 * multiplier formula, callable with any picks-so-far count) are the
 * provably-fair guarantee — a mine layout and a multiplier for N picks
 * always mean the same thing whether they came from a single /play call or
 * from N interactive /pick calls against the same seed/nonce.
 */

export interface MinesParams {
  /** 1-24. */
  minesCount: number;
  /** Non-empty, unique tile indices in [0, 24], at most (25 - minesCount) of them. */
  picks: number[];
}

export interface MinesOutcome {
  win: boolean;
  fairMultiplier: number;
  /** Payout multiplier actually credited; 0 when any pick hit a mine. */
  multiplier: number;
  result: {
    minePositions: number[];
    picks: number[];
    hitMine: boolean;
  };
}

export const MINES_GRID_SIZE = 25;
export const MINES_FLOATS_NEEDED = MINES_GRID_SIZE;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Seeded Fisher-Yates shuffle of [0..24], one float consumed per swap step,
 * so the mine layout is fully determined by the round's floats. Exported
 * for mines-round.service.ts: the interactive flow derives this once at
 * round `start` (same floats derivation as the single-shot path) and holds
 * it server-side across picks — it is never re-derived per pick.
 */
export function deriveMinePositions(floats: number[], minesCount: number): number[] {
  const indices = Array.from({ length: MINES_GRID_SIZE }, (_, i) => i);
  for (let i = MINES_GRID_SIZE - 1; i > 0; i--) {
    const j = Math.floor(floats[MINES_GRID_SIZE - 1 - i] * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  return indices.slice(0, minesCount).sort((a, b) => a - b);
}

/** C(n, k) via an integer-safe BigInt factorial-ratio (n is at most 25 here). */
function combination(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1n;
  for (let i = 1; i <= k; i++) {
    result = (result * BigInt(n - k + i)) / BigInt(i);
  }
  return Number(result);
}

/**
 * The fair-multiplier formula, parameterized by "how many safe picks so
 * far" rather than a fixed final pick count — C(25, picksCount) /
 * C(25 - minesCount, picksCount) is already a running function of picks
 * made, so the same formula that settles a single-shot round's final
 * multiplier also gives the *current* multiplier after each interactive
 * pick (mines-round.service.ts calls this once per safe pick and once
 * more at cashout with picksCount frozen at that point).
 */
export function computeMinesMultiplier(
  minesCount: number,
  picksCount: number,
  houseEdgeBps: number,
): { fairMultiplier: number; multiplier: number } {
  const fairMultiplier = round4(
    combination(MINES_GRID_SIZE, picksCount) / combination(MINES_GRID_SIZE - minesCount, picksCount),
  );
  const multiplier = round4(fairMultiplier * (1 - houseEdgeBps / 10000));
  return { fairMultiplier, multiplier };
}

export function computeMinesOutcome(
  floats: number[],
  params: MinesParams,
  houseEdgeBps: number,
): MinesOutcome {
  const { minesCount, picks } = params;

  const minePositions = deriveMinePositions(floats, minesCount);
  const hitMine = picks.some((p) => minePositions.includes(p));
  const win = !hitMine;

  const { fairMultiplier, multiplier: multiplierIfWin } = computeMinesMultiplier(
    minesCount,
    picks.length,
    houseEdgeBps,
  );
  const multiplier = win ? multiplierIfWin : 0;

  return {
    win,
    fairMultiplier,
    multiplier,
    result: { minePositions, picks, hitMine },
  };
}
