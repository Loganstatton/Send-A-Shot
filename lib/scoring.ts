import { SCORE_WEIGHTS, ScoreInputs } from './types';

// Weighted 0-10 scout ratings -> 0-100 Breakout Score.
export function breakoutScore(inputs: ScoreInputs): number {
  const total = (Object.keys(SCORE_WEIGHTS) as (keyof ScoreInputs)[]).reduce(
    (sum, key) => sum + (inputs[key] ?? 0) * (SCORE_WEIGHTS[key] / 10),
    0
  );
  return Math.round(total * 10) / 10;
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
