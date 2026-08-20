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

export type LogType = 'note' | 'outreach' | 'response' | 'meeting' | 'status_change';

export const LOG_TYPES: LogType[] = ['note', 'outreach', 'response', 'meeting', 'status_change'];

export const LOG_TYPE_LABELS: Record<LogType, string> = {
  note: 'Note',
  outreach: 'Outreach sent',
  response: 'Response received',
  meeting: 'Meeting / call',
  status_change: 'Stage change',
};

export type LogEntry = {
  id: number;
  artist_id: number;
  created_at: string;
  type: LogType;
  message: string;
  author?: string;
};

export type LogEntryInput = {
  type: LogType;
  message: string;
  author?: string;
};

// A point-in-time snapshot of an artist's score inputs + Breakout Score,
// recorded on every create/update so the scoring model can be validated later
// (e.g. "of artists that crossed 90, what % actually broke out?").
export type ScoreSnapshot = ScoreInputs & {
  id: number;
  artist_id: number;
  recorded_at: string;
  stage: Stage;
  breakout_score: number;
  followers_count?: number;
  monthly_listeners?: number;
  growth_velocity_pct?: number;
  engagement_rate_pct?: number;
};
