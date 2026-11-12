import { breakoutScore } from './scoring';
import { SCORE_LABELS, SCORE_WEIGHTS, ScoreInputs } from './types';

// The written rubric every Scout rates against, shown next to each slider
// in the Scout tool and (descriptions only) on NEXT's How it works page, so
// two Scouts rating the same artist start from the same definitions.
// Anchors describe what a rating band means; a Scout picks the band that
// fits and then fine-tunes within it.

export type Guideline = { question: string; anchors: { range: string; meaning: string }[] };

export const SCORING_GUIDELINES: Record<keyof ScoreInputs, Guideline> = {
  music_talent: {
    question: 'How strong is the music itself — songwriting, vocals/performance and production for their level?',
    anchors: [
      { range: '0–3', meaning: 'Rough or derivative; nothing yet stands out.' },
      { range: '4–6', meaning: 'Competent, with flashes of something distinctive.' },
      { range: '7–8', meaning: 'Consistently strong and recognisably their own.' },
      { range: '9–10', meaning: 'Exceptional; would stand next to established artists in the genre.' },
    ],
  },
  growth_velocity: {
    question: 'How fast is their audience growing right now, relative to their size, judged from what the Scout can see?',
    anchors: [
      { range: '0–3', meaning: 'Flat or shrinking.' },
      { range: '4–6', meaning: 'Steady, ordinary growth.' },
      { range: '7–8', meaning: 'Clearly accelerating over recent weeks or months.' },
      { range: '9–10', meaning: 'Breakout-level growth, well beyond their peers.' },
    ],
  },
  engagement_quality: {
    question: 'Do people genuinely respond — real comments, shares, saves, repeat listeners — rather than passive views?',
    anchors: [
      { range: '0–3', meaning: 'Little real interaction, or signs of inflated numbers.' },
      { range: '4–6', meaning: 'Some genuine engagement from a core group.' },
      { range: '7–8', meaning: 'Strong, specific engagement; fans talk about the songs.' },
      { range: '9–10', meaning: 'A dedicated community forming around them.' },
    ],
  },
  original_song_response: {
    question: 'How do audiences respond to their own songs (not covers or trends)?',
    anchors: [
      { range: '0–3', meaning: 'Originals get noticeably less response than other content.' },
      { range: '4–6', meaning: 'Originals hold their own.' },
      { range: '7–8', meaning: 'Originals are what people come for.' },
      { range: '9–10', meaning: 'An original is spreading on its own.' },
    ],
  },
  brand_personality: {
    question: 'Is there a clear, memorable identity — look, voice, story — that people can connect with?',
    anchors: [
      { range: '0–3', meaning: 'Hard to tell who they are.' },
      { range: '4–6', meaning: 'An identity is emerging.' },
      { range: '7–8', meaning: 'Distinct and consistent.' },
      { range: '9–10', meaning: 'Instantly recognisable.' },
    ],
  },
  content_consistency: {
    question: 'Do they release music and post regularly enough to keep an audience?',
    anchors: [
      { range: '0–3', meaning: 'Long gaps; sporadic.' },
      { range: '4–6', meaning: 'Fairly regular.' },
      { range: '7–8', meaning: 'Reliable rhythm of releases and posts.' },
      { range: '9–10', meaning: 'Consistently active without dropping quality.' },
    ],
  },
  commercial_potential: {
    question: 'Could this music reach a much larger audience — playlists, sync, live — with the right support?',
    anchors: [
      { range: '0–3', meaning: 'Very niche.' },
      { range: '4–6', meaning: 'Clear audience within a genre.' },
      { range: '7–8', meaning: 'Broad appeal within reach.' },
      { range: '9–10', meaning: 'Mainstream potential.' },
    ],
  },
  professionalism: {
    question: 'How seriously do they treat it as a career — release quality, communication, follow-through?',
    anchors: [
      { range: '0–3', meaning: 'Little evidence yet.' },
      { range: '4–6', meaning: 'Taking it seriously.' },
      { range: '7–8', meaning: 'Organised and dependable.' },
      { range: '9–10', meaning: 'Operating like a professional act.' },
    ],
  },
};

// A rationale is asked for (not enforced) whenever a Score lands at or above
// this, so a high public rating always comes with reasons.
export const RATIONALE_PROMPT_SCORE = 70;

// The three groups NEXT shows publicly. Every category is a Scout rating;
// the grouping is just to make the total readable without publishing each
// category's number (a public "Professionalism: 4/10" about a real artist
// would be needlessly harsh — the Scout tool shows the full detail).
export const SCORE_GROUPS: { key: string; label: string; categories: (keyof ScoreInputs)[] }[] = [
  { key: 'music', label: 'Music', categories: ['music_talent', 'original_song_response'] },
  { key: 'audience', label: 'Audience', categories: ['growth_velocity', 'engagement_quality'] },
  { key: 'artist', label: 'Artist', categories: ['brand_personality', 'content_consistency', 'commercial_potential', 'professionalism'] },
];

export type ScoreGroupPart = { key: string; label: string; points: number; maxPoints: number; categories: string[] };

export function scoreGroups(inputs: ScoreInputs): ScoreGroupPart[] {
  return SCORE_GROUPS.map((g) => {
    const points = g.categories.reduce((sum, c) => sum + inputs[c] * (SCORE_WEIGHTS[c] / 10), 0);
    const maxPoints = g.categories.reduce((sum, c) => sum + SCORE_WEIGHTS[c], 0);
    return { key: g.key, label: g.label, points: Math.round(points * 10) / 10, maxPoints, categories: g.categories.map((c) => SCORE_LABELS[c]) };
  });
}

// Categories the Scout rated 8 or higher — shown publicly as strengths.
// Weak categories are deliberately never listed.
export const STRENGTH_THRESHOLD = 8;
export function scoreStrengths(inputs: ScoreInputs): string[] {
  return (Object.keys(SCORE_WEIGHTS) as (keyof ScoreInputs)[])
    .filter((c) => inputs[c] >= STRENGTH_THRESHOLD)
    .sort((a, b) => inputs[b] - inputs[a] || SCORE_WEIGHTS[b] - SCORE_WEIGHTS[a])
    .map((c) => SCORE_LABELS[c]);
}

export { breakoutScore };
