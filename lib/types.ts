export type Stage =
  | 'watchlist'
  | 'contacted'
  | 'development'
  | 'portfolio'
  | 'flagship'
  | 'passed';

export const STAGES: Stage[] = [
  'watchlist',
  'contacted',
  'development',
  'portfolio',
  'flagship',
  'passed',
];

export const STAGE_LABELS: Record<Stage, string> = {
  watchlist: 'Watchlist',
  contacted: 'Contacted',
  development: 'Development',
  portfolio: 'Portfolio Artist',
  flagship: 'Flagship',
  passed: 'Passed',
};

// 0-10 scout ratings that feed the weighted Breakout Score.
export type ScoreInputs = {
  music_talent: number;
  growth_velocity: number;
  engagement_quality: number;
  original_song_response: number;
  brand_personality: number;
  content_consistency: number;
  commercial_potential: number;
  professionalism: number;
};

export const SCORE_WEIGHTS: Record<keyof ScoreInputs, number> = {
  music_talent: 25,
  growth_velocity: 15,
  engagement_quality: 15,
  original_song_response: 15,
  brand_personality: 10,
  content_consistency: 10,
  commercial_potential: 5,
  professionalism: 5,
};

export const SCORE_LABELS: Record<keyof ScoreInputs, string> = {
  music_talent: 'Music / Talent',
  growth_velocity: 'Audience Growth Velocity',
  engagement_quality: 'Engagement Quality',
  original_song_response: 'Original-Song Response',
  brand_personality: 'Brand / Personality',
  content_consistency: 'Content Consistency',
  commercial_potential: 'Commercial Potential',
  professionalism: 'Professionalism / Work Ethic',
};

export type Artist = ScoreInputs & {
  id: number;
  created_at: string;
  updated_at: string;
  name: string;
  stage: Stage;
  genre?: string;
  location?: string;
  scout_name?: string;
  tiktok_url?: string;
  instagram_url?: string;
  youtube_url?: string;
  spotify_url?: string;
  soundcloud_url?: string;
  followers_count?: number;
  monthly_listeners?: number;
  growth_velocity_pct?: number;
  engagement_rate_pct?: number;
  notes?: string;
};

export type ArtistInput = Partial<Omit<Artist, 'id' | 'created_at' | 'updated_at'>> & {
  name: string;
};
