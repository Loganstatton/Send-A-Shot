import { NextResponse } from 'next/server';
import { bulkSetArtistStage } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';
import { STAGES } from '@/lib/types';

export const dynamic = 'force-dynamic';

// The one bulk action scoped for a first pass — see PR notes. Reuses
// updateArtist per artist (via bulkSetArtistStage), so every existing
// side effect (the stage-change contact_log entry, score_history
// snapshot) still happens exactly as it would for a single edit.
export async function POST(req: Request) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => Number.isInteger(id)) : [];
  const stage = body?.stage;
  if (ids.length === 0) return NextResponse.json({ error: 'ids is required' }, { status: 400 });
  if (!STAGES.includes(stage)) return NextResponse.json({ error: 'invalid stage' }, { status: 400 });

  const updated = bulkSetArtistStage(ids, stage, user);
  return NextResponse.json({ updated });
}
