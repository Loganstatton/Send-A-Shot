import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

const { createUser, db, getUserById, updateUserPasswordHash, bumpSessionVersion } = await import('./db');
const { loginBlocked, recordAttempt, resetEmailBlocked, emailKey, MAX_FAILURES_PER_EMAIL, MAX_FAILURES_PER_IP, MAX_RESETS_PER_EMAIL_PER_HOUR } = await import('./login-guard');
const { logAdminAction, getAuditLog } = await import('./audit');
const { crossSiteApiWrite } = await import('../proxy');

let seq = 0;
const email = () => `sec-${++seq}-${Date.now()}@example.com`;

describe('login rate limiting', () => {
  it(`blocks an email after ${MAX_FAILURES_PER_EMAIL} failures, counting only failures`, async () => {
    const e = email();
    for (let i = 0; i < 20; i++) await recordAttempt('login', e, '10.0.0.1', true); // successes never count
    expect(await loginBlocked(e, '10.0.0.9')).toBe(false);
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) await recordAttempt('login', e, `10.0.1.${i}`, false);
    expect(await loginBlocked(e, '10.0.2.1')).toBe(true);
    expect(await loginBlocked(email(), '10.0.2.1')).toBe(false); // other accounts unaffected
  });

  it(`blocks a network address after ${MAX_FAILURES_PER_IP} failures across many emails`, async () => {
    const ip = `192.168.${seq}.7`;
    for (let i = 0; i < MAX_FAILURES_PER_IP; i++) await recordAttempt('login', email(), ip, false);
    expect(await loginBlocked(email(), ip)).toBe(true);
    expect(await loginBlocked(email(), '192.168.250.250')).toBe(false);
  });

  it('old failures fall out of the window', async () => {
    const e = email();
    for (let i = 0; i < MAX_FAILURES_PER_EMAIL; i++) await recordAttempt('login', e, null, false);
    await db.prepare('UPDATE login_attempts SET created_at = ? WHERE email_key = ?').run(new Date(Date.now() - 16 * 60_000).toISOString(), emailKey(e));
    expect(await loginBlocked(e, null)).toBe(false);
  });

  it('never stores the email or address in readable form', async () => {
    const e = email();
    await recordAttempt('login', e, '203.0.113.5', false);
    const row = (await db.prepare('SELECT email_key, ip_key FROM login_attempts ORDER BY id DESC LIMIT 1').get()) as any;
    expect(row.email_key).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ip_key).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('example.com');
    expect(JSON.stringify(row)).not.toContain('203.0.113.5');
  });

  it(`limits password-reset emails to ${MAX_RESETS_PER_EMAIL_PER_HOUR} an hour`, async () => {
    const e = email();
    for (let i = 0; i < MAX_RESETS_PER_EMAIL_PER_HOUR; i++) await recordAttempt('reset', e, null, true);
    expect(await resetEmailBlocked(e)).toBe(true);
  });
});

describe('session revocation', () => {
  it('a password change and "log out other devices" both bump the session version', async () => {
    const u = await createUser({ name: 'Sessions', email: email(), password_hash: 'x' });
    expect((await getUserById(u.id))!.session_version).toBe(0);
    await updateUserPasswordHash(u.id, 'y');
    expect((await getUserById(u.id))!.session_version).toBe(1);
    await bumpSessionVersion(u.id);
    expect((await getUserById(u.id))!.session_version).toBe(2);
  });
});

describe('cross-site API writes', () => {
  const req = (method: string, origin: string | null, host = 'next.example.com') =>
    new NextRequest(`https://${host}/api/next/leagues`, { method, headers: { host, ...(origin ? { origin } : {}) } });
  it('blocks a write from another site, allows same-site, reads and server-to-server calls', () => {
    expect(crossSiteApiWrite(req('POST', 'https://evil.example'))).toBe(true);
    expect(crossSiteApiWrite(req('DELETE', 'null'))).toBe(true);
    expect(crossSiteApiWrite(req('POST', 'https://next.example.com'))).toBe(false);
    expect(crossSiteApiWrite(req('GET', 'https://evil.example'))).toBe(false);
    expect(crossSiteApiWrite(req('POST', null))).toBe(false);
  });
});

describe('admin audit log', () => {
  it('records and lists actions newest first', async () => {
    const u = await createUser({ name: 'Auditor', email: email(), password_hash: 'x' });
    await logAdminAction(u.id, 'role_changed', { type: 'user', id: 42 }, 'to internal');
    await logAdminAction(null, 'backup_created', { type: 'snapshot', id: 'snap.json.gz' });
    const [latest, previous] = await getAuditLog(2);
    expect(latest).toMatchObject({ action: 'backup_created', actor_name: null, target_id: 'snap.json.gz' });
    expect(previous).toMatchObject({ action: 'role_changed', actor_name: 'Auditor', target_type: 'user', target_id: '42', detail: 'to internal' });
  });
});
