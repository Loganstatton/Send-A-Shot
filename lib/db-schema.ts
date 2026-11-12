// Postgres schema for Scout + NEXT, as ordered, versioned migrations.
//
// Migration 001 is the full schema as of the SQLite -> Postgres move: every
// table lib/db.ts used to create with better-sqlite3, with every later
// addColumnIfMissing() column folded in. To change the schema from here on,
// APPEND a new migration (never edit one that has shipped) — lib/pg.ts
// applies whatever is missing, once, in order, under an advisory lock, and
// records it in schema_migrations.
//
// Type choices, and why:
//   * BIGSERIAL/BIGINT everywhere SQLite had INTEGER. SQLite integers are
//     64-bit; a 32-bit Postgres INTEGER would overflow on things SQLite
//     stored fine (a big channel's view count, a large credits balance).
//     lib/pg.ts parses BIGINT back into a JS number.
//   * DOUBLE PRECISION where SQLite had REAL.
//   * TEXT COLLATE "C" for every text column. Timestamps are ISO-8601
//     strings compared with <, >= and ORDER BY in SQL and again with plain
//     string comparison in JS; "C" (byte order) is the only collation where
//     those two always agree, and it is what SQLite did.
//   * 0/1 flags stay integers (not BOOLEAN) — the app reads and writes them
//     as 0/1 throughout.
export type Migration = { id: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    id: '001_initial_schema',
    sql: `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  created_at TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL,
  email TEXT COLLATE "C" NOT NULL UNIQUE,
  password_hash TEXT COLLATE "C" NOT NULL,
  role TEXT COLLATE "C" NOT NULL DEFAULT 'public',
  next_credits_cents BIGINT NOT NULL DEFAULT 1000000,
  next_onboarded_at TEXT COLLATE "C",
  avatar_url TEXT COLLATE "C",
  email_verified_at TEXT COLLATE "C",
  tos_accepted_at TEXT COLLATE "C",
  privacy_accepted_at TEXT COLLATE "C",
  show_positions_publicly BIGINT NOT NULL DEFAULT 0,
  notify_watchlist_moves BIGINT NOT NULL DEFAULT 1,
  notify_new_artists BIGINT NOT NULL DEFAULT 1,
  notify_founding_believer BIGINT NOT NULL DEFAULT 1,
  notify_portfolio_milestones BIGINT NOT NULL DEFAULT 1,
  notify_leaderboard_rank BIGINT NOT NULL DEFAULT 1,
  email_notifications_enabled BIGINT NOT NULL DEFAULT 0,
  notifications_emailed_through TEXT COLLATE "C",
  last_login_at TEXT COLLATE "C"
);

CREATE TABLE IF NOT EXISTS artists (
  id BIGSERIAL PRIMARY KEY,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  name TEXT COLLATE "C" NOT NULL,
  stage TEXT COLLATE "C" NOT NULL DEFAULT 'watchlist',
  genre TEXT COLLATE "C",
  location TEXT COLLATE "C",
  scout_name TEXT COLLATE "C",
  tiktok_url TEXT COLLATE "C",
  instagram_url TEXT COLLATE "C",
  youtube_url TEXT COLLATE "C",
  spotify_url TEXT COLLATE "C",
  soundcloud_url TEXT COLLATE "C",
  followers_count BIGINT,
  monthly_listeners BIGINT,
  growth_velocity_pct DOUBLE PRECISION,
  engagement_rate_pct DOUBLE PRECISION,
  music_talent DOUBLE PRECISION NOT NULL DEFAULT 0,
  growth_velocity DOUBLE PRECISION NOT NULL DEFAULT 0,
  engagement_quality DOUBLE PRECISION NOT NULL DEFAULT 0,
  original_song_response DOUBLE PRECISION NOT NULL DEFAULT 0,
  brand_personality DOUBLE PRECISION NOT NULL DEFAULT 0,
  content_consistency DOUBLE PRECISION NOT NULL DEFAULT 0,
  commercial_potential DOUBLE PRECISION NOT NULL DEFAULT 0,
  professionalism DOUBLE PRECISION NOT NULL DEFAULT 0,
  notes TEXT COLLATE "C",
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  next_current_price_cents BIGINT,
  photo_url TEXT COLLATE "C",
  bio TEXT COLLATE "C",
  top_song_url TEXT COLLATE "C",
  song_preview_url TEXT COLLATE "C",
  why_trending TEXT COLLATE "C",
  soundcharts_uuid TEXT COLLATE "C",
  featured_video_id TEXT COLLATE "C",
  soundcharts_synced_at TEXT COLLATE "C",
  deezer_synced_at TEXT COLLATE "C",
  youtube_synced_at TEXT COLLATE "C",
  featured_video_match_type TEXT COLLATE "C",
  youtube_no_match_at TEXT COLLATE "C",
  soundcharts_no_match_at TEXT COLLATE "C",
  high_rating_note TEXT COLLATE "C",
  claimed_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  website_url TEXT COLLATE "C",
  photo_source_type TEXT COLLATE "C",
  photo_source_url TEXT COLLATE "C",
  photo_attribution TEXT COLLATE "C",
  photo_license TEXT COLLATE "C",
  photo_license_url TEXT COLLATE "C",
  photo_uploaded_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  photo_uploaded_at TEXT COLLATE "C",
  photo_rights_confirmed_at TEXT COLLATE "C",
  wikidata_qid TEXT COLLATE "C",
  wikidata_fetched_at TEXT COLLATE "C",
  wikidata_no_match_at TEXT COLLATE "C"
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_soundcharts_uuid ON artists(soundcharts_uuid) WHERE soundcharts_uuid IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_log (
  id BIGSERIAL PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT COLLATE "C" NOT NULL,
  type TEXT COLLATE "C" NOT NULL DEFAULT 'note',
  message TEXT COLLATE "C" NOT NULL,
  author TEXT COLLATE "C",
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  follow_up_at TEXT COLLATE "C"
);
CREATE INDEX IF NOT EXISTS idx_contact_log_artist ON contact_log(artist_id);

CREATE TABLE IF NOT EXISTS artist_field_history (
  id BIGSERIAL PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  field TEXT COLLATE "C" NOT NULL,
  old_value TEXT COLLATE "C",
  new_value TEXT COLLATE "C",
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artist_field_history_artist ON artist_field_history(artist_id);

CREATE TABLE IF NOT EXISTS score_history (
  id BIGSERIAL PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  recorded_at TEXT COLLATE "C" NOT NULL,
  stage TEXT COLLATE "C" NOT NULL,
  breakout_score DOUBLE PRECISION NOT NULL,
  followers_count BIGINT,
  monthly_listeners BIGINT,
  growth_velocity_pct DOUBLE PRECISION,
  engagement_rate_pct DOUBLE PRECISION,
  music_talent DOUBLE PRECISION NOT NULL,
  growth_velocity DOUBLE PRECISION NOT NULL,
  engagement_quality DOUBLE PRECISION NOT NULL,
  original_song_response DOUBLE PRECISION NOT NULL,
  brand_personality DOUBLE PRECISION NOT NULL,
  content_consistency DOUBLE PRECISION NOT NULL,
  commercial_potential DOUBLE PRECISION NOT NULL,
  professionalism DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_score_history_artist ON score_history(artist_id);

CREATE TABLE IF NOT EXISTS agreements (
  id BIGSERIAL PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL,
  type TEXT COLLATE "C" NOT NULL,
  status TEXT COLLATE "C" NOT NULL DEFAULT 'draft',
  start_date TEXT COLLATE "C",
  end_date TEXT COLLATE "C",
  commission_pct DOUBLE PRECISION,
  investment_amount_cents BIGINT,
  notes TEXT COLLATE "C",
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  sponsorship_commission_pct DOUBLE PRECISION,
  touring_commission_pct DOUBLE PRECISION,
  masters_owned_by TEXT COLLATE "C"
);
CREATE INDEX IF NOT EXISTS idx_agreements_artist ON agreements(artist_id);

CREATE TABLE IF NOT EXISTS revenue_entries (
  id BIGSERIAL PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  agreement_id BIGINT REFERENCES agreements(id) ON DELETE SET NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  recorded_at TEXT COLLATE "C" NOT NULL,
  source TEXT COLLATE "C" NOT NULL,
  gross_amount_cents BIGINT NOT NULL,
  commission_pct_applied DOUBLE PRECISION,
  commission_amount_cents BIGINT,
  notes TEXT COLLATE "C",
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_revenue_artist ON revenue_entries(artist_id);

CREATE TABLE IF NOT EXISTS investment_entries (
  id BIGSERIAL PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  agreement_id BIGINT REFERENCES agreements(id) ON DELETE SET NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  recorded_at TEXT COLLATE "C" NOT NULL,
  category TEXT COLLATE "C" NOT NULL,
  amount_cents BIGINT NOT NULL,
  notes TEXT COLLATE "C",
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_investment_artist ON investment_entries(artist_id);

CREATE TABLE IF NOT EXISTS next_price_history (
  id BIGSERIAL PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  recorded_at TEXT COLLATE "C" NOT NULL,
  price_cents BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_next_price_history_artist ON next_price_history(artist_id);

CREATE TABLE IF NOT EXISTS next_holdings (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  shares DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_basis_cents BIGINT NOT NULL DEFAULT 0,
  updated_at TEXT COLLATE "C" NOT NULL,
  UNIQUE(user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_next_holdings_user ON next_holdings(user_id);

CREATE TABLE IF NOT EXISTS next_watchlist (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT COLLATE "C" NOT NULL,
  alerts_enabled BIGINT NOT NULL DEFAULT 1,
  UNIQUE(user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_next_watchlist_user ON next_watchlist(user_id);

CREATE TABLE IF NOT EXISTS notification_reads (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  UNIQUE(user_id, notification_key)
);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT COLLATE "C" NOT NULL,
  metadata TEXT COLLATE "C",
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);

CREATE TABLE IF NOT EXISTS preview_listens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  event TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preview_listens_user_artist ON preview_listens(user_id, artist_id);

CREATE TABLE IF NOT EXISTS next_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT COLLATE "C" NOT NULL,
  type TEXT COLLATE "C" NOT NULL,
  shares DOUBLE PRECISION NOT NULL,
  price_cents_per_share BIGINT NOT NULL,
  credits_delta_cents BIGINT NOT NULL,
  realized_pnl_cents BIGINT,
  listened_before_buy BIGINT
);
CREATE INDEX IF NOT EXISTS idx_next_transactions_user ON next_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_next_transactions_artist ON next_transactions(artist_id);
CREATE INDEX IF NOT EXISTS idx_next_transactions_user_created ON next_transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS trade_idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT COLLATE "C" NOT NULL,
  status BIGINT NOT NULL,
  response_json TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS next_founding_believers (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  purchased_at TEXT COLLATE "C" NOT NULL,
  followers_count BIGINT,
  monthly_listeners BIGINT,
  next_score DOUBLE PRECISION NOT NULL,
  next_price_cents BIGINT NOT NULL,
  discovery_rank BIGINT NOT NULL,
  UNIQUE(user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_founding_believers_artist ON next_founding_believers(artist_id);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TEXT COLLATE "C" NOT NULL,
  completed_at TEXT COLLATE "C",
  status TEXT COLLATE "C" NOT NULL DEFAULT 'running',
  searched_count BIGINT NOT NULL DEFAULT 0,
  candidates_found BIGINT NOT NULL DEFAULT 0,
  error TEXT COLLATE "C",
  source TEXT COLLATE "C" NOT NULL DEFAULT 'soundcharts',
  quota_used BIGINT,
  rejected_not_official_release BIGINT,
  rejected_below_min_views BIGINT,
  rejected_no_subscriber_count BIGINT,
  rejected_subscriber_out_of_band BIGINT,
  rejected_below_momentum_threshold BIGINT,
  best_rejected_momentum_score DOUBLE PRECISION,
  rejected_duplicate_soundcharts_match BIGINT
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id BIGSERIAL PRIMARY KEY,
  started_at TEXT COLLATE "C" NOT NULL,
  completed_at TEXT COLLATE "C",
  status TEXT COLLATE "C" NOT NULL DEFAULT 'running',
  checked_count BIGINT NOT NULL DEFAULT 0,
  updated_count BIGINT NOT NULL DEFAULT 0,
  failed_count BIGINT NOT NULL DEFAULT 0,
  error TEXT COLLATE "C",
  source TEXT COLLATE "C" NOT NULL DEFAULT 'soundcharts',
  no_match_count BIGINT,
  error_count BIGINT,
  last_error TEXT COLLATE "C"
);

CREATE TABLE IF NOT EXISTS sync_failures (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  source TEXT COLLATE "C" NOT NULL,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  artist_name TEXT COLLATE "C" NOT NULL,
  error TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_failures_run ON sync_failures(run_id);
CREATE INDEX IF NOT EXISTS idx_sync_failures_source ON sync_failures(source);

CREATE TABLE IF NOT EXISTS youtube_quota_usage (
  id BIGSERIAL PRIMARY KEY,
  quota_day TEXT COLLATE "C" NOT NULL,
  units BIGINT NOT NULL,
  endpoint TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_youtube_quota_usage_day ON youtube_quota_usage(quota_day);

CREATE TABLE IF NOT EXISTS error_reports (
  id BIGSERIAL PRIMARY KEY,
  source TEXT COLLATE "C" NOT NULL,
  message TEXT COLLATE "C" NOT NULL,
  stack TEXT COLLATE "C",
  digest TEXT COLLATE "C",
  path TEXT COLLATE "C",
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_reports_created ON error_reports(created_at);

-- discovery_candidates: SQLite went through a one-time table-rebuild
-- migration (soundcharts_uuid NOT NULL UNIQUE -> nullable, to support
-- YouTube-sourced candidates). This is a fresh database, so it's created
-- directly in its final shape — no rebuild needed.
CREATE TABLE IF NOT EXISTS discovery_candidates (
  id BIGSERIAL PRIMARY KEY,
  source TEXT COLLATE "C" NOT NULL DEFAULT 'soundcharts',
  soundcharts_uuid TEXT COLLATE "C",
  name TEXT COLLATE "C" NOT NULL,
  photo_url TEXT COLLATE "C",
  country TEXT COLLATE "C",
  followers_count BIGINT,
  followers_7d_ago BIGINT,
  followers_30d_ago BIGINT,
  growth_7d_pct DOUBLE PRECISION,
  growth_30d_pct DOUBLE PRECISION,
  yt_video_id TEXT COLLATE "C",
  yt_channel_id TEXT COLLATE "C",
  yt_channel_title TEXT COLLATE "C",
  yt_genre TEXT COLLATE "C",
  yt_view_count BIGINT,
  yt_like_count BIGINT,
  yt_comment_count BIGINT,
  yt_published_at TEXT COLLATE "C",
  yt_channel_subscriber_count BIGINT,
  yt_channel_view_count BIGINT,
  yt_views_per_day DOUBLE PRECISION,
  yt_like_rate DOUBLE PRECISION,
  yt_comment_rate DOUBLE PRECISION,
  yt_views_per_subscriber DOUBLE PRECISION,
  yt_hype_comment_rate DOUBLE PRECISION,
  yt_comments_analyzed BIGINT,
  yt_example_comment_1 TEXT COLLATE "C",
  yt_example_comment_1_likes BIGINT,
  yt_example_comment_2 TEXT COLLATE "C",
  yt_example_comment_2_likes BIGINT,
  -- Legacy: the blended YouTube momentum score this column stored was
  -- removed pre-beta (lib/youtube-momentum.ts). Never populated by new
  -- scans; kept only so old row data (if migrated from SQLite) has somewhere
  -- to land.
  momentum_score DOUBLE PRECISION,
  flagged_reason TEXT COLLATE "C" NOT NULL,
  status TEXT COLLATE "C" NOT NULL DEFAULT 'new',
  discovered_at TEXT COLLATE "C" NOT NULL,
  reviewed_at TEXT COLLATE "C",
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  artist_id BIGINT REFERENCES artists(id) ON DELETE SET NULL,
  discovery_run_id BIGINT REFERENCES discovery_runs(id) ON DELETE SET NULL,
  submitted_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submission_url TEXT COLLATE "C"
);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_status ON discovery_candidates(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_candidates_soundcharts_uuid
  ON discovery_candidates(soundcharts_uuid) WHERE soundcharts_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_candidates_yt_channel
  ON discovery_candidates(yt_channel_id) WHERE yt_channel_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS discovery_candidate_history (
  id BIGSERIAL PRIMARY KEY,
  candidate_id BIGINT NOT NULL REFERENCES discovery_candidates(id) ON DELETE CASCADE,
  from_status TEXT COLLATE "C",
  to_status TEXT COLLATE "C" NOT NULL,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_candidate_history_candidate ON discovery_candidate_history(candidate_id);

CREATE TABLE IF NOT EXISTS artist_claims (
  id BIGSERIAL PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT COLLATE "C",
  status TEXT COLLATE "C" NOT NULL DEFAULT 'pending',
  created_at TEXT COLLATE "C" NOT NULL,
  reviewed_at TEXT COLLATE "C",
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_artist_claims_artist ON artist_claims(artist_id);
CREATE INDEX IF NOT EXISTS idx_artist_claims_user ON artist_claims(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_claims_pending_unique
  ON artist_claims(artist_id, user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS feed_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT COLLATE "C" NOT NULL,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  artist_id BIGINT REFERENCES artists(id) ON DELETE CASCADE,
  ref_type TEXT COLLATE "C",
  ref_id BIGINT,
  visibility TEXT COLLATE "C" NOT NULL DEFAULT 'public',
  metadata TEXT COLLATE "C",
  dedupe_key TEXT COLLATE "C",
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_events_created ON feed_events(created_at);
CREATE INDEX IF NOT EXISTS idx_feed_events_artist ON feed_events(artist_id);
CREATE INDEX IF NOT EXISTS idx_feed_events_type ON feed_events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_events_dedupe ON feed_events(dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS feed_reactions (
  id BIGSERIAL PRIMARY KEY,
  feed_event_id BIGINT NOT NULL REFERENCES feed_events(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  UNIQUE(feed_event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_reactions_event ON feed_reactions(feed_event_id);
CREATE INDEX IF NOT EXISTS idx_feed_reactions_user ON feed_reactions(user_id);

CREATE TABLE IF NOT EXISTS feed_reaction_taps (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_reaction_taps_user ON feed_reaction_taps(user_id);

CREATE TABLE IF NOT EXISTS feed_user_posts (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  body TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  deleted_at TEXT COLLATE "C",
  hidden_at TEXT COLLATE "C",
  hidden_by BIGINT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_user_posts_user ON feed_user_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_user_posts_artist ON feed_user_posts(artist_id);

CREATE TABLE IF NOT EXISTS feed_post_reports (
  id BIGSERIAL PRIMARY KEY,
  post_id BIGINT NOT NULL REFERENCES feed_user_posts(id) ON DELETE CASCADE,
  reporter_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT COLLATE "C" NOT NULL,
  UNIQUE(post_id, reporter_user_id)
);
`,
  },
  {
    // Database snapshots taken by lib/db-backup.ts — each row is one whole
    // gzipped logical export of every other table. Kept in the database so
    // "back up now" needs no extra storage service; downloadable from the
    // admin Backups page for a copy that lives somewhere else.
    id: '002_db_snapshots',
    sql: `
CREATE TABLE IF NOT EXISTS db_snapshots (
  id BIGSERIAL PRIMARY KEY,
  created_at TEXT COLLATE "C" NOT NULL,
  file_name TEXT COLLATE "C" NOT NULL UNIQUE,
  kind TEXT COLLATE "C" NOT NULL DEFAULT 'scheduled',
  size_bytes BIGINT NOT NULL,
  row_count BIGINT NOT NULL,
  data BYTEA NOT NULL
);
`,
  },
  {
    // Small process-independent settings the app generates for itself and
    // every instance must agree on — currently just the session-signing
    // secret when SESSION_SECRET isn't configured (see lib/auth.ts).
    id: '003_app_settings',
    sql: `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT COLLATE "C" PRIMARY KEY,
  value TEXT COLLATE "C" NOT NULL,
  created_at TEXT COLLATE "C" NOT NULL
);
`,
  },
  {
    // Private leagues: a small group of friends who compete with each other
    // instead of (as well as) the whole site. Joining is by invite code
    // only — a league never appears in any public list.
    id: '004_leagues',
    sql: `
CREATE TABLE IF NOT EXISTS next_leagues (
  id BIGSERIAL PRIMARY KEY,
  name TEXT COLLATE "C" NOT NULL,
  invite_code TEXT COLLATE "C" NOT NULL UNIQUE,
  owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT COLLATE "C" NOT NULL
);
CREATE TABLE IF NOT EXISTS next_league_members (
  id BIGSERIAL PRIMARY KEY,
  league_id BIGINT NOT NULL REFERENCES next_leagues(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT COLLATE "C" NOT NULL,
  UNIQUE (league_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_next_league_members_user ON next_league_members(user_id);
`,
  },
  {
    // The genres a player said they listen to (onboarding or Settings), as a
    // JSON array of labels. NULL = never asked / skipped.
    id: '005_genre_prefs',
    sql: `
ALTER TABLE users ADD COLUMN IF NOT EXISTS next_genre_prefs TEXT COLLATE "C";
`,
  },
  {
    // Scout Score transparency: the Scout's public reasoning, when the
    // ratings last changed and who changed them; each score_history row
    // also records who made that change and the reasoning at the time.
    id: '006_score_rationale',
    sql: `
ALTER TABLE artists ADD COLUMN IF NOT EXISTS score_rationale TEXT COLLATE "C";
ALTER TABLE artists ADD COLUMN IF NOT EXISTS scored_at TEXT COLLATE "C";
ALTER TABLE artists ADD COLUMN IF NOT EXISTS scored_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE score_history ADD COLUMN IF NOT EXISTS changed_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE score_history ADD COLUMN IF NOT EXISTS rationale TEXT COLLATE "C";
UPDATE artists SET scored_at = created_at WHERE scored_at IS NULL;
`,
  },
  {
    // Editorial collections: staff-curated, titled lists of artists with a
    // short note on each ("Bedroom pop to watch"). Editorial only — no paid
    // placement.
    id: '007_collections',
    sql: `
CREATE TABLE IF NOT EXISTS next_collections (
  id BIGSERIAL PRIMARY KEY,
  slug TEXT COLLATE "C" NOT NULL UNIQUE,
  title TEXT COLLATE "C" NOT NULL,
  description TEXT COLLATE "C",
  published BIGINT NOT NULL DEFAULT 0,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT COLLATE "C" NOT NULL,
  updated_at TEXT COLLATE "C" NOT NULL
);
CREATE TABLE IF NOT EXISTS next_collection_items (
  id BIGSERIAL PRIMARY KEY,
  collection_id BIGINT NOT NULL REFERENCES next_collections(id) ON DELETE CASCADE,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  position BIGINT NOT NULL,
  note TEXT COLLATE "C",
  UNIQUE (collection_id, artist_id)
);
`,
  },
  {
    // Requests about an artist profile: corrections, rating reviews and
    // opt-outs from the claimed artist; impersonation reports and claim
    // disputes from anyone signed in. Reviewed by staff in /artist-requests.
    id: '008_artist_requests',
    sql: `
CREATE TABLE IF NOT EXISTS artist_requests (
  id BIGSERIAL PRIMARY KEY,
  artist_id BIGINT NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  kind TEXT COLLATE "C" NOT NULL,
  message TEXT COLLATE "C" NOT NULL,
  from_owner BIGINT NOT NULL DEFAULT 0,
  status TEXT COLLATE "C" NOT NULL DEFAULT 'open',
  created_at TEXT COLLATE "C" NOT NULL,
  resolved_at TEXT COLLATE "C",
  resolved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT COLLATE "C"
);
CREATE INDEX IF NOT EXISTS idx_artist_requests_status ON artist_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_artist_requests_artist ON artist_requests(artist_id);
`,
  },
];
