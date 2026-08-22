// Orchestrates one YouTube discovery scan: search several genre buckets
// for recent Music-category uploads, pull real stats for the videos/
// channels found, analyze top comments for genuine "how is this not
// viral" sentiment, score momentum (now including that sentiment as one
// factor), filter to genuine candidates, then attempt a best-effort
// Soundcharts match/enrich. This is the only file that reads
// YouTube-scan env vars — lib/youtube.ts (API I/O) and
// lib/youtube-momentum.ts (pure scoring) both stay env-free.
//
// Implements the DiscoverySource contract (lib/discovery-source.ts) so a
// future third source can follow the same shape.

import { NewDiscoveryCandidate } from './db';
import { DiscoveryRejectionBreakdown, DiscoveryScanOutcome, DiscoverySource, KnownIdentitySets } from './discovery-source';
import {
  classifyYoutubeCandidate, computeYoutubeMetrics, detectHypeComments, HypeCommentAnalysis, passesCheapGates,
  youtubeFlaggedReason, youtubeMomentumScore, YoutubeThresholds,
} from './youtube-momentum';
import { getChannelsStats, getTopComments, getVideosStats, searchRecentMusicVideos, youtubeConfigured } from './youtube';
import { getArtistData, searchArtists, soundchartsConfigured } from './soundcharts';

// Genre keys a scan can be limited to via YOUTUBE_SCAN_GENRES (comma list).
// The query strings are intentionally simple text searches biased toward
// music uploads in that genre — YouTube's videoCategoryId=10 filter (see
// lib/youtube.ts) already restricts results to the Music category, so
// these don't need to be exhaustive.
export const DEFAULT_YOUTUBE_GENRES: Record<string, string> = {
  'hip-hop-rap': 'hip hop rap music',
  pop: 'pop music',
  rnb: 'r&b music',
  country: 'country music',
  'rock-alternative': 'rock alternative music',
  electronic: 'electronic music',
};

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

function scanGenres(): [string, string][] {
  const raw = process.env.YOUTUBE_SCAN_GENRES;
  if (!raw) return Object.entries(DEFAULT_YOUTUBE_GENRES);
  const keys = raw.split(',').map((k) => k.trim()).filter(Boolean);
  const entries = keys
    .filter((k) => DEFAULT_YOUTUBE_GENRES[k])
    .map((k): [string, string] => [k, DEFAULT_YOUTUBE_GENRES[k]]);
  return entries.length > 0 ? entries : Object.entries(DEFAULT_YOUTUBE_GENRES);
}

function scanThresholds(): YoutubeThresholds {
  return {
    minSubscribers: process.env.YOUTUBE_MIN_SUBSCRIBERS ? envInt('YOUTUBE_MIN_SUBSCRIBERS', 0) : undefined,
    maxSubscribers: process.env.YOUTUBE_MAX_SUBSCRIBERS ? envInt('YOUTUBE_MAX_SUBSCRIBERS', 0) : undefined,
    minMomentumScore: process.env.YOUTUBE_MOMENTUM_THRESHOLD ? envInt('YOUTUBE_MOMENTUM_THRESHOLD', 0) : undefined,
  };
}

