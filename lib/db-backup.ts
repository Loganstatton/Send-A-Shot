import fs from 'fs';
import path from 'path';
import { db } from './db';
import { DATA_DIR } from './data-dir';

// Database backups (Phase 10) — a single SQLite file (see data-dir.ts), so
// "backup" means a consistent point-in-time copy of it. `VACUUM INTO` is
// SQLite's own supported mechanism for this: unlike a raw file copy, it's
// crash-consistent even in WAL mode (a plain `cp` can catch the main file
// mid-checkpoint, missing writes still sitting in the -wal file) and it
// runs against the live connection — no need to stop the app.
//
// These land in DATA_DIR/backups, i.e. the SAME persistent disk the live
// database is already on (Render's disk, in production) — this protects
// against accidental deletes/bad migrations/corruption, NOT against losing
// the whole disk. True off-site backup (S3, etc.) needs real storage
// credentials this app doesn't have configured; wiring that up is a
// follow-up once those exist, not something to fake here.
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
export const BACKUP_RETENTION_COUNT = 14; // roughly two weeks at one backup/day

export type BackupResult = { fileName: string; path: string; sizeBytes: number; prunedCount: number };

export function runBackup(): BackupResult {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  // A random suffix, not just the millisecond timestamp — VACUUM INTO
  // refuses to write to a path that already exists, so two calls landing
  // in the same millisecond (a double-click on "Back up now", a retried
  // cron request) would otherwise throw instead of producing two backups.
  const suffix = Math.random().toString(36).slice(2, 8);
  const fileName = `app-${new Date().toISOString().replace(/[:.]/g, '-')}-${suffix}.db`;
  const filePath = path.join(BACKUP_DIR, fileName);

  db.prepare('VACUUM INTO ?').run(filePath);
  const sizeBytes = fs.statSync(filePath).size;

  const existing = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('app-') && f.endsWith('.db')).sort();
  let prunedCount = 0;
  while (existing.length - prunedCount > BACKUP_RETENTION_COUNT) {
    fs.unlinkSync(path.join(BACKUP_DIR, existing[prunedCount]));
    prunedCount++;
  }

  return { fileName, path: filePath, sizeBytes, prunedCount };
}

export function listBackups(): { fileName: string; sizeBytes: number; createdAt: string }[] {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith('app-') && f.endsWith('.db'))
    .map((fileName) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, fileName));
      return { fileName, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
