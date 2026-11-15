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

// ---------------------------------------------------------------------------------------------------------
// Phase 0 audit (2026-11-15): was the old rounding exploit ever used?
//
// Before the exact-fill fix, one player could make Credits with nobody else trading: buy in one block and
// sell back in small slices (or the reverse), because small trades' price moves rounded to nothing. Done
// normally, a round trip with no outside activity always LOST a little under the old engine. So the clean
// evidence is: an "isolated" round trip — a player's position on one artist going from zero back to zero
// with no other player trading that artist in between — that ended with MORE Credits than it started.
// The slicing pattern (a large buy followed by many small sells, or many small buys then one large sell)
// is reported alongside as context. Read-only: nothing here changes any balance.
export type AuditTrade = {
  id: number; user_id: number; artist_id: number; created_at: string; type: 'buy' | 'sell'; shares: number; credits_delta_cents: number;
};
export type RoundTripEpisode = {
  userId: number; artistId: number; startedAt: string; endedAt: string; trades: number; buys: number; sells: number;
  creditsSpentCents: number; creditsReceivedCents: number; profitCents: number; isolated: boolean; slicingPattern: boolean;
};
export const SLICE_SMALL_CENTS = 10_000;          // a "small" trade: under $100
export const SLICE_MIN_COUNT = 10;                // at least this many small trades on the slicing side
export const SLICE_LARGE_CENTS = 100_000;         // against at least one trade of $1,000+

export function findRoundTripEpisodes(trades: AuditTrade[]): RoundTripEpisode[] {
  const byArtist = new Map<number, AuditTrade[]>();
  for (const t of trades) (byArtist.get(t.artist_id) ?? byArtist.set(t.artist_id, []).get(t.artist_id)!).push(t);
  const episodes: RoundTripEpisode[] = [];
  for (const [artistId, list] of byArtist) {
    list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id));
    const open = new Map<number, { startIdx: number; shares: number; ts: AuditTrade[] }>();
    list.forEach((t, i) => {
      let ep = open.get(t.user_id);
      if (!ep) { if (t.type !== 'buy') return; ep = { startIdx: i, shares: 0, ts: [] }; open.set(t.user_id, ep); }
      ep.ts.push(t); ep.shares += t.type === 'buy' ? Number(t.shares) : -Number(t.shares);
      if (t.type === 'sell' && ep.shares < 0.0001) {
        const others = list.slice(ep.startIdx, i + 1).some((x) => x.user_id !== t.user_id);
        const buys = ep.ts.filter((x) => x.type === 'buy'), sells = ep.ts.filter((x) => x.type === 'sell');
        const spent = -buys.reduce((s, x) => s + Number(x.credits_delta_cents), 0);
        const received = sells.reduce((s, x) => s + Number(x.credits_delta_cents), 0);
        const small = (xs: AuditTrade[]) => xs.filter((x) => Math.abs(Number(x.credits_delta_cents)) < SLICE_SMALL_CENTS).length;
        const large = (xs: AuditTrade[]) => xs.some((x) => Math.abs(Number(x.credits_delta_cents)) >= SLICE_LARGE_CENTS);
        episodes.push({
          userId: t.user_id, artistId, startedAt: ep.ts[0].created_at, endedAt: t.created_at, trades: ep.ts.length,
          buys: buys.length, sells: sells.length, creditsSpentCents: spent, creditsReceivedCents: received, profitCents: received - spent,
          isolated: !others,
          slicingPattern: (large(buys) && small(sells) >= SLICE_MIN_COUNT) || (large(sells) && small(buys) >= SLICE_MIN_COUNT),
        });
        open.delete(t.user_id);
      }
    });
  }
  return episodes;
}

// ---------------------------------------------------------------------------------------------
// Phase 1: coordinated multi-account manipulation ("pump and dump").
//
// With a market maker nobody can create Credits, alone or as a group (Σ paid out ≤ Σ paid in), but a group
// CAN move Credits from throwaway accounts to one account: the main account buys, the throwaways buy after
// it (pushing the price up), the main account sells into that, and the throwaways are left with the loss.
// This detector looks for that shape. It FLAGS for review; it never changes a balance or blocks anyone.
//
// A closed position by account A on artist X is flagged when, inside its last PUMP_WINDOW_HOURS:
//   • A made at least PUMP_MIN_PROFIT_CENTS on it, and
//   • at least PUMP_MIN_FEEDERS other accounts bought X and are now at a loss on X ("feeders"), each of
//     them "thin": younger than THIN_ACCOUNT_DAYS when they bought, or with ≥ THIN_CONCENTRATION of all
//     their purchases in X, or invited by A, and
//   • those feeders supplied at least half of everyone else's buying in the window, and their losses
//     cover at least a quarter of A's profit.
// Organic markets rarely look like this: real late buyers are established, spread across artists, and
// not a majority of the flow right before one account's exit. Repeat offenders (the same feeders backing
// the same beneficiary more than once) are marked `recurring`.
// ---------------------------------------------------------------------------------------------
export const PUMP_WINDOW_HOURS = 24;
export const PUMP_MIN_PROFIT_CENTS = 20_000;     // 200 Credits
export const PUMP_MIN_FEEDERS = 2;
export const THIN_ACCOUNT_DAYS = 7;
export const THIN_CONCENTRATION = 0.8;

