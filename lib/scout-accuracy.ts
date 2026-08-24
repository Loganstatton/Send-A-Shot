// "Was Scout right?" model validation — computed fresh from score_history
// every time this is read (this app's established pattern: no background
// jobs, no stale rollup table — see lib/analytics.ts's own header comment
// for the same reasoning applied to product analytics). Every number here
// is derived at request time from score_history rows that already exist.

import { getAllArtists, getEarliestScoreSnapshots, getLatestScoreSnapshots } from './db';
import { scoreContributors } from './scoring';

// A comparison needs real elapsed time to mean anything — two snapshots
// taken minutes apart (e.g. a Scout tweaking ratings right after adding an
// artist) aren't "did the early call predict later growth," they're the
// same call twice. 14 days matches this codebase's other "meaningful
// waiting period" default (see YOUTUBE_NO_MATCH_RECHECK_DAYS).
export const MIN_DAYS_FOR_ACCURACY_ROW = 14;

export type ScoutAccuracyRow = {
  artistId: number;
  artistName: string;
  stage: string;
  firstRatedAt: string;
  daysSinceFirstRating: number;
  // The Scout's own judgment at first rating — scoreContributors()'s
  // human-only bucket (excludes growth_velocity/engagement_quality), so
  // this never includes the same real growth number it's being compared
  // against. Reported both as raw weighted points (0-70) and normalized to
  // a 0-10 "average rating" for readability.
  initialScoutPoints: number;
  initialScoutRatingAvg: number;
  initialGrowthPct: number | null;
  latestGrowthPct: number | null;
};

export function getScoutAccuracyRows(minDays = MIN_DAYS_FOR_ACCURACY_ROW): ScoutAccuracyRow[] {
  const artistsById = new Map(getAllArtists().map((a) => [a.id, a]));
  const earliestBySnapshot = new Map(getEarliestScoreSnapshots().map((s) => [s.artist_id, s]));
  const latestBySnapshot = new Map(getLatestScoreSnapshots().map((s) => [s.artist_id, s]));

  const rows: ScoutAccuracyRow[] = [];
  const now = Date.now();
  for (const [artistId, first] of earliestBySnapshot) {
    const latest = latestBySnapshot.get(artistId);
    const artist = artistsById.get(artistId);
    if (!latest || !artist || first.id === latest.id) continue; // needs a genuine second data point

    const daysSinceFirstRating = (now - new Date(first.recorded_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceFirstRating < minDays) continue;

    const { scoutPoints } = scoreContributors(first);
    // Sum of weights for the 6 human-rated categories (25+15+10+10+5+5=70,
    // via SCORE_WEIGHTS minus growth_velocity/engagement_quality) — divide
    // by /10 of that to get a 0-10 "average rating" a Scout can read at a
    // glance instead of a 0-70 points figure.
    const humanWeightSum = 70;
    rows.push({
      artistId,
      artistName: artist.name,
      stage: artist.stage,
      firstRatedAt: first.recorded_at,
      daysSinceFirstRating: Math.round(daysSinceFirstRating),
      initialScoutPoints: scoutPoints,
      initialScoutRatingAvg: Math.round((scoutPoints / (humanWeightSum / 10)) * 10) / 10,
      initialGrowthPct: first.growth_velocity_pct ?? null,
      latestGrowthPct: latest.growth_velocity_pct ?? null,
    });
  }
  return rows.sort((a, b) => b.initialScoutPoints - a.initialScoutPoints);
}

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 2) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return null;
  return num / Math.sqrt(denX * denY);
}

export type ScoutAccuracySummary = {
  sampleSize: number;
  correlation: number | null;
  topQuartileAvgGrowth: number | null;
  bottomQuartileAvgGrowth: number | null;
};

// Only rows with a real, measured latest growth % count toward the
// correlation/quartile comparison — an artist with no growth number yet
// (never Soundcharts-linked, or growth just isn't tracked) has no outcome
// to validate against, not a zero outcome.
export function getScoutAccuracySummary(rows: ScoutAccuracyRow[]): ScoutAccuracySummary {
  const withOutcome = rows.filter((r): r is ScoutAccuracyRow & { latestGrowthPct: number } => r.latestGrowthPct != null);
  if (withOutcome.length === 0) return { sampleSize: 0, correlation: null, topQuartileAvgGrowth: null, bottomQuartileAvgGrowth: null };

  const correlation = pearsonCorrelation(withOutcome.map((r) => r.initialScoutPoints), withOutcome.map((r) => r.latestGrowthPct));

  const byScore = [...withOutcome].sort((a, b) => b.initialScoutPoints - a.initialScoutPoints);
  const quartileSize = Math.max(1, Math.floor(byScore.length / 4));
  const avg = (rows: ScoutAccuracyRow[]) => rows.reduce((sum, r) => sum + (r.latestGrowthPct ?? 0), 0) / rows.length;
  const topQuartileAvgGrowth = byScore.length >= 4 ? Math.round(avg(byScore.slice(0, quartileSize)) * 10) / 10 : null;
  const bottomQuartileAvgGrowth = byScore.length >= 4 ? Math.round(avg(byScore.slice(-quartileSize)) * 10) / 10 : null;

  return {
    sampleSize: withOutcome.length,
    correlation: correlation != null ? Math.round(correlation * 100) / 100 : null,
    topQuartileAvgGrowth,
    bottomQuartileAvgGrowth,
  };
}

export function interpretCorrelation(r: number | null): string {
  if (r == null) return 'Not enough data yet';
  const abs = Math.abs(r);
  const strength = abs >= 0.5 ? 'strong' : abs >= 0.3 ? 'moderate' : abs >= 0.1 ? 'weak' : 'negligible';
  const direction = r > 0 ? 'positive' : r < 0 ? 'negative' : 'no';
  return `${strength} ${direction} correlation`;
}
