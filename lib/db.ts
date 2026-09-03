import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { breakoutScore } from './scoring';
import { toPublicArtist } from './public-artist';
import { DATA_DIR } from './data-dir';
import { applyTradeImpact, executionPriceCents, NEXT_STARTING_CREDITS_CENTS, nextBasePriceCents, quoteSell } from './next-market';
import { EARLY_DISCOVERY_RANK_THRESHOLD, scoutScore } from './scout-score';
import { getScoutBadges } from './scout-badges';
import { getCoordinatedPairFlags, getRapidTradingFlags, MarketTradeRow } from './market-integrity';
import type { DiscoveryRejectionBreakdown } from './discovery-source';
import {
  AgreementInput, Agreement, AnalyticsEvent, AnalyticsEventType, Artist, ArtistClaim, ArtistFieldChange, ArtistInput,
  DiscoveryCandidate, DiscoveryCandidateHistoryEntry, DiscoveryCandidateStatus, DiscoveryLeaderboardEntry, DiscoveryRun,
  DiscoverySourceKey, ErrorReport,
  DueFollowUp, FavoriteGenre, FeedEvent, FeedEventType, FeedReaction, FeedUserPost, FoundingBelieverRecord,
  GenreLeaderboardEntry, InvestmentEntry, InvestmentEntryInput, LeaderboardEntry, LeaderboardWindow, LogEntry,
  LogEntryInput, NextHolding, NextMarketRow, NextPricePoint, NextTransaction, NextTransactionType, PortfolioValue,
  ReactionType, RevenueEntry, RevenueEntryInput, RevenueSource, Role, SCORE_WEIGHTS, ScoreChange, ScoreSnapshot, ScoutDiscoveryEntry,
  ScoutProfile, SuspiciousTradingFlag,
  Stage, SyncFailure, SyncRun, SyncSourceKey, User, WatchlistEntry,
} from './types';

export type Actor = { id: number; name: string };

const dbFile = path.join(DATA_DIR, 'app.db');
const dir = path.dirname(dbFile);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(dbFile);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  growth_velocity_pct REAL,
  engagement_rate_pct REAL,
  music_talent REAL NOT NULL DEFAULT 0,
  growth_velocity REAL NOT NULL DEFAULT 0,
  engagement_quality REAL NOT NULL DEFAULT 0,
  original_song_response REAL NOT NULL DEFAULT 0,
  brand_personality REAL NOT NULL DEFAULT 0,
  content_consistency REAL NOT NULL DEFAULT 0,
  commercial_potential REAL NOT NULL DEFAULT 0,
  professionalism REAL NOT NULL DEFAULT 0,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'public',
  next_credits_cents INTEGER NOT NULL DEFAULT 1000000
);
CREATE TABLE IF NOT EXISTS contact_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  message TEXT NOT NULL,
  author TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_contact_log_artist ON contact_log(artist_id);
-- Field-level audit trail for direct edits to an artist record — see
-- updateArtist below. Only logged when a human actor made the change
-- (never an automated sync), and never for 'stage' (already tracked as a
-- contact_log status_change entry). Distinct from score_history, which
-- snapshots the RESULTING numbers on every write but never who changed
-- them or what the previous value was.
CREATE TABLE IF NOT EXISTS artist_field_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artist_field_history_artist ON artist_field_history(artist_id);
CREATE TABLE IF NOT EXISTS score_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL,
  stage TEXT NOT NULL,
  breakout_score REAL NOT NULL,
  followers_count INTEGER,
  monthly_listeners INTEGER,
  growth_velocity_pct REAL,
  engagement_rate_pct REAL,
  music_talent REAL NOT NULL,
  growth_velocity REAL NOT NULL,
  engagement_quality REAL NOT NULL,
  original_song_response REAL NOT NULL,
  brand_personality REAL NOT NULL,
  content_consistency REAL NOT NULL,
  commercial_potential REAL NOT NULL,
  professionalism REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_score_history_artist ON score_history(artist_id);
CREATE TABLE IF NOT EXISTS agreements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  start_date TEXT,
  end_date TEXT,
  commission_pct REAL,
  investment_amount_cents INTEGER,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_agreements_artist ON agreements(artist_id);
CREATE TABLE IF NOT EXISTS revenue_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  agreement_id INTEGER REFERENCES agreements(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  source TEXT NOT NULL,
  gross_amount_cents INTEGER NOT NULL,
  commission_pct_applied REAL,
  commission_amount_cents INTEGER,
  notes TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_revenue_artist ON revenue_entries(artist_id);
CREATE TABLE IF NOT EXISTS investment_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL,
  price_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_next_price_history_artist ON next_price_history(artist_id);
CREATE TABLE IF NOT EXISTS next_holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  shares REAL NOT NULL DEFAULT 0,
  cost_basis_cents INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_next_holdings_user ON next_holdings(user_id);
CREATE TABLE IF NOT EXISTS next_watchlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_next_watchlist_user ON next_watchlist(user_id);
-- The notification center's ONLY persisted state — everything else about a
-- notification (its text, its trigger, whether it's still true) is
-- recomputed fresh from existing tables every time (score_history,
-- next_price_history, next_founding_believers, etc. — see
-- lib/notifications.ts), so a missed cron run or a server restart can never
-- leave it stale or duplicated. This table only remembers "the user has
-- already seen notification X" so a dismissed one stays dismissed.
CREATE TABLE IF NOT EXISTS notification_reads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, notification_key)
);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads(user_id);
-- Generic product-analytics event log — every event type in
-- AnalyticsEventType (lib/types.ts) writes here through logEvent(), one
-- row per occurrence. user_id is nullable and ON DELETE SET NULL so a
-- deleted account doesn't erase historical funnel counts, same reasoning
-- as contact_log's user_id. metadata is a small JSON blob (artist_id,
-- search term, filter name, etc.) — deliberately loose/schemaless rather
-- than a column per event type, since the event shapes vary. Two things
-- this table does NOT duplicate: preview_listens already covers
-- audio_preview_started/completed in more detail (listened-before-buy
-- attribution needs the per-artist table anyway), so those two event
-- types are read from there, not written here.
CREATE TABLE IF NOT EXISTS analytics_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user ON analytics_events(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_type ON analytics_events(event_type);
-- One row per preview play/complete — the "listen" half of NEXT's music
-- experience. 'started' fires each time playback begins (including a
-- replay); 'completed' fires when it reaches the natural end or the 30s
-- preview cap. Kept as its own small table (not folded into next_transactions)
-- since a listen isn't tied to ever trading — most won't be.
CREATE TABLE IF NOT EXISTS preview_listens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_preview_listens_user_artist ON preview_listens(user_id, artist_id);
CREATE TABLE IF NOT EXISTS next_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL,
  shares REAL NOT NULL,
  price_cents_per_share INTEGER NOT NULL,
  credits_delta_cents INTEGER NOT NULL,
  realized_pnl_cents INTEGER
);
CREATE INDEX IF NOT EXISTS idx_next_transactions_user ON next_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_next_transactions_artist ON next_transactions(artist_id);
CREATE INDEX IF NOT EXISTS idx_next_transactions_user_created ON next_transactions(user_id, created_at);
-- Trade double-submit protection: a client-generated key ridden along with
-- a trade request, one row per (user, key) ever. A retried/duplicated
-- request with the same key returns the ORIGINAL trade's stored response
-- instead of executing a second real trade — see executeTradeIdempotent in
-- this file and the trade route. Rows are never pruned (same tradeoff as
-- sync_runs/discovery_runs history — not yet worth a cleanup job at this
-- scale); a key is only ever looked up by (user_id, idempotency_key), so an
-- unbounded table doesn't slow anything else down.
CREATE TABLE IF NOT EXISTS trade_idempotency_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, idempotency_key)
);
CREATE TABLE IF NOT EXISTS next_founding_believers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  purchased_at TEXT NOT NULL,
  followers_count INTEGER,
  monthly_listeners INTEGER,
  next_score REAL NOT NULL,
  next_price_cents INTEGER NOT NULL,
  discovery_rank INTEGER NOT NULL,
  UNIQUE(user_id, artist_id)
);
CREATE INDEX IF NOT EXISTS idx_founding_believers_artist ON next_founding_believers(artist_id);
CREATE TABLE IF NOT EXISTS discovery_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  searched_count INTEGER NOT NULL DEFAULT 0,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  checked_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS sync_failures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quota_day TEXT NOT NULL,
  units INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_youtube_quota_usage_day ON youtube_quota_usage(quota_day);
-- Phase 10 — error monitoring, self-hosted rather than a third-party SDK
-- (this app has no paid-service accounts to wire up). 'client' rows come
-- from app/error.tsx and friends via POST /api/errors (an uncaught render
-- exception, reported best-effort from the browser); 'server' rows come
-- from lib/error-log.ts's logServerError, called from route handlers that
-- catch an unexpected exception. digest is Next.js's own error-boundary
-- correlation id (present on client reports only) — cross-reference it
-- against Render's own log output for the matching server-side stack.
CREATE TABLE IF NOT EXISTS error_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  digest TEXT,
  path TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_reports_created ON error_reports(created_at);
`);

// Lightweight migrations for columns added after the initial table creation.
// SQLite has no "ADD COLUMN IF NOT EXISTS", so ignore the duplicate-column error.
function addColumnIfMissing(table: string, ddl: string) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  } catch (err: any) {
    if (!/duplicate column name/i.test(err?.message ?? '')) throw err;
  }
}
addColumnIfMissing('artists', 'created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumnIfMissing('contact_log', 'follow_up_at TEXT');
addColumnIfMissing('agreements', 'sponsorship_commission_pct REAL');
addColumnIfMissing('agreements', 'touring_commission_pct REAL');
addColumnIfMissing('agreements', 'masters_owned_by TEXT');
addColumnIfMissing('users', "role TEXT NOT NULL DEFAULT 'public'");
addColumnIfMissing('users', 'next_credits_cents INTEGER NOT NULL DEFAULT 1000000');
addColumnIfMissing('users', 'next_onboarded_at TEXT');
addColumnIfMissing('users', 'avatar_url TEXT');
addColumnIfMissing('users', 'email_verified_at TEXT');
addColumnIfMissing('users', 'tos_accepted_at TEXT');
addColumnIfMissing('users', 'privacy_accepted_at TEXT');
// Off by default — unlike return %/rank/Founding Believer records (all
// public-by-precedent elsewhere in NEXT, since credits are virtual), a
// live holdings list is closer to "what am I currently exposed to," so it
// stays opt-in. See getScoutProfile below.
addColumnIfMissing('users', 'show_positions_publicly INTEGER NOT NULL DEFAULT 0');
// Notification category preferences — all on by default (opt-out, not
// opt-in), except email which stays opt-in like every other email this app
// sends (see emailConfigured()/sendEmail() in lib/email.ts: nothing here
// requires email to arrive). notifications_emailed_through is a cursor
// ("everything at or before this timestamp has already been emailed"), not
// a full send-log — see lib/notifications.ts for why one cursor is enough.
addColumnIfMissing('users', 'notify_watchlist_moves INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'notify_new_artists INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'notify_founding_believer INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'notify_portfolio_milestones INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'notify_leaderboard_rank INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('users', 'email_notifications_enabled INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('users', 'notifications_emailed_through TEXT');
// Set on every successful login (see recordLogin below) — the "session
// returned" analytics event fires exactly when this was already non-null
// before the current login, i.e. a real returning session, not the very
// first one right after signup.
addColumnIfMissing('users', 'last_login_at TEXT');
addColumnIfMissing('artists', 'next_current_price_cents INTEGER');
addColumnIfMissing('artists', 'photo_url TEXT');
addColumnIfMissing('artists', 'bio TEXT');
addColumnIfMissing('artists', 'top_song_url TEXT');
addColumnIfMissing('artists', 'song_preview_url TEXT');
addColumnIfMissing('artists', 'why_trending TEXT');
addColumnIfMissing('artists', 'soundcharts_uuid TEXT');
// The YouTube video ID (not a full URL) to embed as NEXT's Artist Detail
// hero — set automatically from a YouTube-discovery candidate's
// yt_video_id on approval (see approveDiscoveryCandidate below), or by a
// Scout pasting a link in the Add/Edit Artist form for any other artist.
addColumnIfMissing('artists', 'featured_video_id TEXT');
// Per-source sync provenance — see the Artist type's comment for exactly
// what "synced" means (a completed check, success or clean no-match; never
// a network/API error). featured_video_match_type records how confident
// the automated YouTube lookup was in featured_video_id — see lib/youtube.ts.
addColumnIfMissing('artists', 'soundcharts_synced_at TEXT');
addColumnIfMissing('artists', 'deezer_synced_at TEXT');
addColumnIfMissing('artists', 'youtube_synced_at TEXT');
addColumnIfMissing('artists', 'featured_video_match_type TEXT');
// Stamped whenever a YouTube lookup genuinely completes with no usable
// video found (not a quota-blocked skip — see getArtistsMissingVideo below
// and app/api/youtube/sync-videos/route.ts). Backs off re-searching an
// artist with no YouTube presence every single day; still checked again
// after RECHECK_NO_MATCH_DAYS in case a video shows up later.
addColumnIfMissing('artists', 'youtube_no_match_at TEXT');
// A Scout's own explanation for an unusually high (9-10) human-rated
// category — see the "≥9" nudge in ArtistForm.tsx. Free text, never
// required to save (encouraged, not enforced), and never auto-cleared —
// if every rating later drops back down, the note still explains why they
// were once rated that high.
// Same purpose as youtube_no_match_at, for the Soundcharts equivalent — see
// getArtistsMissingPhoto below and app/api/soundcharts/backfill/route.ts.
// Without this, an artist Soundcharts genuinely has no listing for would
// get re-searched on every single scheduled backfill run forever.
addColumnIfMissing('artists', 'soundcharts_no_match_at TEXT');
addColumnIfMissing('artists', 'high_rating_note TEXT');
// The verified user account behind this artist row, set only by
// reviewArtistClaim on approval — see the Artist type's own comment. Never
// part of WRITABLE_FIELDS, so a Scout's ordinary PATCH can't set or clear it.
addColumnIfMissing('artists', 'claimed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
// An artist's own official site — Scout-editable, and (pre-beta migration)
// also claimed-artist-editable (see CLAIMED_ARTIST_EDITABLE_FIELDS below).
// Safe to expose publicly as-is (see toPublicArtist) — it's the artist's
// own link, not a vendor-sourced field.
addColumnIfMissing('artists', 'website_url TEXT');
// --- Photo provenance (pre-beta migration: Wikidata/Commons enrichment +
// claimed-artist self-service, see lib/wikidata.ts / lib/wikimedia-commons.ts
// / setArtistPhotoByOwner below) ---
// One of SOURCE_TYPES (lib/types.ts) — never Scout/claimant-writable as a
// raw string; only ever set by the code path that actually sourced the
// photo (SoundchartsSearch/manual edit -> 'SCOUT_MANUAL', the Commons
// picker -> 'WIKIMEDIA_COMMONS', setArtistPhotoByOwner -> 'ARTIST_PROVIDED').
// Legacy artists whose photo_url came from the old Deezer/Soundcharts photo
// fallback (removed pre-beta) have this NULL, not backfilled — a photo that
// predates provenance tracking doesn't get a fabricated source.
addColumnIfMissing('artists', 'photo_source_type TEXT');
// Commons page URL for a WIKIMEDIA_COMMONS photo; the claimed artist's
// original submitted link for an ARTIST_PROVIDED one. NULL otherwise.
addColumnIfMissing('artists', 'photo_source_url TEXT');
// Required attribution text for a WIKIMEDIA_COMMONS photo (creator name +
// whatever the license requires) — legally required to keep showing
// alongside the image, and the one piece of vendor/provenance detail
// toPublicArtist is allowed to expose (see its own comment). NULL for any
// other source.
addColumnIfMissing('artists', 'photo_attribution TEXT');
addColumnIfMissing('artists', 'photo_license TEXT');
addColumnIfMissing('artists', 'photo_license_url TEXT');
// ARTIST_PROVIDED only: who submitted it and when, plus when they checked
// the rights-confirmation box ("I own this content or have permission to
// provide it for use on NEXT") — see setArtistPhotoByOwner. Never backfilled
// for a photo set any other way.
addColumnIfMissing('artists', 'photo_uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumnIfMissing('artists', 'photo_uploaded_at TEXT');
addColumnIfMissing('artists', 'photo_rights_confirmed_at TEXT');
// --- Wikidata match cache (lib/wikidata.ts) — the QID itself, once found,
// so a re-lookup is a single fetch-by-id instead of a fresh fuzzy search.
// Wikidata data is never auto-applied to genre/location/etc — a Scout
// reviews the fetched suggestion and explicitly saves it (same "fill the
// form, Scout still hits Save" flow as SoundchartsSearch). ---
addColumnIfMissing('artists', 'wikidata_qid TEXT');
addColumnIfMissing('artists', 'wikidata_fetched_at TEXT');
// Same backoff idea as youtube_no_match_at/soundcharts_no_match_at above —
// most artists on this roster are small enough that Wikidata genuinely has
// no entry for them; that's an expected, valid outcome, not an error, and
// this stops re-searching every single time a Scout opens the form.
addColumnIfMissing('artists', 'wikidata_no_match_at TEXT');
addColumnIfMissing('next_transactions', 'listened_before_buy INTEGER');
// discovery_runs originally only ever meant a Soundcharts scan; `source`
// distinguishes it from a YouTube scan run, `quota_used` is a rough count
// of external API calls spent (search/videos/channels for YouTube) so a
// quota problem shows up in run history instead of only in logs.
addColumnIfMissing('discovery_runs', "source TEXT NOT NULL DEFAULT 'soundcharts'");
addColumnIfMissing('discovery_runs', 'quota_used INTEGER');
// Why candidates that didn't qualify got rejected on a YouTube scan — see
// DiscoveryRejectionBreakdown in lib/discovery-source.ts. Null/0 on a
// Soundcharts-source run (it doesn't do this kind of threshold filtering).
addColumnIfMissing('discovery_runs', 'rejected_not_official_release INTEGER');
addColumnIfMissing('discovery_runs', 'rejected_below_min_views INTEGER');
addColumnIfMissing('discovery_runs', 'rejected_no_subscriber_count INTEGER');
addColumnIfMissing('discovery_runs', 'rejected_subscriber_out_of_band INTEGER');
addColumnIfMissing('discovery_runs', 'rejected_below_momentum_threshold INTEGER');
addColumnIfMissing('discovery_runs', 'best_rejected_momentum_score REAL');
// A YouTube candidate whose best-effort Soundcharts enrichment resolved to
// a soundcharts_uuid already tracked (a live artist, or an existing
// discovery_candidates row of ANY status/source) — the same real artist
// already known under a different identity, not a genuinely new find. See
// lib/youtube-discovery.ts's rejectionBreakdown.duplicateSoundchartsMatch.
addColumnIfMissing('discovery_runs', 'rejected_duplicate_soundcharts_match INTEGER');
// Same treatment for sync_runs — it originally only ever meant a
// Soundcharts stats sync; `source` distinguishes a Deezer top-track sync
// run (lib/deezer.ts) from it, so each has its own independent history.
addColumnIfMissing('sync_runs', "source TEXT NOT NULL DEFAULT 'soundcharts'");
// Deezer-only diagnostics: why a "checked N, updated 0" run found nothing
// — genuinely no match for any artist (no_match_count) vs an actual API
// call failing (error_count), plus a sample of the last error seen. Null
// on a Soundcharts-source run, which doesn't do this kind of lookup.
addColumnIfMissing('sync_runs', 'no_match_count INTEGER');
addColumnIfMissing('sync_runs', 'error_count INTEGER');
addColumnIfMissing('sync_runs', 'last_error TEXT');
// Per-watch alert preference — whether the Watchlist should flag this
// artist when its Score or Price moves significantly since the user added
// it (see getUserWatchlist below). Defaults on: watching something is
// itself a signal you want to know if it moves.
addColumnIfMissing('next_watchlist', 'alerts_enabled INTEGER NOT NULL DEFAULT 1');

// discovery_candidates originally required `soundcharts_uuid NOT NULL
// UNIQUE` — Soundcharts' /top/artists was the only discovery source, so
// every candidate had one by construction. YouTube discovery (see
// lib/youtube-discovery.ts) adds candidates that may never get a
// confident Soundcharts match, so that column has to become optional.
// SQLite can't relax a column's NOT NULL/UNIQUE in place, so this is a
// one-time table rebuild: rename the old table aside, create the new
// shape, copy every existing row across as source='soundcharts' (the
// only source that could have existed before this migration), drop the
// old table. Guarded by inspecting the live schema (not a version flag),
// so it's idempotent and safe to run on every boot — a fresh database
// never has the old shape and just takes the "create straight away" path.
const DISCOVERY_CANDIDATES_DDL = `
  CREATE TABLE discovery_candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'soundcharts',
    soundcharts_uuid TEXT,
    name TEXT NOT NULL,
    photo_url TEXT,
    country TEXT,
    followers_count INTEGER,
    followers_7d_ago INTEGER,
    followers_30d_ago INTEGER,
    growth_7d_pct REAL,
    growth_30d_pct REAL,
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
    yt_views_per_day REAL,
    yt_like_rate REAL,
    yt_comment_rate REAL,
    yt_views_per_subscriber REAL,
    yt_hype_comment_rate REAL,
    yt_comments_analyzed INTEGER,
    yt_example_comment_1 TEXT,
    yt_example_comment_1_likes INTEGER,
    yt_example_comment_2 TEXT,
    yt_example_comment_2_likes INTEGER,
    -- Legacy: the blended YouTube momentum score this column stored was
    -- removed pre-beta (lib/youtube-momentum.ts). Kept, unwritten, so
    -- existing candidate rows aren't altered — never populated by new scans.
    momentum_score REAL,
    flagged_reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    discovered_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    discovery_run_id INTEGER REFERENCES discovery_runs(id) ON DELETE SET NULL
  )
`;

function ensureDiscoveryCandidatesIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_discovery_candidates_status ON discovery_candidates(status);
    -- Each source has its own identity/dedup key. Partial unique indexes
    -- (not a column-level UNIQUE) because only one source's key column is
    -- ever populated on a given row.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_candidates_soundcharts_uuid
      ON discovery_candidates(soundcharts_uuid) WHERE soundcharts_uuid IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_candidates_yt_channel
      ON discovery_candidates(yt_channel_id) WHERE yt_channel_id IS NOT NULL;
  `);
}

function ensureDiscoveryCandidatesSchema() {
  const tableExists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'discovery_candidates'")
    .get();
  if (!tableExists) {
    db.exec(DISCOVERY_CANDIDATES_DDL);
    ensureDiscoveryCandidatesIndexes();
    return;
  }

  const cols = db.prepare('PRAGMA table_info(discovery_candidates)').all() as { name: string; notnull: number }[];
  const uuidCol = cols.find((c) => c.name === 'soundcharts_uuid');
  const alreadyMigrated = Boolean(uuidCol) && uuidCol!.notnull === 0 && cols.some((c) => c.name === 'source');
  if (alreadyMigrated) {
    ensureDiscoveryCandidatesIndexes();
    return;
  }

  // Phase 10 — migration safety: rename/create/copy/drop as one atomic unit
  // rather than four independent autocommit statements, so a crash
  // mid-rebuild (process killed, disk full on the copy) rolls back to the
  // original table instead of leaving the DB in a half-migrated state
  // (discovery_candidates_pre_youtube present with no discovery_candidates,
  // or an empty new table with the old one already gone).
  db.transaction(() => {
    db.exec('ALTER TABLE discovery_candidates RENAME TO discovery_candidates_pre_youtube');
    db.exec(DISCOVERY_CANDIDATES_DDL);
    db.exec(`
      INSERT INTO discovery_candidates (
        id, source, soundcharts_uuid, name, photo_url, country,
        followers_count, followers_7d_ago, followers_30d_ago, growth_7d_pct, growth_30d_pct,
        flagged_reason, status, discovered_at, reviewed_at, reviewed_by, artist_id
      )
      SELECT
        id, 'soundcharts', soundcharts_uuid, name, photo_url, country,
        followers_count, followers_7d_ago, followers_30d_ago, growth_7d_pct, growth_30d_pct,
        flagged_reason, status, discovered_at, reviewed_at, reviewed_by, artist_id
      FROM discovery_candidates_pre_youtube
    `);
    db.exec('DROP TABLE discovery_candidates_pre_youtube');
    ensureDiscoveryCandidatesIndexes();
  })();
}
ensureDiscoveryCandidatesSchema();
// Created here, AFTER the discovery_candidates rebuild above, not in the
// main DDL block up top — SQLite's ALTER TABLE RENAME (used by that
// rebuild) automatically rewrites OTHER tables' foreign keys that pointed
// at the renamed table, so a history table created earlier and referencing
// discovery_candidates would get silently repointed at the temporary
// discovery_candidates_pre_youtube name, then orphaned the moment that
// temp table is dropped. Creating it only after the rebuild is done means
// its foreign key is always defined against the table's FINAL name.
db.exec(`
CREATE TABLE IF NOT EXISTS discovery_candidate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER NOT NULL REFERENCES discovery_candidates(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_discovery_candidate_history_candidate ON discovery_candidate_history(candidate_id);
`);
// Added after the table-rebuild migration above already shipped — a
// database that went through that migration but predates comment-based
// scoring needs these added the ordinary way (they're new nullable
// columns, not a NOT NULL/UNIQUE relaxation, so no rebuild is needed). A
// brand-new table already has them from DISCOVERY_CANDIDATES_DDL above;
// these are then harmless duplicate-column no-ops.
addColumnIfMissing('discovery_candidates', 'yt_hype_comment_rate REAL');
addColumnIfMissing('discovery_candidates', 'yt_comments_analyzed INTEGER');
addColumnIfMissing('discovery_candidates', 'yt_example_comment_1 TEXT');
addColumnIfMissing('discovery_candidates', 'yt_example_comment_1_likes INTEGER');
addColumnIfMissing('discovery_candidates', 'yt_example_comment_2 TEXT');
addColumnIfMissing('discovery_candidates', 'yt_example_comment_2_likes INTEGER');
// Which scan run found this candidate — added after DISCOVERY_CANDIDATES_DDL
// already shipped without it; a database that predates this migration just
// gets NULL on its existing rows (never backfillable, no run history for
// them), which getRecentDiscoveryRunsWithCandidateCounts treats the same as
// any other run with zero attributed candidates.
addColumnIfMissing('discovery_candidates', 'discovery_run_id INTEGER REFERENCES discovery_runs(id) ON DELETE SET NULL');
// source='public_submission' only — see DiscoverySourceKey's comment.
// submission_url is whatever single link the fan pasted (any platform);
// submitted_by_name isn't stored here, it's joined from users at read time
// (see DISCOVERY_CANDIDATE_SELECT), same pattern as reviewed_by_name.
addColumnIfMissing('discovery_candidates', 'submitted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
addColumnIfMissing('discovery_candidates', 'submission_url TEXT');

// Duplicate-artist detection at the roster level: two live artists sharing
// the same Soundcharts identity are definitely the same real artist, not a
// coincidence — block it at the DB layer the same way discovery_candidates
// already does (see ensureDiscoveryCandidatesIndexes above), rather than
// trusting every call site to check first. Best-effort: if a database that
// predates this migration already has accidental duplicates, creating the
// index throws and is skipped with a warning rather than silently deleting
// someone's data — an admin needs to resolve those by hand once, not have
// them vanish on a routine deploy.
try {
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_soundcharts_uuid ON artists(soundcharts_uuid) WHERE soundcharts_uuid IS NOT NULL');
} catch (err) {
  console.error('[db] could not enforce a unique Soundcharts link across artists — existing duplicates present. Resolve them by hand, then restart.', err);
}

// A "claim this profile" request — see the ArtistClaim type's own comment
// for why this stays a request/review row rather than writing
// artists.claimed_by_user_id directly. The partial unique index blocks a
// second PENDING request from the same user on the same artist (spam
// double-clicks, not a real second ask); a rejected claim can always be
// resubmitted as a fresh row, kept as its own history rather than
// overwriting the rejected one.
db.exec(`
CREATE TABLE IF NOT EXISTS artist_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
`);

// NEXT Feed's event log — see the FeedEvent type's own comment for why
// this is persisted rather than computed live the way notifications are.
// dedupe_key is nullable and only unique when present (a partial index,
// same technique as artists.soundcharts_uuid above) — most event types
// use it as a hard "never post this exact thing twice" guard (tied to the
// specific row that caused it: a discovery_candidates id, a contact_log
// id), while the automated signal types (see lib/feed-signals.ts) rely on
// a time-window cooldown check instead, since "still undervalued" is a
// state that can stay true for weeks and a fixed key can't express "not
// within the last N days."
db.exec(`
CREATE TABLE IF NOT EXISTS feed_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- NEXT Feed reactions — deliberately lightweight (see the spec's explicit
-- "not yet" list: no comments, no DMs, no quote posts). One row per
-- (feed_event, user): the UNIQUE constraint is what makes "one reaction
-- per user per post" and "tap again to change/remove" atomic — a repeat
-- POST either updates reaction_type in place or the row is deleted by the
-- toggle logic in setFeedReaction, never duplicated.
CREATE TABLE IF NOT EXISTS feed_reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_event_id INTEGER NOT NULL REFERENCES feed_events(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(feed_event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_feed_reactions_event ON feed_reactions(feed_event_id);
CREATE INDEX IF NOT EXISTS idx_feed_reactions_user ON feed_reactions(user_id);

-- A tap-rate log, separate from feed_reactions itself — feed_reactions is
-- mutable (a toggle-off DELETEs its row, a change UPDATEs it in place), so
-- counting current rows can't answer "how many times has this user hit the
-- endpoint recently" the way next_transactions naturally can for trade rate
-- limiting (that table is append-only). This one is: one row per POST,
-- whatever it did, never deleted.
CREATE TABLE IF NOT EXISTS feed_reaction_taps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_reaction_taps_user ON feed_reaction_taps(user_id);

-- User Take — the one Feed post type with real user-generated content (see
-- FeedUserPost's own comment in lib/types.ts). Soft-deleted/soft-hidden,
-- never removed outright, so a report always has something real to show an
-- admin even after the author deletes it.
CREATE TABLE IF NOT EXISTS feed_user_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- One row per (post, reporter) — UNIQUE so the same person reporting twice
-- doesn't inflate the count. report_count is never a separate maintained
-- column; it's always COUNT(*) here at read time (see
-- getReportedUserTakePosts), same "compute the aggregate fresh, don't
-- persist a number that can drift" reasoning as the rest of this app.
CREATE TABLE IF NOT EXISTS feed_post_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES feed_user_posts(id) ON DELETE CASCADE,
  reporter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE(post_id, reporter_user_id)
);
`);

const ARTIST_SELECT = `
  SELECT artists.*, users.name AS created_by_name
  FROM artists
  LEFT JOIN users ON users.id = artists.created_by
`;

export function getAllArtists(): Artist[] {
  return db.prepare(`${ARTIST_SELECT} ORDER BY artists.updated_at DESC`).all() as Artist[];
}

export function getArtist(id: number): Artist | undefined {
  return db.prepare(`${ARTIST_SELECT} WHERE artists.id = ?`).get(id) as Artist | undefined;
}

// Case-insensitive exact-name lookup, used to flag (not block) a likely
// duplicate at creation time — two different real artists can legitimately
// share a name, so this is a heads-up for the Scout to double-check, not an
// enforced constraint like the soundcharts_uuid unique index above.
export function findArtistsByName(name: string): { id: number; name: string; stage: string }[] {
  return db.prepare('SELECT id, name, stage FROM artists WHERE LOWER(name) = LOWER(?)').all(name.trim()) as { id: number; name: string; stage: string }[];
}

const WRITABLE_FIELDS = [
  'name', 'stage', 'genre', 'location', 'scout_name',
  'tiktok_url', 'instagram_url', 'youtube_url', 'spotify_url', 'soundcloud_url', 'website_url',
  'followers_count', 'monthly_listeners', 'growth_velocity_pct', 'engagement_rate_pct',
  'music_talent', 'growth_velocity', 'engagement_quality', 'original_song_response',
  'brand_personality', 'content_consistency', 'commercial_potential', 'professionalism',
  'notes', 'photo_url', 'bio', 'top_song_url', 'song_preview_url', 'why_trending', 'soundcharts_uuid',
  'featured_video_id', 'high_rating_note',
  // Photo provenance a Scout sets alongside photo_url (manual paste ->
  // 'SCOUT_MANUAL'; the Commons picker fills all five at once with
  // 'WIKIMEDIA_COMMONS' — see components/WikimediaCommonsSearch.tsx).
  // Deliberately NOT here: photo_uploaded_by_user_id/photo_uploaded_at/
  // photo_rights_confirmed_at (ARTIST_PROVIDED only, set exclusively by
  // setArtistPhotoByOwner below — never client-settable, same reasoning as
  // claimed_by_user_id above) and wikidata_qid/wikidata_fetched_at/
  // wikidata_no_match_at (system-stamped only by the Wikidata lookup route).
  'photo_source_type', 'photo_source_url', 'photo_attribution', 'photo_license', 'photo_license_url',
] as const;

// Pre-beta migration: growth_velocity/engagement_quality used to be
// silently re-derived from growth_velocity_pct/engagement_rate_pct (a
// Soundcharts-shaped metric) on every save — see growthVelocityScore()/
// engagementQualityScore() in lib/scoring.ts, still exported as pure
// helpers but no longer called from here. They're now ordinary
// Scout-manual 0-10 categories, same as the other six (ArtistForm.tsx
// rates them with the same slider). This does NOT reset or touch any
// artist's existing stored value — whatever was last computed/saved stays
// exactly as-is until a Scout deliberately edits it. The *_pct columns
// stay in the schema (legacy context a Scout can still see/edit) but no
// longer drive anything automatically.
const SCORE_FIELD_SET = new Set(Object.keys(SCORE_WEIGHTS));

export function createArtist(input: ArtistInput, actor?: Actor | null): Artist {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { created_at: now, updated_at: now, created_by: actor?.id ?? null };
  for (const field of WRITABLE_FIELDS) {
    const value = (input as any)[field];
    if (value != null) row[field] = value;
    else if (field === 'stage') row[field] = 'watchlist';
    else if (SCORE_FIELD_SET.has(field)) row[field] = 0;
    else row[field] = null;
  }

  const columns = ['created_at', 'updated_at', 'created_by', ...WRITABLE_FIELDS];
  const placeholders = columns.map((c) => `@${c}`).join(', ');
  const info = db
    .prepare(`INSERT INTO artists (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(row);
  const artist = getArtist(info.lastInsertRowid as number)!;
  snapshotScore(artist);
  return artist;
}

export function updateArtist(id: number, input: ArtistInput, actor?: Actor | null): Artist | undefined {
  const existing = getArtist(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const sets: string[] = [];
  const row: Record<string, unknown> = { id, updated_at: now };
  for (const field of WRITABLE_FIELDS) {
    if (field in input) {
      sets.push(`${field} = @${field}`);
      row[field] = (input as any)[field];
    }
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE artists SET updated_at = @updated_at, ${sets.join(', ')} WHERE id = @id`).run(row);
  }
  const updated = getArtist(id)!;
  if (input.stage && input.stage !== existing.stage) {
    addLogEntry(id, {
      type: 'status_change',
      message: `Stage changed from "${existing.stage}" to "${updated.stage}"`,
    }, actor);
  }
  // Field-level audit trail — only for a real human edit (an automated
  // sync route never passes an actor), and never for 'stage' (already
  // covered by the status_change log entry above).
  if (sets.length > 0 && actor?.id != null) {
    logArtistFieldChanges(id, existing, input, actor.id);
  }
  if (sets.length > 0) snapshotScore(updated);
  return updated;
}

// null/undefined/'' all mean "no value" — ArtistForm always submits every
// field on every save (an untouched optional field comes through as '',
// never omitted), so comparing raw values against the DB's null would log
// a spurious "changed" row for every blank field on every single save.
function normalizeFieldValue(v: unknown): string | null {
  return v == null || v === '' ? null : String(v);
}

function logArtistFieldChanges(artistId: number, existing: Artist, input: ArtistInput, actorId: number): void {
  const now = new Date().toISOString();
  const insert = db.prepare('INSERT INTO artist_field_history (artist_id, field, old_value, new_value, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const field of WRITABLE_FIELDS) {
    if (field === 'stage' || !(field in input)) continue;
    const oldValue = normalizeFieldValue((existing as any)[field]);
    const newValue = normalizeFieldValue((input as any)[field]);
    if (oldValue === newValue) continue;
    insert.run(artistId, field, oldValue, newValue, actorId, now);
  }
}

export function getArtistFieldHistory(artistId: number, limit = 50): ArtistFieldChange[] {
  return db
    .prepare(`
      SELECT artist_field_history.*, users.name AS actor_name
      FROM artist_field_history
      LEFT JOIN users ON users.id = artist_field_history.actor_id
      WHERE artist_id = ?
      ORDER BY artist_field_history.created_at DESC, artist_field_history.id DESC
      LIMIT ?
    `)
    .all(artistId, limit) as ArtistFieldChange[];
}

// The exact profile fields an approved claimed artist can edit themselves
// (pre-beta migration brief item 3) — bio, discovery-relevant descriptors,
// their own official links, and which of their own videos NEXT features.
// Deliberately excludes everything else WRITABLE_FIELDS allows a Scout to
// touch: scout_name, notes, high_rating_note, the 8 rating categories,
// stage, follower/growth numbers, soundcharts_uuid, photo provenance (photo
// goes through the separate rights-confirmed setArtistPhotoByOwner instead
// of this generic path) — i.e. no internal discovery info, no scoring, no
// market-moving fields. name is also excluded: renaming a roster artist is
// still a Scout call (their own market visibility/NEXT ticker depends on
// it), not something an artist can silently redo on themselves.
const CLAIMED_ARTIST_EDITABLE_FIELDS = [
  'bio', 'genre', 'location', 'website_url',
  'tiktok_url', 'instagram_url', 'youtube_url', 'spotify_url', 'soundcloud_url',
  'featured_video_id',
] as const satisfies readonly (typeof WRITABLE_FIELDS)[number][];

// Applies a claimed artist's own edit to their own roster row — same
// updateArtist()/field-history/audit-log machinery a Scout's PATCH uses,
// just pre-filtered to CLAIMED_ARTIST_EDITABLE_FIELDS so nothing outside
// that whitelist can be smuggled in even if the request body contains it.
// Caller (app/api/next/my-artist/[id]/profile/route.ts) has already
// confirmed artist.claimed_by_user_id === the acting user.
export function updateArtistByOwner(artistId: number, input: ArtistInput, actor: Actor): Artist | undefined {
  const filtered: Record<string, unknown> = {};
  for (const field of CLAIMED_ARTIST_EDITABLE_FIELDS) {
    if (field in input) filtered[field] = (input as any)[field];
  }
  // updateArtist only ever writes a WRITABLE_FIELDS key actually present on
  // the input object (`field in input`) — `name` being structurally
  // required by ArtistInput's type is a compile-time-only constraint, never
  // checked at runtime, so omitting it here is safe: nothing renames the
  // artist through this path.
  return updateArtist(artistId, filtered as ArtistInput, actor);
}

// "Most recent activity" for roster sorting — the later of the artist's
// own last field edit (updated_at) and its most recent contact_log entry
// (a note/outreach/meeting logged with no field actually changing doesn't
// touch updated_at at all, so relying on updated_at alone would miss it).
// Both are ISO strings, so the 2-arg scalar MAX() below picks whichever
// sorts later — nested inside the same SELECT as the aggregate MAX() per
// group, which SQLite evaluates correctly.
export function getArtistLastActivityMap(): Map<number, string> {
  const rows = db
    .prepare(`
      SELECT artists.id AS id, MAX(artists.updated_at, COALESCE(MAX(contact_log.created_at), '')) AS last_activity_at
      FROM artists
      LEFT JOIN contact_log ON contact_log.artist_id = artists.id
      GROUP BY artists.id
    `)
    .all() as { id: number; last_activity_at: string }[];
  return new Map(rows.map((r) => [r.id, r.last_activity_at]));
}

export function bulkSetArtistStage(ids: number[], stage: Stage, actor: Actor): number {
  let updated = 0;
  for (const id of ids) {
    if (updateArtist(id, { stage } as ArtistInput, actor)) updated++;
  }
  return updated;
}

export function deleteArtist(id: number): boolean {
  const info = db.prepare('DELETE FROM artists WHERE id = ?').run(id);
  return info.changes > 0;
}

function snapshotScore(artist: Artist) {
  db.prepare(`
    INSERT INTO score_history (
      artist_id, recorded_at, stage, breakout_score,
      followers_count, monthly_listeners, growth_velocity_pct, engagement_rate_pct,
      music_talent, growth_velocity, engagement_quality, original_song_response,
      brand_personality, content_consistency, commercial_potential, professionalism
    ) VALUES (
      @artist_id, @recorded_at, @stage, @breakout_score,
      @followers_count, @monthly_listeners, @growth_velocity_pct, @engagement_rate_pct,
      @music_talent, @growth_velocity, @engagement_quality, @original_song_response,
      @brand_personality, @content_consistency, @commercial_potential, @professionalism
    )
  `).run({
    artist_id: artist.id,
    recorded_at: new Date().toISOString(),
    stage: artist.stage,
    breakout_score: breakoutScore(artist),
    followers_count: artist.followers_count ?? null,
    monthly_listeners: artist.monthly_listeners ?? null,
    growth_velocity_pct: artist.growth_velocity_pct ?? null,
    engagement_rate_pct: artist.engagement_rate_pct ?? null,
    music_talent: artist.music_talent,
    growth_velocity: artist.growth_velocity,
    engagement_quality: artist.engagement_quality,
    original_song_response: artist.original_song_response,
    brand_personality: artist.brand_personality,
    content_consistency: artist.content_consistency,
    commercial_potential: artist.commercial_potential,
    professionalism: artist.professionalism,
  });
}

export function getScoreHistory(artistId: number): ScoreSnapshot[] {
  return db
    .prepare('SELECT * FROM score_history WHERE artist_id = ? ORDER BY recorded_at ASC')
    .all(artistId) as ScoreSnapshot[];
}

// The earliest/latest score_history row per artist — the "was Scout right"
// report's two endpoints (a Scout's first-ever rating vs. the most
// recently observed real growth). A self-join on MIN/MAX(recorded_at)
// rather than a window function, so this doesn't depend on a specific
// SQLite build's window-function support.
export function getEarliestScoreSnapshots(): ScoreSnapshot[] {
  return db
    .prepare(`
      SELECT score_history.* FROM score_history
      INNER JOIN (SELECT artist_id, MIN(recorded_at) AS at FROM score_history GROUP BY artist_id) first
        ON score_history.artist_id = first.artist_id AND score_history.recorded_at = first.at
    `)
    .all() as ScoreSnapshot[];
}

export function getLatestScoreSnapshots(): ScoreSnapshot[] {
  return db
    .prepare(`
      SELECT score_history.* FROM score_history
      INNER JOIN (SELECT artist_id, MAX(recorded_at) AS at FROM score_history GROUP BY artist_id) latest
        ON score_history.artist_id = latest.artist_id AND score_history.recorded_at = latest.at
    `)
    .all() as ScoreSnapshot[];
}

export function getArtistLog(artistId: number): LogEntry[] {
  return db
    .prepare('SELECT * FROM contact_log WHERE artist_id = ? ORDER BY created_at DESC')
    .all(artistId) as LogEntry[];
}

// Single-row lookup by contact_log id — NEXT Feed's artist_update events
// point at one via ref_id and need to render its message, not the whole
// artist's log.
export function getLogEntryById(id: number): LogEntry | undefined {
  return db.prepare('SELECT * FROM contact_log WHERE id = ?').get(id) as LogEntry | undefined;
}

export function addLogEntry(artistId: number, input: LogEntryInput, actor?: Actor | { name: string } | null): LogEntry {
  const now = new Date().toISOString();
  const actorId = actor && 'id' in actor ? actor.id : null;
  const info = db
    .prepare('INSERT INTO contact_log (artist_id, created_at, type, message, author, user_id, follow_up_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(artistId, now, input.type, input.message, actor?.name ?? null, actorId, input.follow_up_at ?? null);
  return db.prepare('SELECT * FROM contact_log WHERE id = ?').get(info.lastInsertRowid) as LogEntry;
}

export function deleteLogEntry(artistId: number, logId: number): boolean {
  const info = db
    .prepare('DELETE FROM contact_log WHERE id = ? AND artist_id = ?')
    .run(logId, artistId);
  return info.changes > 0;
}

// Clears (or sets) the follow-up date on a log entry — used to "check off" a
// due follow-up once it's been handled, without deleting the entry itself.
export function setFollowUp(artistId: number, logId: number, followUpAt: string | null): LogEntry | undefined {
  const info = db
    .prepare('UPDATE contact_log SET follow_up_at = ? WHERE id = ? AND artist_id = ?')
    .run(followUpAt, logId, artistId);
  if (info.changes === 0) return undefined;
  return db.prepare('SELECT * FROM contact_log WHERE id = ?').get(logId) as LogEntry;
}

export function getDueFollowUps(): DueFollowUp[] {
  return db.prepare(`
    SELECT contact_log.id, contact_log.artist_id, artists.name AS artist_name,
      contact_log.type, contact_log.message, contact_log.follow_up_at, contact_log.created_at
    FROM contact_log
    JOIN artists ON artists.id = contact_log.artist_id
    WHERE contact_log.follow_up_at IS NOT NULL
      AND contact_log.follow_up_at <= date('now')
      AND artists.stage != 'passed'
    ORDER BY contact_log.follow_up_at ASC
  `).all() as DueFollowUp[];
}

const USER_COLUMNS =
  'id, created_at, name, email, role, next_credits_cents, next_onboarded_at, avatar_url, email_verified_at, tos_accepted_at, privacy_accepted_at, ' +
  'show_positions_publicly, notify_watchlist_moves, notify_new_artists, notify_founding_believer, notify_portfolio_milestones, ' +
  'notify_leaderboard_rank, email_notifications_enabled, notifications_emailed_through, last_login_at';

const BOOLEAN_USER_COLUMNS = [
  'show_positions_publicly', 'notify_watchlist_moves', 'notify_new_artists', 'notify_founding_believer',
  'notify_portfolio_milestones', 'notify_leaderboard_rank', 'email_notifications_enabled',
] as const;

// SQLite has no boolean type — normalizes every raw 0/1 boolean column into
// the booleans the User type promises. Applied at every USER_COLUMNS read
// site so nothing downstream has to remember which columns are numbers.
function normalizeUser<T extends Record<(typeof BOOLEAN_USER_COLUMNS)[number], unknown>>(row: T): T {
  const normalized = { ...row };
  for (const field of BOOLEAN_USER_COLUMNS) (normalized as any)[field] = row[field] === 1;
  return normalized;
}

// New accounts always start as 'public' — internal/admin is never
// self-selected, only granted via setUserRole (an admin) or the
// ADMIN_EMAILS bootstrap in lib/auth.ts. tos_accepted_at/privacy_accepted_at
// are set here, at signup, not editable afterward — they're a one-time
// record of "the terms shown at signup time were accepted," not a
// re-checkable settings toggle.
export function createUser(input: { name: string; email: string; password_hash: string }): User {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      "INSERT INTO users (created_at, name, email, password_hash, role, tos_accepted_at, privacy_accepted_at) VALUES (?, ?, ?, ?, 'public', ?, ?)"
    )
    .run(now, input.name, input.email.toLowerCase(), input.password_hash, now, now);
  return getUserById(info.lastInsertRowid as number)!;
}

// Name and avatar are the only self-editable profile fields — email and
// password go through their own dedicated, more careful flows (change
// password needs the current password; changing email isn't built yet).
// The boolean notification-preference columns — looped over generically
// in updateUserProfile below instead of six near-identical if-blocks.
const NOTIFICATION_PREF_FIELDS = [
  'notify_watchlist_moves', 'notify_new_artists', 'notify_founding_believer',
  'notify_portfolio_milestones', 'notify_leaderboard_rank', 'email_notifications_enabled',
] as const;
type NotificationPrefField = (typeof NOTIFICATION_PREF_FIELDS)[number];

export function updateUserProfile(
  userId: number,
  input: { name?: string; avatar_url?: string | null; show_positions_publicly?: boolean } & Partial<Record<NotificationPrefField, boolean>>
): User | undefined {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id: userId };
  if (input.name != null) {
    sets.push('name = @name');
    params.name = input.name;
  }
  if ('avatar_url' in input) {
    sets.push('avatar_url = @avatar_url');
    params.avatar_url = input.avatar_url || null;
  }
  if (input.show_positions_publicly != null) {
    sets.push('show_positions_publicly = @show_positions_publicly');
    params.show_positions_publicly = input.show_positions_publicly ? 1 : 0;
  }
  for (const field of NOTIFICATION_PREF_FIELDS) {
    if (input[field] != null) {
      sets.push(`${field} = @${field}`);
      params[field] = input[field] ? 1 : 0;
    }
  }
  if (sets.length === 0) return getUserById(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getUserById(userId);
}

export function updateUserPasswordHash(userId: number, password_hash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, userId);
}

// The notification center's read/dismiss state — see the notification_reads
// table comment. All computed notification content lives in
// lib/notifications.ts; this file only ever stores/reads the key.
export function getReadNotificationKeys(userId: number): Set<string> {
  const rows = db.prepare('SELECT notification_key FROM notification_reads WHERE user_id = ?').all(userId) as { notification_key: string }[];
  return new Set(rows.map((r) => r.notification_key));
}

export function markNotificationRead(userId: number, key: string): void {
  db.prepare('INSERT OR IGNORE INTO notification_reads (user_id, notification_key, created_at) VALUES (?, ?, ?)')
    .run(userId, key, new Date().toISOString());
}

export function markNotificationsRead(userId: number, keys: string[]): void {
  const insert = db.prepare('INSERT OR IGNORE INTO notification_reads (user_id, notification_key, created_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  db.transaction(() => { for (const key of keys) insert.run(userId, key, now); })();
}

// A cursor, not a send-log: "everything at or before this timestamp has
// already been emailed." Simpler than tracking per-notification send state,
// and sufficient since email is a digest of what's new, not a guaranteed
// per-item delivery record.
export function setNotificationsEmailedThrough(userId: number, iso: string): void {
  db.prepare('UPDATE users SET notifications_emailed_through = ? WHERE id = ?').run(iso, userId);
}

// Idempotent — verifying an already-verified email is a harmless no-op,
// not an error (a user clicking an old email link twice shouldn't see one).
export function markEmailVerified(userId: number): User | undefined {
  db.prepare('UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ?').run(new Date().toISOString(), userId);
  return getUserById(userId);
}

// Every table that stores a user's own NEXT activity (holdings,
// transactions, founding-believer records, watchlist) is ON DELETE CASCADE;
// Scout-side attribution (created_by, reviewed_by) is ON DELETE SET NULL,
// so a deleted user's Scout history stays intact but anonymized. A plain
// DELETE here is safe as-is — see the FK definitions above.
export function deleteUser(userId: number): void {
  db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

export function getUserByEmail(email: string): (User & { password_hash: string }) | undefined {
  const row = db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .get(email.toLowerCase()) as (User & { password_hash: string }) | undefined;
  return row && normalizeUser(row);
}

// The casual, no-new-infrastructure half of "prevent self-created duplicate
// accounts" — catches the most common trivial-alias trick (Gmail's
// dot-insensitivity and the universal +tag convention most providers
// support), not a real identity check. Someone determined enough to use an
// entirely different mailbox is still outside what an email address alone
// can ever prove; real device/IP-based duplicate detection would need new
// instrumentation this app doesn't collect today.
export function normalizeEmailForDuplicateCheck(email: string): string {
  const lower = email.trim().toLowerCase();
  const [local, domain] = lower.split('@');
  if (!domain) return lower;
  const noTag = local.split('+')[0];
  const isGmail = domain === 'gmail.com' || domain === 'googlemail.com';
  return `${isGmail ? noTag.replace(/\./g, '') : noTag}@${domain}`;
}

// Scans every existing account for one whose email normalizes to the same
// address — see normalizeEmailForDuplicateCheck. A full-table scan, same
// tradeoff getScoutLeaderboard's getAllUsers().map() already makes at this
// app's current scale; there's no index to build this against since it's
// not a stored column, just a signup-time check.
export function findUserByNormalizedEmail(email: string): User | undefined {
  const target = normalizeEmailForDuplicateCheck(email);
  return getAllUsers().find((u) => normalizeEmailForDuplicateCheck(u.email) === target);
}

export function getUserById(id: number): User | undefined {
  const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as User | undefined;
  return row && normalizeUser(row);
}

// Batch actor-name lookup for NEXT Feed — a page of feed_events can name a
// handful of distinct actors (early_discovery submitters, founding-believer
// sharers), and this resolves all of them in one query instead of one
// getUserById call per event.
export function getUsersByIds(ids: number[]): Map<number, User> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id IN (${placeholders})`).all(...unique) as User[];
  return new Map(rows.map((r) => [r.id, normalizeUser(r)]));
}

// Server-only, used solely by the change-password route to verify the
// caller's current password before accepting a new one — never exposed on
// the public User type.
export function getUserPasswordHash(id: number): string | undefined {
  return (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as { password_hash: string } | undefined)?.password_hash;
}

export function getAllUsers(): User[] {
  return (db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC`).all() as User[]).map(normalizeUser);
}

// The only way a user's role changes after signup — called by an admin-only
// route, or by the ADMIN_EMAILS bootstrap. Never reachable from a public
// user's own account settings.
export function setUserRole(userId: number, role: Role): User | undefined {
  const info = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
  if (info.changes === 0) return undefined;
  return getUserById(userId);
}

// Marks the first-login NEXT walkthrough as seen. Idempotent by design —
// once set, it's never cleared or re-triggered automatically, so a user
// only ever sees the full walkthrough once (contextual InfoTips are how
// they get reminded of what a term means after that).
export function completeNextOnboarding(userId: number): User | undefined {
  const info = db.prepare('UPDATE users SET next_onboarded_at = ? WHERE id = ? AND next_onboarded_at IS NULL').run(new Date().toISOString(), userId);
  // Only a genuine first completion (the WHERE guard actually matched)
  // counts as the analytics event — a client retrying this idempotent call
  // shouldn't inflate the funnel.
  if (info.changes > 0) logEvent(userId, 'onboarding_completed');
  return getUserById(userId);
}

const AGREEMENT_SELECT = `
  SELECT agreements.*, users.name AS created_by_name
  FROM agreements
  LEFT JOIN users ON users.id = agreements.created_by
`;

export function getAgreements(artistId: number): Agreement[] {
  return db
    .prepare(`${AGREEMENT_SELECT} WHERE agreements.artist_id = ? ORDER BY agreements.created_at DESC`)
    .all(artistId) as Agreement[];
}

export function getAgreement(artistId: number, agreementId: number): Agreement | undefined {
  return db
    .prepare(`${AGREEMENT_SELECT} WHERE agreements.artist_id = ? AND agreements.id = ?`)
    .get(artistId, agreementId) as Agreement | undefined;
}

const AGREEMENT_WRITABLE_FIELDS = [
  'type', 'status', 'start_date', 'end_date', 'commission_pct',
  'sponsorship_commission_pct', 'touring_commission_pct', 'masters_owned_by',
  'investment_amount_cents', 'notes',
] as const;

export function createAgreement(artistId: number, input: AgreementInput, actor?: Actor | null): Agreement {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    artist_id: artistId,
    created_at: now,
    updated_at: now,
    created_by: actor?.id ?? null,
    status: input.status ?? 'draft',
  };
  for (const field of AGREEMENT_WRITABLE_FIELDS) {
    if (field === 'status') continue;
    row[field] = (input as any)[field] ?? null;
  }
  const columns = ['artist_id', 'created_at', 'updated_at', 'created_by', ...AGREEMENT_WRITABLE_FIELDS];
  const placeholders = columns.map((c) => `@${c}`).join(', ');
  const info = db
    .prepare(`INSERT INTO agreements (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(row);
  return getAgreement(artistId, info.lastInsertRowid as number)!;
}

export function updateAgreement(artistId: number, agreementId: number, input: AgreementInput): Agreement | undefined {
  if (!getAgreement(artistId, agreementId)) return undefined;
  const now = new Date().toISOString();
  const sets: string[] = [];
  const row: Record<string, unknown> = { id: agreementId, updated_at: now };
  for (const field of AGREEMENT_WRITABLE_FIELDS) {
    if (field in input) {
      sets.push(`${field} = @${field}`);
      row[field] = (input as any)[field];
    }
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE agreements SET updated_at = @updated_at, ${sets.join(', ')} WHERE id = @id`).run(row);
  }
  return getAgreement(artistId, agreementId);
}

export function deleteAgreement(artistId: number, agreementId: number): boolean {
  const info = db
    .prepare('DELETE FROM agreements WHERE id = ? AND artist_id = ?')
    .run(agreementId, artistId);
  return info.changes > 0;
}

const REVENUE_SELECT = `
  SELECT revenue_entries.*, users.name AS created_by_name
  FROM revenue_entries
  LEFT JOIN users ON users.id = revenue_entries.created_by
`;

export function getRevenueEntries(artistId: number): RevenueEntry[] {
  return db
    .prepare(`${REVENUE_SELECT} WHERE revenue_entries.artist_id = ? ORDER BY revenue_entries.recorded_at DESC`)
    .all(artistId) as RevenueEntry[];
}

// sponsorship_commission_pct / touring_commission_pct only need to be set
// when they differ from the agreement's default commission_pct — e.g. "15%
// standard, but 0% on touring." Unset (null) falls back to the default.
function resolveCommissionPct(agreement: Agreement | undefined, source: RevenueSource): number | null {
  if (!agreement) return null;
  if (source === 'sponsorship' && agreement.sponsorship_commission_pct != null) {
    return agreement.sponsorship_commission_pct;
  }
  if (source === 'shows' && agreement.touring_commission_pct != null) {
    return agreement.touring_commission_pct;
  }
  return agreement.commission_pct ?? null;
}

export function createRevenueEntry(artistId: number, input: RevenueEntryInput, actor?: Actor | null): RevenueEntry {
  const now = new Date().toISOString();
  const agreement = input.agreement_id ? getAgreement(artistId, input.agreement_id) : undefined;
  const commissionPct = resolveCommissionPct(agreement, input.source);
  const commissionCents = commissionPct != null
    ? Math.round(input.gross_amount_cents * (commissionPct / 100))
    : null;

  const info = db.prepare(`
    INSERT INTO revenue_entries (
      artist_id, agreement_id, created_at, recorded_at, source,
      gross_amount_cents, commission_pct_applied, commission_amount_cents, notes, created_by
    ) VALUES (
      @artist_id, @agreement_id, @created_at, @recorded_at, @source,
      @gross_amount_cents, @commission_pct_applied, @commission_amount_cents, @notes, @created_by
    )
  `).run({
    artist_id: artistId,
    agreement_id: input.agreement_id ?? null,
    created_at: now,
    recorded_at: input.recorded_at,
    source: input.source,
    gross_amount_cents: input.gross_amount_cents,
    commission_pct_applied: commissionPct,
    commission_amount_cents: commissionCents,
    notes: input.notes ?? null,
    created_by: actor?.id ?? null,
  });
  return db
    .prepare(`${REVENUE_SELECT} WHERE revenue_entries.id = ?`)
    .get(info.lastInsertRowid) as RevenueEntry;
}

export function deleteRevenueEntry(artistId: number, revenueId: number): boolean {
  const info = db
    .prepare('DELETE FROM revenue_entries WHERE id = ? AND artist_id = ?')
    .run(revenueId, artistId);
  return info.changes > 0;
}

const INVESTMENT_SELECT = `
  SELECT investment_entries.*, users.name AS created_by_name
  FROM investment_entries
  LEFT JOIN users ON users.id = investment_entries.created_by
`;

export function getInvestmentEntries(artistId: number): InvestmentEntry[] {
  return db
    .prepare(`${INVESTMENT_SELECT} WHERE investment_entries.artist_id = ? ORDER BY investment_entries.recorded_at DESC`)
    .all(artistId) as InvestmentEntry[];
}

export function createInvestmentEntry(artistId: number, input: InvestmentEntryInput, actor?: Actor | null): InvestmentEntry {
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO investment_entries (
      artist_id, agreement_id, created_at, recorded_at, category, amount_cents, notes, created_by
    ) VALUES (
      @artist_id, @agreement_id, @created_at, @recorded_at, @category, @amount_cents, @notes, @created_by
    )
  `).run({
    artist_id: artistId,
    agreement_id: input.agreement_id ?? null,
    created_at: now,
    recorded_at: input.recorded_at,
    category: input.category,
    amount_cents: input.amount_cents,
    notes: input.notes ?? null,
    created_by: actor?.id ?? null,
  });
  return db
    .prepare(`${INVESTMENT_SELECT} WHERE investment_entries.id = ?`)
    .get(info.lastInsertRowid) as InvestmentEntry;
}

export function deleteInvestmentEntry(artistId: number, investmentId: number): boolean {
  const info = db
    .prepare('DELETE FROM investment_entries WHERE id = ? AND artist_id = ?')
    .run(investmentId, artistId);
  return info.changes > 0;
}

export type PortfolioRow = {
  artist: Artist;
  score: number;
  scoreHistory: { recorded_at: string; breakout_score: number }[];
  changeAbs: number;
  changePct: number | null;
  hasComparison: boolean;
  totalInvestedCents: number;
  totalGrossCents: number;
  totalCommissionCents: number;
  roiPct: number | null;
};

// One row per tracked artist: current Breakout Score, its trend since the
// previous snapshot, and money in/out — the "stock screener" view across
// the whole roster instead of one artist at a time.
export function getPortfolioSummary(): PortfolioRow[] {
  const artists = getAllArtists();

  const historyRows = db
    .prepare('SELECT artist_id, recorded_at, breakout_score FROM score_history ORDER BY recorded_at ASC')
    .all() as { artist_id: number; recorded_at: string; breakout_score: number }[];
  const historyByArtist = new Map<number, { recorded_at: string; breakout_score: number }[]>();
  for (const row of historyRows) {
    const list = historyByArtist.get(row.artist_id) ?? [];
    list.push({ recorded_at: row.recorded_at, breakout_score: row.breakout_score });
    historyByArtist.set(row.artist_id, list);
  }

  // Actual categorized spend (marketing/studio/video/etc), not the
  // agreement's negotiated investment_amount_cents ceiling — this is what
  // ROI is measured against.
  const investedRows = db
    .prepare('SELECT artist_id, SUM(amount_cents) as total FROM investment_entries GROUP BY artist_id')
    .all() as { artist_id: number; total: number }[];
  const investedByArtist = new Map(investedRows.map((r) => [r.artist_id, r.total]));

  const revenueRows = db
    .prepare('SELECT artist_id, SUM(commission_amount_cents) as commission, SUM(gross_amount_cents) as gross FROM revenue_entries GROUP BY artist_id')
    .all() as { artist_id: number; commission: number | null; gross: number }[];
  const revenueByArtist = new Map(revenueRows.map((r) => [r.artist_id, r]));

  return artists.map((artist) => {
    const history = historyByArtist.get(artist.id) ?? [];
    const score = breakoutScore(artist);
    const previousScore = history.length >= 2 ? history[history.length - 2].breakout_score : null;
    const hasComparison = previousScore != null;
    const changeAbs = hasComparison ? Math.round((score - previousScore!) * 10) / 10 : 0;
    const changePct = hasComparison && previousScore !== 0
      ? Math.round((changeAbs / previousScore!) * 1000) / 10
      : null;
    const revenue = revenueByArtist.get(artist.id);
    const totalInvestedCents = investedByArtist.get(artist.id) ?? 0;
    const totalCommissionCents = revenue?.commission ?? 0;
    const roiPct = totalInvestedCents > 0
      ? Math.round(((totalCommissionCents - totalInvestedCents) / totalInvestedCents) * 1000) / 10
      : null;
    return {
      artist,
      score,
      scoreHistory: history,
      changeAbs,
      changePct,
      hasComparison,
      totalInvestedCents,
      totalGrossCents: revenue?.gross ?? 0,
      totalCommissionCents,
      roiPct,
    };
  });
}

// --- NEXT (public paper-trading product) ---

// Lazily sets an artist's starting NEXT Price the first time it's needed
// (from the score-based formula in lib/next-market), then leaves it alone —
// after that, price only moves via trades. Self-healing: works whether the
// artist was created before or after NEXT existed.
function ensureNextPrice(artist: Artist): number {
  if (artist.next_current_price_cents != null) return artist.next_current_price_cents;
  const price = nextBasePriceCents(breakoutScore(artist));
  db.prepare('UPDATE artists SET next_current_price_cents = ? WHERE id = ?').run(price, artist.id);
  db.prepare('INSERT INTO next_price_history (artist_id, recorded_at, price_cents) VALUES (?, ?, ?)')
    .run(artist.id, new Date().toISOString(), price);
  return price;
}

function getNextPriceHistory(artistId: number): NextPricePoint[] {
  return db
    .prepare('SELECT recorded_at, price_cents FROM next_price_history WHERE artist_id = ? ORDER BY recorded_at ASC')
    .all(artistId) as NextPricePoint[];
}

// Returns Public NEXT's market rows — every artist row's own `.artist` is
// already narrowed to PublicArtist (see toPublicArtist/lib/public-artist.ts)
// before it leaves this function, since this is the data that gets passed
// straight into 'use client' components (ArtistCard, DiscoverGrid,
// FeaturedArtist, FeedCard) and serialized into the page's RSC payload.
// Server-only code that needs a raw Artist field (stage, Scout notes, the
// raw ScoreInputs categories, soundcharts_uuid, claimed_by_user_id, etc)
// must fetch it separately via getArtist()/getAllArtists() — never widen
// this function's return type to route around that.
export function getNextMarket(): NextMarketRow[] {
  return getAllArtists()
    .filter((a) => a.stage !== 'passed')
    .map((artist) => ({
      artist: toPublicArtist(artist),
      score: breakoutScore(artist),
      priceCents: ensureNextPrice(artist),
      priceHistory: getNextPriceHistory(artist.id),
    }));
}

// Batch sibling of getNextArtist — NEXT Feed needs live score/price context
// for a page of feed_events, which typically names far fewer distinct
// artists than the full roster getNextMarket() would load. One IN query
// for the artists themselves rather than N calls to getArtist. Same public
// projection as getNextMarket() above — see its comment.
export function getNextArtistsByIds(ids: number[]): Map<number, NextMarketRow> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`${ARTIST_SELECT} WHERE artists.id IN (${placeholders})`).all(...unique) as Artist[];
  return new Map(
    rows.map((artist) => [
      artist.id,
      { artist: toPublicArtist(artist), score: breakoutScore(artist), priceCents: ensureNextPrice(artist), priceHistory: getNextPriceHistory(artist.id) },
    ])
  );
}

// The "listen" half of NEXT's music experience — see the preview_listens
// table comment. 'started' logs every time playback begins (a replay
// counts again — "every listen event," not "every unique listener").
export function recordPreviewListen(userId: number, artistId: number, event: 'started' | 'completed'): void {
  db.prepare('INSERT INTO preview_listens (user_id, artist_id, event, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, artistId, event, new Date().toISOString());
}

// Used by executeTrade to stamp "did this trader listen before backing
// this artist" onto the buy transaction — any 'started' event for this
// user+artist recorded before this call is a real prior listen.
export function hasListenedToArtist(userId: number, artistId: number): boolean {
  const row = db.prepare("SELECT 1 FROM preview_listens WHERE user_id = ? AND artist_id = ? AND event = 'started' LIMIT 1").get(userId, artistId);
  return row != null;
}

// Global counts, not scoped to one user — powers Discover's "Most watched"
// / "Most backed" sorts. One GROUP BY each rather than a per-artist query,
// so sorting the whole market by either costs 2 queries total, not 2*N.
export function getWatchCountsByArtist(): Record<number, number> {
  const rows = db.prepare('SELECT artist_id, COUNT(*) AS c FROM next_watchlist GROUP BY artist_id').all() as { artist_id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.artist_id, r.c]));
}

// "Backed" means currently holding shares (shares > 0) — someone who sold
// out entirely no longer counts, same as how the Trade panel's own
// "Shares owned" would read 0 for them.
export function getBackerCountsByArtist(): Record<number, number> {
  const rows = db
    .prepare('SELECT artist_id, COUNT(DISTINCT user_id) AS c FROM next_holdings WHERE shares > 0 GROUP BY artist_id')
    .all() as { artist_id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.artist_id, r.c]));
}

