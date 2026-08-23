import { describe, expect, it } from 'vitest';
import { withRetry } from './retry';

describe('withRetry', () => {
  it('does not retry when the first attempt already succeeds', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls++;
      return { ok: true as const, data: 'first-try' };
    });
    expect(calls).toBe(1);
    expect(result).toEqual({ ok: true, data: 'first-try' });
  });

  it('retries exactly once more on failure, and returns the retry result whether it succeeds or not', async () => {
    let calls = 0;
    const succeedsOnRetry = await withRetry(async () => {
      calls++;
      return calls < 2 ? { ok: false as const, error: 'first attempt failed' } : { ok: true as const, data: 'second-try' };
    });
    expect(calls).toBe(2);
    expect(succeedsOnRetry).toEqual({ ok: true, data: 'second-try' });

    let alwaysFailsCalls = 0;
    const alwaysFails = await withRetry(async () => {
      alwaysFailsCalls++;
      return { ok: false as const, error: `attempt ${alwaysFailsCalls}` };
    });
    // Default attempts=2 — one initial try plus exactly one retry, never more.
    expect(alwaysFailsCalls).toBe(2);
    expect(alwaysFails).toEqual({ ok: false, error: 'attempt 2' });
  });

  it('respects a custom attempts count', async () => {
    let calls = 0;
    await withRetry(async () => {
      calls++;
      return { ok: false as const, error: 'never succeeds' };
    }, 4);
    expect(calls).toBe(4);
  });
});
