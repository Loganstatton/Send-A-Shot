import { NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/audit';
import { getAdminUser } from '@/lib/auth';
import { listBackups, runBackup } from '@/lib/db-backup';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as the sync/discovery routes: an admin session (a
// manual "Back up now" click), or the shared CRON_SECRET for the daily
// GitHub Actions workflow — see .github/workflows/discovery-scan.yml.
async function authorizedActor(req: Request): Promise<{ id: number | null } | null> {
  const admin = await getAdminUser();
  if (admin) return { id: admin.id };
  const secret = process.env.CRON_SECRET;
  return secret && req.headers.get('x-cron-secret') === secret ? { id: null } : null;
}

export async function POST(req: Request) {
  const actor = await authorizedActor(req);
  if (!actor) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = await runBackup();
    if (actor.id != null) await logAdminAction(actor.id, 'backup_created', { type: 'snapshot', id: result.fileName });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Backup failed.' }, { status: 500 });
  }
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await listBackups());
}