// Same public projection as getNextMarket() above (see its comment) — a
// server component that needs raw Artist fields alongside this (e.g. the
// claim-owner check or scoreContributors() on Artist Detail) should call
// getArtist(artistId) itself for those, not expect this function to widen.
export function getNextArtist(artistId: number): NextMarketRow | undefined {
  const artist = getArtist(artistId);
  if (!artist) return undefined;
  return {
    artist: toPublicArtist(artist),
    score: breakoutScore(artist),
    priceCents: ensureNextPrice(artist),
    priceHistory: getNextPriceHistory(artistId),
  };
}

export function getHolding(userId: number, artistId: number): NextHolding | undefined {
  return db
    .prepare('SELECT * FROM next_holdings WHERE user_id = ? AND artist_id = ?')
    .get(userId, artistId) as NextHolding | undefined;
}

export function getUserHoldings(
  userId: number
): (NextHolding & { artist_name: string; artist_photo_url?: string; price_cents: number; exitValueCents: number })[] {
  const rows = db.prepare(`
    SELECT next_holdings.*, artists.name AS artist_name, artists.photo_url AS artist_photo_url
    FROM next_holdings
    JOIN artists ON artists.id = next_holdings.artist_id
    WHERE next_holdings.user_id = ? AND next_holdings.shares > 0
    ORDER BY next_holdings.updated_at DESC
  `).all(userId) as (NextHolding & { artist_name: string; artist_photo_url?: string })[];
  return rows.map((row) => {
    const artist = getArtist(row.artist_id)!;
    const priceCents = ensureNextPrice(artist);
    // The position's realistic exit value — what selling the WHOLE holding
    // right now would actually net (see quoteSell's own comment). This,
    // not shares * priceCents, is what "unrealized P&L" should be measured
    // against: priceCents already includes any impact this same trader's
    // own last buy caused, which a sell of comparable size mostly reverses.
    const exitValueCents = quoteSell(priceCents, row.shares).proceedsCents;
    return { ...row, price_cents: priceCents, exitValueCents };
  });
}

