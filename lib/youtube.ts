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

import { getYoutubeQuotaUsedToday, recordYoutubeQuotaUsage } from './db';

const BASE_URL = 'https://www.googleapis.com/youtube/v3';

export function youtubeConfigured(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

// YouTube's free tier grants 10,000 units/day; overridable once a real
// increased-quota grant is approved (see the checklist's "apply for
// increased YouTube quota if real usage justifies it" — a real-world,
// non-code step this env var is what you'd bump afterward).
const DEFAULT_DAILY_QUOTA_BUDGET = 10_000;
function dailyQuotaBudget(): number {
  const raw = Number(process.env.YOUTUBE_DAILY_QUOTA_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_QUOTA_BUDGET;
}

// YouTube's quota resets at midnight Pacific — format "today" in that
// timezone (not the server's, not UTC) so our own daily counter rolls over
// at the same moment YouTube's does. 'en-CA' formats as YYYY-MM-DD.
export function currentYoutubeQuotaDay(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export type YoutubeQuotaStatus = { usedToday: number; budget: number; remaining: number; warning: boolean };

// warning fires at 80% of budget — early enough to actually act on (finish
// the current batch, wait for reset) rather than finding out right as the
// last unit is spent.
const QUOTA_WARNING_RATIO = 0.8;

export function getYoutubeQuotaStatus(): YoutubeQuotaStatus {
  const budget = dailyQuotaBudget();
  const usedToday = getYoutubeQuotaUsedToday(currentYoutubeQuotaDay());
  return { usedToday, budget, remaining: Math.max(0, budget - usedToday), warning: usedToday >= budget * QUOTA_WARNING_RATIO };
}

// YouTube's own published cost per endpoint — see the file header. Anything
// not listed (there is nothing else this client calls) defaults to 1, the
// cheapest real cost, rather than under-tracking silently.
const QUOTA_COST_BY_PATH: Record<string, number> = {
  '/search': 100,
  '/channels': 1,
  '/playlistItems': 1,
  '/videos': 1,
};

type YoutubeResult<T> = { ok: true; data: T } | { ok: false; error: string; quotaExceeded?: boolean };

async function youtubeFetch(path: string, params: Record<string, string>): Promise<YoutubeResult<any>> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { ok: false, error: 'YouTube is not configured on this server.' };

  const cost = QUOTA_COST_BY_PATH[path] ?? 1;
  const quotaDay = currentYoutubeQuotaDay();
  const status = getYoutubeQuotaStatus();
  // Self-imposed budget check, ahead of YouTube's own — turns "warn before
  // hitting the daily limit" into an actual guardrail instead of only a
  // number on a dashboard nobody's watching in real time. Refusing here
  // costs nothing (no request ever leaves this server), unlike letting
  // YouTube itself reject it with a quotaExceeded 403.
  if (status.usedToday + cost > status.budget) {
    return {
      ok: false,
      quotaExceeded: true,
      error: `YouTube daily quota budget (${status.budget} units) would be exceeded by this call (${status.usedToday} already used) — skipping to preserve remaining quota. Resets at midnight Pacific.`,
    };
  }

  const url = new URL(`${BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set('key', apiKey);

  let res: Response;
  try {
    res = await fetch(url.toString(), { cache: 'no-store' });
  } catch (err: any) {
    // Never reached Google's servers — nothing was actually spent.
    return { ok: false, error: `Could not reach YouTube: ${err?.message ?? 'network error'}` };
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason;
    const message = body?.error?.message ?? `YouTube returned ${res.status}`;
    if (reason === 'quotaExceeded') {
      // Google's quota check happens before the request executes — a
      // rejection here means nothing was actually spent either, so this
      // (unlike every other outcome below) is deliberately NOT recorded.
      return { ok: false, quotaExceeded: true, error: 'YouTube API daily quota exceeded — try again after the quota resets (midnight Pacific).' };
    }
    recordYoutubeQuotaUsage(cost, path, quotaDay);
    return { ok: false, error: `YouTube API error (${res.status}): ${message}` };
  }

  recordYoutubeQuotaUsage(cost, path, quotaDay);
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
    // YouTube rejects (400) anything outside 0-50, rather than clamping —
    // clamp here so an env var set too high degrades to "50, the max"
    // instead of erroring out this genre's search entirely.
    maxResults: String(Math.min(Math.max(opts.maxResults, 1), 50)),
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

// Strips punctuation/case and common channel-name noise ("- Topic", VEVO)
// so "Ed Sheeran" lines up with both "Ed Sheeran" and "EdSheeranVEVO".
function normalizeChannelName(name: string): string {
  return name
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\bvevo\b/gi, '')
    .replace(/\bofficial\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

// How a featured-video match was found, in descending order of confidence
// — see getFeaturedVideoForArtist below. Stored on Artist.featured_video_
// match_type so a Scout (and the Admin sync-health page) can tell a
// verified match from one that genuinely might be the wrong artist.
export type VideoMatchType = 'channel' | 'search_matched_name' | 'search_unverified';
export type YoutubeVideoMatch = YoutubeVideoHit & { matchType: VideoMatchType };

// One-off "find this artist's video" lookup — distinct from
// searchRecentMusicVideos above, which is deliberately date-ordered and
// time-boxed for discovery scans. Here the artist is already known (a
// Scout just added them, or an existing artist has no video yet), so the
// bias flips: order by relevance and don't restrict to recent uploads —
// the goal is their best/most representative video, not a signal of
// recent momentum.
export async function searchArtistVideo(artistName: string): Promise<YoutubeResult<YoutubeVideoMatch | null>> {
  const result = await youtubeFetch('/search', {
    part: 'snippet',
    q: `${artistName} official video`,
    type: 'video',
    videoCategoryId: '10', // Music
    order: 'relevance',
    safeSearch: 'none',
    maxResults: '5',
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

  if (hits.length === 0) return { ok: true, data: null };

  // Prefer a hit whose channel name matches the artist (their own upload —
  // an official artist channel, VEVO, or a label channel bearing their
  // name) over YouTube's raw top relevance hit, which is often a reaction
  // video, cover, or unrelated compilation that just matches the query text.
  const normalized = normalizeChannelName(artistName);
  const ownChannel = hits.find((h) => normalizeChannelName(h.channelTitle).includes(normalized) || normalized.includes(normalizeChannelName(h.channelTitle)));
  if (ownChannel) return { ok: true, data: { ...ownChannel, matchType: 'search_matched_name' } };
  // No channel-name match at all — genuinely could be the wrong artist
  // (a reaction/cover/compilation that just matches the query text).
  // Flagged as 'search_unverified' rather than silently trusted.
  return { ok: true, data: { ...hits[0], matchType: 'search_unverified' } };
}

// Parses a youtube.com URL (as returned by Soundcharts' platformIdentifiers,
// or typed in by hand) into whatever channels.list needs to resolve it.
// /channel/UCxxxx already IS the id — no lookup call needed at all.
// /@handle and legacy /user/name each cost 1 unit to resolve (channels.list
// with forHandle/forUsername). /c/customname has no lookup-by-value
// endpoint — YouTube only resolves those through search, which defeats the
// point, so it's left unresolved here and the caller falls back to search.
function parseChannelUrl(url: string): { channelId: string } | { handle: string } | { username: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (!parsed.hostname.replace(/^www\./, '').endsWith('youtube.com')) return null;

  const channelMatch = parsed.pathname.match(/^\/channel\/([\w-]+)/);
  if (channelMatch) return { channelId: channelMatch[1] };

  const handleMatch = parsed.pathname.match(/^\/@([\w.-]+)/);
  if (handleMatch) return { handle: `@${handleMatch[1]}` };

  const userMatch = parsed.pathname.match(/^\/user\/([\w.-]+)/);
  if (userMatch) return { username: userMatch[1] };

  return null;
}

async function resolveChannelId(url: string): Promise<YoutubeResult<string | null>> {
  const parsed = parseChannelUrl(url);
  if (!parsed) return { ok: true, data: null };
  if ('channelId' in parsed) return { ok: true, data: parsed.channelId };

  const params: Record<string, string> = 'handle' in parsed ? { forHandle: parsed.handle } : { forUsername: parsed.username };
  const result = await youtubeFetch('/channels', { part: 'id', ...params });
  if (!result.ok) return result;
  const id = result.data?.items?.[0]?.id;
  return { ok: true, data: typeof id === 'string' ? id : null };
}

// Skip titles that are technically uploads but a poor choice for a hero
// video — shorts, livestream VODs, trailers/teasers/BTS clips.
const POOR_HERO_VIDEO_TITLE = /\b(shorts?|live|trailer|teaser|behind the scenes)\b/i;

// The channel's own uploads, cheapest path there is: channels.list (1 unit)
// to find the uploads playlist, playlistItems.list (1 unit) to read it —
// 2 units total versus search.list's 100. Reverse-chronological rather
// than relevance-ranked, so it's not guaranteed to be their single best
// video the way searchArtistVideo's ranked search is — a fair trade for a
// 50x quota cut when the channel is already known.
async function getChannelUploadsVideo(channelId: string): Promise<YoutubeResult<YoutubeVideoHit | null>> {
  const channelResult = await youtubeFetch('/channels', { part: 'contentDetails', id: channelId });
  if (!channelResult.ok) return channelResult;
  const uploadsPlaylistId = channelResult.data?.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) return { ok: true, data: null };

  const playlistResult = await youtubeFetch('/playlistItems', { part: 'snippet', playlistId: uploadsPlaylistId, maxResults: '10' });
  if (!playlistResult.ok) return playlistResult;

  const items = Array.isArray(playlistResult.data?.items) ? playlistResult.data.items : [];
  const hits: YoutubeVideoHit[] = items
    .map((item: any) => ({
      videoId: item?.snippet?.resourceId?.videoId,
      channelId: item?.snippet?.channelId,
      channelTitle: item?.snippet?.channelTitle,
      title: item?.snippet?.title,
      publishedAt: item?.snippet?.publishedAt,
      thumbnailUrl: item?.snippet?.thumbnails?.medium?.url ?? item?.snippet?.thumbnails?.default?.url,
    }))
    .filter((h: YoutubeVideoHit) => h.videoId);

  if (hits.length === 0) return { ok: true, data: null };
  return { ok: true, data: hits.find((h) => !POOR_HERO_VIDEO_TITLE.test(h.title)) ?? hits[0] };
}

// YouTube's public oEmbed endpoint — no API key, no Data API quota cost
// (it's a separate, unauthenticated endpoint). 404s for a deleted/private
// video and 401s for one with embedding disabled, which is a definitive
// "this won't work as NEXT's Artist Detail hero" signal that videos.list
// doesn't give this cheaply (it would just return an empty items array,
// costing 1 quota unit to find out). A network hiccup fails OPEN (treated
// as embeddable) rather than discarding a perfectly good match over a
// transient fetch error.
async function isVideoEmbeddable(videoId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return true;
  }
}

// The combined, one-call-site convenience this is actually used through.
// When the artist's YouTube channel is already known (typically from
// Soundcharts' platformIdentifiers), this costs 2 quota units instead of
// searchArtistVideo's 100 — a real difference against YouTube's 10,000/day
// free quota when adding many artists at once. Falls back to the search
// (or turns up nothing, on a channel with no uploads) exactly like before.
// Every candidate is verified embeddable (see isVideoEmbeddable) before
// being returned — a broken candidate is treated as "no match" rather than
// handed to the caller to persist a dead video ID.
export async function getFeaturedVideoForArtist(artistName: string, channelUrl?: string): Promise<YoutubeResult<YoutubeVideoMatch | null>> {
  const match = await (async (): Promise<YoutubeResult<YoutubeVideoMatch | null>> => {
    if (channelUrl) {
      const channelIdResult = await resolveChannelId(channelUrl);
      if (!channelIdResult.ok) return channelIdResult;
      if (channelIdResult.data) {
        const uploadsResult = await getChannelUploadsVideo(channelIdResult.data);
        if (!uploadsResult.ok) return uploadsResult;
        if (uploadsResult.data) return { ok: true, data: { ...uploadsResult.data, matchType: 'channel' } };
      }
    }
    return searchArtistVideo(artistName);
  })();

  if (!match.ok || !match.data) return match;
  const embeddable = await isVideoEmbeddable(match.data.videoId);
  return embeddable ? match : { ok: true, data: null };
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

export type YoutubeComment = { text: string; likeCount: number };

// Top-level comments only (no replies), ordered by relevance — YouTube's
// own "most likely to matter" ranking, which in practice surfaces the
// most-liked/most-replied comments first. That's deliberate: a genuine
// "how is this not viral" reaction that other viewers have upvoted is a
// much stronger signal than one buried at the bottom in chronological
// order. 1 quota unit per call, same tier as videos/channels.list — NOT
// batched (the API takes one videoId per call), so this is called once
// per candidate that already cleared the free gates (see
// lib/youtube-discovery.ts), not once per search hit.
//
// Fails gracefully and non-fatally for a video with comments disabled or
// deleted (a 403/404 from YouTube) — the caller treats a failed result
// exactly like "no comment data available," never as a reason to reject
// or crash on that candidate.
export async function getTopComments(videoId: string, maxResults: number): Promise<YoutubeResult<YoutubeComment[]>> {
  const result = await youtubeFetch('/commentThreads', {
    part: 'snippet',
    videoId,
    maxResults: String(Math.min(maxResults, 100)),
    order: 'relevance',
    textFormat: 'plainText',
  });
  if (!result.ok) return result;

  const items = Array.isArray(result.data?.items) ? result.data.items : [];
  const comments: YoutubeComment[] = items
    .map((item: any) => {
      const snippet = item?.snippet?.topLevelComment?.snippet;
      return { text: snippet?.textDisplay, likeCount: parseCount(snippet?.likeCount) ?? 0 };
    })
    .filter((c: YoutubeComment) => typeof c.text === 'string' && c.text.length > 0);
  return { ok: true, data: comments };
}
