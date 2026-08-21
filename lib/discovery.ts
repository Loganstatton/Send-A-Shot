// The Discovery Engine's filtering logic — pure and testable, separate from
// the Soundcharts I/O (lib/soundcharts.ts) and the DB writes (lib/db.ts).
// Same "documented, no hidden formula" spirit as lib/next-market.ts and
// lib/scout-score.ts.

import { NewDiscoveryCandidate } from './db';
import { getFollowerHistory, SoundchartsTopArtistHit } from './soundcharts';

// "Emerging" means small enough that finding them early is actually worth
// something — an artist already at Drake's scale isn't a discovery.
export const FOLLOWER_CEILING = 250_000;
export const FOLLOWER_FLOOR = 500; // excludes near-empty/inactive accounts

// Either a sustained climb or a sudden spike is worth a look.
export const GROWTH_30D_THRESHOLD_PCT = 8;
export const GROWTH_7D_THRESHOLD_PCT = 4;

// Bounds one scan's Soundcharts call volume — topArtists() returns however
// many results Soundcharts sends back per page; only the first N get an
// audience lookup (a second API call each) so a run can't spiral.
export const MAX_CANDIDATES_PER_RUN = 25;

function pctChange(from: number, to: number): number | undefined {
  if (from <= 0) return undefined;
  return Math.round(((to - from) / from) * 1000) / 10;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`;
  return String(n);
}

// Builds a specific, numbers-first explanation rather than a vague label —
// this is what a Scout actually reads to decide Approve/Watch/Pass.
function flagReason(latest: number, growth7d?: number, growth30d?: number, from7d?: number, from30d?: number): string | null {
  if (growth7d != null && growth7d >= GROWTH_7D_THRESHOLD_PCT && from7d != null) {
    return `+${growth7d}% Spotify followers in 7 days (${formatCount(from7d)} → ${formatCount(latest)}) — a sudden jump`;
  }
  if (growth30d != null && growth30d >= GROWTH_30D_THRESHOLD_PCT && from30d != null) {
    return `+${growth30d}% Spotify followers in 30 days (${formatCount(from30d)} → ${formatCount(latest)})`;
  }
  return null;
}

export type ScanCandidate = SoundchartsTopArtistHit & { skippedReason?: string };

// Given raw hits from Soundcharts and the set of UUIDs already tracked or
// already reviewed (approved/watched/passed), works out which ones are
// genuinely new AND show a real growth signal. Each network call
// (getFollowerHistory) happens here, sequentially, capped at
// MAX_CANDIDATES_PER_RUN — small enough that a naive loop is fine and
// doesn't need a worker pool.
export async function evaluateCandidates(
  hits: SoundchartsTopArtistHit[],
  alreadyKnownUuids: Set<string>
): Promise<{ candidates: NewDiscoveryCandidate[]; searchedCount: number }> {
  const fresh = hits.filter((h) => !alreadyKnownUuids.has(h.uuid)).slice(0, MAX_CANDIDATES_PER_RUN);
  const candidates: NewDiscoveryCandidate[] = [];

  for (const hit of fresh) {
    const history = await getFollowerHistory(hit.uuid);
    if (!history) continue;
    if (history.latest < FOLLOWER_FLOOR || history.latest > FOLLOWER_CEILING) continue;

    const growth7d = history.sevenDaysAgo != null ? pctChange(history.sevenDaysAgo, history.latest) : undefined;
    const growth30d = history.thirtyDaysAgo != null ? pctChange(history.thirtyDaysAgo, history.latest) : undefined;
    const reason = flagReason(history.latest, growth7d, growth30d, history.sevenDaysAgo, history.thirtyDaysAgo);
    if (!reason) continue;

    candidates.push({
      soundcharts_uuid: hit.uuid,
      name: hit.name,
      photo_url: hit.imageUrl,
      country: hit.countryCode,
      followers_count: history.latest,
      followers_7d_ago: history.sevenDaysAgo,
      followers_30d_ago: history.thirtyDaysAgo,
      growth_7d_pct: growth7d,
      growth_30d_pct: growth30d,
      flagged_reason: reason,
    });
  }

  return { candidates, searchedCount: fresh.length };
}