// A bookmark with no credits spent — tracking an artist without owning
// shares. Deliberately separate from next_holdings: watching and backing
// are different actions, and an artist can be watched with zero position.
export function isWatchlisted(userId: number, artistId: number): boolean {
  return db.prepare('SELECT 1 FROM next_watchlist WHERE user_id = ? AND artist_id = ?').get(userId, artistId) != null;
}

export function addToWatchlist(userId: number, artistId: number): void {
  db.prepare('INSERT OR IGNORE INTO next_watchlist (user_id, artist_id, created_at) VALUES (?, ?, ?)')
    .run(userId, artistId, new Date().toISOString());
}

export function removeFromWatchlist(userId: number, artistId: number): void {
  db.prepare('DELETE FROM next_watchlist WHERE user_id = ? AND artist_id = ?').run(userId, artistId);
}

export function setWatchlistAlerts(userId: number, artistId: number, enabled: boolean): void {
  db.prepare('UPDATE next_watchlist SET alerts_enabled = ? WHERE user_id = ? AND artist_id = ?')
    .run(enabled ? 1 : 0, userId, artistId);
}

// Finds the most recent value at or before `at` from a series ordered
// oldest-first, falling back to the earliest ever recorded when everything
// on record postdates `at` (watched right as the first snapshot/price point
// landed) — the closest available reference rather than no comparison at
// all. Null only when the series is completely empty.
export function valueAtOrBefore<T>(series: T[], at: string, recordedAt: (item: T) => string): T | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (recordedAt(series[i]) <= at) return series[i];
  }
  return series[0] ?? null;
}

// Every artist the user is tracking, plus what changed since they added
// it: Score and Price as of the watch date, alongside where both stand
// now (row.score / row.priceCents already carry "now"). Powers the
// Watchlist page's "since you added" line and its alert highlighting.
export function getUserWatchlist(userId: number): WatchlistEntry[] {
  const watches = db
    .prepare('SELECT artist_id, created_at, alerts_enabled FROM next_watchlist WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as { artist_id: number; created_at: string; alerts_enabled: number }[];

  const entries: WatchlistEntry[] = [];
  for (const w of watches) {
    const market = getNextArtist(w.artist_id);
    if (!market) continue;
    const scoreSnapshot = valueAtOrBefore(getScoreHistory(w.artist_id), w.created_at, (s) => s.recorded_at);
    const pricePoint = valueAtOrBefore(market.priceHistory, w.created_at, (p) => p.recorded_at);
    entries.push({
      ...market,
      watchedAt: w.created_at,
      alertsEnabled: w.alerts_enabled === 1,
      scoreAtWatch: scoreSnapshot?.breakout_score ?? null,
      priceAtWatchCents: pricePoint?.price_cents ?? null,
    });
  }
  return entries;
}

// Cheap id-only lookup for pages that just need to know which cards to mark
// as watched (Discover, Artist Detail) without loading full market rows.
export function getWatchlistArtistIds(userId: number): number[] {
  const rows = db.prepare('SELECT artist_id FROM next_watchlist WHERE user_id = ? ORDER BY created_at DESC').all(userId) as { artist_id: number }[];
  return rows.map((r) => r.artist_id);
}

// The "backed" counterpart to getWatchlistArtistIds above — id-only, for
// NEXT Feed's Following tab (watched OR backed both count as "following").
// Currently holding shares, same definition getBackerCountsByArtist uses.
export function getBackedArtistIds(userId: number): number[] {
  const rows = db.prepare('SELECT artist_id FROM next_holdings WHERE user_id = ? AND shares > 0').all(userId) as { artist_id: number }[];
  return rows.map((r) => r.artist_id);
}

// Score movement since the previous snapshot, for every artist that has
// one — one query for the whole roster (see getWatchCountsByArtist /
// getBackerCountsByArtist above for the same pattern) rather than N+1.
// Same definition the internal Screener uses for "momentum" already
// (getPortfolioSummary's changeAbs/hasComparison).
export function getScoreChanges(): Record<number, ScoreChange> {
  const rows = db
    .prepare('SELECT artist_id, breakout_score FROM score_history ORDER BY recorded_at ASC')
    .all() as { artist_id: number; breakout_score: number }[];
  const byArtist = new Map<number, number[]>();
  for (const row of rows) {
    const list = byArtist.get(row.artist_id) ?? [];
    list.push(row.breakout_score);
    byArtist.set(row.artist_id, list);
  }
  const result: Record<number, ScoreChange> = {};
  for (const [artistId, scores] of byArtist) {
    if (scores.length < 2) continue;
    const changeAbs = Math.round((scores[scores.length - 1] - scores[scores.length - 2]) * 10) / 10;
    result[artistId] = { changeAbs, hasComparison: true };
  }
  return result;
}

// Records a permanent "you were early" snapshot the first time a user ever
// buys into an artist. UNIQUE(user_id, artist_id) makes this idempotent —
// safe to call on every buy — and the row is never updated or deleted after
// insert, including when the position is later sold down to zero.
function recordFoundingBelieverIfFirstBuy(userId: number, artistId: number, artist: Artist, score: number, priceCents: number, now: string) {
  const { rank } = db.prepare('SELECT COUNT(*) AS rank FROM next_founding_believers WHERE artist_id = ?').get(artistId) as { rank: number };
  db.prepare(`
    INSERT OR IGNORE INTO next_founding_believers
      (user_id, artist_id, purchased_at, followers_count, monthly_listeners, next_score, next_price_cents, discovery_rank)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, artistId, now, artist.followers_count ?? null, artist.monthly_listeners ?? null, score, priceCents, rank + 1);
}

export function getFoundingBelieverRecord(userId: number, artistId: number): FoundingBelieverRecord | undefined {
  return db
    .prepare('SELECT * FROM next_founding_believers WHERE user_id = ? AND artist_id = ?')
    .get(userId, artistId) as FoundingBelieverRecord | undefined;
}

// Single-row lookup by id — NEXT Feed's founding_believer_share events
// point at one via ref_id and need its tier/rank to render the card.
export function getFoundingBelieverRecordById(id: number): FoundingBelieverRecord | undefined {
  return db.prepare('SELECT * FROM next_founding_believers WHERE id = ?').get(id) as FoundingBelieverRecord | undefined;
}

// A user deliberately choosing to post their own collectible into the Feed
// — never automatic (see the FeedEvent type's comment: the spec is
// explicit that a card is never auto-posted just for existing). No
// metadata snapshot needed here at all: the referenced
// next_founding_believers row already permanently holds the "at time of
// backing" numbers (follower count, score, price, rank) a render would
// need — this event is purely a pointer plus a timestamp. dedupe_key
// allows one share per collectible per calendar day, so a doubled network
// request or an accidental double-tap can't post it twice, while a
// genuine re-share later (a real use case — "still proud of this one") stays possible.
export function shareFoundingBelieverToFeed(userId: number, artistId: number): FeedEvent | null {
  const record = getFoundingBelieverRecord(userId, artistId);
  if (!record) return null;
  const today = new Date().toISOString().slice(0, 10);
  return createFeedEvent({
    eventType: 'founding_believer_share',
    actorUserId: userId,
    artistId,
    refType: 'founding_believer',
    refId: record.id,
    dedupeKey: `founding_believer_share:${record.id}:${today}`,
  });
}

export function getUserTransactions(userId: number, limit = 50): (NextTransaction & { artist_name: string })[] {
  const rows = db.prepare(`
    SELECT next_transactions.*, artists.name AS artist_name
    FROM next_transactions
    JOIN artists ON artists.id = next_transactions.artist_id
    WHERE next_transactions.user_id = ?
    ORDER BY next_transactions.created_at DESC
    LIMIT ?
  `).all(userId, limit) as (Omit<NextTransaction, 'listened_before_buy'> & { artist_name: string; listened_before_buy: number | null })[];
  // SQLite has no boolean type — normalize the raw 0/1/null into the
  // boolean|undefined the NextTransaction type promises (undefined for
  // sells, where the column is never set, not a false "no" claim about
  // something that was never tracked for that row).
  return rows.map((r) => ({ ...r, listened_before_buy: r.type === 'buy' ? Boolean(r.listened_before_buy) : undefined }));
}

// "Volume" for the Trading panel's market-volume stat — total notional
// traded (both buys and sells, both count) in the window. credits_delta_cents
// is negative for a buy (credits spent) and positive for a sell (credits
// received); the absolute value of each is that trade's real dollar size.
export function getArtistTradeVolumeCents(artistId: number, hours: number): number {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare('SELECT COALESCE(SUM(ABS(credits_delta_cents)), 0) AS volume FROM next_transactions WHERE artist_id = ? AND created_at >= ?')
    .get(artistId, cutoff) as { volume: number };
  return row.volume;
}

// Distinct traders who backed (bought) this artist within the window —
// "number of people who backed the artist recently." Deliberately counts
// anyone who bought, not just first-time buyers — a repeat backer adding
// to their position is still real recent activity.
export function getRecentBackerCount(artistId: number, hours: number): number {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare("SELECT COUNT(DISTINCT user_id) AS c FROM next_transactions WHERE artist_id = ? AND type = 'buy' AND created_at >= ?")
    .get(artistId, cutoff) as { c: number };
  return row.c;
}

export type RecentTrade = {
  user_name: string;
  type: NextTransactionType;
  shares: number;
  credits_delta_cents: number;
  created_at: string;
};

// The Trading panel's "recent activity" feed — every trader's activity on
// this one artist, most recent first. Public by the same convention the
// Leaderboard already uses (a trader's chosen display name and portfolio
// figures are visible there too) — nothing here is more sensitive than
// that.
export function getRecentTradesForArtist(artistId: number, limit = 8): RecentTrade[] {
  return db
    .prepare(`
      SELECT users.name AS user_name, next_transactions.type, next_transactions.shares,
             next_transactions.credits_delta_cents, next_transactions.created_at
      FROM next_transactions
      JOIN users ON users.id = next_transactions.user_id
      WHERE next_transactions.artist_id = ?
      ORDER BY next_transactions.created_at DESC, next_transactions.id DESC
      LIMIT ?
    `)
    .all(artistId, limit) as RecentTrade[];
}

export type MarketTrade = RecentTrade & { artist_id: number; artist_name: string };

// The market-wide version of getRecentTradesForArtist — every trader's
// activity across every artist, most recent first. Powers the Market
// Activity feed; same public-by-precedent convention as the per-artist
// feed above.
export function getRecentMarketTrades(limit = 30): MarketTrade[] {
  return db
    .prepare(`
      SELECT users.name AS user_name, artists.id AS artist_id, artists.name AS artist_name,
             next_transactions.type, next_transactions.shares, next_transactions.credits_delta_cents,
             next_transactions.created_at
      FROM next_transactions
      JOIN users ON users.id = next_transactions.user_id
      JOIN artists ON artists.id = next_transactions.artist_id
      ORDER BY next_transactions.created_at DESC, next_transactions.id DESC
      LIMIT ?
    `)
    .all(limit) as MarketTrade[];
}

// "Market-wide total virtual volume" — same shape as
// getArtistTradeVolumeCents, just without the per-artist filter.
export function getMarketVolumeCents(hours: number): number {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare('SELECT COALESCE(SUM(ABS(credits_delta_cents)), 0) AS volume FROM next_transactions WHERE created_at >= ?')
    .get(cutoff) as { volume: number };
  return row.volume;
}

// "Recent buys" / "Recent sells" counts for the daily recap module.
export function getMarketTradeCounts(hours: number): { buys: number; sells: number } {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare("SELECT type, COUNT(*) AS c FROM next_transactions WHERE created_at >= ? GROUP BY type")
    .all(cutoff) as { type: NextTransactionType; c: number }[];
  const counts = { buys: 0, sells: 0 };
  for (const r of rows) counts[r.type === 'buy' ? 'buys' : 'sells'] = r.c;
  return counts;
}

export type ActiveArtist = { artist_id: number; artist_name: string; tradeCount: number };

// "Most active artists" — ranked by trade count within the window, one
// query for the whole roster (same pattern as getWatchCountsByArtist /
// getBackerCountsByArtist above).
export function getMostActiveArtists(hours: number, limit = 5): ActiveArtist[] {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  return db
    .prepare(`
      SELECT artists.id AS artist_id, artists.name AS artist_name, COUNT(*) AS tradeCount
      FROM next_transactions
      JOIN artists ON artists.id = next_transactions.artist_id
      WHERE next_transactions.created_at >= ?
      GROUP BY artists.id
      ORDER BY tradeCount DESC
      LIMIT ?
    `)
    .all(cutoff, limit) as ActiveArtist[];
}

// "Most backed today" — distinct buyers per artist within the window, for
// the whole roster in one query. The time-windowed sibling of
// getBackerCountsByArtist above (which is all-time and shares-based, not
// "recent activity" based).
export function getRecentBackerCountsByArtist(hours: number): Record<number, number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare("SELECT artist_id, COUNT(DISTINCT user_id) AS c FROM next_transactions WHERE type = 'buy' AND created_at >= ? GROUP BY artist_id")
    .all(cutoff) as { artist_id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.artist_id, r.c]));
}

// "Most watched today" — the time-windowed sibling of getWatchCountsByArtist.
export function getRecentWatchCountsByArtist(hours: number): Record<number, number> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare('SELECT artist_id, COUNT(*) AS c FROM next_watchlist WHERE created_at >= ? GROUP BY artist_id')
    .all(cutoff) as { artist_id: number; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.artist_id, r.c]));
}

// "New artists this week" — live NEXT artists (not passed) added recently,
// most recent first.
export function getNewArtistsThisWeek(days = 7): Artist[] {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  return getAllArtists()
    .filter((a) => a.stage !== 'passed' && a.created_at >= cutoff)
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1));
}

export type TradeResult =
  | { ok: true; shares: number; priceCents: number; newBalanceCents: number; realizedPnlCents?: number }
  | { ok: false; error: string };

// Both buy and sell take a NEXT Credits amount ("spend $X" / "sell $X
// worth") rather than a share count — simpler for a paper-trading UI, and
// symmetric in both directions. Average-cost method for P&L: cost_basis
// tracks total credits paid for the current position, so unrealized P&L is
// always (current value - cost_basis), and a partial sell reduces cost_basis
// proportionally to the shares sold.
export function executeTrade(
  userId: number,
  artistId: number,
  type: NextTransactionType,
  creditsAmountCents: number
): TradeResult {
  if (!Number.isFinite(creditsAmountCents) || creditsAmountCents <= 0) {
    return { ok: false, error: 'amount must be a positive number' };
  }
  const artist = getArtist(artistId);
  if (!artist) return { ok: false, error: 'artist not found' };
  const user = getUserById(userId);
  if (!user) return { ok: false, error: 'user not found' };

  const prePriceCents = ensureNextPrice(artist);
  const now = new Date().toISOString();

  if (type === 'buy') {
    if (creditsAmountCents > user.next_credits_cents) {
      return { ok: false, error: 'not enough NEXT Credits' };
    }
    // Impact is sized by the requested spend, same as the visible market
    // move; the trader's own fill price is the average of pre/post so that
    // impact isn't free money on an immediate resale (see executionPriceCents).
    const postPriceCents = applyTradeImpact(prePriceCents, creditsAmountCents, 'buy');
    const executionCents = executionPriceCents(prePriceCents, postPriceCents);
    const shares = creditsAmountCents / executionCents;
    const holding = getHolding(userId, artistId);
    const newShares = (holding?.shares ?? 0) + shares;
    const newCostBasis = (holding?.cost_basis_cents ?? 0) + creditsAmountCents;
    // Whatever the listen history says right up to this moment — "did this
    // trader ever hit play on this artist before backing them."
    const listenedBeforeBuy = hasListenedToArtist(userId, artistId) ? 1 : 0;

    // Prevent negative balances: the check above is a fast pre-check, but
    // the actual debit re-checks the balance atomically in the same
    // statement (`AND next_credits_cents >= ?`), inside the same
    // transaction as everything else. better-sqlite3 is synchronous and
    // this Node process is single-threaded, so a true interleaved race
    // between two calls to executeTrade can't happen today — but this
    // guard is what actually makes that a property of the code, not just
    // an accident of the current runtime, and it costs nothing to keep in
    // place if trade execution is ever moved off this single-process model.
    let insufficientAtDebit = false;
    const tx = db.transaction(() => {
      if (holding) {
        db.prepare('UPDATE next_holdings SET shares = ?, cost_basis_cents = ?, updated_at = ? WHERE id = ?')
          .run(newShares, newCostBasis, now, holding.id);
      } else {
        db.prepare('INSERT INTO next_holdings (user_id, artist_id, shares, cost_basis_cents, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(userId, artistId, newShares, newCostBasis, now);
      }
      const debit = db
        .prepare('UPDATE users SET next_credits_cents = next_credits_cents - ? WHERE id = ? AND next_credits_cents >= ?')
        .run(creditsAmountCents, userId, creditsAmountCents);
      if (debit.changes === 0) {
        insufficientAtDebit = true;
        throw new Error('insufficient balance at debit time'); // rolls back the whole transaction
      }
      db.prepare(`
        INSERT INTO next_transactions (user_id, artist_id, created_at, type, shares, price_cents_per_share, credits_delta_cents, listened_before_buy)
        VALUES (?, ?, ?, 'buy', ?, ?, ?, ?)
      `).run(userId, artistId, now, shares, executionCents, -creditsAmountCents, listenedBeforeBuy);

      db.prepare('UPDATE artists SET next_current_price_cents = ? WHERE id = ?').run(postPriceCents, artistId);
      db.prepare('INSERT INTO next_price_history (artist_id, recorded_at, price_cents) VALUES (?, ?, ?)').run(artistId, now, postPriceCents);

      recordFoundingBelieverIfFirstBuy(userId, artistId, artist, breakoutScore(artist), executionCents, now);
    });
    try {
      tx();
    } catch (err) {
      if (insufficientAtDebit) return { ok: false, error: 'not enough NEXT Credits' };
      throw err;
    }

    return { ok: true, shares, priceCents: executionCents, newBalanceCents: user.next_credits_cents - creditsAmountCents };
  }

  // sell
  const holding = getHolding(userId, artistId);
  const ownedShares = holding?.shares ?? 0;
  if (!holding || ownedShares <= 0) return { ok: false, error: "you don't own any shares of this artist" };

  const requestedShares = creditsAmountCents / prePriceCents;
  // Size impact by what's actually being sold, not the originally requested
  // amount — matters when the request gets capped by ownedShares. quoteSell
  // is the same math used to mark a still-held position's realistic exit
  // value (see its own comment) — one formula, so the two can never drift.
  const sharesSold = Math.min(requestedShares, ownedShares);
  const { postPriceCents, executionCents, proceedsCents } = quoteSell(prePriceCents, sharesSold);
  const avgCostPerShareCents = holding.cost_basis_cents / ownedShares;
  const costBasisSold = avgCostPerShareCents * sharesSold;
  const realizedPnlCents = Math.round(proceedsCents - costBasisSold);
  const remainingShares = ownedShares - sharesSold;
  const remainingCostBasis = Math.round(holding.cost_basis_cents - costBasisSold);

  const tx = db.transaction(() => {
    if (remainingShares < 0.0001) {
      db.prepare('DELETE FROM next_holdings WHERE id = ?').run(holding.id);
    } else {
      db.prepare('UPDATE next_holdings SET shares = ?, cost_basis_cents = ?, updated_at = ? WHERE id = ?')
        .run(remainingShares, remainingCostBasis, now, holding.id);
    }
    db.prepare('UPDATE users SET next_credits_cents = next_credits_cents + ? WHERE id = ?')
      .run(proceedsCents, userId);
    db.prepare(`
      INSERT INTO next_transactions (user_id, artist_id, created_at, type, shares, price_cents_per_share, credits_delta_cents, realized_pnl_cents)
      VALUES (?, ?, ?, 'sell', ?, ?, ?, ?)
    `).run(userId, artistId, now, sharesSold, executionCents, proceedsCents, realizedPnlCents);

    db.prepare('UPDATE artists SET next_current_price_cents = ? WHERE id = ?').run(postPriceCents, artistId);
    db.prepare('INSERT INTO next_price_history (artist_id, recorded_at, price_cents) VALUES (?, ?, ?)').run(artistId, now, postPriceCents);
  });
  tx();

  return {
    ok: true,
    shares: sharesSold,
    priceCents: executionCents,
    newBalanceCents: user.next_credits_cents + proceedsCents,
    realizedPnlCents,
  };
}

// Anti-spam on trading itself — a generous cap, not a serious abuse
// defense (see lib/market-integrity.ts for the behavioral pattern
// detection that actually targets manipulation). This just stops one
// account from hammering the endpoint faster than any real person trades.
export const TRADE_RATE_LIMIT_PER_MINUTE = 20;

export function getRecentTradeCount(userId: number, minutes: number): number {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM next_transactions WHERE user_id = ? AND created_at >= ?')
    .get(userId, cutoff) as { c: number };
  return row.c;
}

// Trade idempotency — see trade_idempotency_keys' own comment in the DDL
// above. The route checks getStoredTradeResponse BEFORE calling
// executeTrade at all; a hit means this exact client-generated key was
// already processed, so the route replays the stored response instead of
// trading a second time. storeTradeResponse is called after either a
// successful or a rejected trade — a rejection (e.g. "not enough NEXT
// Credits") is just as worth deduplicating as a success, so a retried
// request doesn't re-run the (cheap but real) validation work either.
export function getStoredTradeResponse(userId: number, idempotencyKey: string): { status: number; body: unknown } | undefined {
  const row = db
    .prepare('SELECT status, response_json FROM trade_idempotency_keys WHERE user_id = ? AND idempotency_key = ?')
    .get(userId, idempotencyKey) as { status: number; response_json: string } | undefined;
  return row ? { status: row.status, body: JSON.parse(row.response_json) } : undefined;
}

export function storeTradeResponse(userId: number, idempotencyKey: string, status: number, body: unknown): void {
  try {
    db.prepare('INSERT INTO trade_idempotency_keys (user_id, idempotency_key, status, response_json, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, idempotencyKey, status, JSON.stringify(body), new Date().toISOString());
  } catch (err: any) {
    // A duplicate (user_id, idempotency_key) landing here means two
    // concurrent requests raced to store the same key — the first writer
    // wins and this one is a no-op, not an error the caller needs to see.
    if (!/UNIQUE/i.test(err?.message ?? '')) throw err;
  }
}

// Suspicious-trading review — see lib/market-integrity.ts's own header
// comment for what these flags do and don't mean. Pulls the whole trade
// history (small at this app's current scale — see the same tradeoff
// getScoutLeaderboard's getAllUsers().map() already makes) and enriches
// the pure detectors' raw ids with names for the admin page to render.
export function getSuspiciousTradingFlags(): SuspiciousTradingFlag[] {
  const transactions = db
    .prepare('SELECT user_id, artist_id, created_at FROM next_transactions ORDER BY created_at ASC')
    .all() as MarketTradeRow[];

  const flags = [...getRapidTradingFlags(transactions), ...getCoordinatedPairFlags(transactions)];
  if (flags.length === 0) return flags;

  const userIds = [...new Set(flags.flatMap((f) => f.userIds))];
  const artistIds = [...new Set(flags.map((f) => f.artistId).filter((id): id is number => id != null))];
  const userNamesById = new Map(userIds.map((id) => [id, getUserById(id)?.name]));
  const artistNamesById = new Map(artistIds.map((id) => [id, getArtist(id)?.name]));

  return flags.map((f) => ({
    ...f,
    userNames: f.userIds.map((id) => userNamesById.get(id) ?? `User #${id}`),
    artistName: f.artistId != null ? artistNamesById.get(f.artistId) ?? `Artist #${f.artistId}` : undefined,
  }));
}

