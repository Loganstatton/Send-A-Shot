import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { logEvent } from '@/lib/db';
import { leaveLeague } from '@/lib/leagues';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const leagueId = Number(params.id);
  if (!Number.isInteger(leagueId)) return NextResponse.json({ error: 'League not found.' }, { status: 404 });

  const result = await leaveLeague(leagueId, user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 404 });

  await logEvent(user.id, 'league_left', { leagueId, deleted: result.deleted });
  return NextResponse.json(result);
}
