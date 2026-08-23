import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { breakoutScore, engagementQualityScore, growthVelocityScore } from './scoring';
import { DATA_DIR } from './data-dir';
import { applyTradeImpact, executionPriceCents, NEXT_STARTING_CREDITS_CENTS, nextBasePriceCents } from './next-market';
import { EARLY_DISCOVERY_RANK_THRESHOLD, scoutScore } from './scout-score';
import type { DiscoveryRejectionBreakdown } from './discovery-source';
import {
  Agreement, AgreementInput, Artist, ArtistInput, DiscoveryCandidate, DiscoveryCandidateStatus, DiscoveryRun,
  DiscoverySourceKey, DueFollowUp, FoundingBelieverRecord, GenreLeaderboardEntry, InvestmentEntry, InvestmentEntryInput,
  LeaderboardEntry, LogEntry, LogEntryInput, NextHolding, NextMarketRow, NextPricePoint, NextTransaction,
  NextTransactionType, PortfolioValue, RevenueEntry, RevenueEntryInput, RevenueSource, Role, SCORE_WEIGHTS,
  ScoreChange, ScoreSnapshot, ScoutProfile, SyncRun, SyncSourceKey, User, WatchlistEntry,
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
    momentum_score REAL,
    flagged_reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    discovered_at TEXT NOT NULL,
    reviewed_at TEXT,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL
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
}
ensureDiscoveryCandidatesSchema();
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

const WRITABLE_FIELDS = [
  'name', 'stage', 'genre', 'location', 'scout_name',
  'tiktok_url', 'instagram_url', 'youtube_url', 'spotify_url', 'soundcloud_url',
  'followers_count', 'monthly_listeners', 'growth_velocity_pct', 'engagement_rate_pct',
  'music_talent', 'original_song_response',
  'brand_personality', 'content_consistency', 'commercial_potential', 'professionalism',
  'notes', 'photo_url', 'bio', 'top_song_url', 'song_preview_url', 'why_trending', 'soundcharts_uuid',
  'featured_video_id',
] as const;

// growth_velocity and engagement_quality are deliberately NOT writable
// fields — they're always derived from growth_velocity_pct/
// engagement_rate_pct (see lib/scoring.ts) right here, so every write path
// (the form, the API, Discovery's Approve) stays consistent by
// construction instead of each caller needing to remember to compute them.
const DERIVED_SCORE_FIELDS = ['growth_velocity', 'engagement_quality'] as const;

// The six remaining (human-rated) score columns are NOT NULL DEFAULT 0 in
// the schema — a caller that omits them (e.g. approving a Discovery
// candidate, which deliberately leaves rating to a human) must still get
// 0, not null, or the insert violates that constraint.
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
  row.growth_velocity = growthVelocityScore(row.growth_velocity_pct as number | null);
  row.engagement_quality = engagementQualityScore(row.engagement_rate_pct as number | null);

  const columns = ['created_at', 'updated_at', 'created_by', ...WRITABLE_FIELDS, ...DERIVED_SCORE_FIELDS];
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
    // Re-derive from whatever the growth/engagement % ends up being after
    // this update (the new value if this update touched it, the existing
    // one otherwise) — never left stale relative to the % that actually
    // drives it.
    const nextGrowthPct = 'growth_velocity_pct' in input ? input.growth_velocity_pct ?? null : existing.growth_velocity_pct ?? null;
    const nextEngagementPct = 'engagement_rate_pct' in input ? input.engagement_rate_pct ?? null : existing.engagement_rate_pct ?? null;
    sets.push('growth_velocity = @growth_velocity', 'engagement_quality = @engagement_quality');
    row.growth_velocity = growthVelocityScore(nextGrowthPct);
    row.engagement_quality = engagementQualityScore(nextEngagementPct);
    db.prepare(`UPDATE artists SET updated_at = @updated_at, ${sets.join(', ')} WHERE id = @id`).run(row);
  }
  const updated = getArtist(id)!;
  if (input.stage && input.stage !== existing.stage) {
    addLogEntry(id, {
      type: 'status_change',
      message: `Stage changed from "${existing.stage}" to "${updated.stage}"`,
    }, actor);
  }
  if (sets.length > 0) snapshotScore(updated);
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