// --- Scout Identity: public profiles, leaderboards, Founding Believer ---

export function getPortfolioValue(userId: number): PortfolioValue {
  const user = getUserById(userId)!;
  const holdings = getUserHoldings(userId);
  // exitValueCents, not shares * price_cents — see its own comment on
  // getUserHoldings. Portfolio value should reflect what's actually
  // realizable, not a quote inflated by the holder's own last buy.
  const holdingsValueCents = holdings.reduce((sum, h) => sum + h.exitValueCents, 0);
  const totalValueCents = user.next_credits_cents + holdingsValueCents;
  const totalReturnCents = totalValueCents - NEXT_STARTING_CREDITS_CENTS;
  const totalReturnPct = Math.round((totalReturnCents / NEXT_STARTING_CREDITS_CENTS) * 1000) / 10;
  return { cashCents: user.next_credits_cents, holdingsValueCents, totalValueCents, totalReturnCents, totalReturnPct };
}

export type PortfolioValuePoint = { recorded_at: string; value_cents: number };

// Reconstructs total portfolio value (cash + holdings) at every moment
// something relevant happened — one of this user's own trades (which move
// cash and share counts), or ANY trade on an artist they've ever held
// (which moves that artist's next_price_history, same as every other
// trader's fill does for everyone watching that artist's price chart).
// That second part matters: a position's value should move with the
// market even between the user's own trades, not just when they act.
// Grouped by exact timestamp (not walked event-by-event with a cross-table
// tiebreak) because a trade's own transaction row and its own price_history
// row share the identical `now` used inside executeTrade's single
// transaction — applying both before snapshotting is correct regardless of
// which literal row is processed first.
export function getPortfolioValueHistory(userId: number): PortfolioValuePoint[] {
  const transactions = db
    .prepare('SELECT artist_id, created_at, type, shares, credits_delta_cents FROM next_transactions WHERE user_id = ? ORDER BY created_at ASC, id ASC')
    .all(userId) as { artist_id: number; created_at: string; type: NextTransactionType; shares: number; credits_delta_cents: number }[];
  if (transactions.length === 0) return [];

  const artistIds = [...new Set(transactions.map((t) => t.artist_id))];
  const placeholders = artistIds.map(() => '?').join(', ');
  const pricePoints = db
    .prepare(`SELECT artist_id, recorded_at, price_cents FROM next_price_history WHERE artist_id IN (${placeholders}) ORDER BY recorded_at ASC, id ASC`)
    .all(...artistIds) as { artist_id: number; recorded_at: string; price_cents: number }[];

  const moments = new Map<string, { txs: typeof transactions; prices: typeof pricePoints }>();
  const momentAt = (at: string) => moments.get(at) ?? (moments.set(at, { txs: [], prices: [] }), moments.get(at)!);
  for (const t of transactions) momentAt(t.created_at).txs.push(t);
  for (const p of pricePoints) momentAt(p.recorded_at).prices.push(p);

  let cashCents = NEXT_STARTING_CREDITS_CENTS;
  const sharesByArtist = new Map<number, number>();
  const latestPriceByArtist = new Map<number, number>();

  return [...moments.keys()].sort().map((at) => {
    const m = moments.get(at)!;
    for (const t of m.txs) {
      cashCents += t.credits_delta_cents;
      const delta = t.type === 'buy' ? t.shares : -t.shares;
      sharesByArtist.set(t.artist_id, (sharesByArtist.get(t.artist_id) ?? 0) + delta);
    }
    for (const p of m.prices) latestPriceByArtist.set(p.artist_id, p.price_cents);

    let holdingsValueCents = 0;
    for (const [artistId, shares] of sharesByArtist) holdingsValueCents += shares * (latestPriceByArtist.get(artistId) ?? 0);
    return { recorded_at: at, value_cents: Math.round(cashCents + holdingsValueCents) };
  });
}

// Distinct artists ever backed — reads from next_founding_believers (never
// updated/deleted after insert), so selling a position afterward doesn't
// make it disappear from "artists backed."
export function getArtistsBackedCount(userId: number): number {
  const row = db
    .prepare('SELECT COUNT(DISTINCT artist_id) AS c FROM next_founding_believers WHERE user_id = ?')
    .get(userId) as { c: number };
  return row.c;
}

export function getEarlyDiscoveriesCount(userId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM next_founding_believers WHERE user_id = ? AND discovery_rank <= ?')
    .get(userId, EARLY_DISCOVERY_RANK_THRESHOLD) as { c: number };
  return row.c;
}

// Phase 7 — crowdsourced-discovery credit, entirely separate from
// getEarlyDiscoveriesCount above (that's about early BUYING; this is about
// FINDING an artist before it was ever on the roster at all, via
// app/next/submit-artist). "Approved" is the Scout's own judgment call
// that the find was real — the same bar a Scout's own YouTube/Soundcharts
// candidates clear before becoming a roster artist.
export function getApprovedDiscoveriesCount(userId: number): number {
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM discovery_candidates WHERE submitted_by_user_id = ? AND status = 'approved'")
    .get(userId) as { c: number };
  return row.c;
}

