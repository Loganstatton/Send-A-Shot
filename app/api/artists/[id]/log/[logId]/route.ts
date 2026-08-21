import { NextResponse } from 'next/server';
import { deleteLogEntry, setFollowUp } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string; logId: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const artistId = Number(params.id);
  const logId = Number(params.logId);
  if (!Number.isInteger(artistId) || !Number.isInteger(logId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const body = (await req.json()) as { follow_up_at?: string | null };
  const entry = setFollowUp(artistId, logId, body.follow_up_at ?? null);
  if (!entry) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(entry);
}

export async function DELETE(_req: Request, { params }: { params: { id: string; logId: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const artistId = Number(params.id);
  const logId = Number(params.logId);
  if (!Number.isInteger(artistId) || !Number.isInteger(logId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const ok = deleteLogEntry(artistId, logId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
