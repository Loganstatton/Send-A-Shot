import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { submitFeedback } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'Log in to send feedback.' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const result = await submitFeedback(user.id, { page: body?.page, understood: body?.understood, enjoyed: body?.enjoyed, confused: body?.confused });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true }, { status: 201 });
}
