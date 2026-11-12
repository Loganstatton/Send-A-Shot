import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { createCollection } from '@/lib/collections';

export const dynamic = 'force-dynamic';

// Staff only (internal/admin): create an editorial collection, unpublished.
export async function POST(req: Request) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const result = await createCollection(body?.title, body?.description, user.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ collection: result.collection }, { status: 201 });
}
