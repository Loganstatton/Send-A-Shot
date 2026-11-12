import { db } from './pg';

// YouTube API Services Developer Policies: statistics fetched without the
// channel owner's authorization (view, like, comment and subscriber counts)
// must not be stored for more than 30 days. Discovery candidates are
// fetched once, when found, and never refreshed — so once a candidate's
// data is 30 days old, its YouTube statistics, the figures calculated from
// them and the sample comments are cleared. The channel and video IDs
// stay, so a Scout can still open the channel on YouTube. Runs at the start
// of every daily YouTube scan (app/api/discovery/scan-youtube).
export const YOUTUBE_STATS_MAX_AGE_DAYS = 30;

const STAT_COLUMNS = [
  'yt_view_count', 'yt_like_count', 'yt_comment_count', 'yt_channel_subscriber_count', 'yt_channel_view_count',
  'yt_views_per_day', 'yt_like_rate', 'yt_comment_rate', 'yt_views_per_subscriber', 'yt_hype_comment_rate',
  'yt_comments_analyzed', 'yt_example_comment_1', 'yt_example_comment_1_likes', 'yt_example_comment_2', 'yt_example_comment_2_likes',
];

export async function purgeExpiredYouTubeStats(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - YOUTUBE_STATS_MAX_AGE_DAYS * 86400_000).toISOString();
  const anySet = STAT_COLUMNS.map((c) => `${c} IS NOT NULL`).join(' OR ');
  const result = await db
    .prepare(`UPDATE discovery_candidates SET ${STAT_COLUMNS.map((c) => `${c} = NULL`).join(', ')} WHERE discovered_at < ? AND (${anySet})`)
    .run(cutoff);
  return Number((result as { changes?: number }).changes ?? 0);
}
