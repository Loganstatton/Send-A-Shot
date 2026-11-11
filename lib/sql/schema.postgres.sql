-- Postgres schema for Send-A-Shot / NEXT, consolidated from lib/db.ts's
-- SQLite DDL + every addColumnIfMissing() migration applied to a fresh
-- SQLite database as of 2026-11-11 (commit b141053). This is the FINAL
-- resulting shape, not a replay of each incremental SQLite migration —
-- there's no legacy Postgres data to migrate column-by-column, so every
-- column that SQLite added later is folded directly into its table here.
--
-- Differences from the SQLite source, and why:
--   * INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY (Postgres's
--     auto-incrementing integer primary key).
--   * REAL -> DOUBLE PRECISION (Postgres spells it out).
--   * Boolean flags (0/1 in SQLite, e.g. show_positions_publicly) kept as
--     INTEGER NOT NULL DEFAULT 0/1 rather than native BOOLEAN — the app
--     layer reads/writes these as 0/1 throughout; changing the column type
--     would mean changing every call site for no behavioral gain.
--   * Everything else (table names, column names, REFERENCES/ON DELETE,
--     UNIQUE/partial UNIQUE indexes) is unchanged — Postgres supports the
--     same syntax SQLite used here.
--
-- Idempotent: safe to run against a fresh database or re-run against one
-- that already has this schema (IF NOT EXISTS everywhere).

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'public',
  next_credits_cents INTEGER NOT NULL DEFAULT 1000000,
  next_onboarded_at TEXT,
  avatar_url TEXT,
  email_verified_at TEXT,
  tos_accepted_at TEXT,
  privacy_accepted_at TEXT,
  show_positions_publicly INTEGER NOT NULL DEFAULT 0,
  notify_watchlist_moves INTEGER NOT NULL DEFAULT 1,
  notify_new_artists INTEGER NOT NULL DEFAULT 1,
  notify_founding_believer INTEGER NOT NULL DEFAULT 1,
  notify_portfolio_milestones INTEGER NOT NULL DEFAULT 1,
  notify_leaderboard_rank INTEGER NOT NULL DEFAULT 1,
  email_notifications_enabled INTEGER NOT NULL DEFAULT 0,
  notifications_emailed_through TEXT,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS artists (
  id SERIAL PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  name TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'watchlist',
  genre TEXT,
  location TEXT,
  scout_name TEXT,
  tiktok_url TEXT,
  instagram_url TEXT,
  youtube_url TEXT,
  spotify_url TEXT,
  soundcloud_url TEXT,
  followers_count INTEGER,
  monthly_listeners INTEGER,
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
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  next_current_price_cents INTEGER,
  photo_url TEXT,
  bio TEXT,
  top_song_url TEXT,
  song_preview_url TEXT,
  why_trending TEXT,
  soundcharts_uuid TEXT,
  featured_video_id TEXT,
  soundcharts_synced_at TEXT,
  deezer_synced_at TEXT,
  youtube_synced_at TEXT,
  featured_video_match_type TEXT,
  youtube_no_match_at TEXT,
  soundcharts_no_match_at TEXT,
  high_rating_note TEXT,
  claimed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  website_url TEXT,
  photo_source_type TEXT,
  photo_source_url TEXT,
  photo_attribution TEXT,
  photo_license TEXT,
  photo_license_url TEXT,
  photo_uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  photo_uploaded_at TEXT,
  photo_rights_confirmed_at TEXT,
  wikidata_qid TEXT,
  wikidata_fetched_at TEXT,
  wikidata_no_match_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_soundcharts_uuid ON artists(soundcharts_uuid) WHERE soundcharts_uuid IS NOT NULL;

CREATE TABLE IF NOT EXISTS contact_log (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  message TEXT NOT NULL,
  author TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  follow_up_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_contact_log_artist ON contact_log(artist_id);

CREATE TABLE IF NOT EXISTS artist_field_history (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artist_field_history_artist ON artist_field_history(artist_id);

CREATE TABLE IF NOT EXISTS score_history (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL,
  stage TEXT NOT NULL,
  breakout_score DOUBLE PRECISION NOT NULL,
  followers_count INTEGER,
  monthly_listeners INTEGER,
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
  id SERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  start_date TEXT,
  end_date TEXT,
  commission_pct DOUBLE PRECISION,
  investment_amount_cents INTEGER,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sponsorship_commission_pct DOUBLE PRECISION,
  touring_commission_pct DOUBLE PRECISION,
  masters_owned_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_agreements_artist ON agreements(artist_id);

CREATE TABLE IF NOT EXISTS revenue_entries (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  agreement_id INTEGER REFERENCES agreements(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  source TEXT NOT NULL,
  gross_amount_cents INTEGER NOT NULL,
  commission_pct_applied DOUBLE PRECISION,
  commission_amount_cents INTEGER,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_revenue_artist ON revenue_entries(artist_id);

CREATE TABLE IF NOT EXISTS investment_entries (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  agreement_id INTEGER REFERENCES agreements(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_investment_artist ON investment_entries(artist_id);

CREATE TABLE IF NOT EXISTS next_price_history (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL,
  price_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_next_price_history_artist ON next_price_history(artist_id);

CREATE TABLE IF NOT EXISTS next_holdings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  shares DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost_basis_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_next_holdings_user ON next_holdings(user_id);

CREATE TABLE IF NOT EXISTS next_watchlist (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  alerts_enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_next_watchlist_user ON next_watchlist(user_id);

CREATE TABLE IF NOT EXISTS notification_reads (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, notification_key)
);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id);

CREATE TABLE IF NOT EXISTS analytics_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);

CREATE TABLE IF NOT EXISTS preview_listens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preview_listens_user_artist ON preview_listens(user_id, artist_id);

CREATE TABLE IF NOT EXISTS next_transactions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  shares DOUBLE PRECISION NOT NULL,
  price_cents_per_share INTEGER NOT NULL,
  credits_delta_cents INTEGER NOT NULL,
  realized_pnl_cents INTEGER,
  listened_before_buy INTEGER
);
CREATE INDEX IF NOT EXISTS idx_next_transactions_user ON next_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_next_transactions_artist ON next_transactions(artist_id);
CREATE INDEX IF NOT EXISTS idx_next_transactions_user_created ON next_transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS trade_idempotency_keys (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS next_founding_believers (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  purchased_at TEXT NOT NULL,
  followers_count INTEGER,
  monthly_listeners INTEGER,
  next_score DOUBLE PRECISION NOT NULL,
  next_price_cents INTEGER NOT NULL,
  discovery_rank INTEGER NOT NULL,
  UNIQUE(user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_founding_believers_artist ON next_founding_believers(artist_id);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id SERIAL PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  searched_count INTEGER NOT NULL DEFAULT 0,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  source TEXT NOT NULL DEFAULT 'soundcharts',
  quota_used INTEGER,
  rejected_not_official_release INTEGER,
  rejected_below_min_views INTEGER,
  rejected_no_subscriber_count INTEGER,
  rejected_subscriber_out_of_band INTEGER,
  rejected_below_momentum_threshold INTEGER,
  best_rejected_momentum_score DOUBLE PRECISION,
  rejected_duplicate_soundcharts_match INTEGER
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id SERIAL PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  checked_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  source TEXT NOT NULL DEFAULT 'soundcharts',
  no_match_count INTEGER,
  error_count INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS sync_failures (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  artist_name TEXT NOT NULL,
  error TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_failures_run ON sync_failures(run_id);
CREATE INDEX IF NOT EXISTS idx_sync_failures_source ON sync_failures(source);

CREATE TABLE IF NOT EXISTS youtube_quota_usage (
  id SERIAL PRIMARY KEY,
  quota_day TEXT NOT NULL,
  units INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_youtube_quota_usage_day ON youtube_quota_usage(quota_day);

CREATE TABLE IF NOT EXISTS error_reports (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  digest TEXT,
  path TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_reports_created ON error_reports(created_at);

-- discovery_candidates: SQLite went through a one-time table-rebuild
-- migration (soundcharts_uuid NOT NULL UNIQUE -> nullable, to support
-- YouTube-sourced candidates). This is a fresh database, so it's created
-- directly in its final shape — no rebuild needed.
CREATE TABLE IF NOT EXISTS discovery_candidates (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'soundcharts',
  soundcharts_uuid TEXT,
  name TEXT NOT NULL,
  photo_url TEXT,
  country TEXT,
  followers_count INTEGER,
  followers_7d_ago INTEGER,
  followers_30d_ago INTEGER,
  growth_7d_pct DOUBLE PRECISION,
  growth_30d_pct DOUBLE PRECISION,
  yt_video_id TEXT,
  yt_channel_id TEXT,
  yt_channel_title TEXT,
  yt_genre TEXT,
  yt_view_count INTEGER,
  yt_like_count INTEGER,
  yt_comment_count INTEGER,
  yt_published_at TEXT,
  yt_channel_subscriber_count INTEGER,
  yt_channel_view_count INTEGER,
  yt_views_per_day DOUBLE PRECISION,
  yt_like_rate DOUBLE PRECISION,
  yt_comment_rate DOUBLE PRECISION,
  yt_views_per_subscriber DOUBLE PRECISION,
  yt_hype_comment_rate DOUBLE PRECISION,
  yt_comments_analyzed INTEGER,
  yt_example_comment_1 TEXT,
  yt_example_comment_1_likes INTEGER,
  yt_example_comment_2 TEXT,
  yt_example_comment_2_likes INTEGER,
  -- Legacy: the blended YouTube momentum score this column stored was
  -- removed pre-beta (lib/youtube-momentum.ts). Never populated by new
  -- scans; kept only so old row data (if migrated from SQLite) has somewhere
  -- to land.
  momentum_score DOUBLE PRECISION,
  flagged_reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  discovered_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
  discovery_run_id INTEGER REFERENCES discovery_runs(id) ON DELETE SET NULL,
  submitted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submission_url TEXT
);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_status ON discovery_candidates(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_candidates_soundcharts_uuid
  ON discovery_candidates(soundcharts_uuid) WHERE soundcharts_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_candidates_yt_channel
  ON discovery_candidates(yt_channel_id) WHERE yt_channel_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS discovery_candidate_history (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES discovery_candidates(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_candidate_history_candidate ON discovery_candidate_history(candidate_id);

CREATE TABLE IF NOT EXISTS artist_claims (
  id SERIAL PRIMARY KEY,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_artist_claims_artist ON artist_claims(artist_id);
CREATE INDEX IF NOT EXISTS idx_artist_claims_user ON artist_claims(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_claims_pending_unique
  ON artist_claims(artist_id, user_id) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS feed_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  artist_id INTEGER REFERENCES artists(id) ON DELETE CASCADE,
  ref_type TEXT,
  ref_id INTEGER,
  visibility TEXT NOT NULL DEFAULT 'public',
  metadata TEXT,
  dedupe_key TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_events_created ON feed_events(created_at);
CREATE INDEX IF NOT EXISTS idx_feed_events_artist ON feed_events(artist_id);
CREATE INDEX IF NOT EXISTS idx_feed_events_type ON feed_events(event_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_events_dedupe ON feed_events(dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS feed_reactions (
  id SERIAL PRIMARY KEY,
  feed_event_id INTEGER NOT NULL REFERENCES feed_events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(feed_event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_reactions_event ON feed_reactions(feed_event_id);
CREATE INDEX IF NOT EXISTS idx_feed_reactions_user ON feed_reactions(user_id);

CREATE TABLE IF NOT EXISTS feed_reaction_taps (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_reaction_taps_user ON feed_reaction_taps(user_id);

CREATE TABLE IF NOT EXISTS feed_user_posts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  hidden_at TEXT,
  hidden_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_user_posts_user ON feed_user_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_feed_user_posts_artist ON feed_user_posts(artist_id);

CREATE TABLE IF NOT EXISTS feed_post_reports (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES feed_user_posts(id) ON DELETE CASCADE,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(post_id, reporter_user_id)
);
