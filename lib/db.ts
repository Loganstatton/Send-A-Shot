import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { breakoutScore } from './scoring';
import { DATA_DIR } from './data-dir';
import { applyTradeImpact, executionPriceCents, NEXT_STARTING_CREDITS_CENTS, nextBasePriceCents } from './next-market';
import { EARLY_DISCOVERY_RANK_THRESHOLD, scoutScore } from './scout-score';
import {
  Agreement, AgreementInput, Artist, ArtistInput, DueFollowUp, FoundingBelieverRecord, GenreLeaderboardEntry,
  InvestmentEntry, InvestmentEntryInput, LeaderboardEntry, LogEntry, LogEntryInput, NextHolding, NextMarketRow,
  NextPricePoint, NextTransaction, NextTransactionType, PortfolioValue, RevenueEntry, RevenueEntryInput,
  RevenueSource, Role, ScoreSnapshot, ScoutProfile, User,
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
addColumnIfMissing('artists', 'next_current_price_cents INTEGER');
addColumnIfMissing('artists', 'photo_url TEXT');
addColumnIfMissing('artists', 'bio TEXT');
addColumnIfMissing('artists', 'top_song_url TEXT');
addColumnIfMissing('artists', 'song_preview_url TEXT');
addColumnIfMissing('artists', 'why_trending TEXT');

const ARTIST_SELECT = `
  SELECT artists.*, users.name AS created_by_name
  FROM artists
  LEFT JOIN users ON users.id = artists.created_by
`;

// Seed a few example artists so the dashboard isn't empty on first run.
const count = db.prepare('SELECT COUNT(*) as c FROM artists').get() as { c: number };
if (count.c === 0) {
  const now = new Date().toISOString();
  const seed: ArtistInput[] = [
    {
      name: 'Maya X',
      stage: 'contacted',
      genre: 'Pop/R&B',
      location: 'Austin, TX',
      scout_name: 'Stephen',
      tiktok_url: 'https://tiktok.com/@mayax',
      spotify_url: 'https://open.spotify.com/artist/example',
      followers_count: 18402,
      monthly_listeners: 42000,
      growth_velocity_pct: 117,
      engagement_rate_pct: 14.8,
      music_talent: 9,
      growth_velocity: 10,
      engagement_quality: 9,
      original_song_response: 9,
      brand_personality: 8,
      content_consistency: 8,
      commercial_potential: 9,
      professionalism: 8,
      notes: 'Original song "Undertow" is outperforming her covers 3:1. Comments are asking for a full release, not just "cute!"',
    },
    {
      name: 'Tyler Y',
      stage: 'watchlist',
      genre: 'Alt/Indie',
      location: 'Columbus, OH',
      scout_name: 'Stephen',
      tiktok_url: 'https://tiktok.com/@tylery',
      followers_count: 31201,
      monthly_listeners: 19000,
      growth_velocity_pct: 72,
      engagement_rate_pct: 11.2,
      music_talent: 8,
      growth_velocity: 7,
      engagement_quality: 8,
      original_song_response: 7,
      brand_personality: 7,
      content_consistency: 9,
      commercial_potential: 7,
      professionalism: 7,
      notes: 'Very consistent poster, 3-4 videos a week for 6 months straight. No original release yet.',
    },
    {
      name: 'Ada Bloom',
      stage: 'watchlist',
      genre: 'Bedroom pop',
      location: 'Remote',
      scout_name: 'Stephen',
      followers_count: 4700,
      monthly_listeners: 2100,
      growth_velocity_pct: 38,
      engagement_rate_pct: 12.7,
      music_talent: 9,
      growth_velocity: 6,
      engagement_quality: 8,
      original_song_response: 8,
      brand_personality: 6,
      content_consistency: 4,
      commercial_potential: 6,
      professionalism: 5,
      notes: 'One cover at 92k views with comments asking "why is she not famous". Small sample size, needs more data before outreach.',
    },
  ];
  const insert = db.prepare(`
    INSERT INTO artists (
      created_at, updated_at, name, stage, genre, location, scout_name,
      tiktok_url, instagram_url, youtube_url, spotify_url, soundcloud_url,
      followers_count, monthly_listeners, growth_velocity_pct, engagement_rate_pct,
      music_talent, growth_velocity, engagement_quality, original_song_response,
      brand_personality, content_consistency, commercial_potential, professionalism,
      notes
    ) VALUES (
      @created_at, @updated_at, @name, @stage, @genre, @location, @scout_name,
      @tiktok_url, @instagram_url, @youtube_url, @spotify_url, @soundcloud_url,
      @followers_count, @monthly_listeners, @growth_velocity_pct, @engagement_rate_pct,
      @music_talent, @growth_velocity, @engagement_quality, @original_song_response,
      @brand_personality, @content_consistency, @commercial_potential, @professionalism,
      @notes
    )
  `);
  const tx = db.transaction((items: ArtistInput[]) => {
    for (const it of items) {
      insert.run({
        created_at: now,
        updated_at: now,
        genre: null,
        location: null,
        scout_name: null,
        tiktok_url: null,
        instagram_url: null,
        youtube_url: null,
        spotify_url: null,
        soundcloud_url: null,
        followers_count: null,
        monthly_listeners: null,
        growth_velocity_pct: null,
        engagement_rate_pct: null,
        notes: null,
        ...it,
      });
    }
  });
  tx(seed);

  // Seed a snapshot + a bit of activity history for each demo artist.
  const seedActor = { name: 'Stephen' };
  for (const artist of getAllArtists()) {
    snapshotScore(artist);
    if (artist.name === 'Maya X') {
      addLogEntry(artist.id, {
        type: 'outreach',
        message: 'Sent an initial DM introducing Scout and asking about her original music plans.',
      }, seedActor);
      addLogEntry(artist.id, {
        type: 'response',
        message: 'She replied — open to a call next week. Scheduling.',
      }, seedActor);
    }
    if (artist.name === 'Ada Bloom') {
      addLogEntry(artist.id, {
        type: 'note',
        message: 'Flagged by scout after her cover of "Undertow" hit 92k views with unusually strong comment sentiment.',
      }, seedActor);
    }
  }
}

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
  'music_talent', 'growth_velocity', 'engagement_quality', 'original_song_response',
  'brand_personality', 'content_consistency', 'commercial_potential', 'professionalism',
  'notes', 'photo_url', 'bio', 'top_song_url', 'song_preview_url', 'why_trending',
] as const;

