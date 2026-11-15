import { describe, expect, it } from 'vitest';
import {
  COORDINATED_PAIR_COUNT_THRESHOLD, COORDINATED_PAIR_WINDOW_MINUTES, getCoordinatedPairFlags, getRapidTradingFlags,
  MarketTradeRow, RAPID_TRADE_COUNT_THRESHOLD, RAPID_TRADE_WINDOW_MINUTES,
} from './market-integrity';

const BASE = new Date('2026-01-01T00:00:00.000Z').getTime();

function tx(userId: number, artistId: number, minutesOffset: number): MarketTradeRow {
  return { user_id: userId, artist_id: artistId, created_at: new Date(BASE + minutesOffset * 60_000).toISOString() };
}

describe('getRapidTradingFlags', () => {
  it('flags a user who trades the same artist RAPID_TRADE_COUNT_THRESHOLD+ times within the window', () => {
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < RAPID_TRADE_COUNT_THRESHOLD; i++) txs.push(tx(1, 100, i)); // 1-minute apart, well within the window

    const flags = getRapidTradingFlags(txs);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ kind: 'rapid_trading', userIds: [1], artistId: 100 });
    expect(flags[0].detail).toContain(String(RAPID_TRADE_COUNT_THRESHOLD));
  });

  it('does not flag one below the threshold', () => {
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < RAPID_TRADE_COUNT_THRESHOLD - 1; i++) txs.push(tx(1, 100, i));
    expect(getRapidTradingFlags(txs)).toEqual([]);
  });

  it('does not flag trades that meet the threshold count but are spread outside the window', () => {
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < RAPID_TRADE_COUNT_THRESHOLD; i++) txs.push(tx(1, 100, i * (RAPID_TRADE_WINDOW_MINUTES + 1)));
    expect(getRapidTradingFlags(txs)).toEqual([]);
  });

  it('tracks each user+artist pair independently — one user rapid-trading one artist does not flag their trades on a different artist', () => {
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < RAPID_TRADE_COUNT_THRESHOLD; i++) txs.push(tx(1, 100, i));
    for (let i = 0; i < 3; i++) txs.push(tx(1, 200, i)); // same user, different artist, below threshold

    const flags = getRapidTradingFlags(txs);
    expect(flags).toHaveLength(1);
    expect(flags[0].artistId).toBe(100);
  });

  it('only emits one flag per user+artist group, not one per overlapping window', () => {
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < RAPID_TRADE_COUNT_THRESHOLD * 2; i++) txs.push(tx(1, 100, i));
    expect(getRapidTradingFlags(txs)).toHaveLength(1);
  });
});

describe('getCoordinatedPairFlags', () => {
  it('flags two different users alternating trades on the same artist within the window, repeated past the threshold', () => {
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < COORDINATED_PAIR_COUNT_THRESHOLD; i++) {
      txs.push(tx(1, 100, i * 2));
      txs.push(tx(2, 100, i * 2 + 1)); // 1 minute after user 1's trade, well within the window
    }

    const flags = getCoordinatedPairFlags(txs);
    expect(flags).toHaveLength(1);
    expect(flags[0].kind).toBe('coordinated_pair');
    expect(flags[0].userIds.sort()).toEqual([1, 2]);
    expect(flags[0].artistId).toBe(100);
  });

  it('does not flag one below the threshold', () => {
    // ISOLATED two-trade exchanges, each separated by a gap larger than the
    // window so the "connecting" adjacent pair between exchanges never also
    // counts — exactly COORDINATED_PAIR_COUNT_THRESHOLD - 1 counted pairs.
    const gap = COORDINATED_PAIR_WINDOW_MINUTES + 10;
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < COORDINATED_PAIR_COUNT_THRESHOLD - 1; i++) {
      txs.push(tx(1, 100, i * gap));
      txs.push(tx(2, 100, i * gap + 1));
    }
    expect(getCoordinatedPairFlags(txs)).toEqual([]);
  });

  it('does not flag the same user trading with themselves back to back', () => {
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < COORDINATED_PAIR_COUNT_THRESHOLD + 2; i++) txs.push(tx(1, 100, i));
    expect(getCoordinatedPairFlags(txs)).toEqual([]);
  });

  it('does not flag alternating trades spread outside the window', () => {
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < COORDINATED_PAIR_COUNT_THRESHOLD; i++) {
      txs.push(tx(1, 100, i * (COORDINATED_PAIR_WINDOW_MINUTES + 2) * 2));
      txs.push(tx(2, 100, i * (COORDINATED_PAIR_WINDOW_MINUTES + 2) * 2 + COORDINATED_PAIR_WINDOW_MINUTES + 1));
    }
    expect(getCoordinatedPairFlags(txs)).toEqual([]);
  });

  it('tracks each artist independently — the same pair trading two different artists needs the threshold met on EACH artist separately', () => {
    const txs: MarketTradeRow[] = [];
    for (let i = 0; i < COORDINATED_PAIR_COUNT_THRESHOLD; i++) {
      txs.push(tx(1, 100, i * 2));
      txs.push(tx(2, 100, i * 2 + 1));
    }
    // Only 1 alternating pair on artist 200 — below threshold.
    txs.push(tx(1, 200, 1000));
    txs.push(tx(2, 200, 1001));

    const flags = getCoordinatedPairFlags(txs);
    expect(flags).toHaveLength(1);
    expect(flags[0].artistId).toBe(100);
  });
});

describe('findRoundTripEpisodes — the Phase 0 rounding-exploit audit', async () => {
  const { findRoundTripEpisodes } = await import('./market-integrity');
  let id = 0;
  const t = (user: number, artist: number, min: number, type: 'buy' | 'sell', shares: number, delta: number) =>
    ({ id: ++id, user_id: user, artist_id: artist, created_at: new Date(BASE + min * 60_000).toISOString(), type, shares, credits_delta_cents: delta });

  it('an isolated round trip that made Credits is reported, with the slicing pattern', () => {
    const trades = [t(1, 7, 0, 'buy', 450, -1_000_000)];
    for (let i = 0; i < 25; i++) trades.push(t(1, 7, 1 + i, 'sell', 18, 40_976));          // 25 small sells, more back than spent
    const [e] = findRoundTripEpisodes(trades);
    expect(e.isolated).toBe(true);
    expect(e.profitCents).toBe(25 * 40_976 - 1_000_000);
    expect(e.profitCents).toBeGreaterThan(0);
    expect(e.slicingPattern).toBe(false);        // sells of $409.76 are not "small" (< $100)
  });

  it('another player trading in between makes the round trip not isolated (a market outcome, not evidence)', () => {
    const trades = [t(1, 8, 0, 'buy', 10, -20_000), t(2, 8, 1, 'buy', 50, -100_000), t(1, 8, 2, 'sell', 10, 21_000)];
    const eps = findRoundTripEpisodes(trades).filter((e) => e.userId === 1);
    expect(eps).toHaveLength(1);
    expect(eps[0].isolated).toBe(false);
  });

  it('flags a large buy followed by many small sells as the slicing pattern', () => {
    const trades = [t(3, 9, 0, 'buy', 450, -1_000_000)];
    for (let i = 0; i < 12; i++) trades.push(t(3, 9, 1 + i, 'sell', 37.5, 4_000));      // 12 × 37.5 = all 450 shares, $40 each
    const e = findRoundTripEpisodes(trades).find((x) => x.userId === 3)!;
    expect(e).toBeDefined();
    expect(e.slicingPattern).toBe(true);
    expect(e.profitCents).toBe(12 * 4_000 - 1_000_000);                                  // a loss: pattern alone isn't evidence
  });
});
