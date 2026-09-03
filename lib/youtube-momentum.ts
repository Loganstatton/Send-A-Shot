// Pure, testable YouTube signal computation — separate from the API I/O
// (lib/youtube.ts) and the DB writes (lib/db.ts), same split as
// lib/discovery.ts/lib/soundcharts.ts for the Soundcharts source. No
// process.env access here — the orchestration layer (lib/youtube-discovery.ts)
// owns reading any env-configurable thresholds and passes them in.
//
// Pre-beta migration note: this file used to also compute a single blended
// 0-100 "momentum_score" (viewsPerSubscriber/viewsPerDay/hypeCommentRate/
// likeRate/commentRate combined via clampedScore()+MOMENTUM_WEIGHTS below)
// used both to rank candidates within a scan and to gate which ones
// qualified at all. That composite score has been removed — a Scout now
// sees the raw numbers directly (views, subscribers, views/day, like rate,
// comment rate, hype comment rate/examples — computeYoutubeMetrics below)
// and makes the Approve/Watch/Pass call themselves, instead of a formula
// making it for them. Nothing here computes any replacement ratio/formula
// from those numbers; qualification is now just the simple, individually
// inspectable threshold checks in passesCheapGates() (official-release
// title pattern, minimum views, subscriber band) — no composite score.

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

export type YoutubeThresholds = {
  minSubscribers?: number;
  maxSubscribers?: number;
  minViews?: number;
};

export type YoutubeCandidateRejectionReason =
  | 'not_official_release'
  | 'below_min_views'
  | 'no_subscriber_count'
  | 'subscriber_out_of_band';

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

// The single source of truth for why a candidate does or doesn't qualify —
// returns exactly which gate it failed instead of a plain boolean, so a
// scan can report *why* it found nothing instead of just that it found
// nothing (a quiet day and a broken pipeline look identical without this).
// Pure checks on data already fetched for every search hit — cheap enough
// to run before spending a commentThreads call on a candidate. A channel
// that hides its subscriber count is skipped entirely (not treated as if
// it had none) — there's no baseline to judge it against.
//
// Pre-beta migration note: this used to be two phases — these three cheap
// gates, then a fourth momentum-score gate requiring comment data to be
// fetched first (see the file header). The momentum-score gate is gone;
// qualification is now just these three individually inspectable
// thresholds, nothing derived from views/subscribers/rates.
export function passesCheapGates(
  input: Pick<YoutubeCandidateInputs, 'viewCount' | 'channelSubscriberCount'> & { title: string },
  thresholds: YoutubeThresholds = {}
): YoutubeCandidateRejectionReason | 'passes' {
  const minSubscribers = thresholds.minSubscribers ?? MIN_CHANNEL_SUBSCRIBERS;
  const maxSubscribers = thresholds.maxSubscribers ?? MAX_CHANNEL_SUBSCRIBERS;
  const minViews = thresholds.minViews ?? MIN_VIDEO_VIEWS;

  if (!looksLikeOfficialRelease(input.title)) return 'not_official_release';
  if (input.viewCount < minViews) return 'below_min_views';
  if (input.channelSubscriberCount == null) return 'no_subscriber_count';
  if (input.channelSubscriberCount < minSubscribers || input.channelSubscriberCount > maxSubscribers) return 'subscriber_out_of_band';
  return 'passes';
}

export function passesYoutubeThresholds(
  input: Pick<YoutubeCandidateInputs, 'viewCount' | 'channelSubscriberCount'> & { title: string },
  thresholds: YoutubeThresholds = {}
): boolean {
  return passesCheapGates(input, thresholds) === 'passes';
}
