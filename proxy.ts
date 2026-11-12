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
//
// Pages that need an account get the same treatment: with no session cookie
// at all, the visitor is sent to /login?next=… with a real 307 here. The page
// itself would redirect too, but NEXT's loading screen means its response
// has already started (status 200) by then, so the redirect arrives inside
// the page instead of as an HTTP redirect — fine for browsers, wrong for
// anything that reads status codes.
const LOGIN_REQUIRED = [
  '/next/activity', '/next/challenges', '/next/feed', '/next/feedback', '/next/leagues', '/next/my-artist', '/next/notifications', '/next/portfolio',
  '/next/submit-artist', '/next/watchlist', '/settings', '/admin', '/artists', '/artist-claims', '/artist-requests', '/collections', '/discovery', '/metrics', '/screener',
];
const PUBLIC_EXCEPTIONS = ['/next/leagues/join/'];

function needsLogin(pathname: string): boolean {
  if (pathname === '/next/profile') return true; // your own profile; /next/profile/<id> is public
  if (/^\/next\/artists\/[^/]+\/founding-believer\/?$/.test(pathname)) return true;
  if (PUBLIC_EXCEPTIONS.some((p) => pathname.startsWith(p))) return false;
  return LOGIN_REQUIRED.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Defence in depth against cross-site request forgery, on top of the
// SameSite=Lax session cookie: a browser request that changes something
// (POST/PATCH/PUT/DELETE) must come from a page on this same site. Browsers
// always send Origin on such requests; server-to-server callers (scheduled
// jobs with a secret) send none and are unaffected.
export function crossSiteApiWrite(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method)) return false;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true; // "null" or garbage
  }
  const allowed = new Set(
    [req.headers.get('x-forwarded-host'), req.headers.get('host'), req.nextUrl.host]
      .concat(process.env.APP_URL ? [new URL(process.env.APP_URL).host] : [])
      .filter((h): h is string => !!h)
      .flatMap((h) => h.split(',').map((x) => x.trim())),
  );
  return !allowed.has(originHost);
}

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith('/api/')) {
    if (crossSiteApiWrite(req)) return NextResponse.json({ error: 'Cross-site request blocked.' }, { status: 403 });
    return NextResponse.next();
  }
  const signedOut = !req.cookies.has('scout_session');
  if (pathname === '/' && signedOut) {
    return NextResponse.redirect(new URL('/next', req.url));
  }
  if (signedOut && needsLogin(pathname)) {
    const login = new URL('/login', req.url);
    login.searchParams.set('next', pathname + search);
    return NextResponse.redirect(login);
  }
  const headers = new Headers(req.headers);
  headers.set('x-request-path', req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages (not Next's own assets or files with an extension), plus API
  // routes for the cross-site check above.
  matcher: ['/((?!_next/|.*\\..*).*)', '/api/:path*'],
};
