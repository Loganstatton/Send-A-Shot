// The NEXT market maker's books (Phase 1): a double-entry Credit ledger, the per-artist reserve invariant,
// reconciliation, the migration proof, and admin-approved depth changes. See docs/PHASE-1-REPORT.md.
//
// Accounts (next_ledger.account):
//   user:<id>         a player's Credits                       reserve:<artist id>  what that artist's market maker holds
//   fees              the 0.5% buy-fee pool                    issuance             Credits given to players (negative)
//   opening_reserve   virtual Credits that funded reserves at migration (negative)
//   liquidity         virtual Credits added by approved depth increases (negative)
//   retired           Credits of deleted accounts / artists
// Every entry's rows sum to zero, so Credits are never created or destroyed except through the three
// disclosed sources (issuance, opening_reserve, liquidity), and reconciliation proves it.
import { randomUUID } from 'node:crypto';
import { db } from './pg';
import {
  DEPTH_MAX_STEP, DEPTH_STEP_WINDOW_DAYS, DEFAULT_DEPTH_CENTS, anchorFor, curvePriceCents, exitValueCents, owedCents,
  phase0ExitValueCents, planDepthIncrease, recommendedDepthCents, type DepthPlan,
} from './next-market';

export const FEES = 'fees';
export const ISSUANCE = 'issuance';
export const OPENING_RESERVE = 'opening_reserve';
export const LIQUIDITY = 'liquidity';
export const RETIRED = 'retired';
export const userAccount = (id: number) => `user:${id}`;
export const reserveAccount = (artistId: number) => `reserve:${artistId}`;

export type LedgerKind =
  | 'opening_balance' | 'opening_reserve' | 'signup_grant' | 'buy' | 'sell' | 'depth_topup' | 'account_deleted' | 'artist_deleted';
export type LedgerLeg = { account: string; amountCents: number; userId?: number | null; artistId?: number | null };

