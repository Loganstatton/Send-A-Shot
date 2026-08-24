// Standalone CLI equivalent of lib/db-backup.ts's runBackup() — for local
// dev, or an environment with direct disk access rather than the running
// app's own /api/admin/backup route. Duplicates the small amount of path
// logic rather than importing the TS module directly (same tradeoff
// postinstall.js already makes for DATA_DIR — this script runs as plain
// CommonJS with no TypeScript loader configured).
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const RETENTION_COUNT = 14;

function main() {
  const dbFile = path.join(DATA_DIR, 'app.db');
  if (!fs.existsSync(dbFile)) {
    console.error(`[backup-db] no database found at ${dbFile}`);
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // Random suffix so two runs in the same millisecond never collide —
  // VACUUM INTO refuses to write to a path that already exists.
  const suffix = Math.random().toString(36).slice(2, 8);
  const fileName = `app-${new Date().toISOString().replace(/[:.]/g, '-')}-${suffix}.db`;
  const filePath = path.join(BACKUP_DIR, fileName);

  // Not opened readonly: VACUUM INTO reads the source and writes only the
  // NEW target file, but SQLite's VACUUM family of commands expects a
  // writable connection regardless of what they actually modify. WAL mode
  // supports multiple simultaneous connections, so this is safe to run
  // against a live database without stopping the app.
  const db = new Database(dbFile);
  db.prepare('VACUUM INTO ?').run(filePath);
  db.close();

  const sizeBytes = fs.statSync(filePath).size;
  console.log(`[backup-db] wrote ${filePath} (${(sizeBytes / 1024).toFixed(1)} KB)`);

  const existing = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('app-') && f.endsWith('.db')).sort();
  let pruned = 0;
  while (existing.length - pruned > RETENTION_COUNT) {
    const toRemove = existing[pruned];
    fs.unlinkSync(path.join(BACKUP_DIR, toRemove));
    console.log(`[backup-db] pruned old backup ${toRemove}`);
    pruned++;
  }
}

main();
