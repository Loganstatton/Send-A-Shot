import { db } from './pg';
import { exportSnapshot, restoreSnapshot } from './snapshot-core';

// Database backups. Two independent layers, covering different failures:
//
//   1. The hosting provider's own Postgres backups (on Render's paid
//      database plans: point-in-time recovery) — the answer to "the whole
//      database server is gone." Nothing in this file; see docs/DEPLOYMENT.md.
//
//   2. Snapshots, below — a consistent logical export of every table, stored
//      as a row in db_snapshots. The answer to "a bad migration / an
//      accidental delete / a bug corrupted rows and I need yesterday's
//      data back": restore one in place, or download it to keep a copy
//      that lives outside the database entirely.
//
// A snapshot lives in the same database it protects, so by itself it is NOT
// protection against losing that database — downloading one (the admin
// Backups page) is what makes an off-site copy.

// How many scheduled/manual snapshots are kept; older ones are pruned.
export const BACKUP_RETENTION_COUNT = 14; // roughly two weeks at one a day
// Safety snapshots taken automatically right before a restore are kept
// separately, so a run of restores can't push out the regular history.
const PRE_RESTORE_RETENTION_COUNT = 5;

export type BackupKind = 'scheduled' | 'pre-restore';
export type BackupResult = { fileName: string; sizeBytes: number; rowCount: number; prunedCount: number };
export type BackupListEntry = { fileName: string; kind: BackupKind; sizeBytes: number; rowCount: number; createdAt: string };

const raw = { query: async (text: string, values?: unknown[]) => await db.query(text, values) };

export async function runBackup(kind: BackupKind = 'scheduled'): Promise<BackupResult> {
  // REPEATABLE READ: every table is read as of the same instant, however
  // long the export takes and whatever is being written meanwhile.
  const { data, rowCount } = await db.transaction(async () => {
    await db.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
    return exportSnapshot(raw);
  });

  const now = new Date().toISOString();
  // A random suffix, not just the timestamp — two requests landing in the
  // same millisecond (a double-click, a retried cron call) both succeed.
  const suffix = Math.random().toString(36).slice(2, 8);
  const fileName = `${kind === 'pre-restore' ? 'pre-restore' : 'snapshot'}-${now.replace(/[:.]/g, '-')}-${suffix}.json.gz`;
  await db
    .prepare('INSERT INTO db_snapshots (created_at, file_name, kind, size_bytes, row_count, data) VALUES (?, ?, ?, ?, ?, ?)')
    .run(now, fileName, kind, data.length, rowCount, data);

  const keep = kind === 'pre-restore' ? PRE_RESTORE_RETENTION_COUNT : BACKUP_RETENTION_COUNT;
  const pruned = await db
    .prepare(`
      DELETE FROM db_snapshots
      WHERE kind = ? AND id NOT IN (SELECT id FROM db_snapshots WHERE kind = ? ORDER BY created_at DESC, id DESC LIMIT ?)
    `)
    .run(kind, kind, keep);

  return { fileName, sizeBytes: data.length, rowCount, prunedCount: pruned.changes };
}

export async function listBackups(): Promise<BackupListEntry[]> {
  const rows = (await db
    .prepare('SELECT file_name, kind, size_bytes, row_count, created_at FROM db_snapshots ORDER BY created_at DESC, id DESC')
    .all()) as { file_name: string; kind: BackupKind; size_bytes: number; row_count: number; created_at: string }[];
  return rows.map((r) => ({ fileName: r.file_name, kind: r.kind, sizeBytes: r.size_bytes, rowCount: r.row_count, createdAt: r.created_at }));
}

/** The snapshot file itself (gzipped JSON), for download or restore. */
export async function getBackupData(fileName: string): Promise<Buffer | undefined> {
  const row = (await db.prepare('SELECT data FROM db_snapshots WHERE file_name = ?').get(fileName)) as { data: Buffer } | undefined;
  return row?.data;
}

export type RestoreResult = { rowCount: number; tableCount: number; skippedTables: string[]; snapshotCreatedAt: string; safetySnapshot: string };

// Replaces every table's contents with a stored snapshot's. Takes a fresh
// 'pre-restore' snapshot of the current state first, so a restore can
// itself be undone. The replacement runs in one transaction — if anything
// fails partway, the database is left exactly as it was.
export async function restoreBackup(fileName: string): Promise<RestoreResult> {
  const data = await getBackupData(fileName);
  if (!data) throw new Error(`No snapshot named ${fileName}.`);
  const safety = await runBackup('pre-restore');
  const result = await db.transaction(() => restoreSnapshot(raw, data));
  return { ...result, safetySnapshot: safety.fileName };
}
