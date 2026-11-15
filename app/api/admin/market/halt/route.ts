import { NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/audit';
import { getAdminUser } from '@/lib/auth';
import { haltArtistTrading, resumeArtistTrading } from '@/lib/market-ledger';

export const dynamic = 'force-dynamic';

// Pause or resume trading in one artist (the circuit breaker's manual side). Resuming after an automatic
// halt is a deliberate admin action, logged, after the reconciliation issue has been reviewed.
export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { artistId?: unknown; action?: unknown; reason?: unknown } | null;
  const artistId = Number(body?.artistId);
  if (!Number.isInteger(artistId)) return NextResponse.json({ error: 'artistId is required' }, { status: 400 });
  if (body?.action === 'halt') {
    await haltArtistTrading(artistId, typeof body.reason === 'string' && body.reason ? body.reason : 'Paused by an admin.');
  } else if (body?.action === 'resume') {
    if (!(await resumeArtistTrading(artistId))) return NextResponse.json({ error: 'artist not found' }, { status: 404 });
  } else {
    return NextResponse.json({ error: "action must be 'halt' or 'resume'" }, { status: 400 });
  }
  await logAdminAction(admin.id, body.action === 'halt' ? 'market_halted' : 'market_resumed', { type: 'artist', id: artistId });
  return NextResponse.json({ ok: true });
}
