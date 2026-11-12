import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { restoreBackup } from '@/lib/db-backup';
import { logServerError } from '@/lib/error-log';

export const dynamic = 'force-dynamic';

// Replaces the live database's contents with a stored snapshot. Admin
// session only, and the request must repeat the snapshot's exact file name
// as `confirm` — a deliberate second step so this can't happen from a stray
// click or a replayed request for a different file. restoreBackup() itself
// takes a 'pre-restore' snapshot first, so the restore can be undone.
export async function POST(req: Request, props: { params: Promise<{ fileName: string }> }) {
  const params = await props.params;
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { confirm?: string } | null;
  if (!body || body.confirm !== params.fileName) {
    return NextResponse.json({ error: 'Type the snapshot file name exactly to confirm.' }, { status: 400 });
  }

  try {
    const result = await restoreBackup(params.fileName);
    return NextResponse.json(result);
  } catch (err: any) {
    // Best-effort: the restore's own transaction rolled back, so the
    // database (including error_reports) is as it was before the attempt.
    await logServerError('database restore', err, { path: `/api/admin/backup/${params.fileName}/restore`, userId: admin.id });
    return NextResponse.json({ error: err?.message ?? 'Restore failed.' }, { status: 500 });
  }
}
