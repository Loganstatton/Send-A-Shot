import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Unauthenticated by design — an external uptime monitor (or Render's own
// health check) needs to hit this without a session. Checks real DB
// connectivity rather than just returning 200 unconditionally, since "the
// Node process is up" and "the app can actually serve a request" aren't
// the same thing for this app (every page read goes through SQLite).
export async function GET() {
  try {
    db.prepare('SELECT 1').get();
    return NextResponse.json({ ok: true, db: 'connected', timestamp: new Date().toISOString() });
  } catch (err: any) {
    return NextResponse.json({ ok: false, db: 'unreachable', error: err?.message ?? 'unknown error' }, { status: 503 });
  }
}
