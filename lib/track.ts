'use client';

// Fire-and-forget client-side event logging — the browser half of product
// analytics (see app/api/next/events/route.ts for the accepted event
// types, and lib/db.ts's logEvent for everything logged server-side
// instead, which is most events). Never awaited by callers and never
// throws: a lost analytics beacon should never break the feature it's
// attached to.
export function track(eventType: string, metadata?: Record<string, unknown>): void {
  try {
    fetch('/api/next/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, metadata }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Same as above — never let a tracking call throw into caller code.
  }
}
