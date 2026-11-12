import { describe, expect, it } from 'vitest';

const { insertDiscoveryCandidate } = await import('./db');
const { db } = await import('./pg');
const { purgeExpiredYouTubeStats } = await import('./youtube-retention');

async function addCandidate(channelId: string, daysOld: number) {
  await insertDiscoveryCandidate({
    source: 'youtube', name: `Chan ${channelId}`, flagged_reason: 'test', yt_channel_id: channelId, yt_video_id: `v-${channelId}`,
    yt_view_count: 1000, yt_channel_subscriber_count: 50, yt_views_per_day: 12.5, yt_example_comment_1: 'love this', yt_example_comment_1_likes: 3,
  } as any);
  await db.prepare('UPDATE discovery_candidates SET discovered_at = ? WHERE yt_channel_id = ?').run(new Date(Date.now() - daysOld * 86400_000).toISOString(), channelId);
  return (await db.prepare('SELECT * FROM discovery_candidates WHERE yt_channel_id = ?').get(channelId)) as any;
}

describe('YouTube 30-day statistics retention', () => {
  it('clears statistics, derived figures and comments older than 30 days, keeping IDs; leaves fresh ones', async () => {
    const old = await addCandidate(`old-${Date.now()}`, 31);
    const fresh = await addCandidate(`fresh-${Date.now()}`, 29);
    expect(await purgeExpiredYouTubeStats()).toBeGreaterThanOrEqual(1);
    const o = (await db.prepare('SELECT * FROM discovery_candidates WHERE id = ?').get(old.id)) as any;
    const f = (await db.prepare('SELECT * FROM discovery_candidates WHERE id = ?').get(fresh.id)) as any;
    expect([o.yt_view_count, o.yt_channel_subscriber_count, o.yt_views_per_day, o.yt_example_comment_1, o.yt_example_comment_1_likes]).toEqual([null, null, null, null, null]);
    expect([o.yt_channel_id, o.yt_video_id, o.name]).toEqual([old.yt_channel_id, old.yt_video_id, old.name]);
    expect(Number(f.yt_view_count)).toBe(1000);
    expect(f.yt_example_comment_1).toBe('love this');
    // Running again changes nothing.
    expect(await purgeExpiredYouTubeStats()).toBe(0);
  });
});
