import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { getRoundingExploitAudit } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Phase 0: was the old trade-rounding exploit ever used? Read-only; returns account and artist ids only
// (no names or emails). Same dual auth as the backup endpoint: an admin session, or the shared
// CRON_SECRET for the on-demand GitHub Actions run (.github/workflows/market-audit.yml).
export async function GET(req: Request) {
  const admin = await getAdminUser();
  const secret = process.env.CRON_SECRET;
  if (!admin && !(secret && req.headers.get('x-cron-secret') === secret)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await getRoundingExploitAudit());
}
