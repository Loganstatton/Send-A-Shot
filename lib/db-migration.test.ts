import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

// Separate test file so it gets its own fresh module registry (see
// vitest.config.ts) — lib/db.ts's schema-setup code only runs once per
// process/file, so this needs to pre-seed the OLD table shape on disk
// BEFORE lib/db.ts is ever imported, simulating a real deployed database
// from before YouTube discovery existed.
describe('discovery_candidates migration (pre-YouTube schema -> multi-source schema)', () => {
  it('rebuilds an old NOT NULL UNIQUE soundcharts_uuid table in place, preserving existing rows', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-migration-test-'));
    process.env.DATA_DIR = dataDir;

    const dbFile = path.join(dataDir, 'app.db');
    const raw = new Database(dbFile);
    raw.exec(`
      CREATE TABLE discovery_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        soundcharts_uuid TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        photo_url TEXT,
        country TEXT,
        followers_count INTEGER,
        followers_7d_ago INTEGER,
        followers_30d_ago INTEGER,
        growth_7d_pct REAL,
        growth_30d_pct REAL,
        flagged_reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'new',
        discovered_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewed_by INTEGER,
        artist_id INTEGER
      );
    `);
    raw
      .prepare(
        `INSERT INTO discovery_candidates (soundcharts_uuid, name, followers_count, flagged_reason, status, discovered_at)
         VALUES ('uuid-pre-existing-1', 'Pre-Existing Artist', 12345, 'old scan reason', 'new', '2026-01-01T00:00:00.000Z')`
      )
      .run();
    raw.close();

    // Importing lib/db.ts now runs its startup migration against this
    // exact pre-seeded file.
    const { getDiscoveryCandidates, getKnownDiscoveryYoutubeChannelIds, insertDiscoveryCandidate } = await import('./db');

    const rows = getDiscoveryCandidates();
    const migrated = rows.find((r) => r.soundcharts_uuid === 'uuid-pre-existing-1');
    expect(migrated).toBeDefined();
    expect(migrated!.source).toBe('soundcharts');
    expect(migrated!.name).toBe('Pre-Existing Artist');
    expect(migrated!.followers_count).toBe(12345);
    expect(migrated!.flagged_reason).toBe('old scan reason');

    // The new shape actually works post-migration: a nullable-uuid
    // YouTube candidate can be inserted without violating anything the
    // old NOT NULL UNIQUE constraint would have rejected.
    insertDiscoveryCandidate({ source: 'youtube', name: 'New YouTube Candidate', yt_channel_id: 'chan-post-migration-1', flagged_reason: 'test' });
    expect(getKnownDiscoveryYoutubeChannelIds().has('chan-post-migration-1')).toBe(true);
  });
});
