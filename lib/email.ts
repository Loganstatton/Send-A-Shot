// Server-only email sender via Resend's HTTP API — no SDK needed, same
// "plain fetch against a documented REST API" shape as lib/deezer.ts and
// lib/youtube.ts.
//
// Reliability, since a lost verification or password-reset email locks a
// player out:
//   - Retries a failed send (network error, timeout, 429, 5xx) up to three
//     times with backoff, under one Idempotency-Key so a retry after a
//     response that got lost can't deliver the email twice.
//   - Records every attempt's outcome in email_log, shown on the admin Email
//     page, so a failure is visible instead of silent.
//   - Keeps room under the provider's daily cap (EMAIL_DAILY_LIMIT, 100 on
//     Resend's free plan): optional mail — notification digests — stops
//     EMAIL_PRIORITY_RESERVE short of the cap, so verification and reset
//     emails always have room. A held-back digest is sent on a later run.
//   - Sends a plain-text part alongside the HTML (better deliverability,
//     readable in any client).
//
// Unconfigured (no RESEND_API_KEY/EMAIL_FROM): nothing is sent. In
// development the email is printed so its link can be clicked; in
// production only the subject is logged — a reset link is a live
// credential and doesn't belong in server logs.
import crypto from 'crypto';
import { db } from './pg';

const API_BASE_URL = 'https://api.resend.com';
const MAX_ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 10_000;
const LOG_RETENTION_DAYS = 90;

/** Mail a player needs to get into their account always goes first. */
export type EmailKind = 'verify' | 'reset' | 'digest' | 'ops' | 'test';
const OPTIONAL_KINDS: EmailKind[] = ['digest'];

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export function emailDailyLimit(): number {
  const n = Number(process.env.EMAIL_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

export function emailPriorityReserve(): number {
  const n = Number(process.env.EMAIL_PRIORITY_RESERVE);
  return Math.min(Number.isFinite(n) && n >= 0 ? n : 30, emailDailyLimit());
}

export type EmailResult = { ok: true; id?: string } | { ok: false; error: string; deferred?: boolean };

/** A readable plain-text version of our simple HTML emails. */
export function htmlToText(html: string): string {
  return html
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => `${label.replace(/<[^>]+>/g, '').trim()}: ${href}`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|ul|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  return `${(local ?? '').slice(0, 1)}***@${domain ?? ''}`;
}

/** Emails successfully sent in the last 24 hours (the provider's window). */
export async function emailsSentLast24h(): Promise<number> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const row = (await db.prepare("SELECT COUNT(*) AS n FROM email_log WHERE status = 'sent' AND created_at >= ?").get(since)) as { n: number };
  return Number(row.n);
}

async function record(entry: { kind: EmailKind; userId?: number | null; to: string; subject: string; status: string; attempts: number; providerId?: string | null; error?: string | null }) {
  // Logging must never be the reason an email fails.
  try {
    await db
      .prepare('INSERT INTO email_log (kind, user_id, to_email, subject, status, attempts, provider_id, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(entry.kind, entry.userId ?? null, entry.to, entry.subject, entry.status, entry.attempts, entry.providerId ?? null, entry.error?.slice(0, 500) ?? null, new Date().toISOString());
    if (Math.random() < 0.05) {
      const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86400_000).toISOString();
      await db.prepare('DELETE FROM email_log WHERE created_at < ?').run(cutoff);
    }
  } catch (err: any) {
    console.error('[email] could not record send outcome:', err?.message);
  }
}

const retryDelayMs = (attempt: number) => Number(process.env.EMAIL_RETRY_BASE_MS ?? 500) * 3 ** (attempt - 1);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendEmail(input: { to: string; subject: string; html: string; text?: string; kind?: EmailKind; userId?: number | null }): Promise<EmailResult> {
  const kind = input.kind ?? 'test';
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  const text = input.text ?? htmlToText(input.html);

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') {
      console.log(`[email] not configured — "${input.subject}" to ${maskEmail(input.to)} was not sent. Set RESEND_API_KEY and EMAIL_FROM.`);
    } else {
      console.log(`[email] RESEND_API_KEY/EMAIL_FROM not set — would have sent "${input.subject}" to ${input.to}:\n${text}`);
    }
    await record({ kind, userId: input.userId, to: input.to, subject: input.subject, status: 'not_configured', attempts: 0 });
    return { ok: false, error: 'Email is not configured on this server.' };
  }

  if (OPTIONAL_KINDS.includes(kind) && (await emailsSentLast24h()) >= emailDailyLimit() - emailPriorityReserve()) {
    await record({ kind, userId: input.userId, to: input.to, subject: input.subject, status: 'deferred', attempts: 0, error: 'Held back to keep room under the daily sending cap.' });
    return { ok: false, error: 'Held back to keep room for account emails under the daily cap.', deferred: true };
  }

  const idempotencyKey = crypto.randomUUID();
  let lastError = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let retriable = true;
    try {
      const res = await fetch(`${API_BASE_URL}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ from, to: input.to, subject: input.subject, html: input.html, text }),
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: string };
        await record({ kind, userId: input.userId, to: input.to, subject: input.subject, status: 'sent', attempts: attempt, providerId: body.id ?? null });
        return { ok: true, id: body.id };
      }
      const body = await res.text().catch(() => '');
      lastError = `Resend returned ${res.status}: ${body.slice(0, 300)}`;
      // 4xx other than rate limiting won't succeed on a retry (bad address,
      // unverified sending domain, bad key).
      retriable = res.status === 429 || res.status >= 500;
    } catch (err: any) {
      lastError = `Could not reach Resend: ${err?.name === 'TimeoutError' ? 'timed out' : (err?.message ?? 'network error')}`;
    }
    if (!retriable || attempt === MAX_ATTEMPTS) {
      await record({ kind, userId: input.userId, to: input.to, subject: input.subject, status: 'failed', attempts: attempt, error: lastError });
      console.error(`[email] "${input.subject}" to ${maskEmail(input.to)} failed after ${attempt} attempt(s): ${lastError}`);
      return { ok: false, error: lastError };
    }
    await sleep(retryDelayMs(attempt));
  }
  return { ok: false, error: lastError };
}

export type EmailStats = {
  configured: boolean;
  from: string | null;
  sentLast24h: number;
  dailyLimit: number;
  reserve: number;
  last7d: { status: string; kind: string; n: number }[];
  recentProblems: { kind: string; toEmail: string; subject: string; status: string; attempts: number; error: string | null; createdAt: string }[];
};

export async function getEmailStats(): Promise<EmailStats> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const last7d = (await db.prepare('SELECT status, kind, COUNT(*) AS n FROM email_log WHERE created_at >= ? GROUP BY status, kind ORDER BY status, kind').all(since)) as { status: string; kind: string; n: number }[];
  const problems = (await db
    .prepare("SELECT kind, to_email, subject, status, attempts, error, created_at FROM email_log WHERE status <> 'sent' ORDER BY created_at DESC, id DESC LIMIT 20")
    .all()) as { kind: string; to_email: string; subject: string; status: string; attempts: number; error: string | null; created_at: string }[];
  return {
    configured: emailConfigured(),
    from: process.env.EMAIL_FROM ?? null,
    sentLast24h: await emailsSentLast24h(),
    dailyLimit: emailDailyLimit(),
    reserve: emailPriorityReserve(),
    last7d: last7d.map((r) => ({ ...r, n: Number(r.n) })),
    recentProblems: problems.map((p) => ({ kind: p.kind, toEmail: p.to_email, subject: p.subject, status: p.status, attempts: Number(p.attempts), error: p.error, createdAt: p.created_at })),
  };
}
