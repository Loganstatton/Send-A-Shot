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
