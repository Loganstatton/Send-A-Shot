import { NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/audit';
import { getInternalUser } from '@/lib/auth';
import { resolveArtistRequest } from '@/lib/artist-requests';

export const dynamic = 'force-dynamic';

// Staff only: resolve or reject an artist request with a note the
// requester will see.
export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Request not found.' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const result = await resolveArtistRequest(id, body?.decision, body?.note, { id: user.id, name: user.name });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await logAdminAction(user.id, `artist_request_${body?.decision}`, { type: 'artist_request', id });
  return NextResponse.json({ ok: true });
}
