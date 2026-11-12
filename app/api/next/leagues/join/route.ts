import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { logEvent } from '@/lib/db';
import { joinLeague } from '@/lib/leagues';

export const dynamic = 'force-dynamic';

// Join a league by invite code. Joining one you're already in is a no-op
// success, so a double-click or a re-opened invite link never errors.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code : '';
  const result = await joinLeague(user.id, code);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  if (!result.alreadyMember) await logEvent(user.id, 'league_joined', { leagueId: result.league.id });
  return NextResponse.json({ leagueId: result.league.id, alreadyMember: result.alreadyMember });
}
