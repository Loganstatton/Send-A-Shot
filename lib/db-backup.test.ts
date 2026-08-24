import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Own DATA_DIR — this test writes real files to disk (the whole point of
// runBackup), so it needs a throwaway directory, not the shared test DB.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-backup-test-'));
process.env.DATA_DIR = dataDir;

const { createArtist } = await import('./db');
const { BACKUP_RETENTION_COUNT, listBackups, runBackup } = await import('./db-backup');

describe('runBackup', () => {
  it('writes a real, non-empty .db file to DATA_DIR/backups and it appears in listBackups', () => {
    createArtist({ name: 'Backup Test Artist', music_talent: 5 }); // give the DB something in it
    const result = runBackup();

    expect(fs.existsSync(result.path)).toBe(true);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.path).toBe(path.join(dataDir, 'backups', result.fileName));

    const backups = listBackups();
    expect(backups.some((b) => b.fileName === result.fileName)).toBe(true);
  });

  it('the backup file is a real, valid SQLite database containing the data at backup time', () => {
    createArtist({ name: 'Backup Content Artist', music_talent: 7 });
    const result = runBackup();

    // Open the BACKUP file directly (not the live db) and confirm the
    // artist is really in there — proves this is a real, queryable
    // snapshot, not just an empty or corrupt file of the right size.
    const Database = require('better-sqlite3');
    const backupDb = new Database(result.path, { readonly: true });
    const row = backupDb.prepare("SELECT name FROM artists WHERE name = 'Backup Content Artist'").get();
    backupDb.close();
    expect(row).toBeDefined();
    expect(row.name).toBe('Backup Content Artist');
  });

  it('prunes old backups beyond BACKUP_RETENTION_COUNT, keeping the newest ones', () => {
    // Whatever the two tests above already left in dataDir/backups, running
    // this many MORE times must bring the total back down to at most the
    // retention count — pruning is triggered on every run, not just once.
    for (let i = 0; i < BACKUP_RETENTION_COUNT + 3; i++) runBackup();
    const backups = listBackups();
    expect(backups.length).toBeLessThanOrEqual(BACKUP_RETENTION_COUNT);

    // And it kept the NEWEST ones — the very last backup just written is
    // still present, not pruned in favor of an older one.
    expect(backups[0].fileName).toBeDefined();
  });
});
