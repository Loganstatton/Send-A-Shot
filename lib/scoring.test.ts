import { describe, expect, it } from 'vitest';
import { breakoutScore, scoreContributors } from './scoring';

function inputs(overrides: Partial<Parameters<typeof breakoutScore>[0]> = {}) {
  return {
    music_talent: 8,
    growth_velocity: 8,
    engagement_quality: 8,
    original_song_response: 8,
    brand_personality: 8,
    content_consistency: 8,
    commercial_potential: 8,
    professionalism: 8,
    ...overrides,
  };
}

describe('scoreContributors', () => {
  it('the two buckets always sum back to the same total breakoutScore() computes', () => {
    const i = inputs();
    const parts = scoreContributors(i);
    expect(parts.total).toBe(breakoutScore(i));
    expect(Math.round((parts.realDataPoints + parts.scoutPoints) * 10) / 10).toBe(parts.total);
  });

  it('realDataPoints only reflects growth_velocity/engagement_quality, not the other six', () => {
    const low = scoreContributors(inputs({ growth_velocity: 0, engagement_quality: 0 }));
    const high = scoreContributors(inputs({ growth_velocity: 10, engagement_quality: 10 }));
    expect(low.realDataPoints).toBe(0);
    expect(high.realDataPoints).toBe(30); // (15+15)/10 * 10
    // Changing only the real-data inputs shouldn't move the Scout bucket at all.
    expect(low.scoutPoints).toBe(high.scoutPoints);
  });

  it('an artist with zero real growth/engagement still gets full Scout-judgment credit', () => {
    const parts = scoreContributors(inputs({ growth_velocity: 0, engagement_quality: 0 }));
    expect(parts.realDataPoints).toBe(0);
    expect(parts.scoutPoints).toBeGreaterThan(0);
    expect(parts.scoutPoints).toBe(parts.total);
  });
});
