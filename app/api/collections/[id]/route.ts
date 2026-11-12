import { NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/audit';
import { getInternalUser } from '@/lib/auth';
import { deleteCollection, updateCollection } from '@/lib/collections';

export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number((await props.params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 });
  const body = (await req.json().catch(() => null)) ?? {};
  const result = await updateCollection(id, { title: body.title, description: body.description, published: body.published });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (body.published !== undefined) await logAdminAction(user.id, body.published ? 'collection_published' : 'collection_unpublished', { type: 'collection', id });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = Number((await props.params).id);
  if (!Number.isInteger(id) || !(await deleteCollection(id))) return NextResponse.json({ error: 'Collection not found.' }, { status: 404 });
  await logAdminAction(user.id, 'collection_deleted', { type: 'collection', id });
  return NextResponse.json({ ok: true });
}
