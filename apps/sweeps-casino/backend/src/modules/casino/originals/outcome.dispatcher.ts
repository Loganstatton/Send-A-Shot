import { BadRequestException } from '@nestjs/common';
import {
  computeDiceOutcome,
  DiceOutcome,
  DiceParams,
  DICE_FLOATS_NEEDED,
} from './dice/dice.outcome';
import {
  computeMinesOutcome,
  MinesOutcome,
  MinesParams,
  MINES_FLOATS_NEEDED,
  MINES_GRID_SIZE,
} from './mines/mines.outcome';
import {
  computePlinkoOutcome,
  PlinkoOutcome,
  PlinkoParams,
  PLINKO_MAX_ROWS,
  PLINKO_MIN_ROWS,
} from './plinko/plinko.outcome';
import { OriginalGameKey } from './originals.constants';

export type OriginalParams = DiceParams | MinesParams | PlinkoParams;
export type OriginalOutcome = DiceOutcome | MinesOutcome | PlinkoOutcome;

function invalidParams(message: string): never {
  throw new BadRequestException({ code: 'INVALID_PARAMS', message });
}

function normalizeDiceParams(raw: unknown): DiceParams {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const target = Number(obj.target);
  const direction = obj.direction;

  if (!Number.isFinite(target) || target < 2 || target > 98) {
    invalidParams('target must be a number between 2 and 98.');
  }
  if (direction !== 'OVER' && direction !== 'UNDER') {
    invalidParams("direction must be 'OVER' or 'UNDER'.");
  }

  return { target, direction: direction as 'OVER' | 'UNDER' };
}

function normalizeMinesParams(raw: unknown): MinesParams {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const minesCount = Number(obj.minesCount);

  if (!Number.isInteger(minesCount) || minesCount < 1 || minesCount > 24) {
    invalidParams('minesCount must be an integer between 1 and 24.');
  }

  const rawPicks = obj.picks;
  if (!Array.isArray(rawPicks) || rawPicks.length === 0) {
    invalidParams('picks must be a non-empty array of tile indices.');
  }
  if (rawPicks.length > MINES_GRID_SIZE - minesCount) {
    invalidParams('picks cannot exceed the number of safe (non-mine) tiles.');
  }

  const picks = rawPicks.map((p) => Number(p));
  const hasInvalidTile = picks.some((p) => !Number.isInteger(p) || p < 0 || p >= MINES_GRID_SIZE);
  if (hasInvalidTile) {
    invalidParams('picks must be integers between 0 and 24.');
  }
  if (new Set(picks).size !== picks.length) {
    invalidParams('picks must not contain duplicate tile indices.');
  }

  return { minesCount, picks };
}

function normalizePlinkoParams(raw: unknown): PlinkoParams {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rows = Number(obj.rows);

  if (!Number.isInteger(rows) || rows < PLINKO_MIN_ROWS || rows > PLINKO_MAX_ROWS) {
    invalidParams(`rows must be an integer between ${PLINKO_MIN_ROWS} and ${PLINKO_MAX_ROWS}.`);
  }

  const risk = obj.risk;
  if (risk !== 'LOW' && risk !== 'MEDIUM' && risk !== 'HIGH') {
    invalidParams("risk must be 'LOW', 'MEDIUM', or 'HIGH'.");
  }

  return { rows, risk: risk as 'LOW' | 'MEDIUM' | 'HIGH' };
}

/** Validates + extracts game-specific params from a raw request body/object. */
export function normalizeParams(game: OriginalGameKey, raw: unknown): OriginalParams {
  switch (game) {
    case 'dice':
      return normalizeDiceParams(raw);
    case 'mines':
      return normalizeMinesParams(raw);
    case 'plinko':
      return normalizePlinkoParams(raw);
  }
}

export function floatsNeededFor(game: OriginalGameKey, params: OriginalParams): number {
  switch (game) {
    case 'dice':
      return DICE_FLOATS_NEEDED;
    case 'mines':
      return MINES_FLOATS_NEEDED;
    case 'plinko':
      return (params as PlinkoParams).rows;
  }
}

/**
 * Single dispatch point shared by POST /casino/originals/:game/play and
 * POST /provably-fair/verify — the ONE place the (floats, params) ->
 * outcome mapping happens for each game, so both endpoints are
 * mathematically guaranteed to agree given the same inputs.
 */
export function computeOutcome(
  game: OriginalGameKey,
  floats: number[],
  params: OriginalParams,
  houseEdgeBps: number,
): OriginalOutcome {
  switch (game) {
    case 'dice':
      return computeDiceOutcome(floats, params as DiceParams, houseEdgeBps);
    case 'mines':
      return computeMinesOutcome(floats, params as MinesParams, houseEdgeBps);
    case 'plinko':
      return computePlinkoOutcome(floats, params as PlinkoParams, houseEdgeBps);
  }
}
