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
  created_by?: number;
  created_by_name?: string;
  next_current_price_cents?: number;
};

export type ArtistInput = Partial<Omit<Artist, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'created_by_name'>> & {
  name: string;
};

// public: paper-trades on NEXT, can't edit artists or see Scout's private data.
// internal: Scout staff — edits artists, sees deals/notes/investment ledger.
// admin: everything internal can do, plus manage user roles.
// New signups always default to 'public'; internal/admin can only be granted
// by an existing admin (see setUserRole) or the ADMIN_EMAILS bootstrap list —
// never self-selected.
export type Role = 'public' | 'internal' | 'admin';

export const ROLES: Role[] = ['public', 'internal', 'admin'];

export const ROLE_LABELS: Record<Role, string> = {
  public: 'Public (NEXT)',
  internal: 'Internal (Scout)',
  admin: 'Admin',
};

export type User = {
  id: number;
  created_at: string;
  name: string;
  email: string;
  role: Role;
  next_credits_cents: number;
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
  follow_up_at?: string;
};

export type LogEntryInput = {
  type: LogType;
  message: string;
  follow_up_at?: string;
};

// A log entry with a follow-up date that's today or in the past, surfaced
// across the whole roster on the dashboard so promising artists don't go
// quiet in someone's Notes app.
export type DueFollowUp = {
  id: number;
  artist_id: number;
  artist_name: string;
  type: LogType;
  message: string;
  follow_up_at: string;
  created_at: string;
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

export type AgreementType = 'development' | 'management' | 'investment' | 'other';

export const AGREEMENT_TYPES: AgreementType[] = ['development', 'management', 'investment', 'other'];

export const AGREEMENT_TYPE_LABELS: Record<AgreementType, string> = {
  development: 'Development deal',
  management: 'Management agreement',
  investment: 'Development investment',
  other: 'Other',
};

export type AgreementStatus = 'draft' | 'active' | 'completed' | 'terminated';

export const AGREEMENT_STATUSES: AgreementStatus[] = ['draft', 'active', 'completed', 'terminated'];

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  completed: 'Completed',
  terminated: 'Terminated',
};

export type MastersOwner = 'artist' | 'company' | 'shared';

export const MASTERS_OWNERS: MastersOwner[] = ['artist', 'company', 'shared'];

export const MASTERS_OWNER_LABELS: Record<MastersOwner, string> = {
  artist: 'Artist',
  company: 'Company',
  shared: 'Shared',
};

// Deliberately simple money model: this tracks negotiated terms and totals,
// it does not compute real payout waterfalls (recoup-then-commission
// sequencing, taxes, etc). Treat it as a ledger, not an accounting system —
// real splits are whatever the actual contract and accountant say.
//
// commission_pct is the default rate applied to revenue; sponsorship/touring
// participation only need to be set when they differ from it (e.g. "15%
// standard, but 0% on touring") — null/unset means "same as commission_pct".
export type Agreement = {
  id: number;
  artist_id: number;
  created_at: string;
  updated_at: string;
  type: AgreementType;
  status: AgreementStatus;
  start_date?: string;
  end_date?: string;
  commission_pct?: number;
  sponsorship_commission_pct?: number;
  touring_commission_pct?: number;
  masters_owned_by?: MastersOwner;
  investment_amount_cents?: number;
  notes?: string;
  created_by?: number;
  created_by_name?: string;
};

export type AgreementInput = Partial<
  Omit<Agreement, 'id' | 'artist_id' | 'created_at' | 'updated_at' | 'created_by' | 'created_by_name'>
> & {
  type: AgreementType;
};

export type RevenueSource = 'streaming' | 'sponsorship' | 'shows' | 'merch' | 'other';

export const REVENUE_SOURCES: RevenueSource[] = ['streaming', 'sponsorship', 'shows', 'merch', 'other'];

export const REVENUE_SOURCE_LABELS: Record<RevenueSource, string> = {
  streaming: 'Streaming',
  sponsorship: 'Sponsorship / brand deal',
  shows: 'Shows / touring',
  merch: 'Merch',
  other: 'Other',
};

export type RevenueEntry = {
  id: number;
  artist_id: number;
  agreement_id?: number;
  created_at: string;
  recorded_at: string;
  source: RevenueSource;
  gross_amount_cents: number;
  commission_pct_applied?: number;
  commission_amount_cents?: number;
  notes?: string;
  created_by?: number;
  created_by_name?: string;
};

export type RevenueEntryInput = {
  agreement_id?: number;
  recorded_at: string;
  source: RevenueSource;
  gross_amount_cents: number;
  notes?: string;
};

export type InvestmentCategory = 'marketing' | 'studio' | 'video' | 'content' | 'travel' | 'other';

export const INVESTMENT_CATEGORIES: InvestmentCategory[] = [
  'marketing', 'studio', 'video', 'content', 'travel', 'other',
];

export const INVESTMENT_CATEGORY_LABELS: Record<InvestmentCategory, string> = {
  marketing: 'Marketing',
  studio: 'Studio',
  video: 'Video',
  content: 'Content',
  travel: 'Travel',
  other: 'Other',
};

// Actual categorized spend on an artist — separate from an agreement's
// investment_amount_cents (which is the negotiated commitment/ceiling).
// This is "where did the money actually go," used to compute ROI.
export type InvestmentEntry = {
  id: number;
  artist_id: number;
  agreement_id?: number;
  created_at: string;
  recorded_at: string;
  category: InvestmentCategory;
  amount_cents: number;
  notes?: string;
  created_by?: number;
  created_by_name?: string;
};

export type InvestmentEntryInput = {
  agreement_id?: number;
  recorded_at: string;
  category: InvestmentCategory;
  amount_cents: number;
  notes?: string;
};

// --- NEXT (public paper-trading product) ---
//
// NEXT Score (the Breakout Score) answers "how likely is this artist to
// break out" — it moves on artist performance data. NEXT Price answers
// "what does the NEXT community currently value this artist at" — it starts
// from a transparent formula based on the score, then moves purely on paper
// buy/sell demand. They're deliberately allowed to diverge: that gap (a high
// score, low price "undervalued" artist) is the whole point.

export type NextHolding = {
  id: number;
  user_id: number;
  artist_id: number;
  shares: number;
  cost_basis_cents: number;
  updated_at: string;
};

export type NextTransactionType = 'buy' | 'sell';

export type NextTransaction = {
  id: number;
  user_id: number;
  artist_id: number;
  created_at: string;
  type: NextTransactionType;
  shares: number;
  price_cents_per_share: number;
  credits_delta_cents: number;
  realized_pnl_cents?: number;
};

export type NextPricePoint = { recorded_at: string; price_cents: number };

export type NextMarketRow = {
  artist: Artist;
  score: number;
  priceCents: number;
  priceHistory: NextPricePoint[];
};
