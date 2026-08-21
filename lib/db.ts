import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { breakoutScore } from './scoring';
import { DATA_DIR } from './data-dir';
import {
  Agreement, AgreementInput, Artist, ArtistInput, DueFollowUp, InvestmentEntry, InvestmentEntryInput,
  LogEntry, LogEntryInput, RevenueEntry, RevenueEntryInput, RevenueSource, Role, ScoreSnapshot, User,
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
  'notes',
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
