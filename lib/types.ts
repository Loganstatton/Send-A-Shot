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
  photo_url?: string;
  bio?: string;
  top_song_url?: string;
  song_preview_url?: string;
  why_trending?: string;
  soundcharts_uuid?: string;
  // YouTube video ID (e.g. "dQw4w9WgXcQ", not a full URL) embedded as
  // NEXT's Artist Detail hero — see lib/db.ts's addColumnIfMissing note.
  featured_video_id?: string;
  // Provenance for the three external-data sources — when each was last
  // successfully checked (a "no match" attempt counts; a network/API error
  // does not, since nothing was actually confirmed). System-stamped only by
  // the sync routes/on-create lookups in lib/db.ts — never a Scout-editable
  // ArtistInput field, so a client PATCH can't fake freshness.
  soundcharts_synced_at?: string;
  deezer_synced_at?: string;
  youtube_synced_at?: string;
  // How featured_video_id was found — 'channel' (the artist's own known
  // YouTube channel, high confidence), 'search_matched_name' (a keyword
  // search hit whose channel name matched the artist's, decent confidence),
  // or 'search_unverified' (top-relevance search hit with no channel-name
  // match — often a reaction/cover/compilation, genuinely likely wrong).
  // Undefined on any artist whose video predates this column, or wasn't
  // found via the automated lookup at all (e.g. a Scout pasted a link).
  featured_video_match_type?: 'channel' | 'search_matched_name' | 'search_unverified';
  // A Scout's own explanation for an unusually high (9-10) rated category —
  // see the nudge in ArtistForm.tsx. Encouraged, never required to save.
  high_rating_note?: string;
  // The verified user account behind this artist, once an artist_claims
  // request has been approved (see reviewArtistClaim in lib/db.ts) — never
  // Scout-editable via ArtistForm/PATCH, only set through that review flow.
  // Drives access to the Artist Dashboard (app/next/my-artist).
  claimed_by_user_id?: number;
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
  next_onboarded_at?: string;
  avatar_url?: string;
  email_verified_at?: string;
  tos_accepted_at?: string;
  privacy_accepted_at?: string;
  show_positions_publicly: boolean;
  notify_watchlist_moves: boolean;
  notify_new_artists: boolean;
  notify_founding_believer: boolean;
  notify_portfolio_milestones: boolean;
  notify_leaderboard_rank: boolean;
  email_notifications_enabled: boolean;
  notifications_emailed_through?: string;
  last_login_at?: string;
};

export type LogType = 'note' | 'outreach' | 'response' | 'meeting' | 'status_change' | 'claim';

export const LOG_TYPES: LogType[] = ['note', 'outreach', 'response', 'meeting', 'status_change', 'claim'];

