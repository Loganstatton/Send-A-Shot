// Pure, testable YouTube "momentum" scoring — separate from the API I/O
// (lib/youtube.ts) and the DB writes (lib/db.ts), same split as
// lib/discovery.ts/lib/soundcharts.ts for the Soundcharts source. No
// process.env access here — the orchestration layer (lib/youtube-discovery.ts)
// owns reading any env-configurable thresholds and passes them in.
//
// Goal: detect DISPROPORTIONATE momentum, not just raw view count — an
// 8,000-subscriber channel getting 150,000 views in 6 days should score
// higher than a 2-million-subscriber channel getting 200,000 views in the
// same window. viewsPerSubscriber is the factor that captures that; the
// other three (views/day, like rate, comment rate) round out the picture.
//
// Deliberately simple (MVP): four factors, each clamped to a ceiling and
// scored 0-10 (same diminishing-returns style as lib/scoring.ts), then a
// weighted sum -> 0-100 momentum_score. Every ceiling/weight below is a
// first-pass constant, easy to retune without touching the shape of the
// scoring logic — same spirit as GROWTH_VELOCITY_SCORE_CEILING_PCT there.

export type YoutubeCandidateInputs = {
  viewCount: number;
  likeCount?: number;
  commentCount?: number;
  publishedAt: string;
  channelSubscriberCount?: number;
};

export type YoutubeCandidateMetrics = {
  videoAgeDays: number;
  viewsPerDay: number;
  likeRate?: number; // undefined if YouTube didn't return likeCount (likes hidden)
  commentRate?: number; // undefined if commentCount unavailable (comments disabled)
  viewsPerSubscriber?: number; // undefined if subscriberCount unavailable/hidden
};

export function computeYoutubeMetrics(input: YoutubeCandidateInputs): YoutubeCandidateMetrics {
  const publishedMs = new Date(input.publishedAt).getTime();
  // Floored at 1 hour so a video published minutes ago doesn't divide by
  // ~0 and produce a nonsensical views/day spike.
  const ageDays = Math.max(1 / 24, (Date.now() - publishedMs) / 86_400_000);
  return {
    videoAgeDays: Math.round(ageDays * 10) / 10,
    viewsPerDay: Math.round(input.viewCount / ageDays),
    likeRate: input.likeCount != null && input.viewCount > 0 ? input.likeCount / input.viewCount : undefined,
    commentRate: input.commentCount != null && input.viewCount > 0 ? input.commentCount / input.viewCount : undefined,
    viewsPerSubscriber:
      input.channelSubscriberCount != null && input.channelSubscriberCount > 0
        ? input.viewCount / input.channelSubscriberCount
        : undefined,
  };
}

// --- Scoring ceilings: the value at which a factor maxes out at 10/10 ---
export const VIEWS_PER_SUBSCRIBER_CEILING = 10; // views = 10x the sub count is an extreme, cap-worthy spike
export const VIEWS_PER_DAY_CEILING = 50_000; // 50K/day sustained is already a big early signal
export const LIKE_RATE_CEILING = 0.15; // 15% like rate is excellent
export const COMMENT_RATE_CEILING = 0.02; // 2% comment rate is very high

function clampedScore(value: number | undefined, ceiling: number): number {
  if (value == null) return 0;
  const clamped = Math.max(0, Math.min(ceiling, value));
  return Math.round((clamped / ceiling) * 100) / 10;
}

// Weights sum to 100 when every factor is available. viewsPerSubscriber
// carries the most weight deliberately — it's the one factor that
// distinguishes "surprising for this channel's size" from "just a lot of
// raw views."
export const MOMENTUM_WEIGHTS = {
  viewsPerSubscriber: 40,
  viewsPerDay: 30,
  likeRate: 15,
  commentRate: 15,
} as const;