// Strips the noise that keeps an exact-name match from lining up: YouTube's
// auto-generated "Artist Name - Topic" channels (created from streaming
// metadata — extremely common for real recording artists), "VEVO"/
// "Official" suffixes, and punctuation/case differences.
function normalizeArtistName(name: string): string {
  return name
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\bvevo\b/gi, '')
    .replace(/\bofficial\b/gi, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

type SoundchartsEnrichment = { soundcharts_uuid: string; followers_count?: number; growth_30d_pct?: number };

// Best-effort only: a Soundcharts match improves a candidate but is never
// required (see file header / roadmap item 5). Only the two endpoints
// already confirmed working on this plan are used — search and
// artist-by-uuid (which includes the audience/spotify follow-up inside
// getArtistData). /top/artists (plan-restricted) is never called here.
async function matchAndEnrichWithSoundcharts(channelTitle: string): Promise<SoundchartsEnrichment | null> {
  if (!soundchartsConfigured()) return null;
  const searchResult = await searchArtists(channelTitle);
  if (!searchResult.ok) return null;

  const target = normalizeArtistName(channelTitle);
  const match = searchResult.data.find((hit) => normalizeArtistName(hit.name) === target);
  if (!match) return null;

  const dataResult = await getArtistData(match.uuid);
  if (!dataResult.ok) return null;

  return {
    soundcharts_uuid: match.uuid,
    followers_count: dataResult.data.followers_count,
    growth_30d_pct: dataResult.data.growth_velocity_pct,
  };
}

async function runYoutubeDiscoveryScan(known: KnownIdentitySets): Promise<DiscoveryScanOutcome> {
  if (!youtubeConfigured()) throw new Error('YouTube is not configured on this server.');

  // 50 is YouTube's own hard cap on results per search.list call, and
  // search.list is priced as a flat 100 quota units per call regardless
  // of how many results are requested — so defaulting to the max costs
  // nothing extra on the expensive part of the scan, it's strictly more
  // coverage per genre for the same price.
  const maxResultsPerGenre = envInt('YOUTUBE_MAX_RESULTS_PER_GENRE', 50);
  const publishedWithinDays = envInt('YOUTUBE_PUBLISHED_WITHIN_DAYS', 14);
  const maxCandidatesPerRun = envInt('YOUTUBE_MAX_CANDIDATES_PER_RUN', 25);
  const commentsPerCandidate = envInt('YOUTUBE_COMMENTS_PER_CANDIDATE', 20);
  const thresholds = scanThresholds();
  const publishedAfter = new Date(Date.now() - publishedWithinDays * 86_400_000).toISOString();

  let quotaUsed = 0;
  let searchedCount = 0;

  // 1. Search every configured genre bucket. Each call is 100 quota units
  // (YouTube's fixed cost, unrelated to result count) — the expensive part
  // of this scan, which is why genre count and results-per-genre are both
  // env-configurable (see README).
  const genres = scanGenres();
  const hitsByVideoId = new Map<string, { videoId: string; channelId: string; channelTitle: string; publishedAt: string; genre: string }>();
  const genreErrors: string[] = [];
  for (const [genreKey, query] of genres) {
    const result = await searchRecentMusicVideos(query, { publishedAfter, maxResults: maxResultsPerGenre });
    quotaUsed += 100;
    if (!result.ok) {
      // One genre failing (a transient error, a one-off quota hiccup)
      // shouldn't abort the whole scan — logged and tracked, not thrown,
      // unless it turns out every genre failed (see below).
      console.error('[youtube-discovery] search failed for genre', genreKey, result.error);
      genreErrors.push(result.error);
      continue;
    }
    for (const hit of result.data) {
      searchedCount++;
      if (!hitsByVideoId.has(hit.videoId)) {
        hitsByVideoId.set(hit.videoId, { videoId: hit.videoId, channelId: hit.channelId, channelTitle: hit.channelTitle, publishedAt: hit.publishedAt, genre: genreKey });
      }
    }
  }
  // Every genre search failing (bad API key, YouTube outage) is a real
  // problem, not "nothing interesting today" — surface it as a failed run
  // instead of silently reporting 0 candidates found.
  if (genres.length > 0 && genreErrors.length === genres.length) {
    throw new Error(genreErrors[0]);
  }

  // 2. Keep only the highest-view video per channel — one candidate per
  // artist per run, and the DB's unique index on yt_channel_id would
  // reject a second insert for the same channel anyway. Also drops any
  // channel already sitting in the queue from a previous scan.
  const allHits = [...hitsByVideoId.values()].filter((h) => !known.youtubeChannelIds.has(h.channelId));
  if (allHits.length === 0) return { candidates: [], searchedCount, quotaUsed };

  // 3. Batched stats fetches — 1 quota unit per call regardless of how many
  // ids are batched in (up to 50), so every unique video/channel found
  // across all genres this run is fetched in the fewest possible calls.
  const videoIds = [...new Set(allHits.map((h) => h.videoId))];
  const channelIds = [...new Set(allHits.map((h) => h.channelId))];

  const videoStatsById = new Map<string, { viewCount?: number; likeCount?: number; commentCount?: number }>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const result = await getVideosStats(batch);
    quotaUsed += 1;
    if (result.ok) for (const s of result.data) videoStatsById.set(s.videoId, s);
  }

  const channelStatsById = new Map<string, { subscriberCount?: number; viewCount?: number }>();
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const result = await getChannelsStats(batch);
    quotaUsed += 1;
    if (result.ok) for (const s of result.data) channelStatsById.set(s.channelId, s);
  }

  // 4. One highest-view video per channel.
  const byChannel = new Map<string, typeof allHits[number]>();
  for (const hit of allHits) {
    const views = videoStatsById.get(hit.videoId)?.viewCount ?? 0;
    const existing = byChannel.get(hit.channelId);
    const existingViews = existing ? videoStatsById.get(existing.videoId)?.viewCount ?? 0 : -1;
    if (!existing || views > existingViews) byChannel.set(hit.channelId, hit);
  }

  // 5. Score, classify, rank, cap. Two-phase gating: the three cheap gates
  // (view count, subscriber presence, subscriber band) are checked FIRST,
  // with zero extra API calls — only a candidate that already clears
  // those gets a commentThreads.list call spent on it. This keeps comment
  // fetching bounded to genuinely-viable candidates instead of every
  // search hit, while still computing the full (comment-inclusive)
  // momentum score BEFORE ranking/capping — so a candidate with strong
  // comment sentiment can't get cut before its comments were even read.
  // Every non-passing candidate's reason gets counted instead of silently
  // discarded, so "found nothing" and "a threshold/data gap filtered
  // everything" never look the same.
  type Scored = {
    hit: typeof allHits[number]; viewCount: number; likeCount?: number; commentCount?: number;
    subscriberCount?: number; channelViewCount?: number; momentumScore: number; hype: HypeCommentAnalysis;
  };
  const scored: Scored[] = [];
  const rejectionBreakdown: DiscoveryRejectionBreakdown = {
    belowMinViews: 0, noSubscriberCount: 0, subscriberOutOfBand: 0, belowMomentumThreshold: 0,
  };
  for (const hit of byChannel.values()) {
    const videoStats = videoStatsById.get(hit.videoId);
    const channelStats = channelStatsById.get(hit.channelId);
    if (!videoStats?.viewCount) continue; // stats fetch failed for this video — not a scored rejection, just missing data

    const cheapGate = passesCheapGates({ viewCount: videoStats.viewCount, channelSubscriberCount: channelStats?.subscriberCount }, thresholds);
    if (cheapGate !== 'passes') {
      if (cheapGate === 'below_min_views') rejectionBreakdown.belowMinViews++;
      else if (cheapGate === 'no_subscriber_count') rejectionBreakdown.noSubscriberCount++;
      else if (cheapGate === 'subscriber_out_of_band') rejectionBreakdown.subscriberOutOfBand++;
      continue;
    }

    // Only reached by candidates that already clear the free gates.
    const commentsResult = await getTopComments(hit.videoId, commentsPerCandidate);
    quotaUsed += 1;
    const hype = commentsResult.ok
      ? detectHypeComments(commentsResult.data)
      : { hypeCommentRate: undefined, commentsAnalyzed: 0, examples: [] };
    // A failed fetch (comments disabled, deleted video) leaves
    // hypeCommentRate undefined — youtubeMomentumScore excludes a
    // missing factor and rescales the rest, never penalizing the
    // candidate for something YouTube didn't return.

    const inputs = {
      viewCount: videoStats.viewCount,
      likeCount: videoStats.likeCount,
      commentCount: videoStats.commentCount,
      publishedAt: hit.publishedAt,
      channelSubscriberCount: channelStats?.subscriberCount,
      hypeCommentRate: hype.hypeCommentRate,
    };
    const metrics = computeYoutubeMetrics(inputs);
    const momentumScore = youtubeMomentumScore(metrics);
    const classification = classifyYoutubeCandidate(inputs, momentumScore, thresholds);

    if (classification !== 'passes') {
      // Only below_momentum_threshold is reachable here — the cheap
      // gates were already checked above.
      rejectionBreakdown.belowMomentumThreshold++;
      rejectionBreakdown.bestRejectedMomentumScore = Math.max(rejectionBreakdown.bestRejectedMomentumScore ?? 0, momentumScore);
      continue;
    }

    scored.push({
      hit, viewCount: videoStats.viewCount, likeCount: videoStats.likeCount, commentCount: videoStats.commentCount,
      subscriberCount: channelStats?.subscriberCount, channelViewCount: channelStats?.viewCount, momentumScore, hype,
    });
  }
  scored.sort((a, b) => b.momentumScore - a.momentumScore);
  const top = scored.slice(0, maxCandidatesPerRun);

  // 6. Best-effort Soundcharts match/enrich — never blocks a candidate.
  const candidates: NewDiscoveryCandidate[] = [];
  for (const s of top) {
    const inputs = {
      viewCount: s.viewCount, likeCount: s.likeCount, commentCount: s.commentCount,
      publishedAt: s.hit.publishedAt, channelSubscriberCount: s.subscriberCount, hypeCommentRate: s.hype.hypeCommentRate,
    };
    const metrics = computeYoutubeMetrics(inputs);
    const enrichment = await matchAndEnrichWithSoundcharts(s.hit.channelTitle).catch(() => null);
    const bestExample = s.hype.examples[0];

    candidates.push({
      source: 'youtube',
      name: s.hit.channelTitle,
      soundcharts_uuid: enrichment?.soundcharts_uuid,
      followers_count: enrichment?.followers_count,
      growth_30d_pct: enrichment?.growth_30d_pct,
      yt_video_id: s.hit.videoId,
      yt_channel_id: s.hit.channelId,
      yt_channel_title: s.hit.channelTitle,
      yt_genre: s.hit.genre,
      yt_view_count: s.viewCount,
      yt_like_count: s.likeCount,
      yt_comment_count: s.commentCount,
      yt_published_at: s.hit.publishedAt,
      yt_channel_subscriber_count: s.subscriberCount,
      yt_channel_view_count: s.channelViewCount,
      yt_views_per_day: metrics.viewsPerDay,
      yt_like_rate: metrics.likeRate,
      yt_comment_rate: metrics.commentRate,
      yt_views_per_subscriber: metrics.viewsPerSubscriber,
      yt_hype_comment_rate: s.hype.hypeCommentRate,
      yt_comments_analyzed: s.hype.commentsAnalyzed,
      yt_example_comment_1: bestExample?.text,
      yt_example_comment_1_likes: bestExample?.likeCount,
      yt_example_comment_2: s.hype.examples[1]?.text,
      yt_example_comment_2_likes: s.hype.examples[1]?.likeCount,
      momentum_score: s.momentumScore,
      flagged_reason: youtubeFlaggedReason(inputs, metrics, bestExample),
    });
  }

  return { candidates, searchedCount, quotaUsed, rejectionBreakdown };
}

export const youtubeDiscoverySource: DiscoverySource = {
  key: 'youtube',
  scan: runYoutubeDiscoveryScan,
};
