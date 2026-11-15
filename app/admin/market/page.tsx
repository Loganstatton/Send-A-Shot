import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { formatCents } from '@/lib/format';
import { getDepthChanges, getLastReconciliation, getMarketOverview, getMaxAllowedDepths, verifyMarketMigration } from '@/lib/market-ledger';
import { BUY_FEE_BPS, DEPTH_MAX_STEP, DEPTH_STEP_WINDOW_DAYS } from '@/lib/next-market';
import AdminTabs from '@/components/AdminTabs';
import { DepthControl, HaltControl, ReconcileButton } from '@/components/admin/MarketControls';

export const metadata: Metadata = { title: { absolute: 'Market maker — Scout' } };
export const dynamic = 'force-dynamic';

const credits = (c: number) => formatCents(Math.round(c));

export default async function AdminMarketPage() {
  await requireAdmin();
  const [overview, last, migration, changes, maxDepths] = await Promise.all([
    getMarketOverview(), getLastReconciliation(), verifyMarketMigration(), getDepthChanges(20), getMaxAllowedDepths(),
  ]);
  const listed = overview.artists.filter((a) => a.priceCents != null);
  const halted = overview.artists.filter((a) => a.haltedAt);
  const totalReserve = listed.reduce((t, a) => t + a.reserveCents, 0);
  const totalOwed = listed.reduce((t, a) => t + a.owedCents, 0);

  return (
    <div className="space-y-6">
      <AdminTabs />
      <div>
        <h1 className="text-2xl font-bold">Market maker</h1>
        <p className="text-sm" style={{ color: 'var(--text-faint)' }}>
          Every artist&apos;s automated market maker: its reserve must always cover what all its holders could be paid.
          Purchases pay a {BUY_FEE_BPS / 100}% fee into the fee pool; sales pay none. Depth changes happen only when an admin
          approves one here — at most ×{DEPTH_MAX_STEP} in {DEPTH_STEP_WINDOW_DAYS} days, increases only. Virtual Credits only.
        </p>
      </div>

      <div className="card space-y-2">
        <h2 className="font-bold text-lg">Books</h2>
        <p className="text-sm m-0">
          Reserves {credits(totalReserve)} cover {credits(totalOwed)} owed to holders across {listed.length} listed artists
          (margin {credits(totalReserve - totalOwed)}). Fee pool {credits(overview.feePoolCents)}.
        </p>
        <p className="text-sm m-0">
          Last reconciliation:{' '}
          {last ? (
            <strong style={{ color: last.ok ? 'var(--up)' : 'var(--down)' }}>{last.ok ? 'all checks passed' : `${last.issues.length} issue(s)`}</strong>
          ) : 'not run yet'}
          {last && <> at {new Date(last.runAt).toUTCString()} · players {credits(last.totals.playersCents)}, reserves {credits(last.totals.reservesCents)}, fees {credits(last.totals.feePoolCents)}, retired {credits(last.totals.retiredCents)} = issued {credits(last.totals.issuedCents)} + opening reserves {credits(last.totals.openingReserveCents)} + liquidity {credits(last.totals.liquidityAddedCents)}</>}
        </p>
        {last && !last.ok && (
          <ul className="text-sm m-0">
            {last.issues.slice(0, 20).map((i, n) => (
              <li key={n}>{i.check}{i.artistId != null && <> · <Link className="underline" href={`/artists/${i.artistId}`}>artist #{i.artistId}</Link></>}{i.userId != null && <> · user #{i.userId}</>}: {i.detail}</li>
            ))}
          </ul>
        )}
        <ReconcileButton />
      </div>

      <div className="card space-y-1">
        <h2 className="font-bold text-lg">Phase 1 migration proof</h2>
        <p className="text-sm m-0">
          <strong style={{ color: migration.ok ? 'var(--up)' : 'var(--down)' }}>{migration.ok ? 'Verified' : 'Needs review'}</strong>
          {migration.recordedAt && <> · taken {new Date(migration.recordedAt).toUTCString()}</>}
        </p>
        <p className="text-sm m-0">
          {migration.balances.players} balances ({credits(migration.balances.totalCents)}) entered the ledger unchanged: {migration.balances.ledgerOpenedWithSameBalances ? 'yes' : 'NO'}.
          {' '}{migration.holdings.count} holdings worth {credits(migration.holdings.valueBeforeCents)} before and {credits(migration.holdings.valueAfterCents)} after; {migration.holdings.holdingsWhoseValueChanged} changed.
          {' '}{migration.reserves.artistsFunded} reserves funded with {credits(migration.reserves.openingReserveCents)} to cover {credits(migration.reserves.owedAtMigrationCents)} owed: {migration.reserves.everyReserveCovered ? 'covered' : 'NOT covered'}.
          {' '}History: {migration.history.transactionsAtMigration} trades and {migration.history.priceHistoryAtMigration} price points at migration, none removed since: {migration.history.nothingRemoved ? 'yes' : 'NO'}.
        </p>
      </div>

      {halted.length > 0 && (
        <div className="card space-y-2" style={{ border: '1px solid var(--fire-line)' }}>
          <h2 className="font-bold text-lg">Paused ({halted.length})</h2>
          {halted.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-3 flex-wrap text-sm">
              <span><Link className="underline" href={`/artists/${a.id}`}>{a.name}</Link> — {a.haltReason}</span>
              <HaltControl artistId={a.id} halted />
            </div>
          ))}
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="font-bold text-lg">Artists ({listed.length} listed)</h2>
        <p className="text-sm m-0" style={{ color: 'var(--text-faint)' }}>
          {overview.activeTraders30d} players traded in the last 30 days; at 1,000 Credits of depth per active player the
          recommended depth would be {credits(overview.recommendedDepthCents)}. A recommendation only — nothing changes unless approved.
        </p>
        <div className="space-y-4">
          {listed.slice(0, 60).map((a) => (
            <div key={a.id} className="rounded-lg px-4 py-3 space-y-2" style={{ border: '1px solid var(--line)' }}>
              <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
                <span className="font-medium"><Link className="underline" href={`/artists/${a.id}`}>{a.name}</Link> <span style={{ color: 'var(--text-faint)' }}>({a.listingRule === 'uniform' ? 'uniform listing' : 'Score listing'})</span></span>
                <span>price {formatCents(a.priceCents)} · {a.holders} holder(s) · {a.sharesOutstanding.toFixed(4)} shares · reserve {credits(a.reserveCents)} · owed {credits(a.owedCents)} · margin {credits(a.marginCents)}</span>
                {!a.haltedAt && <HaltControl artistId={a.id} halted={false} />}
              </div>
              <DepthControl artistId={a.id} depthCents={a.depthCents} maxAllowedDepthCents={maxDepths.get(a.id) ?? a.depthCents} />
            </div>
          ))}
        </div>
      </div>

      <div className="card space-y-2">
        <h2 className="font-bold text-lg">Depth changes ({changes.length})</h2>
        {changes.length === 0 ? <p className="text-sm m-0" style={{ color: 'var(--text-muted)' }}>None yet.</p> : (
          <ul className="text-sm m-0">
            {changes.map((c) => (
              <li key={String(c.id)}>
                {String(c.created_at)} · artist #{String(c.artist_id)} · {credits(Number(c.old_depth_cents))} → {credits(Number(c.new_depth_cents))} · top-up {credits(Number(c.top_up_cents))} (fees {credits(Number(c.from_fee_pool_cents))}, liquidity {credits(Number(c.from_liquidity_cents))}) · approved by user #{String(c.approved_by_user_id)}{c.note ? ` — ${String(c.note)}` : ''}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
