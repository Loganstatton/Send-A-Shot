import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Own DATA_DIR — the correlation/quartile math needs a small, FULLY
// controlled dataset (every row known, not just a delta), which the huge
// shared lib/db.test.ts suite (every test file's own createArtist call
// adds a score_history row) can't give us.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-accuracy-test-'));

const { createArtist, db, updateArtist } = await import('./db');
const { getScoutAccuracyRows, getScoutAccuracySummary, interpretCorrelation, MIN_DAYS_FOR_ACCURACY_ROW } = await import('./scout-accuracy');

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

// Backdates the most recently inserted score_history row for an artist —
// snapshotScore always stamps "now", so this is how every other test in
// this codebase controls recorded_at (see lib/db.test.ts's Leaderboard
// tests for the same pattern).
function backdateLatestSnapshot(artistId: number, at: string) {
  const row = db.prepare('SELECT id FROM score_history WHERE artist_id = ? ORDER BY id DESC LIMIT 1').get(artistId) as { id: number };
  db.prepare('UPDATE score_history SET recorded_at = ? WHERE id = ?').run(at, row.id);
}

// All six human-rated categories at the same value, for a scoutPoints of
// exactly value * 7 (weights sum to 70) and initialScoutRatingAvg of
// exactly `value`.
function makeRatedArtist(name: string, rating: number, growthPct: number) {
  return createArtist({
    name, music_talent: rating, original_song_response: rating, brand_personality: rating,
    content_consistency: rating, commercial_potential: rating, professionalism: rating,
    growth_velocity_pct: growthPct,
  });
}

describe('getScoutAccuracyRows', () => {
  it('excludes an artist with only one snapshot ever (no second data point to compare against)', () => {
    const artist = makeRatedArtist('Single Snapshot', 8, 20);
    const rows = getScoutAccuracyRows(0);
    expect(rows.find((r) => r.artistId === artist.id)).toBeUndefined();
  });

  it('excludes an artist whose two snapshots are less than minDays apart', () => {
    const artist = makeRatedArtist('Too Recent', 8, 20);
    updateArtist(artist.id, { name: artist.name, growth_velocity_pct: 25 }); // second snapshot, "now" — seconds apart
    const rows = getScoutAccuracyRows(MIN_DAYS_FOR_ACCURACY_ROW);
    expect(rows.find((r) => r.artistId === artist.id)).toBeUndefined();
  });

  it('includes a qualifying artist with the correct initial rating, initial growth, and latest growth', () => {
    const artist = makeRatedArtist('Qualifying Artist', 8, 32);
    backdateLatestSnapshot(artist.id, daysAgoIso(20));
    updateArtist(artist.id, { name: artist.name, growth_velocity_pct: 45 });

    const row = getScoutAccuracyRows(14).find((r) => r.artistId === artist.id)!;
    expect(row).toBeDefined();
    expect(row.daysSinceFirstRating).toBeGreaterThanOrEqual(19); // ~20, allowing for a little test-run drift
    expect(row.initialScoutPoints).toBe(56); // 8 * 70 / 10
    expect(row.initialScoutRatingAvg).toBe(8);
    expect(row.initialGrowthPct).toBe(32);
    expect(row.latestGrowthPct).toBe(45);
  });

  it('reports latestGrowthPct as null (not 0) when the latest snapshot never recorded a growth %', () => {
    const artist = createArtist({ name: 'No Growth Data Artist', music_talent: 7, original_song_response: 7, brand_personality: 7, content_consistency: 7, commercial_potential: 7, professionalism: 7 });
    backdateLatestSnapshot(artist.id, daysAgoIso(20));
    updateArtist(artist.id, { name: artist.name, location: 'Nashville, TN' }); // a second snapshot, still no growth_velocity_pct ever set

    const row = getScoutAccuracyRows(14).find((r) => r.artistId === artist.id)!;
    expect(row.latestGrowthPct).toBeNull();
  });
});

