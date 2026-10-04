import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE, authEnabled, verifySessionToken } from './lib/auth';

export const config = {
  // Everything except static assets, the login page and the login API.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|apple-touch-icon.png|manifest.webmanifest|login|api/auth).*)'],
};

export async function middleware(req: NextRequest) {
  if (!authEnabled()) return NextResponse.next();
  const ok = await verifySessionToken(req.cookies.get(AUTH_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}