// A factor YouTube didn't return data for (likes/comments disabled,
// subscriber count hidden) is excluded from both the numerator and the
// weight total, rather than scored as 0 — a channel that hides its
// subscriber count shouldn't be penalized as if it had none. The
// remaining weight is rescaled so 100 is still reachable on the factors
// that ARE available.
export function youtubeMomentumScore(metrics: YoutubeCandidateMetrics): number {
  const factors: [number | undefined, number, number][] = [
    [metrics.viewsPerSubscriber, VIEWS_PER_SUBSCRIBER_CEILING, MOMENTUM_WEIGHTS.viewsPerSubscriber],
    [metrics.viewsPerDay, VIEWS_PER_DAY_CEILING, MOMENTUM_WEIGHTS.viewsPerDay],
    [metrics.likeRate, LIKE_RATE_CEILING, MOMENTUM_WEIGHTS.likeRate],
    [metrics.commentRate, COMMENT_RATE_CEILING, MOMENTUM_WEIGHTS.commentRate],
  ];
  let weightedSum = 0;
  let weightTotal = 0;
  for (const [value, ceiling, weight] of factors) {
    if (value == null) continue;
    weightedSum += clampedScore(value, ceiling) * weight;
    weightTotal += weight;
  }
  if (weightTotal === 0) return 0;
  const raw = (weightedSum / weightTotal) * 10;
  return Math.round(raw * 10) / 10;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`;
  return String(n);
}

// Builds the specific, numbers-first explanation a Scout reads to decide
// Approve/Watch/Pass — e.g. "142K views in 6 days • 8.4K channel
// subscribers • 11.2% like rate". Only mentions factors YouTube actually
// returned data for.
export function youtubeFlaggedReason(input: YoutubeCandidateInputs, metrics: YoutubeCandidateMetrics): string {
  const days = Math.max(1, Math.round(metrics.videoAgeDays));
  const parts = [`${formatCount(input.viewCount)} views in ${days} day${days === 1 ? '' : 's'}`];
  if (input.channelSubscriberCount != null) {
    parts.push(`${formatCount(input.channelSubscriberCount)} channel subscribers`);
  }
  if (metrics.likeRate != null) {
    parts.push(`${Math.round(metrics.likeRate * 1000) / 10}% like rate`);
  }
  return parts.join(' • ');
}

// --- Qualification thresholds (defaults; env-overridable — see
// lib/youtube-discovery.ts, which is the only place that reads process.env) ---
export const MIN_CHANNEL_SUBSCRIBERS = 200; // excludes near-empty/inactive channels
export const MAX_CHANNEL_SUBSCRIBERS = 100_000; // "smaller channels, not already-famous artists"
export const MIN_VIDEO_VIEWS = 500; // excludes videos too small to trust a rate computed off of
export const MOMENTUM_SCORE_THRESHOLD = 40; // minimum composite score to flag as a candidate

export type YoutubeThresholds = {
  minSubscribers?: number;
  maxSubscribers?: number;
  minViews?: number;
  minMomentumScore?: number;
};

export type YoutubeCandidateRejectionReason =
  | 'below_min_views'
  | 'no_subscriber_count'
  | 'subscriber_out_of_band'
  | 'below_momentum_threshold';

// The single source of truth for why a candidate does or doesn't qualify —
// returns exactly which gate it failed instead of a plain boolean, so a
// scan can report *why* it found nothing instead of just that it found
// nothing (a quiet day and a broken pipeline look identical without this).
// A channel that hides its subscriber count is skipped entirely (not
// scored as if it had 0) — "disproportionate momentum" is meaningless
// without a subscriber baseline to compare against.
export function classifyYoutubeCandidate(
  input: YoutubeCandidateInputs,
  momentumScore: number,
  thresholds: YoutubeThresholds = {}
): YoutubeCandidateRejectionReason | 'passes' {
  const minSubscribers = thresholds.minSubscribers ?? MIN_CHANNEL_SUBSCRIBERS;
  const maxSubscribers = thresholds.maxSubscribers ?? MAX_CHANNEL_SUBSCRIBERS;
  const minViews = thresholds.minViews ?? MIN_VIDEO_VIEWS;
  const minMomentumScore = thresholds.minMomentumScore ?? MOMENTUM_SCORE_THRESHOLD;

  if (input.viewCount < minViews) return 'below_min_views';
  if (input.channelSubscriberCount == null) return 'no_subscriber_count';
  if (input.channelSubscriberCount < minSubscribers || input.channelSubscriberCount > maxSubscribers) return 'subscriber_out_of_band';
  if (momentumScore < minMomentumScore) return 'below_momentum_threshold';
  return 'passes';
}

export function passesYoutubeThresholds(
  input: YoutubeCandidateInputs,
  momentumScore: number,
  thresholds: YoutubeThresholds = {}
): boolean {
  return classifyYoutubeCandidate(input, momentumScore, thresholds) === 'passes';
}
