import { describe, expect, it } from 'vitest';
import {
  computeYoutubeMetrics, detectHypeComments, looksLikeOfficialRelease, MAX_CHANNEL_SUBSCRIBERS,
  MIN_CHANNEL_SUBSCRIBERS, MIN_VIDEO_VIEWS, passesCheapGates, passesYoutubeThresholds,
  youtubeFlaggedReason,
} from './youtube-momentum';

const OFFICIAL_TITLE = 'Song Name (Official Audio)';

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

  it('appends the best hype comment quote with its like count when one is passed in', () => {
    const input = { viewCount: 142_000, likeCount: 15_904, publishedAt: daysAgo(6), channelSubscriberCount: 8_400 };
    const metrics = computeYoutubeMetrics(input);
    const reason = youtubeFlaggedReason(input, metrics, { text: 'how is this not viral??', likeCount: 412 });
    expect(reason).toContain('💬 "how is this not viral??" (412 likes)');
  });

  it('truncates a long comment quote rather than blowing up the line', () => {
    const input = { viewCount: 1_000, publishedAt: daysAgo(1) };
    const metrics = computeYoutubeMetrics(input);
    const longComment = 'a'.repeat(200);
    const reason = youtubeFlaggedReason(input, metrics, { text: longComment, likeCount: 1 });
    expect(reason.length).toBeLessThan(longComment.length);
    expect(reason).toContain('…');
  });

  it('omits the comment segment entirely when no example was found', () => {
    const input = { viewCount: 5_000, publishedAt: daysAgo(2) };
    const reason = youtubeFlaggedReason(input, computeYoutubeMetrics(input));
    expect(reason).not.toContain('💬');
  });
});

describe('detectHypeComments', () => {
  it('matches known hype phrases case-insensitively and computes a rate', () => {
    const analysis = detectHypeComments([
      { text: 'How is this NOT viral??', likeCount: 412 },
      { text: 'love the beat', likeCount: 3 },
      { text: 'this is so underrated', likeCount: 88 },
      { text: 'first', likeCount: 0 },
    ]);
    expect(analysis.commentsAnalyzed).toBe(4);
    expect(analysis.hypeCommentRate).toBeCloseTo(0.5, 5);
  });

  it('returns the top 2 matches sorted by like count, not discovery order', () => {
    const analysis = detectHypeComments([
      { text: 'underrated', likeCount: 5 },
      { text: 'how is this not viral', likeCount: 412 },
      { text: 'this deserves more views', likeCount: 90 },
    ]);
    expect(analysis.examples).toHaveLength(2);
    expect(analysis.examples[0].likeCount).toBe(412);
    expect(analysis.examples[1].likeCount).toBe(90);
  });

  it('a real 0% match rate is a defined number, not undefined — comments existed and were checked', () => {
    const analysis = detectHypeComments([{ text: 'nice song', likeCount: 2 }, { text: 'cool', likeCount: 1 }]);
    expect(analysis.hypeCommentRate).toBe(0);
    expect(analysis.examples).toEqual([]);
  });

  it('an empty comment list (fetch failed / comments disabled) leaves the rate undefined, distinct from a real 0', () => {
    const analysis = detectHypeComments([]);
    expect(analysis.hypeCommentRate).toBeUndefined();
    expect(analysis.commentsAnalyzed).toBe(0);
  });
});

describe('looksLikeOfficialRelease', () => {
  it('matches the standard official-release title conventions', () => {
    expect(looksLikeOfficialRelease('Song Name (Official Audio)')).toBe(true);
    expect(looksLikeOfficialRelease('Song Name (Official Video)')).toBe(true);
    expect(looksLikeOfficialRelease('Song Name (Official Music Video)')).toBe(true);
    expect(looksLikeOfficialRelease('Song Name (Lyric Video)')).toBe(true);
    expect(looksLikeOfficialRelease('SONG NAME - OFFICIAL AUDIO')).toBe(true); // case-insensitive
  });

  it('rejects gear-demo, review, and ranking titles that YouTube still files under Music', () => {
    expect(looksLikeOfficialRelease('Gearhead #synth #electronic')).toBe(false);
    expect(looksLikeOfficialRelease('THA CARTER III Album Rating (9.2/10)')).toBe(false);
    expect(looksLikeOfficialRelease('TOP 5 STORYTELLING RAP SONGS OF ALL TIME')).toBe(false);
    expect(looksLikeOfficialRelease('DATA PROCESSING')).toBe(false);
  });
});

