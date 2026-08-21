import { NextResponse } from 'next/server';
import { getInternalUser } from '@/lib/auth';
import { searchArtists, soundchartsConfigured } from '@/lib/soundcharts';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const user = await getInternalUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!soundchartsConfigured()) {
    return NextResponse.json({ error: 'Soundcharts is not configured on this server.' }, { status: 503 });
  }

  const q = new URL(req.url).searchParams.get('q') ?? '';
  const result = await searchArtists(q);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result.data);
}
