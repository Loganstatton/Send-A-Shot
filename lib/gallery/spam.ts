// Minimal, dependency-free spam protection shared by the gallery's public
// POST endpoints (inquiries, collector emails, submissions): a honeypot
// field plus a per-IP sliding-window rate limit. In-memory, so it resets on
// deploy/restart — acceptable for this app's single-instance deployment
// (same assumption lib/auth.ts already makes about the session secret).
const hits = new Map<string, number[]>();

export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > max;
}

export function requestIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || 'unknown';
}

export function isHoneypotTripped(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
