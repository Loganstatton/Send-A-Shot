import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { approveDiscoveryCandidate, setDiscoveryCandidateStatus } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const body = (await req.json()) as { action?: 'watch' | 'pass' | 'approve' };
  if (body.action === 'watch' || body.action === 'pass') {
    const updated = setDiscoveryCandidateStatus(id, body.action === 'watch' ? 'watching' : 'passed', user);
    if (!updated) return NextResponse.json({ error: 'candidate not found' }, { status: 404 });
    return NextResponse.json(updated);
  }
  if (body.action === 'approve') {
    const artist = approveDiscoveryCandidate(id, user);
    if (!artist) return NextResponse.json({ error: 'candidate not found or already approved' }, { status: 404 });
    return NextResponse.json({ artist });
  }
  return NextResponse.json({ error: "action must be 'watch', 'pass', or 'approve'" }, { status: 400 });
}
