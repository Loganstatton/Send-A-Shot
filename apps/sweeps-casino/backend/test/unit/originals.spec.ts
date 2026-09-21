import { deriveFloats } from '../../src/libs/provably-fair/provably-fair';
import { computeDiceOutcome } from '../../src/modules/casino/originals/dice/dice.outcome';
import { computeMinesOutcome, MINES_GRID_SIZE } from '../../src/modules/casino/originals/mines/mines.outcome';
import { computePlinkoOutcome } from '../../src/modules/casino/originals/plinko/plinko.outcome';
import {
  computeOutcome,
  floatsNeededFor,
  normalizeParams,
} from '../../src/modules/casino/originals/outcome.dispatcher';

/**
 * These tests exercise the pure floats -> outcome functions directly
 * (no HTTP, no DB) with a fixed (serverSeed, clientSeed, nonce) triple and
 * assert determinism: the same inputs must always produce the same
 * outputs. This is the core provably-fair guarantee — POST /play and
 * POST /provably-fair/verify both call these exact functions (via
 * outcome.dispatcher.ts), so if they're deterministic here, the two
 * endpoints can never disagree given the same inputs.
 */

const SERVER_SEED = 'test-server-seed-0123456789abcdef0123456789abcdef';
const CLIENT_SEED = 'test-client-seed';
const NONCE = 42;
const HOUSE_EDGE_BPS = 100; // 1%

