import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { createInvites, listInvites } from '@/lib/invites';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const result = await createInvites(admin.id, Number(body?.count), typeof body?.label === 'string' ? body.label : null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await logAdminAction(admin.id, 'invites_created', { type: 'invites', id: result.codes.length });
  return NextResponse.json({ codes: result.codes }, { status: 201 });
}

// CSV of every invite (code, label, link, status) — for mail-merging the
// invites out from a spreadsheet.
export async function GET(req: Request) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const appUrl = process.env.APP_URL ?? new URL(req.url).origin;
  const esc = (v: string | null) => `"${(v ?? '').replace(/"/g, '""')}"`;
  const rows = (await listInvites()).map((i) =>
    [i.code, i.label, `${appUrl}/signup?invite=${i.code}`, i.revokedAt ? 'revoked' : i.usedAt ? 'used' : 'unused', i.usedAt, i.usedByName].map(esc).join(','));
  const csv = ['code,label,link,status,used_at,used_by', ...rows].join('\n');
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="next-beta-invites.csv"', 'Cache-Control': 'no-store' } });
}
