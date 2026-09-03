import { SCORE_WEIGHTS, ScoreInputs } from './types';

// Weighted 0-10 scout ratings -> 0-100 Breakout Score. All eight inputs are
// a human Scout's own 0-10 rating (music/talent, personality, growth,
// engagement, etc. — judgment a formula can't fully replace). This
// function itself doesn't know or care where an input came from — it just
// sums whatever 0-10 values it's given.
//
// Pre-beta migration note: Growth Velocity and Engagement Quality used to
// be auto-computed from a real growth %/engagement % (typically
// Soundcharts-sourced) via growthVelocityScore()/engagementQualityScore()
// below, on every single save. To stop the Breakout Score depending on a
// paid third-party API, both are now ordinary Scout-manual 0-10 ratings
// (lib/db.ts's WRITABLE_FIELDS, ArtistForm.tsx's rating sliders) — nothing
// derives them automatically anymore. Existing artists' already-computed
// values were left exactly as they were (not reset); only future
// create/update calls stop re-deriving them.
export function breakoutScore(inputs: ScoreInputs): number {
  const total = (Object.keys(SCORE_WEIGHTS) as (keyof ScoreInputs)[]).reduce(
    (sum, key) => sum + (inputs[key] ?? 0) * (SCORE_WEIGHTS[key] / 10),
    0
  );
  return Math.round(total * 10) / 10;
}

// Splits the same total breakoutScore() computes into two buckets for
// NEXT's public Artist Detail page (the "Why the Score is what it is"
// module): the growth_velocity/engagement_quality pair vs. the other six.
// Deliberately NOT broken out category-by-category on NEXT — publicly
// showing "Professionalism: 4/10" about a real artist is a different,
// harsher thing than the same number sitting in Scout's internal tool.
//
// Field names here (realDataPoints/scoutPoints) predate the pre-beta
// migration, when growth_velocity/engagement_quality really were
// auto-derived from a live growth %/engagement % and this split was
// literally "real external data vs. Scout judgment." Both categories are
// Scout-manual now (see breakoutScore()'s comment above), so the public
// copy that renders this was reworded to stop claiming "real data" — see
// app/next/artists/[id]/page.tsx and app/next/my-artist/[id]/page.tsx.
// Kept the field names and the two-bucket shape as-is (not a public API,
// low value in a rename) rather than touching every call site for a
// cosmetic rename.
export type ScoreContributors = { realDataPoints: number; scoutPoints: number; total: number };

export function scoreContributors(inputs: ScoreInputs): ScoreContributors {
  const realDataPoints = inputs.growth_velocity * (SCORE_WEIGHTS.growth_velocity / 10) + inputs.engagement_quality * (SCORE_WEIGHTS.engagement_quality / 10);
  const total = breakoutScore(inputs);
  return { realDataPoints: Math.round(realDataPoints * 10) / 10, scoutPoints: Math.round((total - realDataPoints) * 10) / 10, total };
}

// Converts a real 30-day follower growth % into the 0-10 Growth Velocity
// category. Diminishing-returns curve (sqrt, not linear): going from 0% to
// 10% growth matters more than going from 40% to 50% — sustained modest
// growth is itself a strong signal for an artist this early, so it
// shouldn't take a huge spike to register.
export const GROWTH_VELOCITY_SCORE_CEILING_PCT = 50;

export function growthVelocityScore(growthPct: number | null | undefined): number {
  const clamped = Math.max(0, Math.min(GROWTH_VELOCITY_SCORE_CEILING_PCT, growthPct ?? 0));
  return Math.round(Math.sqrt(clamped / GROWTH_VELOCITY_SCORE_CEILING_PCT) * 100) / 10;
}

// Converts a real engagement rate % into the 0-10 Engagement Quality
// category. Linear, not curved — unlike growth, there's no strong reason
// early engagement-% gains should count disproportionately more than later
// ones. The 20% ceiling is a first-pass, deliberately simple band (most
// engaged small accounts land well under it); worth revisiting once real
// engagement data across many artists shows what "exceptional" looks like.
export const ENGAGEMENT_SCORE_CEILING_PCT = 20;

export function engagementQualityScore(engagementPct: number | null | undefined): number {
  const clamped = Math.max(0, Math.min(ENGAGEMENT_SCORE_CEILING_PCT, engagementPct ?? 0));
  return Math.round((clamped / ENGAGEMENT_SCORE_CEILING_PCT) * 100) / 10;
}

export type Recommendation = {
  label: string;
  emoji: string;
  tone: 'fire' | 'watch' | 'monitor' | 'pass';
};

export function recommendation(score: number): Recommendation {
  if (score >= 85) return { label: 'Immediate outreach', emoji: '🔥', tone: 'fire' };
  if (score >= 70) return { label: 'Watch closely', emoji: '👀', tone: 'watch' };
  if (score >= 55) return { label: 'Monitor', emoji: '📊', tone: 'monitor' };
  return { label: 'Pass', emoji: '—', tone: 'pass' };
}

export type Momentum = {
  label: string;
  emoji: string;
  tone: 'rising' | 'growing' | 'flat' | 'falling' | 'new';
};

// Classifies an artist's Breakout Score change since the previous snapshot —
// the "is this one rising or falling" read for the portfolio screener.
export function momentumStatus(changeAbs: number, hasComparison: boolean): Momentum {
  if (!hasComparison) return { label: 'New', emoji: '🆕', tone: 'new' };
  if (changeAbs >= 5) return { label: 'Rising', emoji: '🔥', tone: 'rising' };
  if (changeAbs > 0) return { label: 'Growing', emoji: '📈', tone: 'growing' };
  if (changeAbs < 0) return { label: 'Falling', emoji: '📉', tone: 'falling' };
  return { label: 'Flat', emoji: '➡️', tone: 'flat' };
}
