import { NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/audit';
import { getAdminUser } from '@/lib/auth';
import { applyDepthChange, previewDepthChange } from '@/lib/market-ledger';

export const dynamic = 'force-dynamic';

// Depth changes are never automatic: an admin previews one (GET) and approves it (POST). Depth can only
// rise, by at most ×1.25 in any 7 days; the price and everyone's shares stay the same, holders' values can
// only go up, and the reserve is topped up (fee pool first, then disclosed liquidity) — lib/market-ledger.ts.
function parse(v: unknown): number { return typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN; }

export async function GET(req: Request) {
  if (!(await getAdminUser())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const artistId = parse(url.searchParams.get('artistId'));
  const depth = parse(url.searchParams.get('depthCents'));
  if (!Number.isInteger(artistId) || !(depth > 0)) return NextResponse.json({ error: 'artistId and depthCents are required' }, { status: 400 });
  const preview = await previewDepthChange(artistId, depth);
  return NextResponse.json(preview, { status: 'error' in preview ? 404 : 200 });
}

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { artistId?: unknown; newDepthCents?: unknown; note?: unknown } | null;
  const artistId = parse(body?.artistId);
  const depth = parse(body?.newDepthCents);
  if (!Number.isInteger(artistId) || !(depth > 0)) return NextResponse.json({ error: 'artistId and newDepthCents are required' }, { status: 400 });
  const note = typeof body?.note === 'string' ? body.note : undefined;
  const result = await applyDepthChange(artistId, Math.round(depth), admin.id, note);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await logAdminAction(admin.id, 'market_depth_changed', { type: 'artist', id: artistId },
    `${result.change.oldDepthCents} → ${result.change.newDepthCents}; top-up ${result.change.topUpCents} (fees ${result.change.fromFeePoolCents}, liquidity ${result.change.fromLiquidityCents})`);
  return NextResponse.json(result.change);
}
