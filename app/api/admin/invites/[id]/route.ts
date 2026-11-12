import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { revokeInvite } from '@/lib/invites';

export const dynamic = 'force-dynamic';

// Revoke an unused invite (a used one can't be revoked — the account exists).
export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number((await props.params).id);
  if (!Number.isInteger(id) || !(await revokeInvite(id))) return NextResponse.json({ error: 'Only an unused invite can be revoked.' }, { status: 400 });
  await logAdminAction(admin.id, 'invite_revoked', { type: 'invite', id });
  return NextResponse.json({ ok: true });
}
