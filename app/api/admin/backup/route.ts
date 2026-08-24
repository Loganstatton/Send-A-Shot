import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { listBackups, runBackup } from '@/lib/db-backup';

export const dynamic = 'force-dynamic';

// Same dual-auth pattern as the sync/discovery routes: an admin session (a
// manual "Back up now" click), or the shared CRON_SECRET for the daily
// GitHub Actions workflow — see .github/workflows/discovery-scan.yml.
async function isAuthorized(req: Request): Promise<boolean> {
  const admin = await getAdminUser();
  if (admin) return true;
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get('x-cron-secret') === secret;
}

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const result = runBackup();
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Backup failed.' }, { status: 500 });
  }
}

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(listBackups());
}