export function getArtistLog(artistId: number): LogEntry[] {
  return db
    .prepare('SELECT * FROM contact_log WHERE artist_id = ? ORDER BY created_at DESC')
    .all(artistId) as LogEntry[];
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
  'id, created_at, name, email, role, next_credits_cents, next_onboarded_at, avatar_url, email_verified_at, tos_accepted_at, privacy_accepted_at';

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
export function updateUserProfile(userId: number, input: { name?: string; avatar_url?: string | null }): User | undefined {
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
  if (sets.length === 0) return getUserById(userId);
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getUserById(userId);
}

export function updateUserPasswordHash(userId: number, password_hash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, userId);
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
  return db
    .prepare(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE email = ?`)
    .get(email.toLowerCase()) as (User & { password_hash: string }) | undefined;
}

export function getUserById(id: number): User | undefined {
  return db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(id) as User | undefined;
}

// Server-only, used solely by the change-password route to verify the
// caller's current password before accepting a new one — never exposed on
// the public User type.
export function getUserPasswordHash(id: number): string | undefined {
  return (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as { password_hash: string } | undefined)?.password_hash;
}

export function getAllUsers(): User[] {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at ASC`).all() as User[];
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
  db.prepare('UPDATE users SET next_onboarded_at = ? WHERE id = ? AND next_onboarded_at IS NULL').run(new Date().toISOString(), userId);
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

export function getNextMarket(): NextMarketRow[] {
  return getAllArtists()
    .filter((a) => a.stage !== 'passed')
    .map((artist) => ({
      artist,
      score: breakoutScore(artist),
      priceCents: ensureNextPrice(artist),
      priceHistory: getNextPriceHistory(artist.id),
    }));
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

export function getNextArtist(artistId: number): NextMarketRow | undefined {
  const artist = getArtist(artistId);
  if (!artist) return undefined;
  return {
    artist,
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

export function getUserHoldings(userId: number): (NextHolding & { artist_name: string; artist_photo_url?: string; price_cents: number })[] {
  const rows = db.prepare(`
    SELECT next_holdings.*, artists.name AS artist_name, artists.photo_url AS artist_photo_url
    FROM next_holdings
    JOIN artists ON artists.id = next_holdings.artist_id
    WHERE next_holdings.user_id = ? AND next_holdings.shares > 0
    ORDER BY next_holdings.updated_at DESC
  `).all(userId) as (NextHolding & { artist_name: string; artist_photo_url?: string })[];
  return rows.map((row) => {
    const artist = getArtist(row.artist_id)!;
    return { ...row, price_cents: ensureNextPrice(artist) };
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
function valueAtOrBefore<T>(series: T[], at: string, recordedAt: (item: T) => string): T | null {
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

    const tx = db.transaction(() => {
      if (holding) {
        db.prepare('UPDATE next_holdings SET shares = ?, cost_basis_cents = ?, updated_at = ? WHERE id = ?')
          .run(newShares, newCostBasis, now, holding.id);
      } else {
        db.prepare('INSERT INTO next_holdings (user_id, artist_id, shares, cost_basis_cents, updated_at) VALUES (?, ?, ?, ?, ?)')
          .run(userId, artistId, newShares, newCostBasis, now);
      }
      db.prepare('UPDATE users SET next_credits_cents = next_credits_cents - ? WHERE id = ?')
        .run(creditsAmountCents, userId);
      db.prepare(`
        INSERT INTO next_transactions (user_id, artist_id, created_at, type, shares, price_cents_per_share, credits_delta_cents, listened_before_buy)
        VALUES (?, ?, ?, 'buy', ?, ?, ?, ?)
      `).run(userId, artistId, now, shares, executionCents, -creditsAmountCents, listenedBeforeBuy);

      db.prepare('UPDATE artists SET next_current_price_cents = ? WHERE id = ?').run(postPriceCents, artistId);
      db.prepare('INSERT INTO next_price_history (artist_id, recorded_at, price_cents) VALUES (?, ?, ?)').run(artistId, now, postPriceCents);

      recordFoundingBelieverIfFirstBuy(userId, artistId, artist, breakoutScore(artist), executionCents, now);
    });
    tx();

    return { ok: true, shares, priceCents: executionCents, newBalanceCents: user.next_credits_cents - creditsAmountCents };
  }

  // sell
  const holding = getHolding(userId, artistId);
  const ownedShares = holding?.shares ?? 0;
  if (!holding || ownedShares <= 0) return { ok: false, error: "you don't own any shares of this artist" };

  const requestedShares = creditsAmountCents / prePriceCents;
  const sharesSold = Math.min(requestedShares, ownedShares);
  // Size impact by what's actually being sold (valued at the pre-trade
  // price), not the originally requested amount — matters when the request
  // gets capped by ownedShares.
  const notionalAtPrePriceCents = Math.round(sharesSold * prePriceCents);
  const postPriceCents = applyTradeImpact(prePriceCents, notionalAtPrePriceCents, 'sell');
  const executionCents = executionPriceCents(prePriceCents, postPriceCents);
  const proceedsCents = Math.round(sharesSold * executionCents);
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

// --- Scout Identity: public profiles, leaderboards, Founding Believer ---

export function getPortfolioValue(userId: number): PortfolioValue {
  const user = getUserById(userId)!;
  const holdings = getUserHoldings(userId);
  const holdingsValueCents = holdings.reduce((sum, h) => sum + Math.round(h.shares * h.price_cents), 0);
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

// Ranked by all-time total return %; ties broken by artists backed (more
// activity outranks a flat, untouched account at the same 0%).
export function getScoutLeaderboard(): LeaderboardEntry[] {
  const entries = getAllUsers().map((user) => ({
    user: { id: user.id, name: user.name },
    rank: 0,
    totalReturnPct: getPortfolioValue(user.id).totalReturnPct,
    artistsBackedCount: getArtistsBackedCount(user.id),
  }));
  entries.sort((a, b) => b.totalReturnPct - a.totalReturnPct || b.artistsBackedCount - a.artistsBackedCount);
  entries.forEach((e, i) => { e.rank = i + 1; });
  return entries;
}

export function getScoutProfile(userId: number): ScoutProfile | undefined {
  const user = getUserById(userId);
  if (!user) return undefined;
  const leaderboard = getScoutLeaderboard();
  const entry = leaderboard.find((e) => e.user.id === userId)!;
  const portfolio = getPortfolioValue(userId);
  const earlyDiscoveriesCount = getEarlyDiscoveriesCount(userId);
  return {
    user: { id: user.id, name: user.name },
    portfolio,
    scoutScoreValue: scoutScore({ totalReturnPct: portfolio.totalReturnPct, earlyDiscoveriesCount }),
    rank: entry.rank,
    totalScouts: leaderboard.length,
    artistsBackedCount: entry.artistsBackedCount,
    earlyDiscoveriesCount,
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
      pnlCents += Math.round(h.shares * ensureNextPrice(artist)) - h.cost_basis_cents;
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
    entries.push({ user: { id: user.id, name: user.name }, rank: 0, pnlCents, artistsBackedCount: artistIds.size });
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

// --- Discovery Engine ---

export function getTrackedSoundchartsUuids(): Set<string> {
  const rows = db.prepare("SELECT soundcharts_uuid FROM artists WHERE soundcharts_uuid IS NOT NULL").all() as { soundcharts_uuid: string }[];
  return new Set(rows.map((r) => r.soundcharts_uuid));
}

// Every artist linked to a Soundcharts profile — the exact set a sync run
// needs to refresh. Unlinked artists (no soundcharts_uuid) are untouched by
// automated sync; their stats stay manual-entry only, same as today.
export function getArtistsWithSoundchartsLink(): { id: number; soundcharts_uuid: string }[] {
  return db
    .prepare("SELECT id, soundcharts_uuid FROM artists WHERE soundcharts_uuid IS NOT NULL")
    .all() as { id: number; soundcharts_uuid: string }[];
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

// Artists still missing a top song link, for Deezer top-track sync —
// unlike Soundcharts sync (which only touches artists explicitly linked
// by uuid, but always re-fetches), this touches every artist regardless
// of a Soundcharts link, but only ones that don't already have one. Once
// filled — by this sync or typed in by hand — it's a Scout's curatorial
// choice of which song best represents the artist, so it's never
// silently overwritten; clear the field to have sync fill it again.
export function getArtistsMissingTopSong(): { id: number; name: string }[] {
  return db
    .prepare("SELECT id, name FROM artists WHERE top_song_url IS NULL OR top_song_url = ''")
    .all() as { id: number; name: string }[];
}

// Same "touch everyone, but only fill what's missing" shape as
// getArtistsMissingTopSong — a video a Scout picked by hand (or a
// discovery-approval video) is never silently overwritten; clear the
// field to have sync fill it again.
export function getArtistsMissingVideo(): { id: number; name: string; youtube_url?: string }[] {
  return db
    .prepare("SELECT id, name, youtube_url FROM artists WHERE featured_video_id IS NULL OR featured_video_id = ''")
    .all() as { id: number; name: string; youtube_url?: string }[];
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
  db.prepare(`
    UPDATE discovery_runs
    SET completed_at = ?, status = ?, searched_count = ?, candidates_found = ?, error = ?, quota_used = ?,
        rejected_not_official_release = ?, rejected_below_min_views = ?, rejected_no_subscriber_count = ?,
        rejected_subscriber_out_of_band = ?, rejected_below_momentum_threshold = ?, best_rejected_momentum_score = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(), result.status, result.searchedCount, result.candidatesFound, result.error ?? null, result.quotaUsed ?? null,
    r?.notOfficialRelease ?? null, r?.belowMinViews ?? null, r?.noSubscriberCount ?? null, r?.subscriberOutOfBand ?? null,
    r?.belowMomentumThreshold ?? null, r?.bestRejectedMomentumScore ?? null, id
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
  momentum_score?: number;
  flagged_reason: string;
};

const DISCOVERY_CANDIDATE_COLUMNS = [
  'source', 'soundcharts_uuid', 'name', 'photo_url', 'country',
  'followers_count', 'followers_7d_ago', 'followers_30d_ago', 'growth_7d_pct', 'growth_30d_pct',
  'yt_video_id', 'yt_channel_id', 'yt_channel_title', 'yt_genre', 'yt_view_count', 'yt_like_count',
  'yt_comment_count', 'yt_published_at', 'yt_channel_subscriber_count', 'yt_channel_view_count',
  'yt_views_per_day', 'yt_like_rate', 'yt_comment_rate', 'yt_views_per_subscriber', 'yt_hype_comment_rate',
  'yt_comments_analyzed', 'yt_example_comment_1', 'yt_example_comment_1_likes', 'yt_example_comment_2',
  'yt_example_comment_2_likes', 'momentum_score', 'flagged_reason',
] as const;

export function insertDiscoveryCandidate(c: NewDiscoveryCandidate): void {
  const columns = [...DISCOVERY_CANDIDATE_COLUMNS, 'status', 'discovered_at'];
  const placeholders = DISCOVERY_CANDIDATE_COLUMNS.map((col) => `@${col}`).join(', ');
  const row: Record<string, unknown> = { discovered_at: new Date().toISOString() };
  for (const col of DISCOVERY_CANDIDATE_COLUMNS) row[col] = (c as any)[col] ?? null;
  db.prepare(`
    INSERT INTO discovery_candidates (${columns.join(', ')})
    VALUES (${placeholders}, 'new', @discovered_at)
  `).run(row);
}

const DISCOVERY_CANDIDATE_SELECT = `
  SELECT discovery_candidates.*, users.name AS reviewed_by_name
  FROM discovery_candidates
  LEFT JOIN users ON users.id = discovery_candidates.reviewed_by
`;

// Soundcharts candidates rank by 30-day growth %, YouTube candidates by
// momentum_score — different scales, but both roughly "how hot is this
// right now" on a 0-a-few-hundred range, so COALESCE-ing them into one
// sort is an acceptable MVP approximation rather than two separate lists.
export function getDiscoveryCandidates(status?: DiscoveryCandidateStatus): DiscoveryCandidate[] {
  if (status) {
    return db
      .prepare(`${DISCOVERY_CANDIDATE_SELECT} WHERE discovery_candidates.status = ? ORDER BY COALESCE(discovery_candidates.momentum_score, discovery_candidates.growth_30d_pct) DESC NULLS LAST, discovery_candidates.discovered_at DESC`)
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

export function setDiscoveryCandidateStatus(
  id: number,
  status: 'watching' | 'passed',
  actor: Actor
): DiscoveryCandidate | undefined {
  const info = db
    .prepare('UPDATE discovery_candidates SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?')
    .run(status, new Date().toISOString(), actor.id, id);
  if (info.changes === 0) return undefined;
  return getDiscoveryCandidate(id);
}

// Approving a candidate creates the real, editable artist row — pre-filled
// with what Discovery already knows, stage 'watchlist', score inputs at the
// neutral default. It does NOT auto-list on NEXT or assign a Breakout Score;
// a human still rates the eight categories before this artist is real to
// the product, same as any artist Scout added by hand.
// The scan-bucket keys used internally by lib/youtube-discovery.ts
// (DEFAULT_YOUTUBE_GENRES) — a Scout approving a candidate should see
// "Hip-Hop/Rap," not the raw search-bucket key "hip-hop-rap".
const YOUTUBE_GENRE_LABELS: Record<string, string> = {
  'hip-hop-rap': 'Hip-Hop/Rap',
  pop: 'Pop',
  rnb: 'R&B',
  country: 'Country',
  'rock-alternative': 'Rock/Alternative',
  electronic: 'Electronic',
};

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
      // The Add Artist form always starts these six human-judgment ratings
      // at a neutral 5/10 (see ArtistForm.tsx) rather than leaving them
      // unset — approval bypasses that form entirely and was falling
      // through to createArtist's raw 0 default instead. At weights
      // summing to 70% of the Breakout Score, that meant every
      // freshly-discovered artist scored as "Pass" regardless of how
      // strong the real momentum signal that flagged them was — a Scout
      // had to hand-rate all six before NEXT Score reflected anything.
      // Matching the form's own neutral starting point here means a new
      // artist's score is driven by what's actually known (growth/
      // engagement, both real, auto-derived below) until a Scout reviews
      // and adjusts these to their own judgment.
      music_talent: 5,
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

  return artist;
}
