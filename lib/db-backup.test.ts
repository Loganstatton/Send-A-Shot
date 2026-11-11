import { describe, expect, it } from 'vitest';

const {
  createArtist, createUser, db, deleteArtist, executeTrade, getAllArtists, getArtist, getHolding, getUserById, getUserTransactions,
} = await import('./db');
const { BACKUP_RETENTION_COUNT, getBackupData, listBackups, restoreBackup, runBackup } = await import('./db-backup');
const { parseSnapshot } = await import('./snapshot-core');

describe('runBackup', () => {
  it('stores a real, non-empty snapshot and it appears in listBackups', async () => {
    await createArtist({ name: 'Backup Test Artist', music_talent: 5 });
    const result = await runBackup();

    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.rowCount).toBeGreaterThan(0);
    const backups = await listBackups();
    const listed = backups.find((b) => b.fileName === result.fileName);
    expect(listed).toBeDefined();
    expect(listed!.sizeBytes).toBe(result.sizeBytes);
    expect(listed!.kind).toBe('scheduled');
  });

  it('the snapshot really contains the data as of backup time', async () => {
    await createArtist({ name: 'Backup Content Artist', music_talent: 7 });
    const result = await runBackup();
    await createArtist({ name: 'Created After The Backup', music_talent: 7 });

    // Read the stored SNAPSHOT (not the live tables) and confirm the artist
    // is in there — a real, parseable export, not just bytes of the right size.
    const snapshot = parseSnapshot((await getBackupData(result.fileName))!);
    const names = snapshot.tables.artists.map((a: { name: string }) => a.name);
    expect(names).toContain('Backup Content Artist');
    expect(names).not.toContain('Created After The Backup');
    // Snapshots never contain other snapshots (or they'd grow without bound).
    expect(snapshot.tables.db_snapshots).toBeUndefined();
  });

  it('prunes old snapshots beyond BACKUP_RETENTION_COUNT, keeping the newest ones', async () => {
    let last = await runBackup();
    for (let i = 0; i < BACKUP_RETENTION_COUNT + 3; i++) last = await runBackup();
    const backups = (await listBackups()).filter((b) => b.kind === 'scheduled');
    expect(backups.length).toBe(BACKUP_RETENTION_COUNT);
    // The very last one just written is still there, newest first.
    expect(backups[0].fileName).toBe(last.fileName);
  });
});

describe('restoreBackup', () => {
  it('brings back deleted rows, undoes later changes, and keeps ids, balances and holdings exactly', async () => {
    const trader = await createUser({ name: 'Restore Trader', email: 'restore-trader@example.com', password_hash: 'hash' });
    const artist = await createArtist({ name: 'Restore Me', music_talent: 8 });
    const buy = await executeTrade(trader.id, artist.id, 'buy', 250_000);
    expect(buy.ok).toBe(true);
    const balanceAtBackup = (await getUserById(trader.id))!.next_credits_cents;
    const holdingAtBackup = (await getHolding(trader.id, artist.id))!;

    const backup = await runBackup();

    // Damage after the backup: more trading, a new artist, and the original
    // artist deleted outright (which cascades away the holding and trades).
    await executeTrade(trader.id, artist.id, 'buy', 100_000);
    const later = await createArtist({ name: 'Should Vanish On Restore', music_talent: 5 });
    await deleteArtist(artist.id);
    expect(await getArtist(artist.id)).toBeUndefined();
    expect(await getHolding(trader.id, artist.id)).toBeUndefined();

    const result = await restoreBackup(backup.fileName);
    expect(result.rowCount).toBe(backup.rowCount);

    expect((await getArtist(artist.id))!.name).toBe('Restore Me');
    expect(await getArtist(later.id)).toBeUndefined();
    expect((await getUserById(trader.id))!.next_credits_cents).toBe(balanceAtBackup);
    const holding = (await getHolding(trader.id, artist.id))!;
    expect(holding.shares).toBe(holdingAtBackup.shares);
    expect(holding.cost_basis_cents).toBe(holdingAtBackup.cost_basis_cents);
    expect(await getUserTransactions(trader.id)).toHaveLength(1);
  });

  it('new rows after a restore get fresh ids (sequences are moved past the restored rows)', async () => {
    const before = await getAllArtists();
    const maxId = Math.max(...before.map((a) => a.id));
    const backup = await runBackup();
    await restoreBackup(backup.fileName);
    const created = await createArtist({ name: 'Created After Restore', music_talent: 5 });
    expect(created.id).toBeGreaterThan(maxId);
  });

  it('takes a pre-restore safety snapshot first, so the restore itself can be undone', async () => {
    const backup = await runBackup();
    const marker = await createArtist({ name: 'Only In The Safety Snapshot', music_talent: 5 });

    const result = await restoreBackup(backup.fileName);
    expect(await getArtist(marker.id)).toBeUndefined();
    const safety = (await listBackups()).find((b) => b.fileName === result.safetySnapshot);
    expect(safety?.kind).toBe('pre-restore');

    // Undo the restore.
    await restoreBackup(result.safetySnapshot);
    expect((await getArtist(marker.id))!.name).toBe('Only In The Safety Snapshot');
  });

  it('a failed restore leaves the database untouched', async () => {
    const artist = await createArtist({ name: 'Survives A Failed Restore', music_talent: 5 });
    // A snapshot whose rows violate a NOT NULL constraint partway through.
    const zlib = await import('zlib');
    const bad = zlib.gzipSync(Buffer.from(JSON.stringify({
      format: 'sas-snapshot-v1', created_at: new Date().toISOString(), migrations: [],
      tables: { users: [{ id: 1, created_at: 'x', name: null, email: 'bad@example.com', password_hash: 'h' }] },
    })));
    await db.prepare('INSERT INTO db_snapshots (created_at, file_name, kind, size_bytes, row_count, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), 'broken.json.gz', 'scheduled', bad.length, 1, bad);

    await expect(restoreBackup('broken.json.gz')).rejects.toThrow();
    expect((await getArtist(artist.id))!.name).toBe('Survives A Failed Restore');
  });

  it('rejects an unknown snapshot name', async () => {
    await expect(restoreBackup('does-not-exist.json.gz')).rejects.toThrow(/No snapshot named/);
  });
});
