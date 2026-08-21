import { NextResponse } from 'next/server';
import { deleteRevenueEntry } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string; revenueId: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const artistId = Number(params.id);
  const revenueId = Number(params.revenueId);
  if (!Number.isInteger(artistId) || !Number.isInteger(revenueId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const ok = deleteRevenueEntry(artistId, revenueId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
