import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// The route checks for an admin session; these tests are always signed out.
vi.mock('@/lib/auth', () => ({ getAdminUser: async () => null }));

const { encryptBackup, decryptBackup } = await import('./backup-crypto');
const { runBackup, getBackupData } = await import('./db-backup');
const { createArtist } = await import('./db');
const { GET: getEncrypted } = await import('@/app/api/admin/backup/[fileName]/encrypted/route');
const { GET: getPlain } = await import('@/app/api/admin/backup/[fileName]/route');

const KEY = 'correct horse battery staple 2026';
const call = (handler: typeof getEncrypted, fileName: string, headers: Record<string, string> = {}) =>
  handler(new Request(`http://localhost/api/admin/backup/${fileName}/encrypted`, { headers }), { params: Promise.resolve({ fileName }) });

afterEach(() => {
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.CRON_SECRET;
});

describe('backup encryption', () => {
  it('round-trips, and the ciphertext does not contain the plaintext', () => {
    const data = Buffer.from('{"users":[{"email":"someone@example.com"}]}');
    const enc = encryptBackup(data, KEY);
    expect(enc.subarray(0, 7).toString()).toBe('NXTBAK1');
    expect(enc.includes(Buffer.from('someone@example.com'))).toBe(false);
    expect(decryptBackup(enc, KEY).equals(data)).toBe(true);
  });

  it('uses a fresh salt and IV each time', () => {
    const data = Buffer.from('same input');
    expect(encryptBackup(data, KEY).equals(encryptBackup(data, KEY))).toBe(false);
  });

  it('fails loudly on a wrong key or a tampered file', () => {
    const enc = encryptBackup(Buffer.from('secret rows'), KEY);
    expect(() => decryptBackup(enc, `${KEY} but wrong`)).toThrow(/wrong BACKUP_ENCRYPTION_KEY/);
    const tampered = Buffer.from(enc);
    tampered[tampered.length - 1] ^= 1;
    expect(() => decryptBackup(tampered, KEY)).toThrow(/Could not decrypt/);
    expect(() => decryptBackup(Buffer.from('plain gzip bytes, not ours at all........................'), KEY)).toThrow(/Not an encrypted/);
  });

  it('refuses a short key', () => {
    expect(() => encryptBackup(Buffer.from('x'), 'short')).toThrow(/at least 24/);
  });
});

describe('encrypted off-site download route', () => {
  it('the cron secret gets ciphertext that decrypts to the stored snapshot — and still cannot get the plain file', async () => {
    await createArtist({ name: 'Offsite Backup Artist', music_talent: 6 });
    const { fileName } = await runBackup();
    process.env.CRON_SECRET = 'cron-secret-for-test';
    process.env.BACKUP_ENCRYPTION_KEY = KEY;

    const res = await call(getEncrypted, fileName, { 'x-cron-secret': 'cron-secret-for-test' });
    expect(res.status).toBe(200);
    const body = Buffer.from(await res.arrayBuffer());
    expect(decryptBackup(body, KEY).equals((await getBackupData(fileName))!)).toBe(true);

    const plain = await call(getPlain, fileName, { 'x-cron-secret': 'cron-secret-for-test' });
    expect(plain.status).toBe(401);
  });

  it('serves nothing without the key set, and nothing to a caller without the secret', async () => {
    const { fileName } = await runBackup();
    process.env.CRON_SECRET = 'cron-secret-for-test';

    expect((await call(getEncrypted, fileName, { 'x-cron-secret': 'cron-secret-for-test' })).status).toBe(503);
    process.env.BACKUP_ENCRYPTION_KEY = KEY;
    expect((await call(getEncrypted, fileName, { 'x-cron-secret': 'wrong' })).status).toBe(401);
    expect((await call(getEncrypted, fileName)).status).toBe(401);
    expect((await call(getEncrypted, 'no-such-file.json.gz', { 'x-cron-secret': 'cron-secret-for-test' })).status).toBe(404);
  });

  it('scripts/decrypt-backup.js turns the off-site file back into the snapshot', async () => {
    const { fileName } = await runBackup();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offsite-'));
    const encFile = path.join(dir, `${fileName}.enc`);
    fs.writeFileSync(encFile, encryptBackup((await getBackupData(fileName))!, KEY));
    execFileSync('node', [path.join(__dirname, '..', 'scripts', 'decrypt-backup.js'), encFile], { env: { ...process.env, BACKUP_ENCRYPTION_KEY: KEY } });
    expect(fs.readFileSync(path.join(dir, fileName)).equals((await getBackupData(fileName))!)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
