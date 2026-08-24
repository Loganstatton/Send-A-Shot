import { NextResponse } from 'next/server';
import { addLogEntry, getArtist } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Lets a verified artist (artists.claimed_by_user_id === them) drop a note
// into their own Activity Log without granting them the rest of Scout's
// internal artist-edit surface — the log entry is the only thing they can
// write, and it's tagged so a Scout can tell it came through this channel.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const artist = getArtist(id);
  if (!artist || artist.claimed_by_user_id !== user.id) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

  const entry = addLogEntry(id, { type: 'note', message: `Artist self-update: ${message}` }, user);
  return NextResponse.json(entry, { status: 201 });
}
