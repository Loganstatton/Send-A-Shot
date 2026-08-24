import { EARLY_DISCOVERY_RANK_THRESHOLD } from './scout-score';
import { ScoutBadge } from './types';

// Scout badges — the first earned-achievement system in this app. Computed
// fresh from a Scout's own stats every time (same pattern as scoutScore
// itself and everything in lib/notifications.ts): no badges table, no award
// event to log, nothing to backfill if a threshold changes later. A badge
// simply IS or ISN'T true right now, derived from numbers that already
// exist — mirrors the "gold pill" treatment Founding Believer already uses
// for an earned, permanent marker, just generalized into reusable data
// instead of one-off inline JSX.

export type ScoutBadgeStats = {
  approvedDiscoveriesCount: number;
  breakoutDiscoveriesCount: number;
  earlyDiscoveriesCount: number;
};

const BADGE_DEFINITIONS: { key: string; label: string; description: string; earned: (s: ScoutBadgeStats) => boolean }[] = [
  {
    key: 'first_find',
    label: 'First Find',
    description: 'Had an artist submission approved onto the roster.',
    earned: (s) => s.approvedDiscoveriesCount >= 1,
  },
  {
    key: 'talent_magnet',
    label: 'Talent Magnet',
    description: '5 or more approved discoveries.',
    earned: (s) => s.approvedDiscoveriesCount >= 5,
  },
  {
    key: 'breakout_spotter',
    label: 'Breakout Spotter',
    description: 'Discovered an artist who went on to reach Flagship.',
    earned: (s) => s.breakoutDiscoveriesCount >= 1,
  },
  {
    key: 'early_bird',
    label: 'Early Bird',
    description: `Among the first ${EARLY_DISCOVERY_RANK_THRESHOLD} backers on 10 or more artists.`,
    earned: (s) => s.earlyDiscoveriesCount >= 10,
  },
];

export function getScoutBadges(stats: ScoutBadgeStats): ScoutBadge[] {
  return BADGE_DEFINITIONS.filter((b) => b.earned(stats)).map(({ key, label, description }) => ({ key, label, description }));
}