// Writes one balanced entry. Must run inside the same db.transaction() as the balance changes it records.
export async function postLedgerEntry(
  kind: LedgerKind, legs: LedgerLeg[], opts: { transactionId?: number | null; memo?: string; createdAt?: string } = {}
): Promise<string> {
  const rows = legs.filter((l) => l.amountCents !== 0);
  for (const l of rows) if (!Number.isInteger(l.amountCents)) throw new MarketInvariantError(`ledger amount must be whole cents (${l.account}: ${l.amountCents})`);
  const sum = rows.reduce((t, l) => t + l.amountCents, 0);
  if (sum !== 0) throw new MarketInvariantError(`ledger entry '${kind}' does not balance (sum ${sum})`);
  const entryId = randomUUID();
  const at = opts.createdAt ?? new Date().toISOString();
  for (const l of rows) {
    await db.prepare(
      'INSERT INTO next_ledger (entry_id, created_at, account, amount_cents, kind, user_id, artist_id, transaction_id, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(entryId, at, l.account, l.amountCents, kind, l.userId ?? null, l.artistId ?? null, opts.transactionId ?? null, opts.memo ?? null);
  }
  return entryId;
}

export class MarketInvariantError extends Error {}

export type CurveState = { priceCents: number; anchorCents: number; depthCents: number; sharesOutstanding: number; reserveCents: number };
// Owed = what every holder together could get by selling everything now. The reserve must cover it; the
// price must sit on the curve for the shares held. Tolerances are far below a cent (floating-point only).
export const RESERVE_TOLERANCE_CENTS = 1e-6;
export const PRICE_TOLERANCE = 1e-9;
export function checkCurveState(s: CurveState): { ok: boolean; owedCents: number; marginCents: number; priceDrift: number; problem?: string } {
  const owed = owedCents(s.priceCents, s.anchorCents, s.depthCents);
  const implied = curvePriceCents(s.anchorCents, s.sharesOutstanding, s.depthCents);
  const priceDrift = Math.abs(s.priceCents / implied - 1);
  const marginCents = s.reserveCents - owed;
  let problem: string | undefined;
  if (!(s.anchorCents > 0)) problem = 'no anchor';
  else if (s.reserveCents < 0) problem = 'negative reserve';
  else if (s.sharesOutstanding < -1e-12) problem = 'negative shares outstanding';
  else if (marginCents < -RESERVE_TOLERANCE_CENTS) problem = `reserve ${s.reserveCents} is below what holders are owed (${owed.toFixed(6)})`;
  else if (!(priceDrift <= PRICE_TOLERANCE)) problem = `price ${s.priceCents} is off the curve (implied ${implied})`;
  return { ok: !problem, owedCents: owed, marginCents, priceDrift, problem };
}

// --- halts (circuit breaker) ----------------------------------------------------------------------------
export async function haltArtistTrading(artistId: number, reason: string): Promise<void> {
  await db.prepare('UPDATE artists SET next_trading_halted_at = COALESCE(next_trading_halted_at, ?), next_trading_halt_reason = ? WHERE id = ?')
    .run(new Date().toISOString(), reason.slice(0, 500), artistId);
}
export async function resumeArtistTrading(artistId: number): Promise<boolean> {
  const info = await db.prepare('UPDATE artists SET next_trading_halted_at = NULL, next_trading_halt_reason = NULL WHERE id = ?').run(artistId);
  return info.changes > 0;
}

// --- reconciliation -------------------------------------------------------------------------------------
export type ReconciliationIssue = { check: string; artistId?: number; userId?: number; account?: string; detail: string };
export type ReconciliationReport = {
  runAt: string; ok: boolean;
  checked: { ledgerEntries: number; users: number; artists: number };
  totals: {
    playersCents: number; reservesCents: number; feePoolCents: number; retiredCents: number;
    issuedCents: number; openingReserveCents: number; liquidityAddedCents: number; owedToHoldersCents: number;
  };
  issues: ReconciliationIssue[];
  haltedArtistIds: number[];
};

const sumAccount = async (account: string) =>
  Number(((await db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM next_ledger WHERE account = ?').get(account)) as { s: number }).s);
export async function getFeePoolCents(): Promise<number> { return await sumAccount(FEES); }

// Proves, from the database alone: every ledger entry balances; every player's balance and every reserve
// equals its ledger account; shares held + retired = the curve's shares outstanding; every reserve covers
// everything its holders could be paid; prices sit on their curves; no negative balances or holdings; and
// players + reserves + fees + retired = Credits issued + opening reserves + liquidity added.
// With haltOnFailure, any artist failing an artist-level check stops trading until an admin resumes it.
export async function reconcileMarket(opts: { haltOnFailure?: boolean; record?: boolean } = {}): Promise<ReconciliationReport> {
  const issues: ReconciliationIssue[] = [];
  const badArtists = new Set<number>();

  const entries = (await db.prepare('SELECT COUNT(DISTINCT entry_id) AS n FROM next_ledger').get()) as { n: number };
  const unbalanced = (await db.prepare(
    'SELECT entry_id, SUM(amount_cents) AS s FROM next_ledger GROUP BY entry_id HAVING SUM(amount_cents) <> 0 LIMIT 50'
  ).all()) as { entry_id: string; s: number }[];
  for (const u of unbalanced) issues.push({ check: 'entry_balances', detail: `entry ${u.entry_id} sums to ${u.s}` });

  const users = (await db.prepare(`
    SELECT u.id, u.next_credits_cents AS balance, COALESCE(l.s, 0) AS ledger
    FROM users u LEFT JOIN (SELECT account, SUM(amount_cents) AS s FROM next_ledger WHERE account LIKE 'user:%' GROUP BY account) l
      ON l.account = 'user:' || u.id
  `).all()) as { id: number; balance: number; ledger: number }[];
  for (const u of users) {
    if (u.balance !== u.ledger) issues.push({ check: 'player_balance_matches_ledger', userId: u.id, detail: `balance ${u.balance}, ledger ${u.ledger}` });
    if (u.balance < 0) issues.push({ check: 'no_negative_balance', userId: u.id, detail: `balance ${u.balance}` });
  }
  const orphanUsers = (await db.prepare(`
    SELECT account, SUM(amount_cents) AS s FROM next_ledger WHERE account LIKE 'user:%'
      AND NOT EXISTS (SELECT 1 FROM users u WHERE 'user:' || u.id = next_ledger.account)
    GROUP BY account HAVING SUM(amount_cents) <> 0
  `).all()) as { account: string; s: number }[];
  for (const o of orphanUsers) issues.push({ check: 'deleted_accounts_retired', account: o.account, detail: `still holds ${o.s}` });

  const artists = (await db.prepare(`
    SELECT a.id, a.next_current_price_cents AS price, a.next_anchor_price_cents AS anchor, a.next_depth_cents AS depth,
           a.next_shares_outstanding AS q, a.next_retired_shares AS retired, a.next_reserve_cents AS reserve,
           COALESCE((SELECT SUM(h.shares) FROM next_holdings h WHERE h.artist_id = a.id), 0) AS held,
           COALESCE((SELECT MIN(h.shares) FROM next_holdings h WHERE h.artist_id = a.id), 0) AS min_held,
           COALESCE(l.s, 0) AS ledger
    FROM artists a LEFT JOIN (SELECT account, SUM(amount_cents) AS s FROM next_ledger WHERE account LIKE 'reserve:%' GROUP BY account) l
      ON l.account = 'reserve:' || a.id
  `).all()) as { id: number; price: number | null; anchor: number | null; depth: number; q: number; retired: number; reserve: number; held: number; min_held: number; ledger: number }[];
  let owedTotal = 0;
  for (const a of artists) {
    const flag = (check: string, detail: string) => { issues.push({ check, artistId: a.id, detail }); badArtists.add(a.id); };
    if (a.reserve !== a.ledger) flag('reserve_matches_ledger', `reserve ${a.reserve}, ledger ${a.ledger}`);
    if (Math.abs(a.held + a.retired - a.q) > 1e-9) flag('shares_held_match_curve', `held ${a.held} + retired ${a.retired} ≠ outstanding ${a.q}`);
    if (a.min_held < 0) flag('no_negative_holdings', `a holding of ${a.min_held}`);
    if (a.price == null) {
      if (a.q > 0 || a.reserve !== 0) flag('unlisted_artist_empty', `no price but ${a.q} shares / reserve ${a.reserve}`);
      continue;
    }
    const c = checkCurveState({ priceCents: a.price, anchorCents: a.anchor ?? 0, depthCents: a.depth, sharesOutstanding: a.q, reserveCents: a.reserve });
    owedTotal += c.owedCents;
    if (!c.ok) flag('reserve_covers_holders', c.problem!);
  }
  const missingReserves = (await db.prepare(`
    SELECT account, SUM(amount_cents) AS s FROM next_ledger WHERE account LIKE 'reserve:%'
      AND NOT EXISTS (SELECT 1 FROM artists a WHERE 'reserve:' || a.id = next_ledger.account)
    GROUP BY account HAVING SUM(amount_cents) <> 0
  `).all()) as { account: string; s: number }[];
  for (const o of missingReserves) issues.push({ check: 'deleted_artists_retired', account: o.account, detail: `still holds ${o.s}` });

  const totals = {
    playersCents: users.reduce((t, u) => t + u.balance, 0),
    reservesCents: artists.reduce((t, a) => t + a.reserve, 0),
    feePoolCents: await sumAccount(FEES),
    retiredCents: await sumAccount(RETIRED),
    issuedCents: -(await sumAccount(ISSUANCE)),
    openingReserveCents: -(await sumAccount(OPENING_RESERVE)),
    liquidityAddedCents: -(await sumAccount(LIQUIDITY)),
    owedToHoldersCents: Math.round(owedTotal * 100) / 100,
  };
  if (totals.feePoolCents < 0) issues.push({ check: 'fee_pool_not_negative', detail: `fee pool ${totals.feePoolCents}` });
  const held = totals.playersCents + totals.reservesCents + totals.feePoolCents + totals.retiredCents;
  const sources = totals.issuedCents + totals.openingReserveCents + totals.liquidityAddedCents;
  if (held !== sources) issues.push({ check: 'credits_conserved', detail: `players+reserves+fees+retired ${held} ≠ issued+opening+liquidity ${sources}` });

  const haltedArtistIds: number[] = [];
  if (opts.haltOnFailure) {
    for (const id of badArtists) { await haltArtistTrading(id, 'Automatic: market reconciliation found a problem; an admin must review before trading resumes.'); haltedArtistIds.push(id); }
  }
  const report: ReconciliationReport = {
    runAt: new Date().toISOString(), ok: issues.length === 0,
    checked: { ledgerEntries: entries.n, users: users.length, artists: artists.length },
    totals, issues: issues.slice(0, 200), haltedArtistIds,
  };
  if (opts.record) {
    await db.prepare('INSERT INTO next_reconciliation_runs (run_at, ok, summary_json) VALUES (?, ?, ?)').run(report.runAt, report.ok ? 1 : 0, JSON.stringify(report));
  }
  return report;
}

export async function getLastReconciliation(): Promise<ReconciliationReport | null> {
  const row = (await db.prepare('SELECT summary_json FROM next_reconciliation_runs ORDER BY id DESC LIMIT 1').get()) as { summary_json: string } | undefined;
  return row ? (JSON.parse(row.summary_json) as ReconciliationReport) : null;
}

// --- migration proof --------------------------------------------------------------------------------------
export type MigrationVerification = {
  ok: boolean; recordedAt: string | null;
  balances: { players: number; totalCents: number; ledgerOpenedWithSameBalances: boolean };
  holdings: { count: number; valueBeforeCents: number; valueAfterCents: number; holdingsWhoseValueChanged: number; largestChangeCents: number };
  reserves: { artistsFunded: number; openingReserveCents: number; owedAtMigrationCents: number; everyReserveCovered: boolean };
  history: { transactionsAtMigration: number; priceHistoryAtMigration: number; transactionsNow: number; priceHistoryNow: number; nothingRemoved: boolean };
};
// From the snapshot migration 016 took: every balance went into the ledger unchanged; every holding is
// worth exactly what it was worth under Phase 0 (same price, same shares); every reserve covered its holders
// at migration; and no transaction or price-history row has disappeared since.
export async function verifyMarketMigration(): Promise<MigrationVerification> {
  const snap = (await db.prepare('SELECT * FROM next_market_migration_snapshot ORDER BY id').all()) as {
    recorded_at: string; kind: string; user_id: number | null; artist_id: number | null; credits_cents: number | null;
    shares: number | null; price_cents: number | null; count_value: number | null;
  }[];
  const balances = snap.filter((r) => r.kind === 'balance');
  const opening = new Map(((await db.prepare("SELECT user_id, amount_cents FROM next_ledger WHERE kind = 'opening_balance' AND account LIKE 'user:%'").all()) as
    { user_id: number; amount_cents: number }[]).map((r) => [r.user_id, r.amount_cents]));
  const ledgerOpenedWithSameBalances = balances.every((b) => (opening.get(b.user_id!) ?? 0) === b.credits_cents) && opening.size === balances.length;

  let before = 0, after = 0, changed = 0, largest = 0;
  const holdings = snap.filter((r) => r.kind === 'holding');
  for (const h of holdings) {
    const b = phase0ExitValueCents(h.price_cents!, h.shares!);
    const a = exitValueCents(h.price_cents!, h.shares!, DEFAULT_DEPTH_CENTS);
    before += b; after += a;
    if (a !== b) { changed++; largest = Math.max(largest, Math.abs(a - b)); }
  }
  const reserves = (await db.prepare("SELECT artist_id, amount_cents FROM next_ledger WHERE kind = 'opening_reserve' AND account LIKE 'reserve:%'").all()) as
    { artist_id: number; amount_cents: number }[];
  const reserveBy = new Map(reserves.map((r) => [r.artist_id, r.amount_cents]));
  const sharesBy = new Map<number, number>();
  for (const h of holdings) sharesBy.set(h.artist_id!, (sharesBy.get(h.artist_id!) ?? 0) + h.shares!);
  let owed = 0, covered = true;
  for (const a of snap.filter((r) => r.kind === 'artist' && r.price_cents != null)) {
    const q = sharesBy.get(a.artist_id!) ?? 0;
    const o = owedCents(a.price_cents!, anchorFor(a.price_cents!, q, DEFAULT_DEPTH_CENTS), DEFAULT_DEPTH_CENTS);
    owed += o;
    if ((reserveBy.get(a.artist_id!) ?? 0) + RESERVE_TOLERANCE_CENTS < o) covered = false;
  }
  const count = (k: string) => Number(snap.find((r) => r.kind === k)?.count_value ?? 0);
  const txNow = Number(((await db.prepare('SELECT COUNT(*) AS n FROM next_transactions').get()) as { n: number }).n);
  const phNow = Number(((await db.prepare('SELECT COUNT(*) AS n FROM next_price_history').get()) as { n: number }).n);
  const nothingRemoved = txNow >= count('count_transactions') && phNow >= count('count_price_history');
  return {
    ok: ledgerOpenedWithSameBalances && changed === 0 && covered && nothingRemoved && snap.length > 0,
    recordedAt: snap[0]?.recorded_at ?? null,
    balances: { players: balances.length, totalCents: balances.reduce((t, b) => t + (b.credits_cents ?? 0), 0), ledgerOpenedWithSameBalances },
    holdings: { count: holdings.length, valueBeforeCents: before, valueAfterCents: after, holdingsWhoseValueChanged: changed, largestChangeCents: largest },
    reserves: { artistsFunded: reserves.length, openingReserveCents: reserves.reduce((t, r) => t + r.amount_cents, 0), owedAtMigrationCents: Math.round(owed * 100) / 100, everyReserveCovered: covered },
    history: { transactionsAtMigration: count('count_transactions'), priceHistoryAtMigration: count('count_price_history'), transactionsNow: txNow, priceHistoryNow: phNow, nothingRemoved },
  };
}

// --- depth changes (admin approval only) -------------------------------------------------------------------
type ArtistCurveRow = {
  id: number; price: number | null; anchor: number | null; depth: number; q: number; reserve: number;
};
async function readArtistCurve(artistId: number, lock: boolean): Promise<ArtistCurveRow | undefined> {
  return (await db.prepare(`
    SELECT id, next_current_price_cents AS price, next_anchor_price_cents AS anchor, next_depth_cents AS depth,
           next_shares_outstanding AS q, next_reserve_cents AS reserve
    FROM artists WHERE id = ?${lock ? ' FOR UPDATE' : ''}
  `).get(artistId)) as ArtistCurveRow | undefined;
}
async function depthWindowStart(artistId: number, currentDepth: number): Promise<number> {
  const cutoff = new Date(Date.now() - DEPTH_STEP_WINDOW_DAYS * 86_400_000).toISOString();
  const row = (await db.prepare('SELECT old_depth_cents FROM next_depth_changes WHERE artist_id = ? AND created_at >= ? ORDER BY created_at ASC, id ASC LIMIT 1')
    .get(artistId, cutoff)) as { old_depth_cents: number } | undefined;
  return row ? row.old_depth_cents : currentDepth;
}
export async function getActiveTraderCount(days = 30): Promise<number> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return Number(((await db.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM next_transactions WHERE created_at >= ?').get(cutoff)) as { n: number }).n);
}

export type DepthPreview = DepthPlan & {
  artistId: number; listed: boolean; maxAllowedDepthCents: number; recommendedDepthCents: number;
  feePoolCents: number; fromFeePoolCents: number; fromLiquidityCents: number;
  holders: { count: number; valueBeforeCents: number; valueAfterCents: number; smallestChangePct: number; largestChangePct: number;
    each: { userId: number; shares: number; valueBeforeCents: number; valueAfterCents: number }[] };
};
// Everything an admin sees before approving: the price stays the same, nobody's shares change, every holder's
// value can only rise (less slippage), the reserve top-up and where it comes from (fee pool first).
export async function previewDepthChange(artistId: number, newDepthCents: number, lock = false): Promise<DepthPreview | { error: string }> {
  const a = await readArtistCurve(artistId, lock);
  if (!a) return { error: 'artist not found' };
  const windowStart = await depthWindowStart(artistId, a.depth);
  const feePoolCents = await getFeePoolCents();
  const recommended = recommendedDepthCents(await getActiveTraderCount());
  const priceCents = a.price ?? 0;
  const plan = planDepthIncrease({ priceCents: priceCents || 1, sharesOutstanding: a.q, reserveCents: a.reserve, depthCents: a.depth, newDepthCents, depthWindowStartCents: windowStart });
  const holdingRows = (await db.prepare('SELECT user_id, shares FROM next_holdings WHERE artist_id = ? ORDER BY shares DESC').all(artistId)) as { user_id: number; shares: number }[];
  const each = a.price == null ? [] : holdingRows.map((h) => ({
    userId: h.user_id, shares: h.shares,
    valueBeforeCents: exitValueCents(a.price!, h.shares, a.depth), valueAfterCents: exitValueCents(a.price!, h.shares, newDepthCents),
  }));
  const pct = (e: { valueBeforeCents: number; valueAfterCents: number }) => (e.valueBeforeCents > 0 ? ((e.valueAfterCents - e.valueBeforeCents) / e.valueBeforeCents) * 100 : 0);
  const topUp = a.price == null ? 0 : plan.topUpCents;
  const fromFee = Math.min(topUp, Math.max(0, feePoolCents));
  return {
    ...plan, topUpCents: topUp, priceCents, artistId, listed: a.price != null,
    maxAllowedDepthCents: Math.floor(windowStart * DEPTH_MAX_STEP), recommendedDepthCents: recommended,
    feePoolCents, fromFeePoolCents: fromFee, fromLiquidityCents: topUp - fromFee,
    holders: {
      count: each.length,
      valueBeforeCents: each.reduce((t, e) => t + e.valueBeforeCents, 0), valueAfterCents: each.reduce((t, e) => t + e.valueAfterCents, 0),
      smallestChangePct: each.length ? Math.min(...each.map(pct)) : 0, largestChangePct: each.length ? Math.max(...each.map(pct)) : 0,
      each: each.slice(0, 50),
    },
  };
}

// Applies an approved depth increase atomically: re-anchors the curve around the current price, tops up the
// reserve (fee pool first, then disclosed liquidity), records who approved it, and re-checks the invariant.
export async function applyDepthChange(artistId: number, newDepthCents: number, approvedByUserId: number, note?: string):
  Promise<{ ok: true; change: DepthPreview } | { ok: false; error: string }> {
  return await db.transaction(async () => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext('next-fee-pool'))").get();
    const p = await previewDepthChange(artistId, newDepthCents, true);
    if ('error' in p) return { ok: false as const, error: p.error };
    if (!p.ok) return { ok: false as const, error: p.reason ?? 'not allowed' };
    const now = new Date().toISOString();
    if (p.listed && p.topUpCents > 0) {
      await postLedgerEntry('depth_topup', [
        { account: reserveAccount(artistId), amountCents: p.topUpCents, artistId },
        { account: FEES, amountCents: -p.fromFeePoolCents, artistId },
        { account: LIQUIDITY, amountCents: -p.fromLiquidityCents, artistId },
      ], { memo: `depth ${p.oldDepthCents} → ${newDepthCents}`, createdAt: now });
    }
    await db.prepare('UPDATE artists SET next_depth_cents = ?, next_anchor_price_cents = ?, next_reserve_cents = next_reserve_cents + ? WHERE id = ?')
      .run(newDepthCents, p.listed ? p.newAnchorCents : null, p.topUpCents, artistId);
    await db.prepare(`
      INSERT INTO next_depth_changes (artist_id, created_at, approved_by_user_id, note, price_cents, shares_outstanding, old_depth_cents, new_depth_cents,
        old_anchor_cents, new_anchor_cents, reserve_before_cents, owed_after_cents, top_up_cents, from_fee_pool_cents, from_liquidity_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(artistId, now, approvedByUserId, note?.slice(0, 500) ?? null, p.priceCents, p.sharesOutstanding, p.oldDepthCents, newDepthCents,
      p.oldAnchorCents, p.newAnchorCents, p.reserveCents, p.owedAfterCents, p.topUpCents, p.fromFeePoolCents, p.fromLiquidityCents);
    if (p.listed) {
      const after = await readArtistCurve(artistId, false);
      const c = checkCurveState({ priceCents: after!.price!, anchorCents: after!.anchor!, depthCents: after!.depth, sharesOutstanding: after!.q, reserveCents: after!.reserve });
      if (!c.ok) throw new MarketInvariantError(`depth change would break the market: ${c.problem}`);
    }
    return { ok: true as const, change: p };
  });
}

export async function getDepthChanges(limit = 50) {
  return (await db.prepare('SELECT * FROM next_depth_changes ORDER BY id DESC LIMIT ?').all(limit)) as Record<string, unknown>[];
}

// --- the market at a glance (admin) -------------------------------------------------------------------------
export type MarketArtistRow = {
  id: number; name: string; priceCents: number | null; depthCents: number; sharesOutstanding: number; reserveCents: number;
  owedCents: number; marginCents: number; holders: number; haltedAt: string | null; haltReason: string | null; listingRule: string;
};
export async function getMarketOverview(): Promise<{ artists: MarketArtistRow[]; feePoolCents: number; activeTraders30d: number; recommendedDepthCents: number }> {
  const rows = (await db.prepare(`
    SELECT a.id, a.name, a.next_current_price_cents AS price, a.next_anchor_price_cents AS anchor, a.next_depth_cents AS depth,
           a.next_shares_outstanding AS q, a.next_reserve_cents AS reserve, a.next_trading_halted_at AS halted_at,
           a.next_trading_halt_reason AS halt_reason, a.next_listing_rule AS rule,
           (SELECT COUNT(*) FROM next_holdings h WHERE h.artist_id = a.id) AS holders
    FROM artists a ORDER BY a.next_reserve_cents DESC, a.id ASC
  `).all()) as { id: number; name: string; price: number | null; anchor: number | null; depth: number; q: number; reserve: number; halted_at: string | null; halt_reason: string | null; rule: string; holders: number }[];
  const active = await getActiveTraderCount();
  return {
    artists: rows.map((r) => {
      const owed = r.price != null && r.anchor ? owedCents(r.price, r.anchor, r.depth) : 0;
      return { id: r.id, name: r.name, priceCents: r.price, depthCents: r.depth, sharesOutstanding: r.q, reserveCents: r.reserve,
        owedCents: owed, marginCents: r.reserve - owed, holders: Number(r.holders), haltedAt: r.halted_at, haltReason: r.halt_reason, listingRule: r.rule };
    }),
    feePoolCents: await getFeePoolCents(), activeTraders30d: active, recommendedDepthCents: recommendedDepthCents(active),
  };
}

// The most each artist's depth may be raised to right now (×1.25 of its depth 7 days ago).
export async function getMaxAllowedDepths(): Promise<Map<number, number>> {
  const cutoff = new Date(Date.now() - DEPTH_STEP_WINDOW_DAYS * 86_400_000).toISOString();
  const starts = new Map(((await db.prepare(`
    SELECT DISTINCT ON (artist_id) artist_id, old_depth_cents FROM next_depth_changes WHERE created_at >= ? ORDER BY artist_id, created_at ASC, id ASC
  `).all(cutoff)) as { artist_id: number; old_depth_cents: number }[]).map((r) => [r.artist_id, r.old_depth_cents]));
  const all = (await db.prepare('SELECT id, next_depth_cents FROM artists').all()) as { id: number; next_depth_cents: number }[];
  return new Map(all.map((a) => [a.id, Math.floor((starts.get(a.id) ?? a.next_depth_cents) * DEPTH_MAX_STEP)]));
}