export function createArtist(input: ArtistInput, actor?: Actor | null): Artist {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { created_at: now, updated_at: now, created_by: actor?.id ?? null };
  for (const field of WRITABLE_FIELDS) {
    row[field] = (input as any)[field] ?? (field === 'stage' ? 'watchlist' : null);
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

const USER_COLUMNS = 'id, created_at, name, email, role, next_credits_cents';

// New accounts always start as 'public' — internal/admin is never
// self-selected, only granted via setUserRole (an admin) or the
// ADMIN_EMAILS bootstrap in lib/auth.ts.
export function createUser(input: { name: string; email: string; password_hash: string }): User {
  const now = new Date().toISOString();
  const info = db
    .prepare("INSERT INTO users (created_at, name, email, password_hash, role) VALUES (?, ?, ?, ?, 'public')")
    .run(now, input.name, input.email.toLowerCase(), input.password_hash);
  return getUserById(info.lastInsertRowid as number)!;
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
  return db.prepare(`
    SELECT next_transactions.*, artists.name AS artist_name
    FROM next_transactions
    JOIN artists ON artists.id = next_transactions.artist_id
    WHERE next_transactions.user_id = ?
    ORDER BY next_transactions.created_at DESC
    LIMIT ?
  `).all(userId, limit) as (NextTransaction & { artist_name: string })[];
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
        INSERT INTO next_transactions (user_id, artist_id, created_at, type, shares, price_cents_per_share, credits_delta_cents)
        VALUES (?, ?, ?, 'buy', ?, ?, ?)
      `).run(userId, artistId, now, shares, executionCents, -creditsAmountCents);

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
