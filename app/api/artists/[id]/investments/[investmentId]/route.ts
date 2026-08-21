import { NextResponse } from 'next/server';
import { deleteInvestmentEntry } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function DELETE(_req: Request, { params }: { params: { id: string; investmentId: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const artistId = Number(params.id);
  const investmentId = Number(params.investmentId);
  if (!Number.isInteger(artistId) || !Number.isInteger(investmentId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  const ok = deleteInvestmentEntry(artistId, investmentId);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
