import { describe, expect, it } from 'vitest';
import {
  classifyYoutubeCandidate, computeYoutubeMetrics, MAX_CHANNEL_SUBSCRIBERS, MIN_CHANNEL_SUBSCRIBERS, MIN_VIDEO_VIEWS,
  MOMENTUM_SCORE_THRESHOLD, passesYoutubeThresholds, youtubeFlaggedReason, youtubeMomentumScore,
} from './youtube-momentum';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

describe('computeYoutubeMetrics', () => {
  it('derives views/day, like rate, comment rate, and views/subscriber from raw counts', () => {
    const metrics = computeYoutubeMetrics({
      viewCount: 150_000,
      likeCount: 16_800,
      commentCount: 1_200,
      publishedAt: daysAgo(6),
      channelSubscriberCount: 8_000,
    });
    expect(metrics.videoAgeDays).toBeCloseTo(6, 0);
    expect(metrics.viewsPerDay).toBeCloseTo(25_000, -2);
    expect(metrics.likeRate).toBeCloseTo(16_800 / 150_000, 5);
    expect(metrics.commentRate).toBeCloseTo(1_200 / 150_000, 5);
    expect(metrics.viewsPerSubscriber).toBeCloseTo(150_000 / 8_000, 5);
  });

  it('leaves a factor undefined (not 0) when YouTube did not return that count', () => {
    const metrics = computeYoutubeMetrics({ viewCount: 10_000, publishedAt: daysAgo(3) });
    expect(metrics.likeRate).toBeUndefined();
    expect(metrics.commentRate).toBeUndefined();
    expect(metrics.viewsPerSubscriber).toBeUndefined();
  });

  it('floors video age so a just-published video does not divide by ~0', () => {
    const metrics = computeYoutubeMetrics({ viewCount: 1000, publishedAt: new Date().toISOString() });
    expect(Number.isFinite(metrics.viewsPerDay)).toBe(true);
    expect(metrics.viewsPerDay).toBeLessThan(1000 * 25); // not an absurd spike from a near-zero denominator
  });
});

describe('youtubeMomentumScore', () => {
  it('a small channel with disproportionate views scores much higher than a huge channel with more raw views', () => {
    // The roadmap's own example: 8K-sub channel, 150K views in 6 days.
    const small = youtubeMomentumScore(
      computeYoutubeMetrics({ viewCount: 150_000, likeCount: 16_800, commentCount: 1_200, publishedAt: daysAgo(6), channelSubscriberCount: 8_000 })
    );
    // 2M-sub channel, 200K views in a similar window.
    const huge = youtubeMomentumScore(
      computeYoutubeMetrics({ viewCount: 200_000, likeCount: 4_000, commentCount: 200, publishedAt: daysAgo(6), channelSubscriberCount: 2_000_000 })
    );
    expect(small).toBeGreaterThan(huge);
  });

  it('caps at 100 and never exceeds it even far past every ceiling', () => {
    const score = youtubeMomentumScore(
      computeYoutubeMetrics({ viewCount: 50_000_000, likeCount: 20_000_000, commentCount: 5_000_000, publishedAt: daysAgo(1), channelSubscriberCount: 100 })
    );
    expect(score).toBeLessThanOrEqual(100);
    expect(score).toBe(100);
  });

  it('rescales around missing factors instead of capping below the available weight', () => {
    // likeCount/commentCount unavailable (disabled), but views/day and
    // views/subscriber both max out — should still reach 100 on the
    // available 70/100 weight, not be capped at 70 just because two
    // factors are missing.
    const metrics = computeYoutubeMetrics({ viewCount: 200_000, publishedAt: daysAgo(1), channelSubscriberCount: 1_000 });
    expect(metrics.likeRate).toBeUndefined();
    expect(metrics.commentRate).toBeUndefined();
    const score = youtubeMomentumScore(metrics);
    expect(score).toBe(100);
  });

  it('returns 0 when no factor has data', () => {
    expect(youtubeMomentumScore({ videoAgeDays: 5, viewsPerDay: 0 })).toBe(0);
  });
});