export type PumpAccount = { id: number; createdAt: string; invitedBy?: number | null };
export type PumpFeeder = {
  userId: number; buysInWindowCents: number; lossCents: number; accountAgeDays: number;
  concentrationPct: number; invitedByBeneficiary: boolean;
};
export type PumpPattern = {
  beneficiaryId: number; artistId: number; startedAt: string; endedAt: string; profitCents: number;
  feeders: PumpFeeder[]; feederLossCents: number; feederShareOfOtherBuyingPct: number; recurring: boolean;
};

export function findPumpPatterns(
  trades: AuditTrade[],
  accounts: Map<number, PumpAccount>,
  // what each open position would pay if sold now, per user+artist (so open feeder losses count)
  openValueCents: (userId: number, artistId: number) => number,
): PumpPattern[] {
  const byArtistUser = new Map<string, AuditTrade[]>();
  const buysByUser = new Map<number, number>();
  for (const t of trades) {
    const k = `${t.artist_id}:${t.user_id}`;
    (byArtistUser.get(k) ?? byArtistUser.set(k, []).get(k)!).push(t);
    if (t.type === 'buy') buysByUser.set(t.user_id, (buysByUser.get(t.user_id) ?? 0) - t.credits_delta_cents);
  }
  const resultOn = (userId: number, artistId: number) => {
    const list = byArtistUser.get(`${artistId}:${userId}`) ?? [];
    const net = list.reduce((s, t) => s + t.credits_delta_cents, 0);              // received − spent
    const spent = list.filter((t) => t.type === 'buy').reduce((s, t) => s - t.credits_delta_cents, 0);
    return { pnl: net + openValueCents(userId, artistId), spent };
  };

  const flagged: PumpPattern[] = [];
  for (const ep of findRoundTripEpisodes(trades)) {
    if (ep.profitCents < PUMP_MIN_PROFIT_CENTS) continue;
    const end = new Date(ep.endedAt).getTime();
    const from = Math.max(new Date(ep.startedAt).getTime(), end - PUMP_WINDOW_HOURS * 3_600_000);
    const otherBuys = trades.filter((t) => t.artist_id === ep.artistId && t.user_id !== ep.userId && t.type === 'buy'
      && new Date(t.created_at).getTime() >= from && new Date(t.created_at).getTime() <= end);
    if (otherBuys.length === 0) continue;
    const buyBy = new Map<number, { cents: number; first: string }>();
    for (const t of otherBuys) {
      const b = buyBy.get(t.user_id) ?? { cents: 0, first: t.created_at };
      b.cents += -t.credits_delta_cents; if (t.created_at < b.first) b.first = t.created_at;
      buyBy.set(t.user_id, b);
    }
    const totalOther = [...buyBy.values()].reduce((s, b) => s + b.cents, 0);
    const feeders: PumpFeeder[] = [];
    for (const [userId, b] of buyBy) {
      const acct = accounts.get(userId);
      const r = resultOn(userId, ep.artistId);
      if (!(r.pnl < 0)) continue;
      const ageDays = acct ? (new Date(b.first).getTime() - new Date(acct.createdAt).getTime()) / 86_400_000 : Infinity;
      const concentration = r.spent / Math.max(1, buysByUser.get(userId) ?? r.spent);
      const invited = acct?.invitedBy === ep.userId;
      if (ageDays < THIN_ACCOUNT_DAYS || concentration >= THIN_CONCENTRATION || invited) {
        feeders.push({ userId, buysInWindowCents: b.cents, lossCents: -r.pnl, accountAgeDays: Math.round(ageDays * 10) / 10,
          concentrationPct: Math.round(concentration * 1000) / 10, invitedByBeneficiary: invited });
      }
    }
    const feederBuys = feeders.reduce((s, f) => s + f.buysInWindowCents, 0);
    const feederLoss = feeders.reduce((s, f) => s + f.lossCents, 0);
    if (feeders.length >= PUMP_MIN_FEEDERS && feederBuys * 2 >= totalOther && feederLoss * 4 >= ep.profitCents) {
      flagged.push({
        beneficiaryId: ep.userId, artistId: ep.artistId, startedAt: ep.startedAt, endedAt: ep.endedAt, profitCents: ep.profitCents,
        feeders: feeders.sort((a, b) => b.lossCents - a.lossCents), feederLossCents: feederLoss,
        feederShareOfOtherBuyingPct: Math.round((feederBuys / totalOther) * 1000) / 10, recurring: false,
      });
    }
  }
  // the same beneficiary fed by an overlapping set of accounts more than once
  for (const p of flagged) {
    const mine = new Set(p.feeders.map((f) => f.userId));
    p.recurring = flagged.some((q) => q !== p && q.beneficiaryId === p.beneficiaryId && q.feeders.some((f) => mine.has(f.userId)));
  }
  return flagged;
}
