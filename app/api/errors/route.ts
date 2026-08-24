import { NextResponse } from 'next/server';
import { insertErrorReport } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Reported from app/error.tsx and friends — a client-side render crash can
// happen to a logged-out visitor on a public page, so this intentionally
// does NOT require auth. user_id is attached best-effort when a session
// happens to exist, purely for triage context (never used to gate the
// write itself).
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message : '';
  if (!message) return NextResponse.json({ error: 'message is required' }, { status: 400 });

  const user = await getSessionUser().catch(() => null);
  insertErrorReport({
    source: 'client',
    message,
    stack: typeof body?.stack === 'string' ? body.stack : undefined,
    digest: typeof body?.digest === 'string' ? body.digest : undefined,
    path: typeof body?.path === 'string' ? body.path : undefined,
    userId: user?.id,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
