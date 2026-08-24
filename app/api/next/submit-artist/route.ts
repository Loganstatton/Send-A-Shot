import { NextResponse } from 'next/server';
import { insertDiscoveryCandidate } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Any logged-in NEXT user can submit — logged-in-only (not anonymous) is
// the accountability line this app already draws elsewhere (e.g. trading,
// watchlisting). Lands in the same Candidate Queue Discovery's own scans
// feed (source='public_submission'), reviewed the same way.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const pitch = typeof body?.pitch === 'string' ? body.pitch.trim() : '';
  const submissionUrl = typeof body?.submissionUrl === 'string' ? body.submissionUrl.trim() : '';

  if (!name) return NextResponse.json({ error: 'Artist name is required.' }, { status: 400 });
  if (!pitch) return NextResponse.json({ error: 'Tell us why — a sentence is enough.' }, { status: 400 });

  insertDiscoveryCandidate({
    source: 'public_submission',
    name,
    submission_url: submissionUrl || undefined,
    flagged_reason: pitch,
    submitted_by_user_id: user.id,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