// A discovery that went on to become a genuine hit — 'flagship' is this
// app's most deliberate, durable "this artist made it" signal (a Scout's
// considered promotion, not a number that drifts with every rating tweak
// the way NEXT Score does), so it's the bar used here rather than a score
// threshold.
export function getBreakoutDiscoveriesCount(userId: number): number {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS c FROM discovery_candidates
      JOIN artists ON artists.id = discovery_candidates.artist_id
      WHERE discovery_candidates.submitted_by_user_id = ? AND discovery_candidates.status = 'approved' AND artists.stage = 'flagship'
    `)
    .get(userId) as { c: number };
  return row.c;
}

// The Discoveries "trophy case" list for a Scout profile — every submission
// this user has ever made, whatever its current status. artistName falls
// back to the name they originally typed for a candidate that was never
// approved (nothing to join against in artists).
export function getDiscoveriesForUser(userId: number): ScoutDiscoveryEntry[] {
  const rows = db
    .prepare(`
      SELECT discovery_candidates.id AS candidateId, discovery_candidates.artist_id AS artistId,
             discovery_candidates.name AS submittedName, artists.name AS resolvedArtistName,
             artists.stage AS artistStage, discovery_candidates.status AS status,
             discovery_candidates.discovered_at AS discoveredAt
      FROM discovery_candidates
      LEFT JOIN artists ON artists.id = discovery_candidates.artist_id
      WHERE discovery_candidates.submitted_by_user_id = ?
      ORDER BY discovery_candidates.discovered_at DESC
    `)
    .all(userId) as {
      candidateId: number; artistId: number | null; submittedName: string; resolvedArtistName: string | null;
      artistStage: Stage | null; status: DiscoveryCandidateStatus; discoveredAt: string;
    }[];

  return rows.map((r) => ({
    candidateId: r.candidateId,
    artistId: r.artistId ?? undefined,
    artistName: r.resolvedArtistName ?? r.submittedName,
    status: r.status,
    discoveredAt: r.discoveredAt,
    breakout: r.artistStage === 'flagship',
  }));
}

// Same "which genres is this Scout actually good in" idea as
// getFavoriteGenres, but earned through successful discoveries instead of
// backing — an approved find in a genre is real, demonstrated expertise,
// not just a preference.
export function getDiscoveryGenres(userId: number, limit = 3): FavoriteGenre[] {
  return db
    .prepare(`
      SELECT artists.genre AS genre, COUNT(*) AS count
      FROM discovery_candidates
      JOIN artists ON artists.id = discovery_candidates.artist_id
      WHERE discovery_candidates.submitted_by_user_id = ? AND discovery_candidates.status = 'approved'
        AND artists.genre IS NOT NULL AND artists.genre != ''
      GROUP BY artists.genre
      ORDER BY count DESC, artists.genre ASC
      LIMIT ?
    `)
    .all(userId, limit) as FavoriteGenre[];
}

// The "Top Discoverers" board — ranked by crowdsourced-discovery credit,
// completely independent of getScoutLeaderboard's trading-performance
// ranking. Zero-discovery accounts are left in (unlike getScoutLeaderboard,
// which filters those out at the PAGE level) — app/next/leaderboard.tsx
// applies the same filter here for consistency with how it treats Top
// Scouts, keeping the filtering decision in one place.
export function getDiscoveryLeaderboard(): DiscoveryLeaderboardEntry[] {
  const entries = getAllUsers().map((user) => ({
    user: { id: user.id, name: user.name, avatar_url: user.avatar_url },
    rank: 0,
    approvedDiscoveriesCount: getApprovedDiscoveriesCount(user.id),
    breakoutDiscoveriesCount: getBreakoutDiscoveriesCount(user.id),
  }));
  entries.sort((a, b) => b.approvedDiscoveriesCount - a.approvedDiscoveriesCount || b.breakoutDiscoveriesCount - a.breakoutDiscoveriesCount);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

// "Define which submission gets discovery credit" / "prevent
// duplicate-credit disputes" — the simplest resolution that avoids the
// dispute ever happening: block a second submission of the same artist
// outright rather than creating a rival candidate a Scout would have to
// adjudicate later. A 'passed' candidate does NOT block resubmission —
// Scout already closed that one out; a new submission is a fresh case, not
// a credit dispute over an old one.
export function findDuplicateArtistSubmission(name: string): { kind: 'artist' | 'candidate'; name: string } | undefined {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return undefined;

  const artist = db.prepare('SELECT name FROM artists WHERE LOWER(name) = ?').get(normalized) as { name: string } | undefined;
  if (artist) return { kind: 'artist', name: artist.name };

  const candidate = db
    .prepare("SELECT name FROM discovery_candidates WHERE LOWER(name) = ? AND status != 'passed' ORDER BY discovered_at ASC LIMIT 1")
    .get(normalized) as { name: string } | undefined;
  if (candidate) return { kind: 'candidate', name: candidate.name };

  return undefined;
}

// Anti-spam — a generous cap, not a serious abuse defense (coordinated/
// adversarial abuse is Phase 8 scope, once real prizes/rewards exist to
// abuse). This just stops one person from flooding the Candidate Queue.
export const SUBMISSION_RATE_LIMIT_PER_DAY = 5;

export function getRecentSubmissionCount(userId: number, hours: number): number {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = db
    .prepare("SELECT COUNT(*) AS c FROM discovery_candidates WHERE submitted_by_user_id = ? AND source = 'public_submission' AND discovered_at >= ?")
    .get(userId, cutoff) as { c: number };
  return row.c;
}

// Total portfolio value as of `cutoffIso`, reconstructed the same way
// getPortfolioValueHistory does — the last history point at or before the
// cutoff, or NEXT_STARTING_CREDITS_CENTS if the account existed by then but
// hadn't traded yet. Null means the account didn't exist yet at the
// cutoff at all (nothing to compare against, not "started at zero").
function pastPortfolioValueCents(userId: number, userCreatedAt: string, cutoffIso: string): number | null {
  if (userCreatedAt > cutoffIso) return null;
  let value = NEXT_STARTING_CREDITS_CENTS;
  for (const point of getPortfolioValueHistory(userId)) {
    if (point.recorded_at > cutoffIso) break;
    value = point.value_cents;
  }
  return value;
}

// Ranked by total return % over `window`; ties broken by artists backed
// (more activity outranks a flat, untouched account at the same %). For
// 'week'/'month', the baseline is each scout's own reconstructed portfolio
// value at the start of that window (or their starting balance, if they
// joined partway through it) — "how much have you grown lately," not just
// all-time. 'all' keeps the original all-time-since-signup baseline
// unchanged (NEXT_STARTING_CREDITS_CENTS for everyone), so existing callers
// that don't pass a window see identical numbers to before.
export function getScoutLeaderboard(window: LeaderboardWindow = 'all'): LeaderboardEntry[] {
  const windowDays = window === 'week' ? 7 : window === 'month' ? 30 : null;
  const cutoffIso = windowDays != null ? new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString() : null;

  const entries = getAllUsers().map((user) => {
    const portfolioValueCents = getPortfolioValue(user.id).totalValueCents;
    const baselineCents = cutoffIso != null ? pastPortfolioValueCents(user.id, user.created_at, cutoffIso) ?? NEXT_STARTING_CREDITS_CENTS : NEXT_STARTING_CREDITS_CENTS;
    const totalReturnPct = baselineCents !== 0 ? Math.round(((portfolioValueCents - baselineCents) / baselineCents) * 1000) / 10 : 0;
    return {
      user: { id: user.id, name: user.name, avatar_url: user.avatar_url },
      rank: 0,
      totalReturnPct,
      portfolioValueCents,
      artistsBackedCount: getArtistsBackedCount(user.id),
      earlyDiscoveriesCount: getEarlyDiscoveriesCount(user.id),
      approvedDiscoveriesCount: getApprovedDiscoveriesCount(user.id),
      rankChange: null as number | null,
    };
  });
  entries.sort((a, b) => b.totalReturnPct - a.totalReturnPct || b.artistsBackedCount - a.artistsBackedCount);
  entries.forEach((e, i) => { e.rank = i + 1; });

  // Rank movement is always relative to all-time standing 7 days ago,
  // independent of `window` — see the LeaderboardEntry.rankChange comment.
  const movements = getRankMovements();
  for (const e of entries) e.rankChange = movements[e.user.id] ?? null;

  return entries;
}

// How each scout's ALL-TIME rank has moved in the last 7 days. Reuses the
// same portfolio-value reconstruction as the leaderboard itself — no
// separate rank-snapshot table or cron job needed, consistent with how
// Watchlist's alert flags and Portfolio's value chart are also computed
// on demand from existing trade/price history rather than a background job.
export function getRankMovements(): Record<number, number | null> {
  const users = getAllUsers();
  const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Past ranking uses raw reconstructed value, not %, but the order is
  // identical to ranking by past return % here: every scout shares the same
  // fixed starting balance, so value and (value - constant) / constant sort
  // the same way.
  const past = users
    .map((user) => ({ id: user.id, value: pastPortfolioValueCents(user.id, user.created_at, cutoffIso) }))
    .filter((p): p is { id: number; value: number } => p.value != null)
    .sort((a, b) => b.value - a.value);
  const pastRankById = new Map(past.map((p, i) => [p.id, i + 1]));

  const current = getScoutLeaderboardUnranked(); // avoid recursing into getScoutLeaderboard's own rankChange computation
  const result: Record<number, number | null> = {};
  for (const e of current) {
    const pastRank = pastRankById.get(e.user.id);
    result[e.user.id] = pastRank != null ? pastRank - e.rank : null;
  }
  return result;
}

// getScoutLeaderboard('all') minus the rankChange pass — factored out so
// getRankMovements can get current all-time ranks without recursing into
// itself through getScoutLeaderboard.
function getScoutLeaderboardUnranked(): Omit<LeaderboardEntry, 'rankChange'>[] {
  const entries = getAllUsers().map((user) => {
    const portfolio = getPortfolioValue(user.id);
    return {
      user: { id: user.id, name: user.name, avatar_url: user.avatar_url },
      rank: 0,
      totalReturnPct: portfolio.totalReturnPct,
      portfolioValueCents: portfolio.totalValueCents,
      artistsBackedCount: getArtistsBackedCount(user.id),
      earlyDiscoveriesCount: getEarlyDiscoveriesCount(user.id),
      approvedDiscoveriesCount: getApprovedDiscoveriesCount(user.id),
    };
  });
  entries.sort((a, b) => b.totalReturnPct - a.totalReturnPct || b.artistsBackedCount - a.artistsBackedCount);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

// Ranked by how many artists in that genre this Scout has ever backed —
// reads from next_founding_believers (never erased after a sell), so a
// genre stays "yours" even once you've moved on from every position in it,
// same permanence next_founding_believers already gives the trophy case.
export function getFavoriteGenres(userId: number, limit = 3): FavoriteGenre[] {
  const rows = db.prepare(`
    SELECT artists.genre AS genre, COUNT(*) AS count
    FROM next_founding_believers
    JOIN artists ON artists.id = next_founding_believers.artist_id
    WHERE next_founding_believers.user_id = ? AND artists.genre IS NOT NULL AND artists.genre != ''
    GROUP BY artists.genre
    ORDER BY count DESC, artists.genre ASC
    LIMIT ?
  `).all(userId, limit) as FavoriteGenre[];
  return rows;
}

export function getScoutProfile(userId: number): ScoutProfile | undefined {
  const user = getUserById(userId);
  if (!user) return undefined;
  const leaderboard = getScoutLeaderboard();
  const entry = leaderboard.find((e) => e.user.id === userId)!;
  const portfolio = getPortfolioValue(userId);
  const earlyDiscoveriesCount = getEarlyDiscoveriesCount(userId);
  const approvedDiscoveriesCount = getApprovedDiscoveriesCount(userId);
  const breakoutDiscoveriesCount = getBreakoutDiscoveriesCount(userId);

  const positions = user.show_positions_publicly
    ? getUserHoldings(userId).map((h) => {
        const marketValueCents = h.exitValueCents; // see getUserHoldings' own comment
        const unrealizedPnlCents = marketValueCents - h.cost_basis_cents;
        const unrealizedPct = h.cost_basis_cents !== 0 ? (unrealizedPnlCents / h.cost_basis_cents) * 100 : 0;
        return {
          artist_id: h.artist_id,
          artist_name: h.artist_name,
          artist_photo_url: h.artist_photo_url,
          shares: h.shares,
          marketValueCents,
          unrealizedPnlCents,
          unrealizedPct,
        };
      })
    : null;

  return {
    user: { id: user.id, name: user.name, avatar_url: user.avatar_url },
    portfolio,
    scoutScoreValue: scoutScore({ totalReturnPct: portfolio.totalReturnPct, earlyDiscoveriesCount, approvedDiscoveriesCount, breakoutDiscoveriesCount }),
    rank: entry.rank,
    totalScouts: leaderboard.length,
    artistsBackedCount: entry.artistsBackedCount,
    earlyDiscoveriesCount,
    favoriteGenres: getFavoriteGenres(userId),
    showPositionsPublicly: user.show_positions_publicly,
    positions,
    approvedDiscoveriesCount,
    breakoutDiscoveriesCount,
    discoveryGenres: getDiscoveryGenres(userId),
    discoveries: getDiscoveriesForUser(userId),
    badges: getScoutBadges({ approvedDiscoveriesCount, breakoutDiscoveriesCount, earlyDiscoveriesCount }),
  };
}

export function getAvailableGenres(): string[] {
  const rows = db
    .prepare("SELECT DISTINCT genre FROM artists WHERE genre IS NOT NULL AND genre != '' ORDER BY genre ASC")
    .all() as { genre: string }[];
  return rows.map((r) => r.genre);
}

// Ranked by realized + unrealized $ P&L earned specifically from that
// genre's artists (not %, since "amount invested in this genre" isn't
// well-defined once a position's fully sold). Only scouts with at least
// one buy or sell in the genre appear.
export function getGenreLeaderboard(genre: string): GenreLeaderboardEntry[] {
  const entries: GenreLeaderboardEntry[] = [];

  for (const user of getAllUsers()) {
    const holdings = db.prepare(`
      SELECT next_holdings.shares, next_holdings.cost_basis_cents, next_holdings.artist_id
      FROM next_holdings
      JOIN artists ON artists.id = next_holdings.artist_id
      WHERE next_holdings.user_id = ? AND next_holdings.shares > 0 AND artists.genre = ?
    `).all(user.id, genre) as { shares: number; cost_basis_cents: number; artist_id: number }[];

    const artistIds = new Set<number>();
    let pnlCents = 0;
    for (const h of holdings) {
      const artist = getArtist(h.artist_id)!;
      // exitValueCents, not shares * price — see getUserHoldings' own comment.
      pnlCents += quoteSell(ensureNextPrice(artist), h.shares).proceedsCents - h.cost_basis_cents;
      artistIds.add(h.artist_id);
    }

    const sells = db.prepare(`
      SELECT next_transactions.realized_pnl_cents, next_transactions.artist_id
      FROM next_transactions
      JOIN artists ON artists.id = next_transactions.artist_id
      WHERE next_transactions.user_id = ? AND next_transactions.type = 'sell' AND artists.genre = ?
    `).all(user.id, genre) as { realized_pnl_cents: number | null; artist_id: number }[];
    for (const s of sells) {
      pnlCents += s.realized_pnl_cents ?? 0;
      artistIds.add(s.artist_id);
    }

    if (artistIds.size === 0) continue;
    entries.push({ user: { id: user.id, name: user.name, avatar_url: user.avatar_url }, rank: 0, pnlCents, artistsBackedCount: artistIds.size });
  }

  entries.sort((a, b) => b.pnlCents - a.pnlCents);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

export function getFoundingBelieverCountForArtist(artistId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM next_founding_believers WHERE artist_id = ?').get(artistId) as { c: number };
  return row.c;
}

export function getFoundingBelieverRecordsForUser(
  userId: number
): (FoundingBelieverRecord & { artist_name: string; artist_photo_url?: string })[] {
  return db.prepare(`
    SELECT next_founding_believers.*, artists.name AS artist_name, artists.photo_url AS artist_photo_url
    FROM next_founding_believers
    JOIN artists ON artists.id = next_founding_believers.artist_id
    WHERE next_founding_believers.user_id = ?
    ORDER BY next_founding_believers.purchased_at DESC
  `).all(userId) as (FoundingBelieverRecord & { artist_name: string; artist_photo_url?: string })[];
}

// --- Product analytics ---

// One row per occurrence — see the analytics_events table comment for what
// this does and doesn't cover. userId is nullable (a signed-out event isn't
// possible today since every tracked action requires a session, but the
// column allows for one without a migration later).
export function logEvent(userId: number | null, eventType: AnalyticsEventType, metadata?: Record<string, unknown>): void {
  db.prepare('INSERT INTO analytics_events (user_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, eventType, metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
}

// Logs the same artist_card_viewed event once per artist currently on
// Discover — see the Discover page for why this counts as "viewed" rather
// than true scroll-based impression tracking (no client-side observer/API
// round trip per card; one batched write per page load instead).
export function logArtistCardViews(userId: number, artistIds: number[]): void {
  if (artistIds.length === 0) return;
  const insert = db.prepare('INSERT INTO analytics_events (user_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const artistId of artistIds) insert.run(userId, 'artist_card_viewed', JSON.stringify({ artistId }), now);
  })();
}

// Same batched-impression pattern as logArtistCardViews above, for NEXT
// Feed items — "impression" means "was in the ranked results this
// page/page-of-more returned," logged once per feed_events id, not a
// per-card scroll observer or network round trip.
export function logFeedItemImpressions(userId: number, feedEventIds: number[]): void {
  if (feedEventIds.length === 0) return;
  const insert = db.prepare('INSERT INTO analytics_events (user_id, event_type, metadata, created_at) VALUES (?, ?, ?, ?)');
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const feedEventId of feedEventIds) insert.run(userId, 'feed_item_impression', JSON.stringify({ feedEventId }), now);
  })();
}

function parseEventRow(row: { id: number; user_id: number | null; event_type: string; metadata: string | null; created_at: string }): AnalyticsEvent {
  return { ...row, event_type: row.event_type as AnalyticsEventType, metadata: row.metadata ? JSON.parse(row.metadata) : null };
}

// All-time count per event type — the simplest possible read side, enough
// to verify events are actually being recorded. The MVP metrics dashboard
// (funnels, conversion rates, retention) is its own, later checklist item;
// this one is scoped to tracking, not analyzing.
export function getEventCountsByType(): Record<AnalyticsEventType, number> {
  const rows = db.prepare('SELECT event_type, COUNT(*) AS c FROM analytics_events GROUP BY event_type').all() as { event_type: AnalyticsEventType; c: number }[];
  return Object.fromEntries(rows.map((r) => [r.event_type, r.c])) as Record<AnalyticsEventType, number>;
}

export function getRecentEventsForUser(userId: number, limit = 50): AnalyticsEvent[] {
  return (db.prepare('SELECT * FROM analytics_events WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(userId, limit) as any[]).map(parseEventRow);
}

// Error monitoring (Phase 10) — see error_reports' own DDL comment. Stack
// traces are capped at a generous-but-bounded length so one runaway report
// can't bloat the table; message has no such cap since it's normally short
// and truncating it risks losing the one line that actually explains what
// broke.
const ERROR_STACK_MAX_CHARS = 4000;

export function insertErrorReport(input: {
  source: 'client' | 'server';
  message: string;
  stack?: string;
  digest?: string;
  path?: string;
  userId?: number;
}): void {
  db.prepare('INSERT INTO error_reports (source, message, stack, digest, path, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    input.source,
    input.message.slice(0, 2000),
    input.stack ? input.stack.slice(0, ERROR_STACK_MAX_CHARS) : null,
    input.digest ?? null,
    input.path ?? null,
    input.userId ?? null,
    new Date().toISOString()
  );
}

export function getRecentErrorReports(limit = 100): ErrorReport[] {
  return db
    .prepare(`
      SELECT error_reports.*, users.name AS user_name
      FROM error_reports
      LEFT JOIN users ON users.id = error_reports.user_id
      ORDER BY error_reports.created_at DESC, error_reports.id DESC
      LIMIT ?
    `)
    .all(limit) as any[];
}

export function getErrorReportCount(hours = 24): number {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = db.prepare('SELECT COUNT(*) AS c FROM error_reports WHERE created_at >= ?').get(cutoff) as { c: number };
  return row.c;
}

// Whole-table reads for the MVP metrics dashboard (lib/analytics.ts) — this
// app's scale makes "fetch everything once, compute funnels/sessions/
// retention in JS" simpler and just as fast as SQL window functions would
// be, and far more readable for the gap-based session grouping several of
// those metrics need.
export function getAllEvents(): AnalyticsEvent[] {
  return (db.prepare('SELECT * FROM analytics_events WHERE user_id IS NOT NULL ORDER BY created_at ASC, id ASC').all() as any[]).map(parseEventRow);
}

export type PreviewListenEvent = { user_id: number; artist_id: number; event: 'started' | 'completed'; created_at: string };
export function getAllPreviewListenEvents(): PreviewListenEvent[] {
  return db.prepare('SELECT user_id, artist_id, event, created_at FROM preview_listens ORDER BY created_at ASC, id ASC').all() as PreviewListenEvent[];
}

export type AnalyticsTransaction = { user_id: number; artist_id: number; type: NextTransactionType; created_at: string; listened_before_buy: number | null };
export function getAllTransactionsForAnalytics(): AnalyticsTransaction[] {
  return db
    .prepare('SELECT user_id, artist_id, type, created_at, listened_before_buy FROM next_transactions ORDER BY created_at ASC, id ASC')
    .all() as AnalyticsTransaction[];
}

// Stamps last_login_at and reports whether this is a RETURNING session —
// true only when the user already had a last_login_at before this call,
// i.e. not their very first login right after signup. The caller decides
// whether to log session_returned from that (see app/api/auth/login).
export function recordLogin(userId: number): { returning: boolean } {
  const before = getUserById(userId);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), userId);
  return { returning: Boolean(before?.last_login_at) };
}

// --- Discovery Engine ---

export function getTrackedSoundchartsUuids(): Set<string> {
  const rows = db.prepare("SELECT soundcharts_uuid FROM artists WHERE soundcharts_uuid IS NOT NULL").all() as { soundcharts_uuid: string }[];
  return new Set(rows.map((r) => r.soundcharts_uuid));
}

// Every artist linked to a Soundcharts profile — the exact set a sync run
// needs to refresh. Unlinked artists (no soundcharts_uuid) are untouched by
// automated sync; their stats stay manual-entry only, same as today.
export function getArtistsWithSoundchartsLink(): { id: number; name: string; soundcharts_uuid: string }[] {
  return db
    .prepare("SELECT id, name, soundcharts_uuid FROM artists WHERE soundcharts_uuid IS NOT NULL")
    .all() as { id: number; name: string; soundcharts_uuid: string }[];
}

// The gap getArtistsWithSoundchartsLink above never covered: an artist that
// never got linked in the first place (a failed on-create lookup — see
// app/api/artists/route.ts and components/BulkAddArtists.tsx — or one added
// before Soundcharts was wired in) sits with no photo forever, since the
// regular sync only re-syncs artists ALREADY linked by uuid. This is the
// search-and-link backfill that's missing that step, mirroring
// getArtistsMissingVideo's "touch everyone still missing it, but respect a
// recent honest no-match" shape.
export const SOUNDCHARTS_NO_MATCH_RECHECK_DAYS = 14;

export function getArtistsMissingPhoto(): { id: number; name: string }[] {
  const recheckCutoff = new Date(Date.now() - SOUNDCHARTS_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(`
      SELECT id, name FROM artists
      WHERE (photo_url IS NULL OR photo_url = '') AND soundcharts_uuid IS NULL
        AND (soundcharts_no_match_at IS NULL OR soundcharts_no_match_at < ?)
    `)
    .all(recheckCutoff) as { id: number; name: string }[];
}

export function stampSoundchartsNoMatch(artistId: number, at: string = new Date().toISOString()): void {
  db.prepare('UPDATE artists SET soundcharts_no_match_at = ? WHERE id = ?').run(at, artistId);
}

export type PhotoBackoffStatus = { count: number; earliestRecheckAt?: string };

// Same "why did this say checked 0" visibility as getArtistsInVideoBackoff.
export function getArtistsInPhotoBackoff(): PhotoBackoffStatus {
  const cutoff = new Date(Date.now() - SOUNDCHARTS_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(`
      SELECT soundcharts_no_match_at FROM artists
      WHERE (photo_url IS NULL OR photo_url = '') AND soundcharts_uuid IS NULL
        AND soundcharts_no_match_at IS NOT NULL AND soundcharts_no_match_at >= ?
      ORDER BY soundcharts_no_match_at ASC
    `)
    .all(cutoff) as { soundcharts_no_match_at: string }[];
  if (rows.length === 0) return { count: 0 };
  const earliestRecheckAt = new Date(new Date(rows[0].soundcharts_no_match_at).getTime() + SOUNDCHARTS_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { count: rows.length, earliestRecheckAt };
}

// --- Wikidata match cache (see lib/wikidata.ts) ---

export function saveWikidataMatch(artistId: number, qid: string): void {
  db.prepare('UPDATE artists SET wikidata_qid = ?, wikidata_fetched_at = ?, wikidata_no_match_at = NULL WHERE id = ?')
    .run(qid, new Date().toISOString(), artistId);
}

// A genuine no-match is cached same as soundcharts_no_match_at/
// youtube_no_match_at — most artists on this roster are small enough that
// Wikidata has no entry for them at all, which is an expected, valid
// outcome (see lib/wikidata.ts's file header), not something to keep
// re-searching for on every form load.
export function saveWikidataNoMatch(artistId: number, at: string = new Date().toISOString()): void {
  db.prepare('UPDATE artists SET wikidata_fetched_at = ?, wikidata_no_match_at = ? WHERE id = ?').run(at, at, artistId);
}

// --- Claimed-artist photo upload (pre-beta migration: item 3/33 of the
// migration brief) — the ONE write path for artists.photo_source_type =
// 'ARTIST_PROVIDED'. Deliberately not routed through the generic
// updateArtist()/WRITABLE_FIELDS path (unlike photo_url itself, which a
// Scout can set directly): rightsConfirmed must be an explicit, real
// checkbox click, not a client-suppliable boolean, and uploadedByUserId
// must be the actual acting user's id, not anything the request body could
// spoof — see app/api/next/my-artist/[id]/photo/route.ts, the only caller. ---
export function setArtistPhotoByOwner(artistId: number, photoUrl: string, uploadedByUserId: number): Artist | undefined {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE artists SET
      updated_at = ?, photo_url = ?, photo_source_type = 'ARTIST_PROVIDED', photo_source_url = ?,
      photo_attribution = NULL, photo_license = NULL, photo_license_url = NULL,
      photo_uploaded_by_user_id = ?, photo_uploaded_at = ?, photo_rights_confirmed_at = ?
    WHERE id = ?
  `).run(now, photoUrl, photoUrl, uploadedByUserId, now, now, artistId);
  return getArtist(artistId);
}

// Lets an admin (never the claimed artist themself) remove an
// ARTIST_PROVIDED photo — the migration brief's "admin must be able to
// remove an uploaded asset" — falling back to no photo (the resolver's
// gradient/initial fallback takes over) rather than silently reverting to
// whatever photo_url happened to be there before, which could just as
// easily have been another removed/disputed image.
export function removeArtistProvidedPhoto(artistId: number): Artist | undefined {
  const artist = getArtist(artistId);
  if (!artist || artist.photo_source_type !== 'ARTIST_PROVIDED') return artist;
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE artists SET
      updated_at = ?, photo_url = NULL, photo_source_type = NULL, photo_source_url = NULL,
      photo_attribution = NULL, photo_license = NULL, photo_license_url = NULL,
      photo_uploaded_by_user_id = NULL, photo_uploaded_at = NULL, photo_rights_confirmed_at = NULL
    WHERE id = ?
  `).run(now, artistId);
  return getArtist(artistId);
}

export function createSyncRun(source: SyncSourceKey = 'soundcharts'): SyncRun {
  const now = new Date().toISOString();
  const info = db
    .prepare("INSERT INTO sync_runs (started_at, status, checked_count, updated_count, failed_count, source) VALUES (?, 'running', 0, 0, 0, ?)")
    .run(now, source);
  return db.prepare('SELECT * FROM sync_runs WHERE id = ?').get(info.lastInsertRowid) as SyncRun;
}

export function completeSyncRun(
  id: number,
  result: {
    status: 'completed' | 'failed'; checkedCount: number; updatedCount: number; failedCount: number; error?: string;
    noMatchCount?: number; errorCount?: number; lastError?: string;
  }
): void {
  db.prepare(`
    UPDATE sync_runs
    SET completed_at = ?, status = ?, checked_count = ?, updated_count = ?, failed_count = ?, error = ?,
        no_match_count = ?, error_count = ?, last_error = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(), result.status, result.checkedCount, result.updatedCount, result.failedCount, result.error ?? null,
    result.noMatchCount ?? null, result.errorCount ?? null, result.lastError ?? null, id
  );
}

export function getLatestSyncRun(source: SyncSourceKey = 'soundcharts'): SyncRun | undefined {
  return db
    // id DESC breaks ties when two runs share the same started_at timestamp
    // (millisecond-resolution ISO strings collide easily under fast/automated
    // syncs) — started_at alone isn't a reliable "most recent" ordering.
    .prepare('SELECT * FROM sync_runs WHERE source = ? ORDER BY started_at DESC, id DESC LIMIT 1')
    .get(source) as SyncRun | undefined;
}

