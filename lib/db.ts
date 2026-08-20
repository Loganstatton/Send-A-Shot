import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { breakoutScore } from './scoring';
import { Artist, ArtistInput, LogEntry, LogEntryInput, ScoreSnapshot } from './types';

const dbFile = path.join(process.cwd(), 'data', 'app.db');
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
CREATE TABLE IF NOT EXISTS contact_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'note',
  message TEXT NOT NULL,
  author TEXT
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
`);

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
  for (const artist of getAllArtists()) {
    snapshotScore(artist);
    if (artist.name === 'Maya X') {
      addLogEntry(artist.id, {
        type: 'outreach',
        message: 'Sent an initial DM introducing Scout and asking about her original music plans.',
        author: 'Stephen',
      });
      addLogEntry(artist.id, {
        type: 'response',
        message: 'She replied — open to a call next week. Scheduling.',
        author: 'Stephen',
      });
    }
    if (artist.name === 'Ada Bloom') {
      addLogEntry(artist.id, {
        type: 'note',
        message: 'Flagged by scout after her cover of "Undertow" hit 92k views with unusually strong comment sentiment.',
        author: 'Stephen',
      });
    }
  }
}

export function getAllArtists(): Artist[] {
  return db.prepare('SELECT * FROM artists ORDER BY updated_at DESC').all() as Artist[];
}

export function getArtist(id: number): Artist | undefined {
  return db.prepare('SELECT * FROM artists WHERE id = ?').get(id) as Artist | undefined;
}

const WRITABLE_FIELDS = [
  'name', 'stage', 'genre', 'location', 'scout_name',
  'tiktok_url', 'instagram_url', 'youtube_url', 'spotify_url', 'soundcloud_url',
  'followers_count', 'monthly_listeners', 'growth_velocity_pct', 'engagement_rate_pct',
  'music_talent', 'growth_velocity', 'engagement_quality', 'original_song_response',
  'brand_personality', 'content_consistency', 'commercial_potential', 'professionalism',
  'notes',
] as const;

export function createArtist(input: ArtistInput): Artist {
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { created_at: now, updated_at: now };
  for (const field of WRITABLE_FIELDS) {
    row[field] = (input as any)[field] ?? (field === 'stage' ? 'watchlist' : null);
  }
  const columns = ['created_at', 'updated_at', ...WRITABLE_FIELDS];
  const placeholders = columns.map((c) => `@${c}`).join(', ');
  const info = db
    .prepare(`INSERT INTO artists (${columns.join(', ')}) VALUES (${placeholders})`)
    .run(row);
  const artist = getArtist(info.lastInsertRowid as number)!;
  snapshotScore(artist);
  return artist;
}

export function updateArtist(id: number, input: ArtistInput): Artist | undefined {
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
    });
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

export function addLogEntry(artistId: number, input: LogEntryInput): LogEntry {
  const now = new Date().toISOString();
  const info = db
    .prepare('INSERT INTO contact_log (artist_id, created_at, type, message, author) VALUES (?, ?, ?, ?, ?)')
    .run(artistId, now, input.type, input.message, input.author ?? null);
  return db.prepare('SELECT * FROM contact_log WHERE id = ?').get(info.lastInsertRowid) as LogEntry;
}

export function deleteLogEntry(artistId: number, logId: number): boolean {
  const info = db
    .prepare('DELETE FROM contact_log WHERE id = ? AND artist_id = ?')
    .run(logId, artistId);
  return info.changes > 0;
}
