import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { removeLeagueMember } from '@/lib/leagues';

export const dynamic = 'force-dynamic';

// Owner-only: remove a member from the league.
export async function DELETE(_req: Request, props: { params: Promise<{ id: string; userId: string }> }) {
  const params = await props.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const leagueId = Number(params.id);
  const memberId = Number(params.userId);
  if (!Number.isInteger(leagueId) || !Number.isInteger(memberId)) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const result = await removeLeagueMember(leagueId, user.id, memberId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
