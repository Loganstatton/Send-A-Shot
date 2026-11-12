import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { addCollectionItem, removeCollectionItem, updateCollectionItem } from '@/lib/collections';

export const dynamic = 'force-dynamic';

async function parse(req: Request, props: { params: Promise<{ id: string }> }) {
  const user = await getInternalUser();
  if (!user) return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  const id = Number((await props.params).id);
  const body = (await req.json().catch(() => null)) ?? {};
  const artistId = Number(body.artistId);
  if (!Number.isInteger(id) || !Number.isInteger(artistId)) return { error: NextResponse.json({ error: 'collection and artistId are required' }, { status: 400 }) };
  return { id, artistId, body };
}

const respond = (r: { ok: true } | { ok: false; status: number; error: string }) =>
  r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: r.status });

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const p = await parse(req, props);
  if ('error' in p) return p.error;
  return respond(await addCollectionItem(p.id, p.artistId, p.body.note));
}

export async function PATCH(req: Request, props: { params: Promise<{ id: string }> }) {
  const p = await parse(req, props);
  if ('error' in p) return p.error;
  return respond(await updateCollectionItem(p.id, p.artistId, { note: p.body.note, move: p.body.move }));
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  const p = await parse(req, props);
  if ('error' in p) return p.error;
  return respond(await removeCollectionItem(p.id, p.artistId));
}
