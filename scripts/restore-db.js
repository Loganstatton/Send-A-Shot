// Restores a backup written by backup-db.js (or /admin/backups' "Back up
// now" button) over the live database. Deliberately a CLI script, not a
// one-click admin web action — overwriting the live database from a
// browser button is the kind of action that should require someone with
// actual disk access, thinking carefully, not a misclick.
//
// Usage:
//   node scripts/restore-db.js <path-to-backup.db>
//   node scripts/restore-db.js latest   # picks the newest file in data/backups
//
// STOP THE APP FIRST. Restoring into a live database out from under a
// running server risks the app reading a half-swapped file.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DB_FILE = path.join(DATA_DIR, 'app.db');

function resolveBackupPath(arg) {
  if (!arg) {
    console.error('[restore-db] usage: node scripts/restore-db.js <path-to-backup.db|latest>');
    process.exit(1);
  }
  if (arg !== 'latest') return path.resolve(arg);

  if (!fs.existsSync(BACKUP_DIR)) {
    console.error(`[restore-db] no backups directory at ${BACKUP_DIR}`);
    process.exit(1);
  }
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('app-') && f.endsWith('.db')).sort();
  if (files.length === 0) {
    console.error('[restore-db] no backups found');
    process.exit(1);
  }
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

function main() {
  const backupPath = resolveBackupPath(process.argv[2]);
  if (!fs.existsSync(backupPath)) {
    console.error(`[restore-db] backup file not found: ${backupPath}`);
    process.exit(1);
  }

  // Always snapshot whatever's currently live before overwriting it — an
  // aborted or wrong restore should never be unrecoverable.
  if (fs.existsSync(DB_FILE)) {
    const safetyPath = path.join(DATA_DIR, `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    fs.copyFileSync(DB_FILE, safetyPath);
    console.log(`[restore-db] current database saved to ${safetyPath} before overwriting`);
  }

  fs.copyFileSync(backupPath, DB_FILE);
  // Drop any stale WAL/SHM files from the PREVIOUS database — they don't
  // belong to the restored file's contents, and leaving them around risks
  // SQLite trying to replay unrelated writes on next open.
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = DB_FILE + suffix;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  console.log(`[restore-db] restored ${backupPath} -> ${DB_FILE}`);
  console.log('[restore-db] restart the app now.');
}

main();
