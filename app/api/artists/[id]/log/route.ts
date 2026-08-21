import { NextResponse } from 'next/server';
import { addLogEntry, getArtist, getArtistLog } from '@/lib/db';
import { getInternalUser } from '@/lib/auth';
import { LOG_TYPES, LogEntryInput } from '@/lib/types';

export const dynamic = 'force-dynamic';

function parseId(idParam: string) {
  const id = Number(idParam);
  return Number.isInteger(id) ? id : null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json(getArtistLog(id));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const id = parseId(params.id);
  if (id === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  if (!getArtist(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const body = (await req.json()) as LogEntryInput;
  if (!body.message || !body.message.trim()) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }
  if (!LOG_TYPES.includes(body.type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  const entry = addLogEntry(id, body, user);
  return NextResponse.json(entry, { status: 201 });
}
