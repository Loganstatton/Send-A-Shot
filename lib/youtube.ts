// Server-only YouTube Data API v3 client. Never import this from a client
// component — YOUTUBE_API_KEY must never reach the browser bundle.
//
// Three endpoint types, used deliberately to keep quota cost down:
// - search.list: the only expensive call (100 quota units each — YouTube's
//   own published cost, unrelated to result count), so it's called once per
//   genre per scan, not once per candidate.
// - videos.list / channels.list: 1 unit per call REGARDLESS of how many ids
//   are batched in (up to 50), so every video/channel found across all
//   genres in one scan is deduped and fetched in as few batched calls as
//   possible rather than one call each. See lib/youtube-discovery.ts for
//   where that batching happens.
//
// Unlike Soundcharts, this is a stable, thoroughly documented public API —
// no live-response archaeology needed — but statistics fields still come
// back as strings, and likeCount/commentCount/subscriberCount can be
// entirely ABSENT (comments/likes disabled, subscriber count hidden) rather
// than zero. Treating "absent" as "0" would silently invent a signal that
// was never there, so every parse below keeps that distinction as
// undefined, not 0.

const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export function youtubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

type YoutubeResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function youtubeFetch(path: string, params: Record<string, string>): Promise<YoutubeResult<any>> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { ok: false, error: 'YouTube is not configured on this server.' };

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('key', apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: 'no-store' });
  } catch (err: any) {
    return { ok: false, error: `Could not reach YouTube: ${err?.message ?? 'network error'}` };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason;
    const message = body?.error?.message ?? `YouTube returned ${res.status}`;
    if (reason === 'quotaExceeded') {
      return { ok: false, error: 'YouTube API daily quota exceeded — try again after the quota resets (midnight Pacific).' };
    }
    return { ok: false, error: `YouTube API error (${res.status}): ${message}` };
  }

  try {
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, error: 'YouTube returned a response that was not valid JSON.' };
  }
}

// A whole number if present, otherwise undefined — never invents a 0 for a
// field YouTube didn't return (see file header).
function parseCount(value: unknown): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

export type YoutubeVideoHit = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  publishedAt: string;
  thumbnailUrl?: string;
};

// One search.list call per genre bucket, biased toward recent Music-category
// uploads. `order: 'date'` (not 'relevance'/'viewCount') is what keeps this
// from just surfacing already-huge channels — relevance and view-count
// ordering both favor established popularity, the opposite of what an early
// discovery tool wants.
export async function searchRecentMusicVideos(
  query: string,
  opts: { publishedAfter: string; maxResults: number }
): Promise<YoutubeResult<YoutubeVideoHit[]>> {
  const result = await youtubeFetch('/search', {
    part: 'snippet',
    q: query,
    type: 'video',
    videoCategoryId: '10', // Music
    order: 'date',
    publishedAfter: opts.publishedAfter,
    maxResults: String(opts.maxResults),
    safeSearch: 'none',
  });
  if (!result.ok) return result;

  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  const hits: YoutubeVideoHit[] = items
    .map((item: any) => ({
      videoId: item?.id?.videoId,
      channelId: item?.snippet?.channelId,
      channelTitle: item?.snippet?.channelTitle,
      title: item?.snippet?.title,
      publishedAt: item?.snippet?.publishedAt,
      thumbnailUrl: item?.snippet?.thumbnails?.medium?.url ?? item?.snippet?.thumbnails?.default?.url,
    }))
    .filter((h: YoutubeVideoHit) => h.videoId && h.channelId);

  return { ok: true, data: hits };
}

export type YoutubeVideoStats = {
  videoId: string;
  viewCount?: number;
  likeCount?: number;
  commentCount?: number;
};

// Batched: up to 50 ids per call, 1 quota unit total no matter how many.
export async function getVideosStats(videoIds: string[]): Promise<YoutubeResult<YoutubeVideoStats[]>> {
  if (videoIds.length === 0) return { ok: true, data: [] };
  const result = await youtubeFetch('/videos', { part: 'statistics', id: videoIds.slice(0, 50).join(',') });
  if (!result.ok) return result;

  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  const stats: YoutubeVideoStats[] = items.map((item: any) => ({
    videoId: item.id,
    viewCount: parseCount(item?.statistics?.viewCount),
    likeCount: parseCount(item?.statistics?.likeCount),
    commentCount: parseCount(item?.statistics?.commentCount),
  }));
  return { ok: true, data: stats };
}

export type YoutubeChannelStats = {
  channelId: string;
  subscriberCount?: number; // undefined if the channel hides this (hiddenSubscriberCount)
  viewCount?: number;
};

// Batched, same as getVideosStats.
export async function getChannelsStats(channelIds: string[]): Promise<YoutubeResult<YoutubeChannelStats[]>> {
  if (channelIds.length === 0) return { ok: true, data: [] };
  const result = await youtubeFetch('/channels', { part: 'statistics', id: channelIds.slice(0, 50).join(',') });
  if (!result.ok) return result;

  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  const stats: YoutubeChannelStats[] = items.map((item: any) => ({
    channelId: item.id,
    subscriberCount: item?.statistics?.hiddenSubscriberCount ? undefined : parseCount(item?.statistics?.subscriberCount),
    viewCount: parseCount(item?.statistics?.viewCount),
  }));
  return { ok: true, data: stats };
}
