import { NextResponse } from 'next/server';
import { deleteLogEntry } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string; logId: string } }) {
  const artistId = Number(params.id);
  const logId = Number(params.logId);
  if (!Number.isInteger(artistId) || !Number.isInteger(logId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const ok = deleteLogEntry(artistId, logId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
