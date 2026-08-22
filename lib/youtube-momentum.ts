// Pure, testable YouTube "momentum" scoring — separate from the API I/O
// (lib/youtube.ts) and the DB writes (lib/db.ts), same split as
// lib/discovery.ts/lib/soundcharts.ts for the Soundcharts source. No
// process.env access here — the orchestration layer (lib/youtube-discovery.ts)
// owns reading any env-configurable thresholds and passes them in.
//
// Goal: detect DISPROPORTIONATE momentum, not just raw view count — an
// 8,000-subscriber channel getting 150,000 views in 6 days should score
// higher than a 2-million-subscriber channel getting 200,000 views in the
// same window. viewsPerSubscriber is the factor that captures that; views/
// day, like rate, and comment rate round out the numeric picture; and
// hypeCommentRate (see detectHypeComments below) adds a qualitative
// signal — real people in the comments reacting with "wow" / "how is this
// not viral" is exactly the kind of organic surprise the numbers alone
// can miss.
//
// Deliberately simple (MVP): five factors, each clamped to a ceiling and
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
  // Pre-computed by detectHypeComments() from real comment text fetched
  // separately (see lib/youtube.ts's getTopComments) — not derived here,
  // just passed through. Undefined when comments are disabled/unfetched,
  // NOT when zero comments matched (that's a real 0, not missing data).
  hypeCommentRate?: number;
};

export type YoutubeCandidateMetrics = {
  videoAgeDays: number;
  viewsPerDay: number;
  likeRate?: number; // undefined if YouTube didn't return likeCount (likes hidden)
  commentRate?: number; // undefined if commentCount unavailable (comments disabled)
  viewsPerSubscriber?: number; // undefined if subscriberCount unavailable/hidden
  hypeCommentRate?: number; // pass-through from input — see there
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
    hypeCommentRate: input.hypeCommentRate,
  };
}

// --- Scoring ceilings: the value at which a factor maxes out at 10/10 ---
//
// Originally calibrated for "already going viral" (10x subs, 50K views/day)
// — which meant a genuinely small, early, quietly-trending artist (the
// entire point of this tool) almost never scored high enough to matter.
// Lowered to describe "outperforming its own small audience," not
// "blowing up nationally":
export const VIEWS_PER_SUBSCRIBER_CEILING = 3; // views = 3x the sub count already means reach beyond your own subscribers
export const VIEWS_PER_DAY_CEILING = 5_000; // 5K/day sustained is a strong early signal for a small channel
export const LIKE_RATE_CEILING = 0.08; // 8% like rate is genuinely excellent for music content
export const COMMENT_RATE_CEILING = 0.01; // 1% comment rate is very high
export const HYPE_COMMENT_RATE_CEILING = 0.2; // 1 in 5 top comments reading as genuine hype is a strong tell

function clampedScore(value: number | undefined, ceiling: number): number {
  if (value == null) return 0;
  const clamped = Math.max(0, Math.min(ceiling, value));
  return Math.round((clamped / ceiling) * 100) / 10;
}

// Weights sum to 100 when every factor is available. viewsPerSubscriber
// still carries the most weight — it's a hard number that's meaningfully
// harder to fake than a comment. hypeCommentRate is deliberately the
// second-largest weight (comment sentiment was the whole point of adding
// it) but not the largest — it's the one factor here that's gameable
// (bots, an artist's own fans coordinating), so it informs the score
// without being able to single-handedly dominate it.
export const MOMENTUM_WEIGHTS = {
  viewsPerSubscriber: 35,
  viewsPerDay: 25,
  hypeCommentRate: 20,
  likeRate: 10,
  commentRate: 10,
} as const;