describe('youtubeFlaggedReason', () => {
  it('matches the roadmap example shape: views, days, subscribers, like rate', () => {
    const input = { viewCount: 142_000, likeCount: 15_904, publishedAt: daysAgo(6), channelSubscriberCount: 8_400 };
    const metrics = computeYoutubeMetrics(input);
    const reason = youtubeFlaggedReason(input, metrics);
    expect(reason).toContain('142K views in 6 days');
    expect(reason).toContain('8.4K channel subscribers');
    expect(reason).toContain('11.2% like rate');
  });

  it('omits a factor YouTube did not return instead of inventing a number', () => {
    const input = { viewCount: 5_000, publishedAt: daysAgo(2) };
    const metrics = computeYoutubeMetrics(input);
    const reason = youtubeFlaggedReason(input, metrics);
    expect(reason).not.toContain('subscribers');
    expect(reason).not.toContain('like rate');
    expect(reason).toContain('5K views in 2 days');
  });
});

describe('passesYoutubeThresholds', () => {
  const strongInput = { viewCount: 150_000, likeCount: 16_800, commentCount: 1_200, publishedAt: daysAgo(6), channelSubscriberCount: 8_000 };
  const strongMetrics = computeYoutubeMetrics(strongInput);
  const strongScore = youtubeMomentumScore(strongMetrics);

  it('a genuinely strong candidate passes the default thresholds', () => {
    expect(strongScore).toBeGreaterThanOrEqual(MOMENTUM_SCORE_THRESHOLD);
    expect(passesYoutubeThresholds(strongInput, strongScore)).toBe(true);
  });

  it('rejects a channel with no subscriber count at all — cannot judge "disproportionate" without a baseline', () => {
    const input = { ...strongInput, channelSubscriberCount: undefined };
    expect(passesYoutubeThresholds(input, 100)).toBe(false);
  });

  it('rejects an already-famous channel above the subscriber ceiling', () => {
    const input = { ...strongInput, channelSubscriberCount: MAX_CHANNEL_SUBSCRIBERS + 1 };
    expect(passesYoutubeThresholds(input, 100)).toBe(false);
  });

  it('rejects a near-empty channel below the subscriber floor', () => {
    const input = { ...strongInput, channelSubscriberCount: MIN_CHANNEL_SUBSCRIBERS - 1 };
    expect(passesYoutubeThresholds(input, 100)).toBe(false);
  });

  it('rejects a video below the minimum view floor even with a great ratio', () => {
    const input = { ...strongInput, viewCount: MIN_VIDEO_VIEWS - 1, channelSubscriberCount: 10 };
    expect(passesYoutubeThresholds(input, 100)).toBe(false);
  });

  it('custom thresholds override the defaults', () => {
    expect(passesYoutubeThresholds(strongInput, strongScore, { minMomentumScore: strongScore + 1 })).toBe(false);
    expect(passesYoutubeThresholds(strongInput, strongScore, { minMomentumScore: strongScore })).toBe(true);
  });
});

describe('classifyYoutubeCandidate', () => {
  const strongInput = { viewCount: 150_000, likeCount: 16_800, commentCount: 1_200, publishedAt: daysAgo(6), channelSubscriberCount: 8_000 };
  const strongScore = youtubeMomentumScore(computeYoutubeMetrics(strongInput));

  it('returns "passes" for a candidate that clears every gate — same verdict as passesYoutubeThresholds', () => {
    expect(classifyYoutubeCandidate(strongInput, strongScore)).toBe('passes');
    expect(passesYoutubeThresholds(strongInput, strongScore)).toBe(true);
  });

  it('identifies each rejection reason distinctly, checked in gate order', () => {
    expect(classifyYoutubeCandidate({ ...strongInput, viewCount: MIN_VIDEO_VIEWS - 1 }, 100)).toBe('below_min_views');
    expect(classifyYoutubeCandidate({ ...strongInput, channelSubscriberCount: undefined }, 100)).toBe('no_subscriber_count');
    expect(classifyYoutubeCandidate({ ...strongInput, channelSubscriberCount: MAX_CHANNEL_SUBSCRIBERS + 1 }, 100)).toBe('subscriber_out_of_band');
    expect(classifyYoutubeCandidate(strongInput, 1)).toBe('below_momentum_threshold');
  });

  it('a view-count failure is reported even when the channel would also fail on subscribers — first gate wins, not a random one', () => {
    const input = { ...strongInput, viewCount: MIN_VIDEO_VIEWS - 1, channelSubscriberCount: undefined };
    expect(classifyYoutubeCandidate(input, 100)).toBe('below_min_views');
  });
});