describe('getScoutAccuracySummary', () => {
  it('computes a strong positive correlation and correct quartile averages for a clearly monotonic dataset', () => {
    const specs: [string, number, number][] = [
      ['Top Rated', 10, 50],
      ['High Rated', 7.5, 30],
      ['Mid Rated', 5, 20],
      ['Low Rated', 2.5, 5],
    ];
    for (const [name, rating, growth] of specs) {
      const artist = makeRatedArtist(name, rating, 10);
      backdateLatestSnapshot(artist.id, daysAgoIso(20));
      updateArtist(artist.id, { name: artist.name, growth_velocity_pct: growth });
    }

    const rows = getScoutAccuracyRows(14).filter((r) => specs.some(([name]) => name === r.artistName));
    expect(rows).toHaveLength(4);
    const summary = getScoutAccuracySummary(rows);

    expect(summary.sampleSize).toBe(4);
    expect(summary.correlation).not.toBeNull();
    expect(summary.correlation!).toBeGreaterThan(0.9); // monotonically increasing score -> growth
    expect(summary.topQuartileAvgGrowth).toBe(50); // "Top Rated" alone (quartile size 1 of 4)
    expect(summary.bottomQuartileAvgGrowth).toBe(5); // "Low Rated" alone
  });

  it('computes a strong negative correlation when higher-rated artists actually grew less', () => {
    const specs: [string, number, number][] = [
      ['Inverse Top Rated', 10, 5],
      ['Inverse High Rated', 7.5, 20],
      ['Inverse Mid Rated', 5, 30],
      ['Inverse Low Rated', 2.5, 50],
    ];
    for (const [name, rating, growth] of specs) {
      const artist = makeRatedArtist(name, rating, 10);
      backdateLatestSnapshot(artist.id, daysAgoIso(20));
      updateArtist(artist.id, { name: artist.name, growth_velocity_pct: growth });
    }

    const rows = getScoutAccuracyRows(14).filter((r) => specs.some(([name]) => name === r.artistName));
    const summary = getScoutAccuracySummary(rows);
    expect(summary.correlation!).toBeLessThan(-0.9);
  });

  it('returns null quartile averages (but still a correlation) with fewer than 4 rows, and an all-null summary with zero rows', () => {
    const a = makeRatedArtist('Pair A', 9, 10);
    backdateLatestSnapshot(a.id, daysAgoIso(20));
    updateArtist(a.id, { name: a.name, growth_velocity_pct: 40 });
    const b = makeRatedArtist('Pair B', 3, 10);
    backdateLatestSnapshot(b.id, daysAgoIso(20));
    updateArtist(b.id, { name: b.name, growth_velocity_pct: 10 });

    const pairRows = getScoutAccuracyRows(14).filter((r) => r.artistName === 'Pair A' || r.artistName === 'Pair B');
    const summary = getScoutAccuracySummary(pairRows);
    expect(summary.sampleSize).toBe(2);
    expect(summary.correlation).not.toBeNull();
    expect(summary.topQuartileAvgGrowth).toBeNull();
    expect(summary.bottomQuartileAvgGrowth).toBeNull();

    const empty = getScoutAccuracySummary([]);
    expect(empty).toEqual({ sampleSize: 0, correlation: null, topQuartileAvgGrowth: null, bottomQuartileAvgGrowth: null });
  });
});

describe('interpretCorrelation', () => {
  it('labels strength and direction correctly, and handles null', () => {
    expect(interpretCorrelation(null)).toBe('Not enough data yet');
    expect(interpretCorrelation(0.6)).toBe('strong positive correlation');
    expect(interpretCorrelation(-0.4)).toBe('moderate negative correlation');
    expect(interpretCorrelation(0.15)).toBe('weak positive correlation');
    expect(interpretCorrelation(0.05)).toBe('negligible positive correlation');
    expect(interpretCorrelation(-0.05)).toBe('negligible negative correlation');
  });
});