describe('passesCheapGates', () => {
  it('checks all four data-already-in-hand gates — no derived score needed', () => {
    expect(passesCheapGates({ title: OFFICIAL_TITLE, viewCount: 10_000, channelSubscriberCount: 5_000 })).toBe('passes');
    expect(passesCheapGates({ title: 'Album Ranking Video', viewCount: 10_000, channelSubscriberCount: 5_000 })).toBe('not_official_release');
    expect(passesCheapGates({ title: OFFICIAL_TITLE, viewCount: MIN_VIDEO_VIEWS - 1, channelSubscriberCount: 5_000 })).toBe('below_min_views');
    expect(passesCheapGates({ title: OFFICIAL_TITLE, viewCount: 10_000, channelSubscriberCount: undefined })).toBe('no_subscriber_count');
    expect(passesCheapGates({ title: OFFICIAL_TITLE, viewCount: 10_000, channelSubscriberCount: MAX_CHANNEL_SUBSCRIBERS + 1 })).toBe('subscriber_out_of_band');
  });

  it('a non-official-release title is rejected before any other gate is even checked', () => {
    const input = { title: 'Synth Gear Demo', viewCount: MIN_VIDEO_VIEWS - 1, channelSubscriberCount: undefined };
    expect(passesCheapGates(input)).toBe('not_official_release');
  });

  it('a view-count failure is reported even when the channel would also fail on subscribers — first gate wins, not a random one', () => {
    const input = { title: OFFICIAL_TITLE, viewCount: MIN_VIDEO_VIEWS - 1, channelSubscriberCount: undefined };
    expect(passesCheapGates(input)).toBe('below_min_views');
  });
});

describe('passesYoutubeThresholds', () => {
  const strongInput = { title: OFFICIAL_TITLE, viewCount: 150_000, channelSubscriberCount: 8_000 };

  it('a genuinely strong candidate passes the default thresholds — same verdict as passesCheapGates', () => {
    expect(passesYoutubeThresholds(strongInput)).toBe(true);
    expect(passesCheapGates(strongInput)).toBe('passes');
  });

  it('rejects a channel with no subscriber count at all — cannot judge "disproportionate" without a baseline', () => {
    const input = { ...strongInput, channelSubscriberCount: undefined };
    expect(passesYoutubeThresholds(input)).toBe(false);
  });

  it('rejects an already-famous channel above the subscriber ceiling', () => {
    const input = { ...strongInput, channelSubscriberCount: MAX_CHANNEL_SUBSCRIBERS + 1 };
    expect(passesYoutubeThresholds(input)).toBe(false);
  });

  it('rejects a near-empty channel below the subscriber floor', () => {
    const input = { ...strongInput, channelSubscriberCount: MIN_CHANNEL_SUBSCRIBERS - 1 };
    expect(passesYoutubeThresholds(input)).toBe(false);
  });

  it('rejects a video below the minimum view floor even with a great ratio', () => {
    const input = { ...strongInput, viewCount: MIN_VIDEO_VIEWS - 1, channelSubscriberCount: 10 };
    expect(passesYoutubeThresholds(input)).toBe(false);
  });

  it('custom thresholds override the defaults', () => {
    expect(passesYoutubeThresholds(strongInput, { minSubscribers: strongInput.channelSubscriberCount + 1 })).toBe(false);
    expect(passesYoutubeThresholds(strongInput, { minSubscribers: strongInput.channelSubscriberCount })).toBe(true);
  });
});
