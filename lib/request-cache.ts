import * as React from 'react';

// Wraps a read so that, while ONE page is being rendered on the server,
// calling it again with the same arguments reuses the first result instead
// of querying again — the layout and the page it wraps both need the
// signed-in user, and both the notification badge and Discover need the
// market. Nothing is remembered between requests or between users.
//
// React only provides this inside a server-component render. Everywhere
// else (API route handlers, scripts, tests) the function is returned as-is
// and simply runs every time it's called.
export function perRequest<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  const cache = (React as { cache?: <F>(f: F) => F }).cache;
  return typeof cache === 'function' ? cache(fn) : fn;
}
