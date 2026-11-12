import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { logEvent } from '@/lib/db';
import { saveProInterest } from '@/lib/pro-interest';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  const result = await saveProInterest(user.id, body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  await logEvent(user.id, 'pro_survey_answered', { intent: body.intent });
  return NextResponse.json({ ok: true });
}
