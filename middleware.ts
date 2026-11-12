import { NextResponse, type NextRequest } from 'next/server';

// Passes the requested path (and query) to server components as a request
// header. Server components can't read the URL directly, and requireUser()
// needs it to send a signed-out visitor to /login?next=<where they were>,
// so that after logging in they land back on the page they wanted instead
// of the home page.
export function middleware(req: NextRequest) {
  const headers = new Headers(req.headers);
  headers.set('x-request-path', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only — not API routes, Next's own assets, or files with an extension.
  matcher: ['/((?!api/|_next/|.*\\..*).*)'],
};
