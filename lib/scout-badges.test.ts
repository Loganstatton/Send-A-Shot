import { describe, expect, it } from 'vitest';
import { getScoutBadges } from './scout-badges';

const NONE = { approvedDiscoveriesCount: 0, breakoutDiscoveriesCount: 0, earlyDiscoveriesCount: 0 };

describe('getScoutBadges', () => {
  it('awards nothing for a brand-new account', () => {
    expect(getScoutBadges(NONE)).toEqual([]);
  });

  it('awards First Find at 1 approved discovery, but not Talent Magnet until 5', () => {
    const keys = (stats: typeof NONE) => getScoutBadges(stats).map((b) => b.key);
    expect(keys({ ...NONE, approvedDiscoveriesCount: 1 })).toContain('first_find');
    expect(keys({ ...NONE, approvedDiscoveriesCount: 4 })).not.toContain('talent_magnet');
    expect(keys({ ...NONE, approvedDiscoveriesCount: 5 })).toContain('talent_magnet');
  });

  it('awards Breakout Spotter at 1 breakout discovery', () => {
    expect(getScoutBadges({ ...NONE, breakoutDiscoveriesCount: 1 }).map((b) => b.key)).toContain('breakout_spotter');
    expect(getScoutBadges({ ...NONE, breakoutDiscoveriesCount: 0 }).map((b) => b.key)).not.toContain('breakout_spotter');
  });

  it('awards Early Bird at 10 early (buying) discoveries, not before', () => {
    expect(getScoutBadges({ ...NONE, earlyDiscoveriesCount: 9 }).map((b) => b.key)).not.toContain('early_bird');
    expect(getScoutBadges({ ...NONE, earlyDiscoveriesCount: 10 }).map((b) => b.key)).toContain('early_bird');
  });

  it('can award multiple badges at once, each with a label and description', () => {
    const badges = getScoutBadges({ approvedDiscoveriesCount: 5, breakoutDiscoveriesCount: 1, earlyDiscoveriesCount: 10 });
    expect(badges.map((b) => b.key).sort()).toEqual(['breakout_spotter', 'early_bird', 'first_find', 'talent_magnet'].sort());
    for (const badge of badges) {
      expect(badge.label.length).toBeGreaterThan(0);
      expect(badge.description.length).toBeGreaterThan(0);
    }
  });
});
