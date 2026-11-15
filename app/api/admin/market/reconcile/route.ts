import { NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/audit';
import { reconcileMarket, verifyMarketMigration } from '@/lib/market-ledger';
import { adminOrCron } from '../auth';

export const dynamic = 'force-dynamic';

// Runs the full reconciliation (lib/market-ledger.ts reconcileMarket), records it, and halts trading in
// any artist whose books don't check out. Read-only otherwise. Returns ids and amounts only.
export async function POST(req: Request) {
  const actor = await adminOrCron(req);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const report = await reconcileMarket({ haltOnFailure: true, record: true });
  const migration = await verifyMarketMigration();
  if (actor.id != null) await logAdminAction(actor.id, 'market_reconciled', undefined, report.ok ? 'ok' : `${report.issues.length} issue(s)`);
  return NextResponse.json({ ...report, migration }, { status: report.ok ? 200 : 409 });
}
