// Self-hosted error monitoring — no third-party APM account exists for
// this app to wire a Sentry/Bugsnag-style SDK into, so this is the
// pragmatic substitute: every uncaught exception (client render crash or
// an unexpected server-side throw) lands in error_reports (lib/db.ts),
// reviewable at /admin/errors. console.error still fires alongside every
// write here — Render captures stdout regardless, so nothing is lost if
// the DB write itself somehow fails.

import { insertErrorReport } from './db';

// Called from route handlers wrapping an operation that isn't expected to
// throw under normal conditions — a genuine bug, not a validated user
// error (those already return a 400 with a specific message and never
// reach here). Never throws itself: a logging failure must not turn a
// real error response into a worse one.
export function logServerError(context: string, err: unknown, meta?: { path?: string; userId?: number }): void {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  console.error(`[${context}]`, err);
  try {
    insertErrorReport({ source: 'server', message: `${context}: ${message}`, stack, path: meta?.path, userId: meta?.userId });
  } catch (logErr) {
    console.error('[error-log] failed to persist error report', logErr);
  }
}
