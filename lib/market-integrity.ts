// Heuristic wash-trading / coordinated-account detection, computed fresh
// from next_transactions every time this is read (this app's established
// "no background job" pattern — see lib/analytics.ts's own header comment
// for the same reasoning applied elsewhere). Nothing here is a verdict: a
// flag means "an admin should look at this," not "this account is guilty."
// Real collusion is genuinely hard to prove from trade timing alone — two
// friends legitimately both liking the same obscure artist looks similar to
// two accounts colluding, so these thresholds are deliberately loose
// (flag rarely, not aggressively) and every flag stays human-reviewed
// (app/admin/market-integrity) rather than auto-suppressing anyone from the
// leaderboard or the market.

import { SuspiciousTradingFlag } from './types';

export type MarketTradeRow = {
  user_id: number;
  artist_id: number;
  created_at: string;
};

// "Repetitive tiny trades intended only to manipulate price" — one account
// firing many trades on the same artist in a short window. The price-impact
// formula itself (lib/next-market.ts) doesn't discriminate against
// frequency — many small trades move price at least as much as one big one,
// due to compounding — so this has to be a behavioral pattern check, not a
// pricing-math mitigation.
export const RAPID_TRADE_WINDOW_MINUTES = 10;
export const RAPID_TRADE_COUNT_THRESHOLD = 10;

export function getRapidTradingFlags(transactions: MarketTradeRow[]): SuspiciousTradingFlag[] {
  const groups = new Map<string, MarketTradeRow[]>();
  for (const t of transactions) {
    const key = `${t.user_id}:${t.artist_id}`;
    const existing = groups.get(key);
    if (existing) existing.push(t);
    else groups.set(key, [t]);
  }

  const flags: SuspiciousTradingFlag[] = [];
  for (const [key, txs] of groups) {
    const sorted = [...txs].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    for (let i = 0; i < sorted.length; i++) {
      const windowStart = new Date(sorted[i].created_at).getTime();
      let count = 1;
      for (let j = i + 1; j < sorted.length; j++) {
        const deltaMin = (new Date(sorted[j].created_at).getTime() - windowStart) / 60_000;
        if (deltaMin > RAPID_TRADE_WINDOW_MINUTES) break;
        count++;
      }
      if (count >= RAPID_TRADE_COUNT_THRESHOLD) {
        const [userId, artistId] = key.split(':').map(Number);
        flags.push({
          kind: 'rapid_trading',
          userIds: [userId],
          artistId,
          detail: `${count} trades within ${RAPID_TRADE_WINDOW_MINUTES} minutes`,
        });
        break; // one flag per user+artist is enough — don't re-flag every overlapping window
      }
    }
  }
  return flags;
}

// "Coordinated accounts" / wash-trading — two DIFFERENT accounts trading
// the same artist back and forth in tight succession, repeatedly. A single
// closely-timed exchange between two people is normal market activity;
// several in a row on the same narrow artist is the pattern colluding
// accounts pumping-and-holding for each other would produce.
export const COORDINATED_PAIR_WINDOW_MINUTES = 5;
export const COORDINATED_PAIR_COUNT_THRESHOLD = 3;

export function getCoordinatedPairFlags(transactions: MarketTradeRow[]): SuspiciousTradingFlag[] {
  const byArtist = new Map<number, MarketTradeRow[]>();
  for (const t of transactions) {
    const existing = byArtist.get(t.artist_id);
    if (existing) existing.push(t);
    else byArtist.set(t.artist_id, [t]);
  }

  const flags: SuspiciousTradingFlag[] = [];
  for (const [artistId, txs] of byArtist) {
    const sorted = [...txs].sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const pairCounts = new Map<string, number>();
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      if (a.user_id === b.user_id) continue;
      const deltaMin = (new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) / 60_000;
      if (deltaMin > COORDINATED_PAIR_WINDOW_MINUTES) continue;
      const pairKey = [a.user_id, b.user_id].sort((x, y) => x - y).join(':');
      pairCounts.set(pairKey, (pairCounts.get(pairKey) ?? 0) + 1);
    }
    for (const [pairKey, count] of pairCounts) {
      if (count < COORDINATED_PAIR_COUNT_THRESHOLD) continue;
      const [userA, userB] = pairKey.split(':').map(Number);
      flags.push({
        kind: 'coordinated_pair',
        userIds: [userA, userB],
        artistId,
        detail: `${count} closely-timed alternating trades within ${COORDINATED_PAIR_WINDOW_MINUTES} minutes`,
      });
    }
  }
  return flags;
}