// A per-artist, per-source "last checked" timestamp — distinct from
// SyncRun, which only records a whole batch run, not which artists it
// actually touched. Called by each sync route (and the on-create lookups in
// app/api/artists/route.ts) whenever a check against that source genuinely
// completed for this artist, success or a clean no-match alike — never on a
// network/API error, where nothing was actually confirmed one way or the
// other. See the Artist type for the exact semantics.
export function stampSourceSyncedAt(artistId: number, source: 'soundcharts' | 'deezer' | 'youtube', at: string = new Date().toISOString()): void {
  const column = source === 'soundcharts' ? 'soundcharts_synced_at' : source === 'deezer' ? 'deezer_synced_at' : 'youtube_synced_at';
  db.prepare(`UPDATE artists SET ${column} = ? WHERE id = ?`).run(at, artistId);
}

export function setFeaturedVideoMatchType(artistId: number, matchType: Artist['featured_video_match_type'] | null): void {
  db.prepare('UPDATE artists SET featured_video_match_type = ? WHERE id = ?').run(matchType ?? null, artistId);
}

// Structured, queryable failure history — see the SyncFailure type for why
// this exists alongside SyncRun's aggregate counters. Deliberately only
// ever called for a real error, never a clean no-match.
export function logSyncFailure(runId: number, source: SyncSourceKey, artistId: number, artistName: string, error: string): void {
  db.prepare('INSERT INTO sync_failures (run_id, source, artist_id, artist_name, error, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(runId, source, artistId, artistName, error, new Date().toISOString());
}

export function getRecentSyncFailures(source?: SyncSourceKey, limit = 50): SyncFailure[] {
  if (source) {
    return db.prepare('SELECT * FROM sync_failures WHERE source = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(source, limit) as SyncFailure[];
  }
  return db.prepare('SELECT * FROM sync_failures ORDER BY created_at DESC, id DESC LIMIT ?').all(limit) as SyncFailure[];
}

// YouTube quota tracking — `quotaDay` is a caller-computed "YYYY-MM-DD in
// Pacific time" string (see lib/youtube.ts), not computed here, so this
// stays a plain "N units for day X" ledger with no timezone logic of its
// own. Every call through lib/youtube.ts's youtubeFetch records here,
// covering discovery scans, artist backfills, and on-create lookups alike
// — the first true cross-route daily total (discovery_runs.quota_used is
// only ever a single run's own estimate).
export function recordYoutubeQuotaUsage(units: number, endpoint: string, quotaDay: string): void {
  db.prepare('INSERT INTO youtube_quota_usage (quota_day, units, endpoint, created_at) VALUES (?, ?, ?, ?)')
    .run(quotaDay, units, endpoint, new Date().toISOString());
}

export function getYoutubeQuotaUsedToday(quotaDay: string): number {
  return (db.prepare('SELECT COALESCE(SUM(units), 0) AS total FROM youtube_quota_usage WHERE quota_day = ?').get(quotaDay) as { total: number }).total;
}

// Artists still missing a top song link OR a photo, for Deezer sync — one
// artist-search call (see lib/deezer.ts's getTopSongForArtist) can fill
// either or both, so one query covers everyone that call is worth making
// for. Unlike Soundcharts sync (which only touches artists explicitly
// linked by uuid, but always re-fetches), this touches every artist
// regardless of a Soundcharts link, but only ones missing at least one of
// the two fields. Once filled — by this sync or typed in by hand — each
// field is a Scout's own curatorial choice, so neither is ever silently
// overwritten; clear a field to have sync fill it again.
export function getArtistsMissingDeezerData(): { id: number; name: string }[] {
  return db
    .prepare(`
      SELECT id, name FROM artists
      WHERE (top_song_url IS NULL OR top_song_url = '') OR (photo_url IS NULL OR photo_url = '')
    `)
    .all() as { id: number; name: string }[];
}

// Same "touch everyone, but only fill what's missing" shape as
// getArtistsMissingTopSong — a video a Scout picked by hand (or a
// discovery-approval video) is never silently overwritten; clear the
// field to have sync fill it again.
// How long a genuine "no YouTube video found" result sticks before an
// artist is worth re-checking — avoids burning quota re-searching someone
// with no YouTube presence every single day, while still catching it if a
// video eventually appears (see the youtube_no_match_at column comment).
export const YOUTUBE_NO_MATCH_RECHECK_DAYS = 14;

export function getArtistsMissingVideo(): { id: number; name: string; youtube_url?: string }[] {
  const recheckCutoff = new Date(Date.now() - YOUTUBE_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return db
    .prepare(`
      SELECT id, name, youtube_url FROM artists
      WHERE (featured_video_id IS NULL OR featured_video_id = '')
        AND (youtube_no_match_at IS NULL OR youtube_no_match_at < ?)
    `)
    .all(recheckCutoff) as { id: number; name: string; youtube_url?: string }[];
}

export function stampYoutubeNoMatch(artistId: number, at: string = new Date().toISOString()): void {
  db.prepare('UPDATE artists SET youtube_no_match_at = ? WHERE id = ?').run(at, artistId);
}

export type VideoBackoffStatus = { count: number; earliestRecheckAt?: string };

// The exact inverse of getArtistsMissingVideo's exclusion — artists still
// missing a video that WON'T show up on the next backfill run because
// they were checked too recently. Without this, "checked 0, updated 0" on
// a backfill run looks identical whether the roster genuinely has no
// artists left to check or every candidate is just sitting in this
// backoff window — this makes the difference visible on Admin sync health.
export function getArtistsInVideoBackoff(): VideoBackoffStatus {
  const cutoff = new Date(Date.now() - YOUTUBE_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(`
      SELECT youtube_no_match_at FROM artists
      WHERE (featured_video_id IS NULL OR featured_video_id = '')
        AND youtube_no_match_at IS NOT NULL AND youtube_no_match_at >= ?
      ORDER BY youtube_no_match_at ASC
    `)
    .all(cutoff) as { youtube_no_match_at: string }[];
  if (rows.length === 0) return { count: 0 };
  const earliestRecheckAt = new Date(new Date(rows[0].youtube_no_match_at).getTime() + YOUTUBE_NO_MATCH_RECHECK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return { count: rows.length, earliestRecheckAt };
}

// A featured video matched via an unverified top-relevance search hit
// (see lib/youtube.ts's 'search_unverified' match type) — genuinely likely
// to be the wrong video, not just an artist with no video at all. Powers
// the Admin sync-health page's data-reliability summary.
export function getUnverifiedVideoMatchCount(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM artists WHERE featured_video_match_type = 'search_unverified'").get() as { c: number }).c;
}

export type PlatformLinksImpact = {
  artistsMissingAllLinks: number;
  totalArtists: number;
  viewsOnArtistsMissingAllLinks: number;
  totalArtistDetailViews: number;
};

// "Track how often missing platform links materially hurt the product"
// (Phase 4's Soundcharts limitations section) — Soundcharts' artist-
// metadata endpoint doesn't return Spotify/Instagram/TikTok/YouTube links
// on this app's plan (see README), and those stay manual. Rather than a
// static "N artists have no links" count, this ties the gap to real usage:
// how many actual Artist Detail views (already tracked by Phase 3's event
// log — no new instrumentation needed) landed on an artist with NONE of
// the four links at all, the worst case. A tiny number here across real
// traffic is the evidence for "keep working around it"; a large one is
// the evidence for revisiting the Soundcharts plan — see the checklist's
// own "revisit only when real user volume/data needs justify it."
export function getMissingPlatformLinksImpact(): PlatformLinksImpact {
  const artists = getAllArtists();
  const missingIds = new Set(
    artists.filter((a) => !a.spotify_url && !a.instagram_url && !a.tiktok_url && !a.youtube_url).map((a) => a.id)
  );
  const views = getAllEvents().filter((e) => e.event_type === 'artist_detail_opened');
  const viewsOnArtistsMissingAllLinks = views.filter((e) => {
    const artistId = (e.metadata as any)?.artistId;
    return typeof artistId === 'number' && missingIds.has(artistId);
  }).length;
  return { artistsMissingAllLinks: missingIds.size, totalArtists: artists.length, viewsOnArtistsMissingAllLinks, totalArtistDetailViews: views.length };
}

// Candidates already reviewed (watching/approved/passed) for a name are
// skipped on future scans too — a "no thanks" from a Scout should stick,
// not reappear every day just because the artist is still growing.
export function getKnownDiscoveryUuids(): Set<string> {
  const rows = db
    .prepare('SELECT soundcharts_uuid FROM discovery_candidates WHERE soundcharts_uuid IS NOT NULL')
    .all() as { soundcharts_uuid: string }[];
  return new Set(rows.map((r) => r.soundcharts_uuid));
}

// Same "a no-thanks sticks" rule, keyed by YouTube channel instead — a
// channel already sitting in the queue (any status) is skipped on future
// YouTube scans, whether or not it ever picked up a Soundcharts match.
export function getKnownDiscoveryYoutubeChannelIds(): Set<string> {
  const rows = db
    .prepare('SELECT yt_channel_id FROM discovery_candidates WHERE yt_channel_id IS NOT NULL')
    .all() as { yt_channel_id: string }[];
  return new Set(rows.map((r) => r.yt_channel_id));
}

export function createDiscoveryRun(source: DiscoverySourceKey = 'soundcharts'): DiscoveryRun {
  const now = new Date().toISOString();
  const info = db
    .prepare("INSERT INTO discovery_runs (started_at, status, searched_count, candidates_found, source) VALUES (?, 'running', 0, 0, ?)")
    .run(now, source);
  return db.prepare('SELECT * FROM discovery_runs WHERE id = ?').get(info.lastInsertRowid) as DiscoveryRun;
}

export function completeDiscoveryRun(
  id: number,
  result: {
    status: 'completed' | 'failed'; searchedCount: number; candidatesFound: number; error?: string; quotaUsed?: number;
    rejectionBreakdown?: DiscoveryRejectionBreakdown;
  }
): void {
  const r = result.rejectionBreakdown;
  // rejected_below_momentum_threshold / best_rejected_momentum_score are
  // legacy columns (see the momentum_score comment in the schema above) —
  // always written null now that no momentum score is computed to reject
  // candidates against; kept so historical pre-migration run rows are
  // untouched.
  db.prepare(`
    UPDATE discovery_runs
    SET completed_at = ?, status = ?, searched_count = ?, candidates_found = ?, error = ?, quota_used = ?,
        rejected_not_official_release = ?, rejected_below_min_views = ?, rejected_no_subscriber_count = ?,
        rejected_subscriber_out_of_band = ?, rejected_below_momentum_threshold = ?, best_rejected_momentum_score = ?,
        rejected_duplicate_soundcharts_match = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(), result.status, result.searchedCount, result.candidatesFound, result.error ?? null, result.quotaUsed ?? null,
    r?.notOfficialRelease ?? null, r?.belowMinViews ?? null, r?.noSubscriberCount ?? null, r?.subscriberOutOfBand ?? null,
    null, null, r?.duplicateSoundchartsMatch ?? null, id
  );
}

export function getLatestDiscoveryRun(source: DiscoverySourceKey = 'soundcharts'): DiscoveryRun | undefined {
  return db
    // Same started_at tie-break as getLatestSyncRun above.
    .prepare('SELECT * FROM discovery_runs WHERE source = ? ORDER BY started_at DESC, id DESC LIMIT 1')
    .get(source) as DiscoveryRun | undefined;
}

export type NewDiscoveryCandidate = {
  source: DiscoverySourceKey;
  soundcharts_uuid?: string;
  name: string;
  photo_url?: string;
  country?: string;
  followers_count?: number;
  followers_7d_ago?: number;
  followers_30d_ago?: number;
  growth_7d_pct?: number;
  growth_30d_pct?: number;
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
  yt_hype_comment_rate?: number;
  yt_comments_analyzed?: number;
  yt_example_comment_1?: string;
  yt_example_comment_1_likes?: number;
  yt_example_comment_2?: string;
  yt_example_comment_2_likes?: number;
  flagged_reason: string;
  // Which scan run found this candidate — see the discovery_run_id column
  // comment. Optional because the (dormant) Soundcharts source predates
  // this and hasn't been wired to pass it; a candidate without it just
  // never shows up attributed to a run on the Admin discovery page.
  discovery_run_id?: number;
  // source='public_submission' only — see DiscoverySourceKey's comment.
  submitted_by_user_id?: number;
  submission_url?: string;
};

const DISCOVERY_CANDIDATE_COLUMNS = [
  'source', 'soundcharts_uuid', 'name', 'photo_url', 'country',
  'followers_count', 'followers_7d_ago', 'followers_30d_ago', 'growth_7d_pct', 'growth_30d_pct',
  'yt_video_id', 'yt_channel_id', 'yt_channel_title', 'yt_genre', 'yt_view_count', 'yt_like_count',
  'yt_comment_count', 'yt_published_at', 'yt_channel_subscriber_count', 'yt_channel_view_count',
  'yt_views_per_day', 'yt_like_rate', 'yt_comment_rate', 'yt_views_per_subscriber', 'yt_hype_comment_rate',
  'yt_comments_analyzed', 'yt_example_comment_1', 'yt_example_comment_1_likes', 'yt_example_comment_2',
  'yt_example_comment_2_likes', 'flagged_reason', 'discovery_run_id',
  'submitted_by_user_id', 'submission_url',
] as const;

// candidate_id isn't known until the INSERT above returns its rowid — a
// second statement, not a trigger, keeps this readable and matches how
// every other history/audit table in this app is written (see
// logSyncFailure). from_status is always null here: this row IS the
// candidate's discovery, not a transition from some prior state.
function logDiscoveryCandidateDiscovered(candidateId: number): void {
  db.prepare('INSERT INTO discovery_candidate_history (candidate_id, from_status, to_status, actor_id, created_at) VALUES (?, NULL, ?, NULL, ?)')
    .run(candidateId, 'new', new Date().toISOString());
}

export function insertDiscoveryCandidate(c: NewDiscoveryCandidate): void {
  const columns = [...DISCOVERY_CANDIDATE_COLUMNS, 'status', 'discovered_at'];
  const placeholders = DISCOVERY_CANDIDATE_COLUMNS.map((col) => `@${col}`).join(', ');
  const row: Record<string, unknown> = { discovered_at: new Date().toISOString() };
  for (const col of DISCOVERY_CANDIDATE_COLUMNS) row[col] = (c as any)[col] ?? null;
  const info = db.prepare(`
    INSERT INTO discovery_candidates (${columns.join(', ')})
    VALUES (${placeholders}, 'new', @discovered_at)
  `).run(row);
  logDiscoveryCandidateDiscovered(info.lastInsertRowid as number);
}

const DISCOVERY_CANDIDATE_SELECT = `
  SELECT discovery_candidates.*, users.name AS reviewed_by_name, submitters.name AS submitted_by_name
  FROM discovery_candidates
  LEFT JOIN users ON users.id = discovery_candidates.reviewed_by
  LEFT JOIN users submitters ON submitters.id = discovery_candidates.submitted_by_user_id
`;

// Soundcharts candidates rank by 30-day growth % (a single real metric, not
// a blended score). YouTube candidates no longer carry any composite score
// (pre-beta migration — see lib/youtube-momentum.ts) so they fall through
// to the discovered_at tiebreak, newest first — a simple, non-derived order,
// not a replacement formula.
export function getDiscoveryCandidates(status?: DiscoveryCandidateStatus): DiscoveryCandidate[] {
  if (status) {
    return db
      .prepare(`${DISCOVERY_CANDIDATE_SELECT} WHERE discovery_candidates.status = ? ORDER BY discovery_candidates.growth_30d_pct DESC NULLS LAST, discovery_candidates.discovered_at DESC`)
      .all(status) as DiscoveryCandidate[];
  }
  return db
    .prepare(`${DISCOVERY_CANDIDATE_SELECT} ORDER BY discovery_candidates.discovered_at DESC`)
    .all() as DiscoveryCandidate[];
}

export function getNewDiscoveryCandidateCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM discovery_candidates WHERE status = 'new'").get() as { c: number };
  return row.c;
}

export function getDiscoveryCandidate(id: number): DiscoveryCandidate | undefined {
  return db.prepare(`${DISCOVERY_CANDIDATE_SELECT} WHERE discovery_candidates.id = ?`).get(id) as DiscoveryCandidate | undefined;
}

function logDiscoveryCandidateHistory(candidateId: number, fromStatus: DiscoveryCandidateStatus, toStatus: DiscoveryCandidateStatus, actorId: number): void {
  db.prepare('INSERT INTO discovery_candidate_history (candidate_id, from_status, to_status, actor_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(candidateId, fromStatus, toStatus, actorId, new Date().toISOString());
}

export function setDiscoveryCandidateStatus(
  id: number,
  status: 'watching' | 'passed',
  actor: Actor
): DiscoveryCandidate | undefined {
  const existing = getDiscoveryCandidate(id);
  if (!existing) return undefined;
  const info = db
    .prepare('UPDATE discovery_candidates SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?')
    .run(status, new Date().toISOString(), actor.id, id);
  if (info.changes === 0) return undefined;
  logDiscoveryCandidateHistory(id, existing.status, status, actor.id);
  return getDiscoveryCandidate(id);
}

export function getDiscoveryCandidateHistory(candidateId: number): DiscoveryCandidateHistoryEntry[] {
  return db
    .prepare(`
      SELECT discovery_candidate_history.*, users.name AS actor_name
      FROM discovery_candidate_history
      LEFT JOIN users ON users.id = discovery_candidate_history.actor_id
      WHERE candidate_id = ?
      ORDER BY discovery_candidate_history.created_at ASC, discovery_candidate_history.id ASC
    `)
    .all(candidateId) as DiscoveryCandidateHistoryEntry[];
}

// A cross-candidate audit feed for the Admin discovery page — every real
// review decision (not the initial "discovered" row, which isn't a
// decision anyone made), most recent first.
export function getRecentDiscoveryReviewDecisions(limit = 30): (DiscoveryCandidateHistoryEntry & { candidate_name: string; candidate_source: DiscoverySourceKey })[] {
  return db
    .prepare(`
      SELECT discovery_candidate_history.*, users.name AS actor_name,
             discovery_candidates.name AS candidate_name, discovery_candidates.source AS candidate_source
      FROM discovery_candidate_history
      JOIN discovery_candidates ON discovery_candidates.id = discovery_candidate_history.candidate_id
      LEFT JOIN users ON users.id = discovery_candidate_history.actor_id
      WHERE discovery_candidate_history.from_status IS NOT NULL
      ORDER BY discovery_candidate_history.created_at DESC, discovery_candidate_history.id DESC
      LIMIT ?
    `)
    .all(limit) as (DiscoveryCandidateHistoryEntry & { candidate_name: string; candidate_source: DiscoverySourceKey })[];
}

export function getDiscoveryCandidateCountsByStatus(): Record<DiscoveryCandidateStatus, number> {
  const rows = db.prepare('SELECT status, COUNT(*) AS c FROM discovery_candidates GROUP BY status').all() as { status: DiscoveryCandidateStatus; c: number }[];
  const counts: Record<DiscoveryCandidateStatus, number> = { new: 0, watching: 0, approved: 0, passed: 0 };
  for (const row of rows) counts[row.status] = row.c;
  return counts;
}

// Genre coverage monitoring — YouTube-only (yt_genre is null for every
// Soundcharts candidate), so a genre that's gone quiet (0 candidates for
// several runs) is visible instead of invisible inside one aggregate count.
export function getDiscoveryCandidateCountsByGenre(): { genre: string; count: number }[] {
  return db
    .prepare("SELECT yt_genre AS genre, COUNT(*) AS count FROM discovery_candidates WHERE yt_genre IS NOT NULL GROUP BY yt_genre ORDER BY count DESC")
    .all() as { genre: string; count: number }[];
}

// "Candidate count by scan" — the run history the Admin discovery page
// actually needs (getLatestDiscoveryRun alone only ever shows one row).
// candidateCount reflects insertDiscoveryCandidate's own bookkeeping via
// discovery_run_id, which can differ from a run's own candidates_found if
// an insert failed after scoring (see app/api/discovery/scan-youtube) —
// showing both side by side surfaces that gap instead of hiding it.
export function getRecentDiscoveryRunsWithCandidateCounts(source: DiscoverySourceKey, limit = 10): (DiscoveryRun & { candidateCount: number })[] {
  return db
    .prepare(`
      SELECT discovery_runs.*, COUNT(discovery_candidates.id) AS candidateCount
      FROM discovery_runs
      LEFT JOIN discovery_candidates ON discovery_candidates.discovery_run_id = discovery_runs.id
      WHERE discovery_runs.source = ?
      GROUP BY discovery_runs.id
      ORDER BY discovery_runs.started_at DESC, discovery_runs.id DESC
      LIMIT ?
    `)
    .all(source, limit) as (DiscoveryRun & { candidateCount: number })[];
}

// Approving a candidate creates the real, editable artist row — pre-filled
// with what Discovery already knows, stage 'watchlist', score inputs at the
// neutral default. It does NOT auto-list on NEXT or assign a Breakout Score;
// a human still rates the eight categories before this artist is real to
// the product, same as any artist Scout added by hand.
// The scan-bucket keys used internally by lib/youtube-discovery.ts
// (DEFAULT_YOUTUBE_GENRES) — a Scout approving a candidate should see
// "Hip-Hop/Rap," not the raw search-bucket key "hip-hop-rap".
export const YOUTUBE_GENRE_LABELS: Record<string, string> = {
  'hip-hop-rap': 'Hip-Hop/Rap',
  pop: 'Pop',
  rnb: 'R&B',
  country: 'Country',
  'rock-alternative': 'Rock/Alternative',
  electronic: 'Electronic',
};

// --- NEXT Feed ---
// See the FeedEvent type's own comment (lib/types.ts) for why this is a
// real persisted table rather than the compute-live pattern
// lib/notifications.ts uses. This file only owns writing/reading rows;
// lib/feed-signals.ts owns deciding WHEN an automated (non-user-triggered)
// event is worth creating.

export function getFeedEvent(id: number): FeedEvent | undefined {
  return db.prepare('SELECT * FROM feed_events WHERE id = ?').get(id) as FeedEvent | undefined;
}

// Returns the created row, or null if a dedupe_key collision meant this
// exact event already existed (INSERT OR IGNORE — a no-op, not an error,
// since "someone already posted this" is the expected/desired outcome of
// a duplicate call, not a failure). Rows with no dedupe_key always insert.
export function createFeedEvent(input: {
  eventType: FeedEventType;
  actorUserId?: number;
  artistId?: number;
  refType?: string;
  refId?: number;
  metadata?: Record<string, unknown>;
  dedupeKey?: string;
}): FeedEvent | null {
  const info = db
    .prepare(`
      INSERT OR IGNORE INTO feed_events (event_type, actor_user_id, artist_id, ref_type, ref_id, visibility, metadata, dedupe_key, created_at)
      VALUES (?, ?, ?, ?, ?, 'public', ?, ?, ?)
    `)
    .run(
      input.eventType, input.actorUserId ?? null, input.artistId ?? null, input.refType ?? null, input.refId ?? null,
      input.metadata ? JSON.stringify(input.metadata) : null, input.dedupeKey ?? null, new Date().toISOString()
    );
  if (info.changes === 0) return null; // dedupe_key already existed
  return getFeedEvent(info.lastInsertRowid as number) ?? null;
}

// The cooldown check for automated signal events (see lib/feed-signals.ts)
// — "has this exact signal already fired for this artist recently?" A
// sliding time window can't be expressed as a unique-index dedupe_key
// (that only ever means "never/always", not "not within N days"), so this
// is a plain lookup the generator calls before deciding to post.
export function hasFeedEventSince(eventType: FeedEventType, artistId: number, sinceISO: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM feed_events WHERE event_type = ? AND artist_id = ? AND created_at >= ? LIMIT 1')
    .get(eventType, artistId, sinceISO);
  return Boolean(row);
}

// Newest-first, optionally paged with `beforeId` (strictly less than, so
// paging never re-shows or skips a row even if new events are inserted
// between pages). No feed-ranking/personalization here yet — that's the
// UI-facing PR; this is the plain chronological read the schema needs to
// be genuinely useful and testable on its own.
export function getFeedEvents(limit = 50, beforeId?: number): FeedEvent[] {
  if (beforeId != null) {
    return db.prepare('SELECT * FROM feed_events WHERE id < ? ORDER BY id DESC LIMIT ?').all(beforeId, limit) as FeedEvent[];
  }
  return db.prepare('SELECT * FROM feed_events ORDER BY id DESC LIMIT ?').all(limit) as FeedEvent[];
}

export function getFeedEventCount(): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM feed_events').get() as { c: number }).c;
}

// Same anti-spam-not-fraud-detection posture as TRADE_RATE_LIMIT_PER_MINUTE
// above — a reaction is low-stakes, so this is generous, just enough to
// stop one account hammering the endpoint faster than any real person taps.
export const REACTION_RATE_LIMIT_PER_MINUTE = 30;

// Reads feed_reaction_taps (see its own comment in the DDL above), not
// feed_reactions — the latter is mutable and would undercount a user
// rapidly toggling the same reaction on and off, since each "off" deletes
// its own row.
export function getRecentReactionCount(userId: number, minutes: number): number {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = db.prepare('SELECT COUNT(*) AS c FROM feed_reaction_taps WHERE user_id = ? AND created_at >= ?').get(userId, cutoff) as { c: number };
  return row.c;
}

// One reaction per user per post — tapping the same reaction again removes
// it (returns null), tapping a different one changes it in place. The
// UNIQUE(feed_event_id, user_id) index is what makes this atomic instead of
// a check-then-write race. Every call — add, change, or remove — logs one
// row to feed_reaction_taps for rate limiting, regardless of outcome.
export function setFeedReaction(feedEventId: number, userId: number, reactionType: ReactionType): FeedReaction | null {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO feed_reaction_taps (user_id, created_at) VALUES (?, ?)').run(userId, now);

  const existing = db
    .prepare('SELECT * FROM feed_reactions WHERE feed_event_id = ? AND user_id = ?')
    .get(feedEventId, userId) as FeedReaction | undefined;

  if (existing && existing.reaction_type === reactionType) {
    db.prepare('DELETE FROM feed_reactions WHERE id = ?').run(existing.id);
    return null;
  }
  if (existing) {
    db.prepare('UPDATE feed_reactions SET reaction_type = ?, created_at = ? WHERE id = ?').run(reactionType, now, existing.id);
    return { ...existing, reaction_type: reactionType };
  }
  const info = db
    .prepare('INSERT INTO feed_reactions (feed_event_id, user_id, reaction_type, created_at) VALUES (?, ?, ?, ?)')
    .run(feedEventId, userId, reactionType, now);
  return { id: info.lastInsertRowid as number, feed_event_id: feedEventId, user_id: userId, reaction_type: reactionType, created_at: now };
}

export function getFeedReactionCounts(feedEventId: number): Record<ReactionType, number> {
  const rows = db
    .prepare('SELECT reaction_type, COUNT(*) AS c FROM feed_reactions WHERE feed_event_id = ? GROUP BY reaction_type')
    .all(feedEventId) as { reaction_type: ReactionType; c: number }[];
  const counts: Record<ReactionType, number> = { fire: 0, eyes: 0, early: 0 };
  for (const row of rows) counts[row.reaction_type] = row.c;
  return counts;
}

// Batch versions of the two lookups above, for rendering a whole page of
// feed items in a fixed number of queries instead of two per card.
export function getFeedReactionCountsForEvents(feedEventIds: number[]): Map<number, Record<ReactionType, number>> {
  const result = new Map<number, Record<ReactionType, number>>();
  if (feedEventIds.length === 0) return result;
  const placeholders = feedEventIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT feed_event_id, reaction_type, COUNT(*) AS c FROM feed_reactions WHERE feed_event_id IN (${placeholders}) GROUP BY feed_event_id, reaction_type`)
    .all(...feedEventIds) as { feed_event_id: number; reaction_type: ReactionType; c: number }[];
  for (const row of rows) {
    const counts = result.get(row.feed_event_id) ?? { fire: 0, eyes: 0, early: 0 };
    counts[row.reaction_type] = row.c;
    result.set(row.feed_event_id, counts);
  }
  return result;
}

export function getUserFeedReactionsForEvents(userId: number, feedEventIds: number[]): Map<number, ReactionType> {
  const result = new Map<number, ReactionType>();
  if (feedEventIds.length === 0) return result;
  const placeholders = feedEventIds.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT feed_event_id, reaction_type FROM feed_reactions WHERE user_id = ? AND feed_event_id IN (${placeholders})`)
    .all(userId, ...feedEventIds) as { feed_event_id: number; reaction_type: ReactionType }[];
  for (const row of rows) result.set(row.feed_event_id, row.reaction_type);
  return result;
}

// --- NEXT Feed: User Take posts ---

export const USER_TAKE_BODY_MAX_LENGTH = 500;
// A post is heavier content than a trade or a tap, so a tighter window
// than TRADE_RATE_LIMIT_PER_MINUTE/REACTION_RATE_LIMIT_PER_MINUTE — still
// generous for genuine use (a real person posting 5 takes in 10 minutes is
// already an unusual pace), tight enough to bound spam.
export const USER_TAKE_RATE_LIMIT_PER_10_MIN = 5;

export function getRecentUserTakePostCount(userId: number, minutes: number): number {
  const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  const row = db.prepare('SELECT COUNT(*) AS c FROM feed_user_posts WHERE user_id = ? AND created_at >= ?').get(userId, cutoff) as { c: number };
  return row.c;
}

// Business-logic validation lives here (matches executeTrade's own
// ok/error result shape); auth and the rate-limit check above live in the
// route, same split every other Feed-writing route already uses.
export function createUserTakePost(
  userId: number,
  artistId: number,
  rawBody: string
): { ok: true; post: FeedUserPost; event: FeedEvent } | { ok: false; error: string } {
  const body = rawBody.trim().replace(/\n{3,}/g, '\n\n');
  if (!body) return { ok: false, error: 'Your take can\'t be empty.' };
  if (body.length > USER_TAKE_BODY_MAX_LENGTH) return { ok: false, error: `Keep it under ${USER_TAKE_BODY_MAX_LENGTH} characters.` };

  const artist = getArtist(artistId);
  if (!artist || artist.stage === 'passed') return { ok: false, error: 'That artist is not on NEXT.' };

  // Prevent a duplicated/rapid-retried submission (a flaky network, an
  // accidental double-tap) from posting the same take twice, without full
  // idempotency-key plumbing — a post isn't financial, so "same user, same
  // artist, same exact text, within the last minute" is a cheap, sufficient
  // guard rather than trade-style client-generated keys.
  const dupCutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const dup = db
    .prepare('SELECT 1 FROM feed_user_posts WHERE user_id = ? AND artist_id = ? AND body = ? AND created_at >= ? LIMIT 1')
    .get(userId, artistId, body, dupCutoff);
  if (dup) return { ok: false, error: 'You just posted that — give it a moment before posting again.' };

  const now = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO feed_user_posts (user_id, artist_id, body, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, artistId, body, now);
  const post = getUserTakePostById(info.lastInsertRowid as number)!;

  // No dedupe_key — every genuine post is meant to create its own event
  // (unlike a signal, a take is never "the same thing happening again").
  const event = createFeedEvent({ eventType: 'user_take', actorUserId: userId, artistId, refType: 'user_post', refId: post.id })!;
  return { ok: true, post, event };
}

export function getUserTakePostById(id: number): FeedUserPost | undefined {
  return db.prepare('SELECT * FROM feed_user_posts WHERE id = ?').get(id) as FeedUserPost | undefined;
}

export function getUserTakePostsByIds(ids: number[]): Map<number, FeedUserPost> {
  const result = new Map<number, FeedUserPost>();
  if (ids.length === 0) return result;
  const unique = [...new Set(ids)];
  const placeholders = unique.map(() => '?').join(',');
  const rows = db.prepare(`SELECT * FROM feed_user_posts WHERE id IN (${placeholders})`).all(...unique) as FeedUserPost[];
  for (const row of rows) result.set(row.id, row);
  return result;
}

// Soft delete only, and only the owner may do it. The feed_events row is
// left in place — lib/feed-items.ts drops any user_take item whose post is
// deleted/hidden at render time, the same "resolve, then filter" pattern
// already used for an item whose artist no longer resolves.
export function deleteUserTakePost(userId: number, postId: number): boolean {
  const info = db.prepare('UPDATE feed_user_posts SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .run(new Date().toISOString(), postId, userId);
  return info.changes > 0;
}

export function getUserTakePostsForUser(userId: number): (FeedUserPost & { artist_name: string })[] {
  return db.prepare(`
    SELECT feed_user_posts.*, artists.name AS artist_name
    FROM feed_user_posts
    JOIN artists ON artists.id = feed_user_posts.artist_id
    WHERE feed_user_posts.user_id = ? AND feed_user_posts.deleted_at IS NULL
    ORDER BY feed_user_posts.created_at DESC
  `).all(userId) as (FeedUserPost & { artist_name: string })[];
}

// One report per (post, reporter) — a second report from the same person
// is a silent no-op via the UNIQUE index, not an error.
export function reportUserTakePost(reporterId: number, postId: number): void {
  db.prepare('INSERT OR IGNORE INTO feed_post_reports (post_id, reporter_user_id, created_at) VALUES (?, ?, ?)')
    .run(postId, reporterId, new Date().toISOString());
}

// Admin moderation view — every post with at least one report, newest
// report first, with exactly what a moderator needs: the real account
// behind it (name/email, not just a display name), the artist context, and
// how many people flagged it. report_count is COUNT(*) at read time, never
// a maintained column (see feed_post_reports' own DDL comment).
export function getReportedUserTakePosts(): {
  post: FeedUserPost; authorName: string; authorEmail: string; artistName: string; reportCount: number; lastReportedAt: string;
}[] {
  const rows = db.prepare(`
    SELECT
      feed_user_posts.*,
      users.name AS author_name, users.email AS author_email,
      artists.name AS artist_name,
      COUNT(feed_post_reports.id) AS report_count,
      MAX(feed_post_reports.created_at) AS last_reported_at
    FROM feed_post_reports
    JOIN feed_user_posts ON feed_user_posts.id = feed_post_reports.post_id
    JOIN users ON users.id = feed_user_posts.user_id
    JOIN artists ON artists.id = feed_user_posts.artist_id
    GROUP BY feed_user_posts.id
    ORDER BY last_reported_at DESC
  `).all() as any[];
  return rows.map((r) => ({
    post: {
      id: r.id, user_id: r.user_id, artist_id: r.artist_id, body: r.body, created_at: r.created_at,
      deleted_at: r.deleted_at ?? undefined, hidden_at: r.hidden_at ?? undefined, hidden_by: r.hidden_by ?? undefined,
    },
    authorName: r.author_name,
    authorEmail: r.author_email,
    artistName: r.artist_name,
    reportCount: r.report_count,
    lastReportedAt: r.last_reported_at,
  }));
}

export function hideUserTakePost(adminId: number, postId: number): boolean {
  const info = db.prepare('UPDATE feed_user_posts SET hidden_at = ?, hidden_by = ? WHERE id = ? AND hidden_at IS NULL')
    .run(new Date().toISOString(), adminId, postId);
  return info.changes > 0;
}

export function unhideUserTakePost(postId: number): boolean {
  const info = db.prepare('UPDATE feed_user_posts SET hidden_at = NULL, hidden_by = NULL WHERE id = ?').run(postId);
  return info.changes > 0;
}

// Composer artist search — substring match over the live NEXT roster,
// capped small since this backs an autocomplete dropdown, not a full
// Discover-style browse. findArtistsByName (above) is exact-match only
// (duplicate-submission checking), not what a search box needs.
export function searchNextArtists(query: string, limit = 8): { id: number; name: string; photo_url?: string; genre?: string }[] {
  const term = query.trim();
  if (term.length < 1) return [];
  return db
    .prepare(`
      SELECT id, name, photo_url, genre FROM artists
      WHERE stage != 'passed' AND name LIKE ? ESCAPE '\\'
      ORDER BY (CASE WHEN LOWER(name) LIKE LOWER(?) THEN 0 ELSE 1 END), name ASC
      LIMIT ?
    `)
    .all(`%${term.replace(/[%_\\]/g, '\\$&')}%`, `${term}%`, limit) as { id: number; name: string; photo_url?: string; genre?: string }[];
}

export function approveDiscoveryCandidate(id: number, actor: Actor): Artist | undefined {
  const candidate = getDiscoveryCandidate(id);
  if (!candidate || candidate.status === 'approved') return undefined;

  const artist = createArtist(
    {
      name: candidate.name,
      photo_url: candidate.photo_url,
      location: candidate.country,
      genre: candidate.yt_genre ? (YOUTUBE_GENRE_LABELS[candidate.yt_genre] ?? candidate.yt_genre) : undefined,
      followers_count: candidate.followers_count,
      growth_velocity_pct: candidate.growth_30d_pct,
      soundcharts_uuid: candidate.soundcharts_uuid,
      why_trending: candidate.flagged_reason,
      featured_video_id: candidate.yt_video_id,
      // The Add Artist form always starts all eight rated categories at a
      // neutral 5/10 (see ArtistForm.tsx) rather than leaving them unset —
      // approval bypasses that form entirely and was falling through to
      // createArtist's raw 0 default instead. At weights summing to 100%
      // of the Breakout Score, that meant every freshly-discovered artist
      // scored as "Pass" regardless of how strong the signal that flagged
      // them was. growth_velocity/engagement_quality used to get a real
      // starting value for free here (auto-derived from the candidate's
      // real growth %) — now that both are Scout-manual (pre-beta
      // migration, see the WRITABLE_FIELDS comment above), they get the
      // same neutral 5 as the other six, pending an actual Scout rating.
      music_talent: 5,
      growth_velocity: 5,
      engagement_quality: 5,
      original_song_response: 5,
      brand_personality: 5,
      content_consistency: 5,
      commercial_potential: 5,
      professionalism: 5,
    },
    actor
  );

  db.prepare('UPDATE discovery_candidates SET status = ?, reviewed_at = ?, reviewed_by = ?, artist_id = ? WHERE id = ?')
    .run('approved', new Date().toISOString(), actor.id, artist.id, id);
  logDiscoveryCandidateHistory(id, candidate.status, 'approved', actor.id);

  // dedupe_key ties to this specific candidate row, so re-approving (can't
  // happen — the guard at the top returns early on an already-approved
  // candidate) or any future retry can never double-post either event.
  createFeedEvent({
    eventType: 'new_artist',
    artistId: artist.id,
    refType: 'discovery_candidate',
    refId: id,
    metadata: { genre: artist.genre, score: breakoutScore(artist) },
    dedupeKey: `new_artist:${id}`,
  });
  // A public submission (someone pasted a link on /next/submit-artist)
  // carries real discoverer attribution — see discovery_candidates.
  // submitted_by_user_id. A YouTube-scan or Soundcharts-sourced candidate
  // has no submitter, so it's a New Artist event only, never a "someone
  // found this" one.
  if (candidate.submitted_by_user_id) {
    createFeedEvent({
      eventType: 'early_discovery',
      actorUserId: candidate.submitted_by_user_id,
      artistId: artist.id,
      refType: 'discovery_candidate',
      refId: id,
      metadata: { followersAtDiscovery: candidate.followers_count, genre: artist.genre },
      dedupeKey: `early_discovery:${id}`,
    });
  }

  return artist;
}

// Artist claims — see the ArtistClaim type's own comment for why this is a
// review queue rather than a direct write to artists.claimed_by_user_id.
const ARTIST_CLAIM_SELECT = `
  SELECT artist_claims.*, artists.name AS artist_name,
         claimants.name AS user_name, claimants.email AS user_email,
         reviewers.name AS reviewed_by_name
  FROM artist_claims
  JOIN artists ON artists.id = artist_claims.artist_id
  JOIN users claimants ON claimants.id = artist_claims.user_id
  LEFT JOIN users reviewers ON reviewers.id = artist_claims.reviewed_by
`;

export function getArtistClaim(id: number): ArtistClaim | undefined {
  return db.prepare(`${ARTIST_CLAIM_SELECT} WHERE artist_claims.id = ?`).get(id) as ArtistClaim | undefined;
}

export function getPendingArtistClaims(): ArtistClaim[] {
  return db
    .prepare(`${ARTIST_CLAIM_SELECT} WHERE artist_claims.status = 'pending' ORDER BY artist_claims.created_at ASC`)
    .all() as ArtistClaim[];
}

export function getPendingArtistClaimCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS c FROM artist_claims WHERE status = 'pending'").get() as { c: number };
  return row.c;
}

export function getArtistClaimsForUser(userId: number): ArtistClaim[] {
  return db
    .prepare(`${ARTIST_CLAIM_SELECT} WHERE artist_claims.user_id = ? ORDER BY artist_claims.created_at DESC`)
    .all(userId) as ArtistClaim[];
}

export function getPendingClaimForUserAndArtist(userId: number, artistId: number): ArtistClaim | undefined {
  return db
    .prepare(`${ARTIST_CLAIM_SELECT} WHERE artist_claims.user_id = ? AND artist_claims.artist_id = ? AND artist_claims.status = 'pending'`)
    .get(userId, artistId) as ArtistClaim | undefined;
}

// The only artists a claim's own user_id is allowed to see the Artist
// Dashboard for — see requireArtistOwner in lib/auth.ts.
export function getArtistsClaimedByUser(userId: number): Artist[] {
  return db.prepare(`${ARTIST_SELECT} WHERE artists.claimed_by_user_id = ? ORDER BY artists.name ASC`).all(userId) as Artist[];
}

// Rejects with a reason string rather than throwing — these are all
// expected, user-facing outcomes (already claimed, duplicate pending
// request), not exceptional failures, so the API route can turn `reason`
// straight into the response instead of every caller needing a try/catch.
export function createArtistClaim(
  artistId: number,
  userId: number,
  message: string | undefined
): { ok: true; claim: ArtistClaim } | { ok: false; reason: string } {
  const artist = getArtist(artistId);
  if (!artist) return { ok: false, reason: 'Artist not found.' };
  if (artist.claimed_by_user_id != null) {
    return {
      ok: false,
      reason: artist.claimed_by_user_id === userId ? 'You already claimed this profile.' : 'This profile has already been claimed.',
    };
  }

  try {
    const info = db
      .prepare('INSERT INTO artist_claims (artist_id, user_id, message, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(artistId, userId, message ?? null, 'pending', new Date().toISOString());
    return { ok: true, claim: getArtistClaim(info.lastInsertRowid as number)! };
  } catch (err: any) {
    if (/UNIQUE/i.test(err?.message ?? '')) return { ok: false, reason: 'You already have a pending claim on this artist.' };
    throw err;
  }
}

export function reviewArtistClaim(id: number, decision: 'approved' | 'rejected', actor: Actor): ArtistClaim | undefined {
  const existing = getArtistClaim(id);
  if (!existing || existing.status !== 'pending') return undefined;

  const now = new Date().toISOString();
  db.prepare('UPDATE artist_claims SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?').run(decision, now, actor.id, id);

  if (decision === 'approved') {
    db.prepare('UPDATE artists SET claimed_by_user_id = ?, updated_at = ? WHERE id = ?').run(existing.user_id, now, existing.artist_id);
    addLogEntry(existing.artist_id, { type: 'claim', message: `Profile claim approved for ${existing.user_name ?? `user #${existing.user_id}`}.` }, actor);
  }

  return getArtistClaim(id);
}
