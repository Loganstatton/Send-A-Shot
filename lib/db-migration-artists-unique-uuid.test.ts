import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

// Separate test file for its own fresh module registry (see
// vitest.config.ts and lib/db-migration.test.ts's own comment) — this needs
// to pre-seed a database that already has two artists sharing the same
// soundcharts_uuid BEFORE lib/db.ts ever runs its startup migration,
// simulating a real deployed database that predates the new unique index.
describe('artists.soundcharts_uuid unique index migration (best-effort, non-destructive)', () => {
  it('does not crash and does not delete/alter existing accidental-duplicate rows when the index cannot be created', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-artists-uuid-migration-test-'));
    process.env.DATA_DIR = dataDir;

    const dbFile = path.join(dataDir, 'app.db');
    const raw = new Database(dbFile);
    // A minimal pre-migration artists table with two rows that already
    // share a soundcharts_uuid — something the app itself could never have
    // created before this migration (no unique index existed yet), but a
    // real deployed database from before this change could have via a
    // manual DB edit or an old code path.
    raw.exec(`
      CREATE TABLE artists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        name TEXT NOT NULL,
        stage TEXT NOT NULL DEFAULT 'watchlist',
        music_talent REAL NOT NULL DEFAULT 0,
        growth_velocity REAL NOT NULL DEFAULT 0,
        engagement_quality REAL NOT NULL DEFAULT 0,
        original_song_response REAL NOT NULL DEFAULT 0,
        brand_personality REAL NOT NULL DEFAULT 0,
        content_consistency REAL NOT NULL DEFAULT 0,
        commercial_potential REAL NOT NULL DEFAULT 0,
        professionalism REAL NOT NULL DEFAULT 0,
        soundcharts_uuid TEXT
      );
    `);
    raw.prepare("INSERT INTO artists (created_at, updated_at, name, soundcharts_uuid) VALUES ('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'Pre-Existing Dup A', 'shared-uuid-pre-migration')").run();
    raw.prepare("INSERT INTO artists (created_at, updated_at, name, soundcharts_uuid) VALUES ('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', 'Pre-Existing Dup B', 'shared-uuid-pre-migration')").run();
    raw.close();

    // Importing lib/db.ts now runs its startup schema setup (including the
    // addColumnIfMissing calls this minimal table is missing columns for,
    // and the best-effort unique-index creation) against this exact
    // pre-seeded file. It must not throw.
    const { getAllArtists } = await import('./db');

    const artists = getAllArtists();
    const dupes = artists.filter((a) => a.soundcharts_uuid === 'shared-uuid-pre-migration');
    // Both pre-existing rows survive untouched — the migration is
    // best-effort and non-destructive, not a silent data-loss cleanup.
    expect(dupes).toHaveLength(2);
    expect(dupes.map((d) => d.name).sort()).toEqual(['Pre-Existing Dup A', 'Pre-Existing Dup B']);
  });
});
