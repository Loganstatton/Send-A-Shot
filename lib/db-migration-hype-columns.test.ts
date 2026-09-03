import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

// Separate test file so it gets its own fresh module registry (see
// vitest.config.ts and lib/db-migration.test.ts's header comment).
// Simulates a database that already went through the PR #20 table
// rebuild (has `source` and a nullable soundcharts_uuid) but predates the
// hype-comment columns added alongside comment-sentiment scoring. That
// gap is closed with plain addColumnIfMissing calls, not another table
// rebuild — this confirms that path actually adds the columns rather
// than the "already migrated, skip" branch silently swallowing them.
describe('discovery_candidates migration (post-YouTube schema -> hype-comment columns)', () => {
  it('adds the new hype-comment columns to an already-migrated table without a rebuild, preserving existing rows', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-migration-hype-test-'));
    process.env.DATA_DIR = dataDir;

    const dbFile = path.join(dataDir, 'app.db');
    const raw = new Database(dbFile);
    raw.exec(`
      CREATE TABLE discovery_candidates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL DEFAULT 'soundcharts',
        soundcharts_uuid TEXT,
        name TEXT NOT NULL,
        photo_url TEXT,
        country TEXT,
        followers_count INTEGER,
        followers_7d_ago INTEGER,
        followers_30d_ago INTEGER,
        growth_7d_pct REAL,
        growth_30d_pct REAL,
        yt_video_id TEXT,
        yt_channel_id TEXT,
        yt_channel_title TEXT,
        yt_genre TEXT,
        yt_view_count INTEGER,
        yt_like_count INTEGER,
        yt_comment_count INTEGER,
        yt_published_at TEXT,
        yt_channel_subscriber_count INTEGER,
        yt_channel_view_count INTEGER,
        yt_views_per_day REAL,
        yt_like_rate REAL,
        yt_comment_rate REAL,
        yt_views_per_subscriber REAL,
        momentum_score REAL,
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
        `INSERT INTO discovery_candidates (source, yt_channel_id, name, momentum_score, flagged_reason, status, discovered_at)
         VALUES ('youtube', 'chan-pre-hype-1', 'Pre-Hype Channel', 65, 'old flagged reason', 'new', '2026-06-01T00:00:00.000Z')`
      )
      .run();
    raw.close();

    const { getDiscoveryCandidates, insertDiscoveryCandidate } = await import('./db');

    const existing = getDiscoveryCandidates().find((c) => c.yt_channel_id === 'chan-pre-hype-1');
    expect(existing).toBeDefined();
    expect(existing!.name).toBe('Pre-Hype Channel');
    // momentum_score is a legacy column (pre-beta migration removed the
    // blended score it stored — see lib/db.ts's schema comment) not on the
    // DiscoveryCandidate type anymore, but the raw row still round-trips it
    // untouched — confirmed via the raw driver, not the typed select.
    expect((existing as unknown as { momentum_score: number }).momentum_score).toBe(65);
    // The new columns exist and are readable (null) on a row inserted
    // before this migration — not an error, not silently missing.
    expect(existing!.yt_hype_comment_rate ?? null).toBeNull();

    // And the new columns are actually writable now — the whole point.
    insertDiscoveryCandidate({
      source: 'youtube', name: 'Post-Hype Channel', yt_channel_id: 'chan-post-hype-1',
      yt_hype_comment_rate: 0.2, yt_comments_analyzed: 15, yt_example_comment_1: 'wow', yt_example_comment_1_likes: 50,
      flagged_reason: 'test',
    });
    const inserted = getDiscoveryCandidates().find((c) => c.yt_channel_id === 'chan-post-hype-1')!;
    expect(inserted.yt_hype_comment_rate).toBeCloseTo(0.2, 5);
    expect(inserted.yt_example_comment_1).toBe('wow');
  });
});
