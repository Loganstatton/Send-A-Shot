import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let sessionUser: any = null;
vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), getSessionUser: async () => sessionUser }));

const { sendEmail, htmlToText, getEmailStats } = await import('./email');
const { createUser, deleteUser } = await import('./db');
const { db } = await import('./pg');
const { POST: resendVerification } = await import('@/app/api/auth/resend-verification/route');

type Call = { headers: Record<string, string>; body: any };
let calls: Call[] = [];
function stubFetch(responses: (() => Response | Promise<Response>)[]) {
  calls = [];
  let i = 0;
  vi.stubGlobal('fetch', async (_url: string, init: any) => {
    calls.push({ headers: init.headers, body: JSON.parse(init.body) });
    const next = responses[Math.min(i++, responses.length - 1)];
    return next();
  });
}
const ok = (id = 'em_1') => () => new Response(JSON.stringify({ id }), { status: 200 });
const status = (code: number) => () => new Response('{"message":"nope"}', { status: code });
const lastLog = async () => (await db.prepare('SELECT * FROM email_log ORDER BY id DESC LIMIT 1').get()) as any;

beforeEach(async () => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.EMAIL_FROM = 'NEXT <hello@example.com>';
  process.env.EMAIL_RETRY_BASE_MS = '1';
  await db.prepare('DELETE FROM email_log').run();
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ['RESEND_API_KEY', 'EMAIL_FROM', 'EMAIL_DAILY_LIMIT', 'EMAIL_PRIORITY_RESERVE']) delete process.env[k];
});

describe('sendEmail', () => {
  it('sends HTML plus a plain-text part and records the send', async () => {
    stubFetch([ok('em_42')]);
    const r = await sendEmail({ to: 'a@example.com', subject: 'Hi', html: '<p>Hello</p><p><a href="https://x.test/v?t=1">Verify email</a></p>', kind: 'verify' });
    expect(r).toEqual({ ok: true, id: 'em_42' });
    expect(calls[0].body.text).toContain('Verify email: https://x.test/v?t=1');
    const log = await lastLog();
    expect([log.status, Number(log.attempts), log.provider_id, log.kind]).toEqual(['sent', 1, 'em_42', 'verify']);
  });

  it('retries a 500 and a network error under one idempotency key, then succeeds', async () => {
    stubFetch([status(500), () => { throw new TypeError('fetch failed'); }, ok()]);
    const r = await sendEmail({ to: 'a@example.com', subject: 'Reset', html: '<p>x</p>', kind: 'reset' });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.headers['Idempotency-Key'])).size).toBe(1);
    expect(Number((await lastLog()).attempts)).toBe(3);
  });

  it('does not retry a permanent error (bad address / unverified domain) and records the failure', async () => {
    stubFetch([status(422)]);
    const r = await sendEmail({ to: 'bad', subject: 'Reset', html: '<p>x</p>', kind: 'reset' });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(1);
    const log = await lastLog();
    expect(log.status).toBe('failed');
    expect(log.error).toContain('422');
  });

  it('gives up after three attempts on repeated 429s', async () => {
    stubFetch([status(429)]);
    expect((await sendEmail({ to: 'a@example.com', subject: 's', html: '<p>x</p>', kind: 'verify' })).ok).toBe(false);
    expect(calls).toHaveLength(3);
    expect((await getEmailStats()).recentProblems[0].status).toBe('failed');
  });

  it('holds digests back near the daily cap but always sends account emails', async () => {
    process.env.EMAIL_DAILY_LIMIT = '5';
    process.env.EMAIL_PRIORITY_RESERVE = '2';
    stubFetch([ok()]);
    for (let i = 0; i < 3; i++) expect((await sendEmail({ to: `d${i}@example.com`, subject: 'digest', html: '<p>x</p>', kind: 'digest' })).ok).toBe(true);
    const held = await sendEmail({ to: 'd4@example.com', subject: 'digest', html: '<p>x</p>', kind: 'digest' });
    expect(held).toMatchObject({ ok: false, deferred: true });
    expect((await sendEmail({ to: 'r@example.com', subject: 'reset', html: '<p>x</p>', kind: 'reset' })).ok).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it('unconfigured in production: nothing sent, and the link is not written to the log', async () => {
    delete process.env.RESEND_API_KEY;
    const env = process.env as Record<string, string | undefined>;
    const prevEnv = env.NODE_ENV;
    env.NODE_ENV = 'production';
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((m) => { logs.push(String(m)); });
    stubFetch([ok()]);
    const r = await sendEmail({ to: 'someone@example.com', subject: 'Reset your NEXT password', html: '<a href="https://x.test/reset?token=SECRET123">Reset</a>', kind: 'reset' });
    spy.mockRestore();
    env.NODE_ENV = prevEnv;
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
    expect(logs.join('\n')).not.toContain('SECRET123');
    expect(logs.join('\n')).not.toContain('someone@example.com');
    expect((await lastLog()).status).toBe('not_configured');
  });
});

describe('htmlToText', () => {
  it('keeps link targets and list items readable', () => {
    expect(htmlToText('<p>Hi &amp; welcome</p><ul><li>One</li><li>Two</li></ul><p><a href="https://a.test">Go</a></p>')).toBe('Hi & welcome\n\n- One\n- Two\nGo: https://a.test');
  });
});

describe('resend verification', () => {
  it('allows three an hour, then asks the player to wait', async () => {
    const u = await createUser({ name: 'Ver', email: `ver${Date.now()}@example.com`, password_hash: 'x' });
    sessionUser = { ...u, email_verified_at: null };
    stubFetch([ok()]);
    const req = () => new Request('http://localhost/api/auth/resend-verification', { method: 'POST' });
    for (let i = 0; i < 3; i++) expect((await resendVerification(req())).status).toBe(200);
    const blocked = await resendVerification(req());
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/try again in an hour/);
    expect(calls).toHaveLength(3);
    sessionUser = null;
  });
});

describe('account deletion', () => {
  it('removes that player’s email records', async () => {
    const u = await createUser({ name: 'Del', email: `del${Date.now()}@example.com`, password_hash: 'x' });
    stubFetch([ok()]);
    await sendEmail({ to: u.email, subject: 's', html: '<p>x</p>', kind: 'verify', userId: u.id });
    await deleteUser(u.id);
    const left = (await db.prepare('SELECT COUNT(*) AS n FROM email_log WHERE to_email = ?').get(u.email)) as { n: number };
    expect(Number(left.n)).toBe(0);
  });
});
