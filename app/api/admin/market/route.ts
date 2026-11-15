import { NextResponse } from 'next/server';
import { getLastReconciliation, getMarketOverview, verifyMarketMigration } from '@/lib/market-ledger';
import { adminOrCron } from './auth';

export const dynamic = 'force-dynamic';

// The market maker at a glance: every artist's curve, reserve and margin, the fee pool, the last
// reconciliation, and the proof that the Phase 1 migration preserved everything. Ids and numbers only.
export async function GET(req: Request) {
  if (!(await adminOrCron(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [overview, lastReconciliation, migration] = await Promise.all([getMarketOverview(), getLastReconciliation(), verifyMarketMigration()]);
  return NextResponse.json({ overview, lastReconciliation, migration });
}
