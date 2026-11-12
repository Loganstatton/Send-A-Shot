import crypto from 'node:crypto';
import { db } from './pg';

// Brute-force protection for login and password-reset emails. Attempts are
// keyed by a SHA-256 hash of the (lower-cased) email and of the network
// address — neither is stored in readable form. Limits apply to FAILED
// logins only, so a person who keeps getting their password right is never
// locked out by their own successful sign-ins.

export const WINDOW_MIN = 15;
export const MAX_FAILURES_PER_EMAIL = 8;
export const MAX_FAILURES_PER_IP = 30;
export const MAX_RESETS_PER_EMAIL_PER_HOUR = 3;

const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
export const emailKey = (email: string) => hash(`email:${email.trim().toLowerCase()}`);
export const ipKey = (ip: string | null) => (ip ? hash(`ip:${ip}`) : null);

// Render (and most hosts) put the client address first in x-forwarded-for.
export function clientIp(headers: Headers): string | null {
  const fwd = headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim() || null;
  return headers.get('x-real-ip');
}

export async function loginBlocked(email: string, ip: string | null): Promise<boolean> {
  const since = new Date(Date.now() - WINDOW_MIN * 60_000).toISOString();
  const byEmail = (await db.prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE kind = 'login' AND ok = 0 AND email_key = ? AND created_at >= ?").get(emailKey(email), since)) as { c: number };
  if (byEmail.c >= MAX_FAILURES_PER_EMAIL) return true;
  const ik = ipKey(ip);
  if (ik) {
    const byIp = (await db.prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE kind = 'login' AND ok = 0 AND ip_key = ? AND created_at >= ?").get(ik, since)) as { c: number };
    if (byIp.c >= MAX_FAILURES_PER_IP) return true;
  }
  return false;
}

export async function recordAttempt(kind: 'login' | 'reset', email: string, ip: string | null, ok: boolean): Promise<void> {
  await db.prepare('INSERT INTO login_attempts (email_key, ip_key, kind, ok, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(emailKey(email), ipKey(ip), kind, ok ? 1 : 0, new Date().toISOString());
}

export async function resetEmailBlocked(email: string): Promise<boolean> {
  const since = new Date(Date.now() - 60 * 60_000).toISOString();
  const row = (await db.prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE kind = 'reset' AND email_key = ? AND created_at >= ?").get(emailKey(email), since)) as { c: number };
  return row.c >= MAX_RESETS_PER_EMAIL_PER_HOUR;
}

// Old attempt rows are only useful for the rolling window; drop anything
// older than a day so the table stays small.
export async function pruneAttempts(): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE created_at < ?').run(new Date(Date.now() - 86_400_000).toISOString());
}