// A factor YouTube didn't return data for (likes/comments disabled,
// subscriber count hidden, comment fetch failed) is excluded from both
// the numerator and the weight total, rather than scored as 0 — e.g. a
// channel that hides its subscriber count shouldn't be penalized as if
// it had none. The remaining weight is rescaled so 100 is still
// reachable on the factors that ARE available.
export function youtubeMomentumScore(metrics: YoutubeCandidateMetrics): number {
  const factors: [number | undefined, number, number][] = [
    [metrics.viewsPerSubscriber, VIEWS_PER_SUBSCRIBER_CEILING, MOMENTUM_WEIGHTS.viewsPerSubscriber],
    [metrics.viewsPerDay, VIEWS_PER_DAY_CEILING, MOMENTUM_WEIGHTS.viewsPerDay],
    [metrics.hypeCommentRate, HYPE_COMMENT_RATE_CEILING, MOMENTUM_WEIGHTS.hypeCommentRate],
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

function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
}

// Builds the specific, numbers-first explanation a Scout reads to decide
// Approve/Watch/Pass — e.g. '142K views in 6 days • 8.4K channel
// subscribers • 11.2% like rate • 💬 "how is this not viral??" (412
// likes)'. Only mentions factors YouTube actually returned data for.
export function youtubeFlaggedReason(
  input: YoutubeCandidateInputs,
  metrics: YoutubeCandidateMetrics,
  bestHypeComment?: HypeCommentExample
): string {
  const days = Math.max(1, Math.round(metrics.videoAgeDays));
  const parts = [`${formatCount(input.viewCount)} views in ${days} day${days === 1 ? '' : 's'}`];
  if (input.channelSubscriberCount != null) {
    parts.push(`${formatCount(input.channelSubscriberCount)} channel subscribers`);
  }
  if (metrics.likeRate != null) {
    parts.push(`${Math.round(metrics.likeRate * 1000) / 10}% like rate`);
  }
  if (bestHypeComment) {
    parts.push(`💬 "${truncate(bestHypeComment.text, 80)}" (${bestHypeComment.likeCount} like${bestHypeComment.likeCount === 1 ? '' : 's'})`);
  }
  return parts.join(' • ');
}

// --- Comment sentiment: a lightweight keyword heuristic, not NLP ---
//
// Deliberately simple and honest about its limits: substring matching
// against a curated phrase list. It will miss paraphrased hype and
// occasionally false-positive on sarcasm — it is not sentiment analysis.
// What it's good at is exactly the pattern the roadmap asked for: the
// recognizable, repeated shape real "this deserves to blow up" comments
// take. Tune this list freely; it costs nothing to extend.
export const HYPE_PHRASES = [
  'how is this not viral',
  "how is this not blowing up",
  "why isn't this viral",
  'why is this not viral',
  'underrated',
  'deserves more views',
  'deserves millions',
  'deserves way more',
  'needs to blow up',
  'blowing up soon',
  'about to blow up',
  'going to blow up',
  'gonna blow up',
  'this is a hit',
  'certified banger',
  'this slaps',
  'on repeat',
  "can't stop listening",
  'cant stop listening',
  'insane talent',
  'so talented',
  'needs a record deal',
  'record label',
  'gonna be famous',
  'going to be famous',
  'next big thing',
  'star in the making',
] as const;

function containsHypePhrase(text: string): boolean {
  const lower = text.toLowerCase();
  return HYPE_PHRASES.some((phrase) => lower.includes(phrase));
}

export type HypeCommentExample = { text: string; likeCount: number };

export type HypeCommentAnalysis = {
  // Undefined (not 0) when there was nothing to analyze — comments
  // disabled, fetch failed, or zero comments existed. A real 0 means
  // comments existed and were checked but none matched.
  hypeCommentRate?: number;
  commentsAnalyzed: number;
  examples: HypeCommentExample[]; // up to 2 matches, highest-liked first
};

export function detectHypeComments(comments: HypeCommentExample[]): HypeCommentAnalysis {
  if (comments.length === 0) return { hypeCommentRate: undefined, commentsAnalyzed: 0, examples: [] };
  const matches = comments.filter((c) => containsHypePhrase(c.text));
  const examples = [...matches].sort((a, b) => b.likeCount - a.likeCount).slice(0, 2);
  return { hypeCommentRate: matches.length / comments.length, commentsAnalyzed: comments.length, examples };
}

// --- Qualification thresholds (defaults; env-overridable — see
// lib/youtube-discovery.ts, which is the only place that reads process.env) ---
export const MIN_CHANNEL_SUBSCRIBERS = 200; // excludes near-empty/inactive channels
export const MAX_CHANNEL_SUBSCRIBERS = 100_000; // "smaller channels, not already-famous artists"
export const MIN_VIDEO_VIEWS = 500; // excludes videos too small to trust a rate computed off of
// Lowered alongside the ceilings above, same reasoning: 40 was tuned for
// candidates that were already scoring near-max on the old, viral-only
// ceilings. 25 is a real bar (not "everything passes") but reachable by a
// small channel with a couple of genuinely good factors, not only one
// already blowing up.
export const MOMENTUM_SCORE_THRESHOLD = 25; // minimum composite score to flag as a candidate

export type YoutubeThresholds = {
  minSubscribers?: number;
  maxSubscribers?: number;
  minViews?: number;
  minMomentumScore?: number;
};

export type YoutubeCandidateRejectionReason =
  | 'not_official_release'
  | 'below_min_views'
  | 'no_subscriber_count'
  | 'subscriber_out_of_band'
  | 'below_momentum_threshold';

// YouTube's Music category (videoCategoryId=10) is much broader than
// "artists releasing songs" — gear-demo channels, album review/ranking
// channels, reaction videos, and DJ mix compilations all get categorized
// as Music too, and a generic genre-keyword search surfaces plenty of
// them. Requiring the title to read like an actual song release (the
// near-universal "(Official Audio)" / "(Official Video)" / "Lyric Video"
// convention real artists and labels use) is a strong, standard signal
// that this is someone's own music, not commentary about music. This
// trades some recall (a real artist who doesn't tag this way gets missed)
// for a lot of precision — worth it given the alternative was gear-review
// and album-ranking channels showing up as "candidates."
const OFFICIAL_RELEASE_TITLE_PATTERN = /official\s+(music\s+)?video|official\s+audio|lyric\s+video/i;

export function looksLikeOfficialRelease(title: string): boolean {
  return OFFICIAL_RELEASE_TITLE_PATTERN.test(title);
}

// The four gates that need no extra API call — pure checks on data
// already fetched for every search hit. Checked BEFORE spending a
// commentThreads call on a candidate: no point paying for comment
// analysis on a channel that was never going to qualify on title, view
// count, or subscriber size alone. A channel that hides its subscriber
// count is skipped entirely (not scored as if it had 0) —
// "disproportionate momentum" is meaningless without a subscriber
// baseline to compare against.
export function passesCheapGates(
  input: Pick<YoutubeCandidateInputs, 'viewCount' | 'channelSubscriberCount'> & { title: string },
  thresholds: YoutubeThresholds = {}
): Exclude<YoutubeCandidateRejectionReason, 'below_momentum_threshold'> | 'passes' {
  const minSubscribers = thresholds.minSubscribers ?? MIN_CHANNEL_SUBSCRIBERS;
  const maxSubscribers = thresholds.maxSubscribers ?? MAX_CHANNEL_SUBSCRIBERS;
  const minViews = thresholds.minViews ?? MIN_VIDEO_VIEWS;

  if (!looksLikeOfficialRelease(input.title)) return 'not_official_release';
  if (input.viewCount < minViews) return 'below_min_views';
  if (input.channelSubscriberCount == null) return 'no_subscriber_count';
  if (input.channelSubscriberCount < minSubscribers || input.channelSubscriberCount > maxSubscribers) return 'subscriber_out_of_band';
  return 'passes';
}

// The single source of truth for why a candidate does or doesn't qualify
// OVERALL — returns exactly which gate it failed instead of a plain
// boolean, so a scan can report *why* it found nothing instead of just
// that it found nothing (a quiet day and a broken pipeline look identical
// without this). Requires momentumScore, which in turn requires comment
// data to be complete (see lib/youtube-discovery.ts's two-phase flow) —
// use passesCheapGates() first if you need a verdict before that exists.
export function classifyYoutubeCandidate(
  input: YoutubeCandidateInputs & { title: string },
  momentumScore: number,
  thresholds: YoutubeThresholds = {}
): YoutubeCandidateRejectionReason | 'passes' {
  const cheapGate = passesCheapGates(input, thresholds);
  if (cheapGate !== 'passes') return cheapGate;

  const minMomentumScore = thresholds.minMomentumScore ?? MOMENTUM_SCORE_THRESHOLD;
  return momentumScore < minMomentumScore ? 'below_momentum_threshold' : 'passes';
}

export function passesYoutubeThresholds(
  input: YoutubeCandidateInputs & { title: string },
  momentumScore: number,
  thresholds: YoutubeThresholds = {}
): boolean {
  return classifyYoutubeCandidate(input, momentumScore, thresholds) === 'passes';
}
