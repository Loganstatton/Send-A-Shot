import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { resetLeagueInviteCode } from '@/lib/leagues';

export const dynamic = 'force-dynamic';

// Owner-only: issue a new invite code. Links already shared stop working;
// current members are unaffected.
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const leagueId = Number(params.id);
  if (!Number.isInteger(leagueId)) return NextResponse.json({ error: 'League not found.' }, { status: 404 });

  const result = await resetLeagueInviteCode(leagueId, user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ inviteCode: result.code });
}
