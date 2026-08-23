import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

// Same isolation trick as lib/db.test.ts — lib/youtube.ts now depends on
// lib/db.ts for quota tracking, so DATA_DIR must be set before either is
// ever imported.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'youtube-test-'));

const { recordYoutubeQuotaUsage } = await import('./db');
const { currentYoutubeQuotaDay, getYoutubeQuotaStatus, searchArtistVideo, searchRecentMusicVideos } = await import('./youtube');

describe('currentYoutubeQuotaDay', () => {
  it('formats as YYYY-MM-DD', () => {
    expect(currentYoutubeQuotaDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('getYoutubeQuotaStatus', () => {
  it('defaults to a 10,000-unit budget with nothing used yet', () => {
    delete process.env.YOUTUBE_DAILY_QUOTA_BUDGET;
    const status = getYoutubeQuotaStatus();
    expect(status.budget).toBe(10_000);
    expect(status.usedToday).toBe(0);
    expect(status.remaining).toBe(10_000);
    expect(status.warning).toBe(false);
  });

  it('reflects usage recorded for today, and warns at 80% of budget', () => {
    recordYoutubeQuotaUsage(7_999, '/search', currentYoutubeQuotaDay());
    let status = getYoutubeQuotaStatus();
    expect(status.usedToday).toBe(7_999);
    expect(status.remaining).toBe(10_000 - 7_999);
    expect(status.warning).toBe(false); // just under 80% of 10,000

    recordYoutubeQuotaUsage(1, '/channels', currentYoutubeQuotaDay());
    status = getYoutubeQuotaStatus();
    expect(status.usedToday).toBe(8_000);
    expect(status.warning).toBe(true); // exactly 80%
  });

  it('ignores usage recorded for a different quota day', () => {
    const before = getYoutubeQuotaStatus().usedToday;
    recordYoutubeQuotaUsage(500, '/search', '2020-01-01');
    expect(getYoutubeQuotaStatus().usedToday).toBe(before);
  });

  it('respects a custom YOUTUBE_DAILY_QUOTA_BUDGET override', () => {
    process.env.YOUTUBE_DAILY_QUOTA_BUDGET = '50000';
    expect(getYoutubeQuotaStatus().budget).toBe(50_000);
    delete process.env.YOUTUBE_DAILY_QUOTA_BUDGET;
  });
});

describe('youtubeFetch pre-flight budget check (exercised via exported lookups)', () => {
  it('refuses a call that would exceed the daily budget without making a network request', async () => {
    process.env.YOUTUBE_API_KEY = 'test-key-not-real';
    process.env.YOUTUBE_DAILY_QUOTA_BUDGET = '100';
    // Already at budget for today (from the describe block above, plus this
    // exact day's own recorded usage) — a search.list call (100 units) must
    // be refused locally. If the pre-flight check were missing, this would
    // instead attempt a real network call to googleapis.com with a fake key
    // and either hang or return a different (auth) error — the tight
    // timeout below is itself part of what's being verified.
    recordYoutubeQuotaUsage(100, '/search', currentYoutubeQuotaDay());

    const result = await searchRecentMusicVideos('test query', { publishedAfter: new Date().toISOString(), maxResults: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.quotaExceeded).toBe(true);
      expect(result.error).toMatch(/quota/i);
    }

    delete process.env.YOUTUBE_API_KEY;
    delete process.env.YOUTUBE_DAILY_QUOTA_BUDGET;
  }, 2000);

  it('reports "not configured" without even reaching the budget check when no API key is set', async () => {
    delete process.env.YOUTUBE_API_KEY;
    const result = await searchArtistVideo('Some Artist');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.quotaExceeded).toBeFalsy();
      expect(result.error).toMatch(/not configured/i);
    }
  });
});