describe('provably-fair determinism', () => {
  describe('dice', () => {
    const params = { target: 50, direction: 'OVER' as const };

    it('produces identical output for identical inputs, every time', () => {
      const floatsA = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, 1);
      const floatsB = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, 1);
      expect(floatsA).toEqual(floatsB);

      const outcomeA = computeDiceOutcome(floatsA, params, HOUSE_EDGE_BPS);
      const outcomeB = computeDiceOutcome(floatsB, params, HOUSE_EDGE_BPS);
      expect(outcomeA).toEqual(outcomeB);

      // Re-derive from scratch a third time (simulating a completely
      // separate /provably-fair/verify call) and confirm it still matches.
      const floatsC = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, 1);
      const outcomeC = computeDiceOutcome(floatsC, params, HOUSE_EDGE_BPS);
      expect(outcomeC).toEqual(outcomeA);
    });

    it('a different nonce produces a different roll (overwhelmingly likely)', () => {
      const floatsNonce42 = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, 1);
      const floatsNonce43 = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE + 1, 1);
      expect(floatsNonce42).not.toEqual(floatsNonce43);
    });

    it('roll is in [0, 100) with 2 decimal places, and win/lose matches direction', () => {
      const floats = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, 1);
      const outcome = computeDiceOutcome(floats, params, HOUSE_EDGE_BPS);

      expect(outcome.result.roll).toBeGreaterThanOrEqual(0);
      expect(outcome.result.roll).toBeLessThan(100);
      expect(Number.isInteger(outcome.result.roll * 100)).toBe(true);
      expect(outcome.win).toBe(outcome.result.roll > params.target);
      if (!outcome.win) {
        expect(outcome.multiplier).toBe(0);
      } else {
        expect(outcome.multiplier).toBeGreaterThan(0);
      }
    });

    it('fairMultiplier for a 50/OVER bet is the textbook 100/50 = 2x before house edge', () => {
      const floats = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, 1);
      const outcome = computeDiceOutcome(floats, { target: 50, direction: 'OVER' }, HOUSE_EDGE_BPS);
      expect(outcome.fairMultiplier).toBeCloseTo(2, 4);
    });
  });

  describe('mines', () => {
    const params = { minesCount: 3, picks: [0, 1, 2] };

    it('produces identical mine layout and outcome for identical inputs, every time', () => {
      const floatsA = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, MINES_GRID_SIZE);
      const floatsB = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, MINES_GRID_SIZE);
      expect(floatsA).toEqual(floatsB);

      const outcomeA = computeMinesOutcome(floatsA, params, HOUSE_EDGE_BPS);
      const outcomeB = computeMinesOutcome(floatsB, params, HOUSE_EDGE_BPS);
      expect(outcomeA).toEqual(outcomeB);
      expect(outcomeA.result.minePositions).toEqual(outcomeB.result.minePositions);
    });

    it('derives exactly minesCount unique mine positions within the 0-24 grid', () => {
      const floats = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, MINES_GRID_SIZE);
      const outcome = computeMinesOutcome(floats, params, HOUSE_EDGE_BPS);

      expect(outcome.result.minePositions).toHaveLength(params.minesCount);
      expect(new Set(outcome.result.minePositions).size).toBe(params.minesCount);
      for (const pos of outcome.result.minePositions) {
        expect(pos).toBeGreaterThanOrEqual(0);
        expect(pos).toBeLessThan(MINES_GRID_SIZE);
      }
    });

    it('loses (multiplier 0) iff a pick hit a mine, wins otherwise', () => {
      const floats = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, MINES_GRID_SIZE);
      const outcome = computeMinesOutcome(floats, params, HOUSE_EDGE_BPS);

      const expectedHit = params.picks.some((p) => outcome.result.minePositions.includes(p));
      expect(outcome.result.hitMine).toBe(expectedHit);
      expect(outcome.win).toBe(!expectedHit);
      if (!outcome.win) {
        expect(outcome.multiplier).toBe(0);
      } else {
        expect(outcome.multiplier).toBeGreaterThan(0);
      }
    });

    it('fairMultiplier for 1 mine / 1 pick is the textbook 25/24', () => {
      const floats = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, MINES_GRID_SIZE);
      const outcome = computeMinesOutcome(floats, { minesCount: 1, picks: [0] }, HOUSE_EDGE_BPS);
      expect(outcome.fairMultiplier).toBeCloseTo(25 / 24, 4);
    });
  });

  describe('plinko', () => {
    const params = { rows: 12, risk: 'MEDIUM' as const };

    it('produces identical path/bucket/multiplier for identical inputs, every time', () => {
      const floatsA = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, params.rows);
      const floatsB = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, params.rows);
      expect(floatsA).toEqual(floatsB);

      const outcomeA = computePlinkoOutcome(floatsA, params, HOUSE_EDGE_BPS);
      const outcomeB = computePlinkoOutcome(floatsB, params, HOUSE_EDGE_BPS);
      expect(outcomeA).toEqual(outcomeB);
    });

    it('bucket equals the number of rightward steps in path, within [0, rows]', () => {
      const floats = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, params.rows);
      const outcome = computePlinkoOutcome(floats, params, HOUSE_EDGE_BPS);

      const rightSteps = outcome.result.path.filter((step) => step === 'R').length;
      expect(outcome.result.bucket).toBe(rightSteps);
      expect(outcome.result.path).toHaveLength(params.rows);
      expect(outcome.result.bucket).toBeGreaterThanOrEqual(0);
      expect(outcome.result.bucket).toBeLessThanOrEqual(params.rows);
    });

    it('always returns a strictly positive payout multiplier (Plinko never fully busts)', () => {
      const floats = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, params.rows);
      const outcome = computePlinkoOutcome(floats, params, HOUSE_EDGE_BPS);
      expect(outcome.multiplier).toBeGreaterThan(0);
    });
  });

  describe('outcome.dispatcher (the single dispatch point /play and /verify both use)', () => {
    it('dispatches deterministically for dice given raw, unnormalized params', () => {
      const raw = { target: 50, direction: 'OVER' };
      const paramsA = normalizeParams('dice', raw);
      const paramsB = normalizeParams('dice', raw);
      expect(paramsA).toEqual(paramsB);

      const floats = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, floatsNeededFor('dice', paramsA));
      const outcomeA = computeOutcome('dice', floats, paramsA, HOUSE_EDGE_BPS);
      const outcomeB = computeOutcome('dice', floats, paramsB, HOUSE_EDGE_BPS);
      expect(outcomeA).toEqual(outcomeB);
    });

    it('dispatches deterministically for mines given raw, unnormalized params', () => {
      const raw = { minesCount: 5, picks: [0, 5, 10, 15, 20] };
      const params = normalizeParams('mines', raw);
      const floatsNeeded = floatsNeededFor('mines', params);

      const floats1 = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, floatsNeeded);
      const floats2 = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, floatsNeeded);
      const outcome1 = computeOutcome('mines', floats1, params, HOUSE_EDGE_BPS);
      const outcome2 = computeOutcome('mines', floats2, params, HOUSE_EDGE_BPS);
      expect(outcome1).toEqual(outcome2);
    });

    it('dispatches deterministically for plinko given raw, unnormalized params', () => {
      const raw = { rows: 10, risk: 'HIGH' };
      const params = normalizeParams('plinko', raw);
      const floatsNeeded = floatsNeededFor('plinko', params);

      const floats1 = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, floatsNeeded);
      const floats2 = deriveFloats(SERVER_SEED, CLIENT_SEED, NONCE, floatsNeeded);
      const outcome1 = computeOutcome('plinko', floats1, params, HOUSE_EDGE_BPS);
      const outcome2 = computeOutcome('plinko', floats2, params, HOUSE_EDGE_BPS);
      expect(outcome1).toEqual(outcome2);
    });
  });
});
