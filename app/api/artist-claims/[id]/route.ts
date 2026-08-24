import { NextResponse } from 'next/server';
import { reviewArtistClaim } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const body = await req.json().catch(() => null);
  const decision = body?.decision;
  if (decision !== 'approved' && decision !== 'rejected') {
    return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 });
  }

  const claim = reviewArtistClaim(id, decision, user);
  if (!claim) return NextResponse.json({ error: 'not found or already reviewed' }, { status: 404 });

  return NextResponse.json(claim);
}
