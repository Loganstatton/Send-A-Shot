// Encryption for snapshot files that leave the server (the daily off-site
// copy kept by GitHub Actions). A snapshot holds every account's email and
// password hash, and this repository is public — so anything stored outside
// Render is encrypted here first, with a key that only lives in Render's
// environment (BACKUP_ENCRYPTION_KEY) and in the owner's password manager.
// Whoever holds CRON_SECRET can fetch the ciphertext but cannot read it.
//
// Plain CommonJS so the decrypt CLI (scripts/decrypt-backup.js) shares it,
// like lib/snapshot-core.js.
//
// Format: "NXTBAK1" | salt(16) | iv(12) | authTag(16) | ciphertext
// AES-256-GCM, key = scrypt(passphrase, salt). GCM's tag means a wrong key
// or a corrupted file fails loudly instead of yielding garbage.
const crypto = require('crypto');

const MAGIC = Buffer.from('NXTBAK1');
const MIN_KEY_LENGTH = 24;
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function deriveKey(passphrase, salt) {
  return crypto.scryptSync(passphrase, salt, 32, SCRYPT);
}

function checkPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_KEY_LENGTH) {
    throw new Error(`BACKUP_ENCRYPTION_KEY must be at least ${MIN_KEY_LENGTH} characters.`);
  }
}

function encryptBackup(data, passphrase) {
  checkPassphrase(passphrase);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

function decryptBackup(file, passphrase) {
  checkPassphrase(passphrase);
  if (file.length < MAGIC.length + 44 || !file.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not an encrypted NEXT backup file.');
  }
  let o = MAGIC.length;
  const salt = file.subarray(o, (o += 16));
  const iv = file.subarray(o, (o += 12));
  const tag = file.subarray(o, (o += 16));
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(file.subarray(o)), decipher.final()]);
  } catch {
    throw new Error('Could not decrypt: wrong BACKUP_ENCRYPTION_KEY, or the file is damaged.');
  }
}

module.exports = { encryptBackup, decryptBackup, MIN_KEY_LENGTH };