export const LOG_TYPE_LABELS: Record<LogType, string> = {
  note: 'Note',
  outreach: 'Outreach sent',
  response: 'Response received',
  meeting: 'Meeting / call',
  status_change: 'Stage change',
  claim: 'Profile claimed',
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

// One row per changed field on a direct artist edit — see updateArtist in
// lib/db.ts. old_value/new_value are stored as plain strings (every
// writable field is a string or number) so this stays a simple, generic
// log rather than a typed column per field.
export type ArtistFieldChange = {
  id: number;
  artist_id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  actor_id?: number;
  actor_name?: string;
  created_at: string;
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

// Every event type this app logs to analytics_events — see logEvent() in
// lib/db.ts. audio_preview_started/completed are deliberately absent:
// preview_listens already tracks those in more detail (it needs the
// per-artist/per-listen shape for "did this trader listen before buying"
// attribution anyway), so the MVP metrics dashboard reads that table for
// those two event types instead of this one.
export type AnalyticsEventType =
  | 'signup_completed'
  | 'onboarding_completed'
  | 'discover_viewed'
  | 'artist_card_viewed'
  | 'artist_detail_opened'
  | 'video_played'
  | 'watchlist_added'
  | 'watchlist_removed'
  | 'buy_started'
  | 'buy_completed'
  | 'sell_completed'
  | 'search_used'
  | 'filter_used'
  | 'session_returned';

export type AnalyticsEvent = {
  id: number;
  user_id: number | null;
  event_type: AnalyticsEventType;
  metadata: Record<string, unknown> | null;
  created_at: string;
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
  listened_before_buy?: boolean;
};

export type NextPricePoint = { recorded_at: string; price_cents: number };

export type NextMarketRow = {
  artist: Artist;
  score: number;
  priceCents: number;
  priceHistory: NextPricePoint[];
};

// One row of a user's Watchlist — the market data every artist has, plus
// the watch-specific facts DiscoverGrid's shared card can show only here:
// when it was added, and what Score/Price looked like at that moment (so
// "what changed since you added it" doesn't need a second round trip).
// scoreAtWatch/priceAtWatchCents are null only when no snapshot/price point
// exists at or before watchedAt at all (nothing to compare against yet).
export type WatchlistEntry = NextMarketRow & {
  watchedAt: string;
  alertsEnabled: boolean;
  scoreAtWatch: number | null;
  priceAtWatchCents: number | null;
};

// Score movement since the previous score_history snapshot — the same
// "momentum" definition the internal Screener already uses
// (see momentumStatus() in lib/scoring.ts). Keyed by artist id, computed
// for the whole roster in one query rather than N+1 per artist.
export type ScoreChange = { changeAbs: number; hasComparison: boolean };

// A permanent, never-erased snapshot of the moment a user first bought an
// artist on NEXT — recorded on the very first buy, before any UI surfaces
// it, because the underlying facts (follower count that day, how many
// people had already backed this artist) can't be reconstructed later.
// Selling afterward does not remove or alter this record: "you were early"
// stays true even if the position doesn't.
export type FoundingBelieverRecord = {
  id: number;
  user_id: number;
  artist_id: number;
  purchased_at: string;
  followers_count?: number;
  monthly_listeners?: number;
  next_score: number;
  next_price_cents: number;
  discovery_rank: number;
};

// Public-safe user summary — no email, no password_hash. What a leaderboard
// row or a Scout Profile is allowed to show about someone else.
export type PublicScout = {
  id: number;
  name: string;
  avatar_url?: string;
};

export type PortfolioValue = {
  cashCents: number;
  holdingsValueCents: number;
  totalValueCents: number;
  totalReturnCents: number;
  totalReturnPct: number;
};

// A holding as shown on a *public* Scout Profile — only rendered at all
// when that Scout has opted into show_positions_publicly (see
// getScoutProfile). Real $ amounts, same public-by-precedent convention
// the genre leaderboard and Artist Detail's recent-trade feed already use.
export type PublicPosition = {
  artist_id: number;
  artist_name: string;
  artist_photo_url?: string;
  shares: number;
  marketValueCents: number;
  unrealizedPnlCents: number;
  unrealizedPct: number;
};

export type FavoriteGenre = { genre: string; count: number };

// An earned reputation badge — see getScoutBadges in lib/scout-badges.ts.
// Computed fresh from a Scout's own stats every time, never persisted.
export type ScoutBadge = {
  key: string;
  label: string;
  description: string;
};

// One submission a Scout has ever reviewed (or is still reviewing) for this
// user — the "trophy case" list on their profile. artistName falls back to
// the name the user typed if it was never approved (no artists row to join
// against); breakout mirrors getBreakoutDiscoveriesCount's own definition
// (the linked artist reached 'flagship').
export type ScoutDiscoveryEntry = {
  candidateId: number;
  artistId?: number;
  artistName: string;
  status: DiscoveryCandidateStatus;
  discoveredAt: string;
  breakout: boolean;
};

export type ScoutProfile = {
  user: PublicScout;
  portfolio: PortfolioValue;
  scoutScoreValue: number;
  rank: number;
  totalScouts: number;
  artistsBackedCount: number;
  earlyDiscoveriesCount: number;
  favoriteGenres: FavoriteGenre[];
  showPositionsPublicly: boolean;
  // Null when the Scout hasn't opted in — not an empty list, so the page
  // can tell "chose to hide this" apart from "opted in but holds nothing."
  positions: PublicPosition[] | null;
  // Phase 7 — crowdsourced-discovery reputation, entirely separate from
  // trading performance above. See ScoutDiscoveryEntry and
  // getApprovedDiscoveriesCount/getBreakoutDiscoveriesCount in lib/db.ts.
  approvedDiscoveriesCount: number;
  breakoutDiscoveriesCount: number;
  discoveryGenres: FavoriteGenre[];
  discoveries: ScoutDiscoveryEntry[];
  badges: ScoutBadge[];
};

export type LeaderboardWindow = 'week' | 'month' | 'all';

export type LeaderboardEntry = {
  user: PublicScout;
  rank: number;
  totalReturnPct: number;
  portfolioValueCents: number;
  artistsBackedCount: number;
  earlyDiscoveriesCount: number;
  // Discovery-submission credit, shown alongside trading stats but never
  // factored into this board's own ranking (see getDiscoveryLeaderboard for
  // the board that ranks by this instead).
  approvedDiscoveriesCount: number;
  // Rank movement is always the last-7-days change in ALL-TIME rank,
  // regardless of which time window the board is currently sorted by — a
  // consistent "how has your standing moved lately" signal rather than a
  // second, window-relative movement number. Positive = moved up
  // (a lower rank number now). Null when there's nothing to compare against
  // yet (the account didn't exist 7 days ago).
  rankChange: number | null;
};

// The "Top Discoverers" board — ranked by crowdsourced-discovery credit
// instead of trading performance. Same PublicScout/rank shape as
// LeaderboardEntry so the page can reuse the identical card layout.
export type DiscoveryLeaderboardEntry = {
  user: PublicScout;
  rank: number;
  approvedDiscoveriesCount: number;
  breakoutDiscoveriesCount: number;
};

// A genre board ranks by realized+unrealized $ P&L earned specifically from
// that genre's artists, not overall %, since a per-genre "invested" base
// isn't always well-defined (e.g. a fully-sold position).
export type GenreLeaderboardEntry = {
  user: PublicScout;
  rank: number;
  pnlCents: number;
  artistsBackedCount: number;
};

// --- Discovery Engine: finds artists Scout hasn't heard of yet ---
//
// A candidate never becomes a real artist/NEXT-listed row on its own — it
// sits in this queue until a human Scout reviews it. That's deliberate:
// the system finds the names, a person still decides who's worth backing.

// A candidate's origin. Soundcharts' /top/artists (restricted to plans
// above ours) was the original — and until now, only — source. YouTube
// discovery (lib/youtube-discovery.ts) is the second; this type is the
// deliberate extension point for any future source (a Scout's own
// submission, an artist self-submission, etc.) — they all end up as the
// same NewDiscoveryCandidate shape feeding the one Candidate Queue below.
// 'public_submission' is the third: any logged-in NEXT user nominating an
// artist via app/next/submit-artist — the fan's own pitch rides in the
// existing flagged_reason column (same "why this showed up" shape the
// other two sources already use it for), just written by a person instead
// of an algorithm.
export type DiscoverySourceKey = 'soundcharts' | 'youtube' | 'public_submission';

export type DiscoveryCandidateStatus = 'new' | 'watching' | 'approved' | 'passed';

export type DiscoveryCandidate = {
  id: number;
  source: DiscoverySourceKey;
  // Soundcharts identity — set for source='soundcharts' candidates always,
  // and for source='youtube' candidates only once/if they get a confident
  // Soundcharts name match (see lib/youtube-discovery.ts). Never required.
  soundcharts_uuid?: string;
  name: string;
  photo_url?: string;
  country?: string;
  followers_count?: number;
  followers_7d_ago?: number;
  followers_30d_ago?: number;
  growth_7d_pct?: number;
  growth_30d_pct?: number;
  // YouTube identity + the raw signals and derived metrics its Momentum
  // Score is built from (see lib/youtube-momentum.ts) — kept as individual
  // typed fields, not a JSON blob, so they stay queryable/sortable and a
  // Scout can see exactly which numbers produced the score.
  yt_video_id?: string;
  yt_channel_id?: string;
  yt_channel_title?: string;
  yt_genre?: string;
  yt_view_count?: number;
  yt_like_count?: number;
  yt_comment_count?: number;
  yt_published_at?: string;
  yt_channel_subscriber_count?: number;
  yt_channel_view_count?: number;
  yt_views_per_day?: number;
  yt_like_rate?: number;
  yt_comment_rate?: number;
  yt_views_per_subscriber?: number;
  // Comment sentiment (see detectHypeComments in lib/youtube-momentum.ts)
  // — a rate (undefined when nothing could be analyzed, not 0) plus up to
  // two real example quotes for a Scout to read directly, highest-liked
  // first.
  yt_hype_comment_rate?: number;
  yt_comments_analyzed?: number;
  yt_example_comment_1?: string;
  yt_example_comment_1_likes?: number;
  yt_example_comment_2?: string;
  yt_example_comment_2_likes?: number;
  momentum_score?: number;
  flagged_reason: string;
  status: DiscoveryCandidateStatus;
  discovered_at: string;
  reviewed_at?: string;
  reviewed_by?: number;
  reviewed_by_name?: string;
  artist_id?: number;
  // Which scan run found this candidate — undefined on a row that predates
  // this column, or if it was somehow inserted outside a run. See
  // getRecentDiscoveryRunsWithCandidateCounts in lib/db.ts.
  discovery_run_id?: number;
  // source='public_submission' only: who submitted it (joined — see
  // DISCOVERY_CANDIDATE_SELECT) and whatever link they pasted (any
  // platform — TikTok, Spotify, a YouTube video, etc.), left for the
  // reviewing Scout to open directly rather than guessing which URL field
  // it belongs in.
  submitted_by_user_id?: number;
  submitted_by_name?: string;
  submission_url?: string;
};

// One row per status transition — see discovery_candidate_history in
// lib/db.ts. from_status is null for the very first row (discovery
// itself), so a candidate's full lifecycle (discovered -> watching ->
// approved, or discovered -> passed, etc.) is reconstructable, unlike the
// single overwritten status/reviewed_at/reviewed_by columns on the
// candidate row itself.
export type DiscoveryCandidateHistoryEntry = {
  id: number;
  candidate_id: number;
  from_status: DiscoveryCandidateStatus | null;
  to_status: DiscoveryCandidateStatus;
  actor_id?: number;
  actor_name?: string;
  created_at: string;
};

// An artist self-identifying as the real person behind a roster row — see
// createArtistClaim in lib/db.ts. Deliberately NOT auto-approved: anyone
// could otherwise declare themselves any artist on the roster, so every
// claim sits 'pending' until a Scout reviews it (app/artist-claims), same
// review-queue shape as a Discovery candidate. Approval sets
// artists.claimed_by_user_id, which is what actually grants Artist
// Dashboard access — this row is the request/audit trail, not the grant
// itself.
export type ArtistClaimStatus = 'pending' | 'approved' | 'rejected';

export type ArtistClaim = {
  id: number;
  artist_id: number;
  artist_name?: string; // joined — see ARTIST_CLAIM_SELECT in lib/db.ts
  user_id: number;
  user_name?: string;
  user_email?: string;
  message?: string;
  status: ArtistClaimStatus;
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: number;
  reviewed_by_name?: string;
};

export type DiscoveryRunStatus = 'running' | 'completed' | 'failed';

// One row per scan — powers the "last scan: 3 hours ago, found 6" summary
// and is the only way to see why a scan came up empty (e.g. plan-restricted
// endpoint) without digging through server logs.
export type DiscoveryRun = {
  id: number;
  source: DiscoverySourceKey;
  started_at: string;
  completed_at?: string;
  status: DiscoveryRunStatus;
  searched_count: number;
  candidates_found: number;
  quota_used?: number;
  error?: string;
  // YouTube-only: why candidates that didn't qualify got rejected (see
  // DiscoveryRejectionBreakdown in lib/discovery-source.ts). Always
  // undefined on a Soundcharts-source run.
  rejected_not_official_release?: number;
  rejected_below_min_views?: number;
  rejected_no_subscriber_count?: number;
  rejected_subscriber_out_of_band?: number;
  rejected_below_momentum_threshold?: number;
  best_rejected_momentum_score?: number;
  rejected_duplicate_soundcharts_match?: number;
};

export type SyncRunStatus = 'running' | 'completed' | 'failed';

// Same extension pattern as DiscoverySourceKey — Soundcharts stats sync
// was the only sync source until Deezer top-track sync (lib/deezer.ts)
// needed its own independent run history. ('spotify' was the original
// source key for this before Spotify's Client Credentials flow started
// 403ing on every call for new apps — old rows keep that value, nothing
// new writes it.)
export type SyncSourceKey = 'soundcharts' | 'deezer' | 'spotify' | 'youtube_video';

// One row per sync run — same "last run: X ago" visibility as DiscoveryRun
// above, so an automated daily sync that silently starts failing (bad
// CRON_SECRET, missing credentials) shows up on the dashboard instead of
// only in server logs.
export type SyncRun = {
  id: number;
  source: SyncSourceKey;
  started_at: string;
  completed_at?: string;
  status: SyncRunStatus;
  checked_count: number;
  updated_count: number;
  failed_count: number;
  error?: string;
  // Deezer-only: why failed_count is what it is — genuinely no match
  // found vs an actual API call erroring, plus a sample of the last
  // error seen. Always undefined on a Soundcharts-source run.
  no_match_count?: number;
  error_count?: number;
  last_error?: string;
};

// One row per artist-level failure within a sync run — unlike SyncRun's
// aggregate counts/single last_error, this is queryable structured history
// (which artists, which errors) instead of only a console.error a Scout
// would need Render's log viewer to ever see. Only real errors are logged
// here, never a clean "no match found" (that's already captured by
// SyncRun.no_match_count and isn't a failure worth surfacing this way).
export type SyncFailure = {
  id: number;
  run_id: number;
  source: SyncSourceKey;
  artist_id: number;
  artist_name: string;
  error: string;
  created_at: string;
};
