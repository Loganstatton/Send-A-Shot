import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { getBackupData } from '@/lib/db-backup';

export const dynamic = 'force-dynamic';

// Downloads one snapshot file — the way to get a copy of the data that
// lives somewhere other than the database it came from. Admin session only
// (no cron-secret access: a snapshot contains every account's email and
// password hash, so it's never handed to anything but a signed-in admin).
export async function GET(_req: Request, { params }: { params: { fileName: string } }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const data = await getBackupData(params.fileName);
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(data.length),
      'Content-Disposition': `attachment; filename="${params.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
