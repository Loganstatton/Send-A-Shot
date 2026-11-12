import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), setSessionCookie: async () => {} }));

const { createInvites, listInvites, revokeInvite, inviteSummary, normalizeInviteCode } = await import('./invites');
const { createUser, getUserByEmail } = await import('./db');
const { db } = await import('./pg');
const { POST: signup } = await import('@/app/api/auth/signup/route');

let n = 0;
const email = () => `inv${Date.now()}${n++}@example.com`;
const signUp = (inviteCode?: string, addr = email()) =>
  signup(new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Beta Tester', email: addr, password: 'beta-pass-123', tosAccepted: true, privacyAccepted: true, inviteCode }),
  }));

let adminId: number;
beforeEach(async () => {
  await db.prepare('DELETE FROM beta_invites').run();
  adminId = (await createUser({ name: 'Admin', email: email(), password_hash: 'x' })).id;
  process.env.SIGNUP_MODE = 'invite';
});
afterEach(() => {
  for (const k of ['SIGNUP_MODE', 'SIGNUP_INVITE_CODE', 'BETA_USER_CAP']) delete process.env[k];
});

describe('creating invites', () => {
  it('makes unique, readable codes and enforces batch size', async () => {
    const r = await createInvites(adminId, 5, '  Jordan  ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(new Set(r.codes).size).toBe(5);
    for (const c of r.codes) expect(c).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect((await listInvites())[0].label).toBe('Jordan');
    expect((await createInvites(adminId, 0, null)).ok).toBe(false);
    expect((await createInvites(adminId, 101, null)).ok).toBe(false);
  });
});

describe('invite-only signup', () => {
  it('requires a code, accepts a valid one once (any case, with or without the dash), and records who used it', async () => {
    const r = await createInvites(adminId, 1, 'Sam');
    if (!r.ok) throw new Error('create failed');
    const code = r.codes[0];

    const none = await signUp();
    expect(none.status).toBe(403);
    expect((await none.json()).error).toMatch(/invite-only/);
    expect((await signUp('ZZZZ-ZZZZ')).status).toBe(403);

    const addr = email();
    const ok = await signUp(normalizeInviteCode(code).toLowerCase(), addr);
    expect(ok.status).toBe(201);
    const [inv] = await listInvites();
    expect(inv.usedByName).toBe('Beta Tester');
    expect(inv.usedByUserId).toBe((await getUserByEmail(addr))!.id);

    const again = await signUp(code);
    expect(again.status).toBe(403);
    expect((await again.json()).error).toMatch(/already been used/);
  });

  it('a revoked code stops working; a used one cannot be revoked', async () => {
    const r = await createInvites(adminId, 2, null);
    if (!r.ok) throw new Error('create failed');
    const [a, b] = await listInvites();
    expect(await revokeInvite(a.id)).toBe(true);
    expect((await signUp(a.code)).status).toBe(403);
    expect((await signUp(b.code)).status).toBe(201);
    expect(await revokeInvite(b.id)).toBe(false);
  });

  it('stops at the beta cap', async () => {
    process.env.BETA_USER_CAP = '2';
    const r = await createInvites(adminId, 3, null);
    if (!r.ok) throw new Error('create failed');
    expect((await signUp(r.codes[0])).status).toBe(201);
    expect((await signUp(r.codes[1])).status).toBe(201);
    const full = await signUp(r.codes[2]);
    expect(full.status).toBe(403);
    expect((await full.json()).error).toMatch(/beta is full/);
    expect((await inviteSummary()).used).toBe(2);
  });

  it('two people using one code at the same moment: exactly one account is created', async () => {
    const r = await createInvites(adminId, 1, null);
    if (!r.ok) throw new Error('create failed');
    const [e1, e2] = [email(), email()];
    const results = await Promise.all([signUp(r.codes[0], e1), signUp(r.codes[0], e2)]);
    expect(results.map((x) => x.status).sort()).toEqual([201, 403]);
    const created = [await getUserByEmail(e1), await getUserByEmail(e2)].filter(Boolean);
    expect(created).toHaveLength(1);
  });

  it('the shared staging code still works', async () => {
    process.env.SIGNUP_INVITE_CODE = 'staging-shared-code';
    expect((await signUp('staging-shared-code')).status).toBe(201);
  });
});

describe('open signup', () => {
  it('needs no code, still uses up a valid one, and ignores an invalid one', async () => {
    delete process.env.SIGNUP_MODE;
    const r = await createInvites(adminId, 1, null);
    if (!r.ok) throw new Error('create failed');
    expect((await signUp()).status).toBe(201);
    expect((await signUp('NOPE-NOPE')).status).toBe(201);
    expect((await signUp(r.codes[0])).status).toBe(201);
    expect((await inviteSummary()).used).toBe(1);
  });
});
