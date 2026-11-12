import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { logEvent } from '@/lib/db';
import { createLeague } from '@/lib/leagues';

export const dynamic = 'force-dynamic';

// Create a private league. The creator is its owner and first member.
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const result = await createLeague(user.id, body?.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  await logEvent(user.id, 'league_created', { leagueId: result.league.id });
  return NextResponse.json({ league: { id: result.league.id, name: result.league.name, inviteCode: result.league.invite_code } }, { status: 201 });
}
