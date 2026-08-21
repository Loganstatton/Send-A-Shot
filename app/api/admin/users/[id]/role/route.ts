import { NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/auth';
import { setUserRole } from '@/lib/db';
import { ROLES, Role } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const admin = await getAdminUser();
  if (!admin) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const body = (await req.json()) as { role?: Role };
  if (!body.role || !ROLES.includes(body.role)) {
    return NextResponse.json({ error: 'invalid role' }, { status: 400 });
  }
  if (id === admin.id && body.role !== 'admin') {
    return NextResponse.json({ error: "can't demote yourself" }, { status: 400 });
  }

  const user = setUserRole(id, body.role);
  if (!user) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(user);
}
