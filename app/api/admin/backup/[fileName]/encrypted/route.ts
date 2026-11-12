import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { getBackupData } from '@/lib/db-backup';
import { encryptBackup, MIN_KEY_LENGTH } from '@/lib/backup-crypto';

export const dynamic = 'force-dynamic';

// The encrypted form of one snapshot, for the daily off-site copy
// (.github/workflows/discovery-scan.yml). Unlike the plain download next
// door, the cron secret may fetch this: what it gets is AES-256-GCM
// ciphertext under BACKUP_ENCRYPTION_KEY, which never leaves Render's
// environment and the owner's password manager. Without that key set,
// nothing is served — an off-site copy is never made unencrypted.
export async function GET(req: Request, props: { params: Promise<{ fileName: string }> }) {
  const params = await props.params;
  const secret = process.env.CRON_SECRET;
  const viaCron = Boolean(secret) && req.headers.get('x-cron-secret') === secret;
  if (!viaCron && !(await getAdminUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const key = process.env.BACKUP_ENCRYPTION_KEY;
  if (!key || key.length < MIN_KEY_LENGTH) {
    return NextResponse.json({ error: `Off-site backups are off: set BACKUP_ENCRYPTION_KEY (at least ${MIN_KEY_LENGTH} characters) on the server.` }, { status: 503 });
  }

  const data = await getBackupData(params.fileName);
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const encrypted = encryptBackup(data, key);
  return new NextResponse(new Uint8Array(encrypted), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(encrypted.length),
      'Content-Disposition': `attachment; filename="${params.fileName.replace(/[^A-Za-z0-9._-]/g, '_')}.enc"`,
      'Cache-Control': 'no-store',
    },
  });
}
