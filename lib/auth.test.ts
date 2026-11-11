import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same isolation pattern as db.test.ts — DATA_DIR must be set before
// lib/data-dir.ts (and therefore lib/auth.ts, which persists a fallback
// session secret under it) is ever imported.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-auth-test-'));

const { createActionToken, verifyActionToken } = await import('./auth');

describe('Action tokens (email verification / password reset)', () => {
  it('round-trips a verify-email token', async () => {
    const token = await createActionToken(42, 'verify-email', 3600);
    expect(await verifyActionToken(token, 'verify-email')).toEqual({ uid: 42 });
  });

  it('rejects a token verified against the wrong purpose', async () => {
    const token = await createActionToken(42, 'verify-email', 3600);
    expect(await verifyActionToken(token, 'reset-password', 'some-hash')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await createActionToken(42, 'verify-email', -1); // already expired
    expect(await verifyActionToken(token, 'verify-email')).toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const token = await createActionToken(42, 'verify-email', 3600);
    const [body] = token.split('.');
    const tampered = `${body}.notarealsignature`;
    expect(await verifyActionToken(tampered, 'verify-email')).toBeNull();
  });

  it('rejects a tampered payload (uid swapped) even with a well-formed signature', async () => {
    const token = await createActionToken(42, 'verify-email', 3600);
    const [body, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    const forgedBody = Buffer.from(JSON.stringify({ ...payload, uid: 999 })).toString('base64url');
    expect(await verifyActionToken(`${forgedBody}.${sig}`, 'verify-email')).toBeNull();
  });

  it('a reset-password token verifies only while the fingerprinted password hash still matches', async () => {
    const token = await createActionToken(7, 'reset-password', 3600, 'original-hash');
    expect(await verifyActionToken(token, 'reset-password', 'original-hash')).toEqual({ uid: 7 });
    // Simulates the password having been changed since the link was
    // issued — see the self-invalidation comment on createActionToken.
    expect(await verifyActionToken(token, 'reset-password', 'a-different-hash-after-reset')).toBeNull();
  });

  it('a reset-password token with no fingerprint recorded never verifies', async () => {
    const token = await createActionToken(7, 'reset-password', 3600); // no currentPasswordHash passed
    expect(await verifyActionToken(token, 'reset-password', 'any-hash')).toBeNull();
  });
});
