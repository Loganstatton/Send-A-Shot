import { SCORE_WEIGHTS, ScoreInputs } from './types';

// Weighted 0-10 scout ratings -> 0-100 Breakout Score. Six of the eight
// inputs are still a human's own rating (music/talent, personality, etc. —
// judgment a number can't replace). The other two, Growth Velocity and
// Engagement Quality, are never hand-set anymore: see
// growthVelocityScore()/engagementQualityScore() below, which convert a
// real growth/engagement % into the 0-10 this function expects. This
// function itself doesn't know or care where an input came from — it just
// sums whatever 0-10 values it's given.
export function breakoutScore(inputs: ScoreInputs): number {
  const total = (Object.keys(SCORE_WEIGHTS) as (keyof ScoreInputs)[]).reduce(
    (sum, key) => sum + (inputs[key] ?? 0) * (SCORE_WEIGHTS[key] / 10),
    0
  );
  return Math.round(total * 10) / 10;
}

// Splits the same total breakoutScore() computes into the two buckets that
// actually explain "why is the score what it is" for NEXT's public Artist
// Detail page (see the "Why the NEXT Score is what it is" module): the
// growth_velocity/engagement_quality pair (real, auto-derived numbers) vs.
// the other six (a Scout's own rating). Deliberately NOT broken out
// category-by-category on NEXT — publicly showing "Professionalism: 4/10"
// about a real artist is a different, harsher thing than the same number
// sitting in Scout's internal tool, and the two-bucket split is honest
// about the real/judgment split without that.
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
