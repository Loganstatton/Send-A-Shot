import { NextRequest, NextResponse } from 'next/server';

// True HTTP-level gate for /gallery/admin/*, run before any React rendering
// starts. Needed because this app's root layout ships a root-level
// app/loading.tsx, which wraps every route (including /gallery/admin) in a
// Suspense boundary — Next.js flushes that boundary's 200 shell before an
// async redirect() deeper in the tree (lib/gallery/auth.ts's
// requireGalleryAdmin, called from app/gallery/admin/layout.tsx) resolves,
// so redirect() degrades to a client-side-only soft redirect instead of a
// real HTTP 30x once streaming has already started (confirmed via curl:
// the same thing already happens for Scout's own pre-existing
// requireAdmin() at /admin/users — this isn't new to the gallery, but the
// gallery is the part of the app this task owns, so it gets the real fix).
// This only checks cookie *presence*; the page-level requireGalleryAdmin()
// is still the authoritative check for signature validity and admin role.
const SESSION_COOKIE = 'scout_session';

export function middleware(req: NextRequest) {
  if (!req.cookies.has(SESSION_COOKIE)) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/gallery/admin/:path*'],
};
