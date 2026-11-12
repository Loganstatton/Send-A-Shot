import { NextResponse, type NextRequest } from 'next/server';

// Passes the requested path (and query) to server components as a request
// header. Server components can't read the URL directly, and requireUser()
// needs it to send a signed-out visitor to /login?next=<where they were>,
// so that after logging in they land back on the page they wanted instead
// of the home page.
//
// It also sends a visitor with no session cookie at all straight from the
// site root to NEXT with a real redirect, before any page renders — so the
// bare site URL, when shared, previews as NEXT rather than a login form.
// (Whether a cookie is actually valid is still checked by the page itself.)
export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname === '/' && !req.cookies.has('scout_session')) {
    return NextResponse.redirect(new URL('/next', req.url));
  }
  const headers = new Headers(req.headers);
  headers.set('x-request-path', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only — not API routes, Next's own assets, or files with an extension.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
