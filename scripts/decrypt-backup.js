#!/usr/bin/env node
// Turns an encrypted off-site backup (a .enc file from the "database-backup"
// artifact of the daily GitHub Actions run) back into a normal snapshot
// file, which scripts/restore-db.js can then restore.
//
// Usage:
//   BACKUP_ENCRYPTION_KEY='...' node scripts/decrypt-backup.js <backup.json.gz.enc> [output.json.gz]
//
// The key is the same value set as BACKUP_ENCRYPTION_KEY in Render's
// Environment tab (keep a copy in your password manager: without it the
// off-site copies cannot be read by anyone, including you).
const fs = require('fs');
const { decryptBackup } = require('../lib/backup-crypto');

function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Usage: node scripts/decrypt-backup.js <backup.json.gz.enc> [output.json.gz]');
  if (!fs.existsSync(input)) throw new Error(`No such file: ${input}`);
  const output = process.argv[3] || input.replace(/\.enc$/, '') || `${input}.json.gz`;
  if (output === input) throw new Error('Give an output file name.');
  const data = decryptBackup(fs.readFileSync(input), process.env.BACKUP_ENCRYPTION_KEY || '');
  fs.writeFileSync(output, data);
  console.log(`Decrypted ${input} -> ${output} (${data.length} bytes). Restore it with scripts/restore-db.js.`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
