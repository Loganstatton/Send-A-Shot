import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { Artist, ArtistInput } from './types';

const dbFile = path.join(process.cwd(), 'data', 'app.db');
const dir = path.dirname(dbFile);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

export const db = new Database(dbFile);

db.pragma('journal_mode = WAL');

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
  return getArtist(info.lastInsertRowid as number)!;
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
  return getArtist(id);
}

export function deleteArtist(id: number): boolean {
  const info = db.prepare('DELETE FROM artists WHERE id = ?').run(id);
  return info.changes > 0;
}
